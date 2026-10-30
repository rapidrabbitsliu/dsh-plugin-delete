/**
 * Host half of dsh-plugin-delete.
 *
 * The harness keeps no session-delete or folder-delete capability, so this
 * plugin owns those removals itself:
 *  - session logs under `<DSH_HOME>/sessions/<project>/<sessionId>/`
 *  - projection caches under `<DSH_HOME>/storages/session_projcache/sessions/`
 *  - registry references (pin / archive / workspace accounting)
 *
 * The client half reaches these operations over package-private HTTP routes
 * under `/plugin-delete/api` (registered on ctx.webServer), because the
 * generated `ctx.remote` namespaces are fixed at build time.
 */
import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'

export const inject = ['webServer', 'workspaceRegistry', 'workspaceController', 'agents', 'tools']

const VERSION = '0.2.2'
const POLL_MS = 25000
const DEFERRED_FALLBACK_MS = 60000
const RM_OPTIONS = { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }

export function apply(ctx, config = {}) {
  const info = (message, error) => ctx.logger?.info?.(`[plugin-delete] ${message}${error ? `: ${error?.stack ?? error}` : ''}`)

  const home = path.resolve(config.home ?? process.env.DSH_HOME ?? path.join(os.homedir(), '.dsh'))
  const sessionsRoot = path.resolve(config.sessionsRoot ?? path.join(home, 'sessions'))
  const projcacheDir = path.resolve(config.projcacheDir ?? path.join(home, 'storages', 'session_projcache', 'sessions'))
  info(`sessions root=${sessionsRoot} projcache=${projcacheDir}`)

  /* ---------------- session record removal ---------------- */

  async function sessionRecordDirs(sessionId) {
    const found = []
    let projects
    try {
      projects = await readdir(sessionsRoot, { withFileTypes: true })
    } catch {
      return found
    }
    for (const entry of projects) {
      if (!entry.isDirectory()) continue
      const dir = path.join(sessionsRoot, entry.name, sessionId)
      try {
        if ((await stat(dir)).isDirectory()) found.push(dir)
      } catch {}
    }
    return found
  }

  async function removeRecordFiles(sessionId) {
    const dirs = await sessionRecordDirs(sessionId)
    for (const dir of dirs) await rm(dir, RM_OPTIONS)
    try {
      await rm(path.join(projcacheDir, `${sessionId}.json`), { force: true })
    } catch {}
    return dirs.length > 0
  }

  async function registryCleanups(sessionId) {
    try {
      await ctx.workspaceRegistry.unarchiveSession(sessionId)
    } catch {}
    try {
      await ctx.workspaceRegistry.unpinSession(sessionId)
    } catch {}
    try {
      for (const workspace of ctx.workspaceRegistry.list()) {
        if (workspace.sessionIds.includes(sessionId)) await workspace.detachSession(sessionId)
      }
    } catch {}
  }

  /** Deferred physical removals waiting for `session/disposed` (live agent). */
  const pendingSessions = new Map() // sessionId -> disposer

  const pendingEffect = ctx.effect(() => () => {
    for (const dispose of pendingSessions.values()) dispose()
    pendingSessions.clear()
  }, 'plugin-delete: pending removals')
  void pendingEffect

  async function finishRemoval(sessionId) {
    try {
      const deleted = await removeRecordFiles(sessionId)
      await registryCleanups(sessionId)
      ctx.emit('api-session/removed', sessionId)
      info(`deferred removal of ${sessionId}: ${deleted ? 'deleted' : 'absent'}`)
    } catch (error) {
      info(`deferred removal of ${sessionId} failed`, error)
    }
  }

  function deferRemoval(sessionId) {
    if (pendingSessions.has(sessionId)) return
    const disposer = ctx.effect(() => {
      const off = ctx.on('session/disposed', (session) => {
        if (session?.id !== sessionId) return
        if (pendingSessions.delete(sessionId)) {
          off()
          void finishRemoval(sessionId)
        }
      })
      const timer = setTimeout(() => {
        if (pendingSessions.delete(sessionId)) {
          off()
          void finishRemoval(sessionId)
        }
      }, DEFERRED_FALLBACK_MS)
      return () => {
        off()
        clearTimeout(timer)
      }
    }, `plugin-delete: deferred ${sessionId}`)
    pendingSessions.set(sessionId, disposer)
  }

  /**
   * Stop a live session's work (mirrors the sidebar stop-and-archive) and
   * report whether the physical removal ran now or waits for disposal.
   * Cold sessions are removed immediately.
   */
  async function purgeSession(sessionId) {
    try {
      if (ctx.agents.get(sessionId)) {
        // Archive with stopActivity stops turns, subagents, jobs, and reminders.
        // For an id the client half already archived this resolves without writing.
        await ctx.workspaceRegistry.archiveSession(sessionId, { stopActivity: true })
        deferRemoval(sessionId)
        return { id: sessionId, status: 'pending-close' }
      }
      const deleted = await removeRecordFiles(sessionId)
      await registryCleanups(sessionId)
      if (deleted) ctx.emit('api-session/removed', sessionId)
      return { id: sessionId, status: deleted ? 'deleted' : 'absent' }
    } catch (error) {
      return { id: sessionId, status: 'failed', error: String(error?.message ?? error) }
    }
  }

  /* ---------------- workspace folder removal ---------------- */

  async function removeFolder(rawPath) {
    try {
      const target = path.resolve(String(rawPath))
      const inside = (base, other) => other === base || other.startsWith(base + path.sep)
      if (!path.isAbsolute(target)) return { path: target, status: 'refused', reason: 'not-absolute' }
      if (target === path.parse(target).root) return { path: target, status: 'refused', reason: 'drive-root' }
      if (target === home || inside(home, target)) return { path: target, status: 'refused', reason: 'inside-dsh-home' }
      const realHome = path.resolve(os.homedir())
      if (target === realHome) return { path: target, status: 'refused', reason: 'home-directory' }
      let current
      try {
        current = await stat(target)
      } catch {
        return { path: target, status: 'missing' }
      }
      if (!current.isDirectory()) return { path: target, status: 'refused', reason: 'not-a-directory' }
      await rm(target, RM_OPTIONS)
      return { path: target, status: 'deleted' }
    } catch (error) {
      return { path: String(rawPath), status: 'failed', error: String(error?.message ?? error) }
    }
  }

  /* ---------------- workspace-deletion offers ---------------- */

  const offers = new Map() // offerId -> offer
  /**
   * Workspace ids whose registration removal this plugin initiated through
   * `/delete-workspace`. The removal watch below skips creating a follow-up
   * cleanup offer for those: the unified dialog already handled the options.
   */
  const selfInitiatedDeletions = new Set()
  let offerSeq = 0
  let previousWorkspaces = null // Map id -> offer data

  function snapshotWorkspaces() {
    const snapshot = new Map()
    try {
      for (const workspace of ctx.workspaceRegistry.list()) {
        snapshot.set(String(workspace.id), {
          workspaceId: String(workspace.id),
          title: workspace.title,
          path: workspace.path,
          sessionIds: [...workspace.sessionIds],
        })
      }
    } catch (error) {
      info('workspace snapshot failed', error)
    }
    return snapshot
  }

  const wakeListeners = new Set()

  function wakeListenersNow() {
    for (const wake of [...wakeListeners]) wake()
  }

  function addOffer(workspace) {
    offerSeq += 1
    const offerId = `offer-${Date.now().toString(36)}-${offerSeq}`
    offers.set(offerId, { offerId, ...workspace, sessionCount: workspace.sessionIds.length })
    info(`workspace ${workspace.workspaceId} removed; offer ${offerId} created`)
    wakeListenersNow()
  }

  ctx.effect(() => {
    previousWorkspaces = snapshotWorkspaces()
    const off = ctx.on('domain/changed', () => {
      const current = snapshotWorkspaces()
      const previous = previousWorkspaces
      previousWorkspaces = current
      if (!previous) return
      for (const [id, workspace] of previous) {
        if (current.has(id)) continue
        if (selfInitiatedDeletions.delete(id)) {
          info(`workspace ${id} removal was plugin-initiated; no cleanup offer`)
          continue
        }
        addOffer(workspace)
      }
    })
    return off
  }, 'plugin-delete: workspace removal watch')

  /* ---------------- HTTP bridge ---------------- */

  /** In-memory diagnostics ring reported by the client interceptor. */
  const debugRing = []

  async function handleDebug(req, res) {
    const body = await readBody(req)
    const entry = body && typeof body === 'object' ? { at: Date.now(), ...body } : { at: Date.now(), raw: String(body) }
    debugRing.unshift(entry)
    if (debugRing.length > 24) debugRing.length = 24
    respond(res, 200, { ok: true })
  }

  async function readBody(req) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > 1_000_000) throw new Error('request body too large')
      chunks.push(chunk)
    }
    if (!chunks.length) return {}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }

  function respond(res, status, payload) {
    if (res.headersSent) return
    const body = JSON.stringify(payload)
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': Buffer.byteLength(body),
      'cache-control': 'no-store',
    })
    res.end(body)
  }

  function handlePending(req, res) {
    if (offers.size > 0) {
      respond(res, 200, { ok: true, offers: [...offers.values()] })
      return
    }
    let done = false
    let timer
    const wake = () => {
      if (done) return
      done = true
      wakeListeners.delete(wake)
      clearTimeout(timer)
      if (res.writableEnded || res.destroyed) return
      respond(res, 200, { ok: true, offers: [...offers.values()] })
    }
    timer = setTimeout(wake, POLL_MS)
    wakeListeners.add(wake)
    req.on('close', () => {
      done = true
      wakeListeners.delete(wake)
      clearTimeout(timer)
    })
  }

  async function handleDismiss(req, res) {
    const body = await readBody(req)
    const ids = Array.isArray(body?.offerIds) ? body.offerIds : [body?.offerId]
    for (const offerId of ids) if (offerId) offers.delete(String(offerId))
    respond(res, 200, { ok: true })
  }

  async function handleApply(req, res) {
    const body = await readBody(req)
    const offer = offers.get(String(body?.offerId ?? ''))
    if (!offer) {
      respond(res, 404, { ok: false, error: 'offer-not-found' })
      return
    }
    const result = { ok: true, sessions: null, folder: null }
    if (body?.deleteSessions === true && offer.sessionIds.length > 0) {
      result.sessions = []
      for (const sessionId of offer.sessionIds) {
        result.sessions.push(await purgeSession(String(sessionId)))
      }
    }
    if (body?.deleteFiles === true) {
      result.folder = await removeFolder(offer.path)
    }
    offers.delete(String(body.offerId))
    respond(res, 200, result)
  }

  async function handleDeleteSessions(req, res) {
    const body = await readBody(req)
    const ids = Array.isArray(body?.ids) ? body.ids.map(String) : []
    const results = []
    for (const sessionId of ids) results.push(await purgeSession(sessionId))
    respond(res, 200, { ok: true, results })
  }

  function findWorkspace(workspaceId) {
    for (const workspace of ctx.workspaceRegistry.list()) {
      if (String(workspace.id) === workspaceId) return workspace
    }
    return null
  }

  async function handleWsInfo(req, res) {
    const body = await readBody(req)
    const workspaceId = String(body?.workspaceId ?? '')
    const workspace = workspaceId ? findWorkspace(workspaceId) : null
    if (!workspace) {
      respond(res, 404, { ok: false, error: 'unknown-workspace' })
      return
    }
    respond(res, 200, {
      ok: true,
      workspace: {
        workspaceId,
        title: workspace.title,
        path: workspace.path,
        sessionIds: [...workspace.sessionIds],
      },
    })
  }

  /**
   * Unified first-dialog delete: remove the registration through the same
   * controller path the sidebar uses, then optionally purge session records
   * and the folder, all in one round-trip.
   */
  async function handleDeleteWorkspace(req, res) {
    const body = await readBody(req)
    const workspaceId = String(body?.workspaceId ?? '')
    const workspace = workspaceId ? findWorkspace(workspaceId) : null
    if (!workspace) {
      respond(res, 404, { ok: false, error: 'unknown-workspace' })
      return
    }
    const captured = { title: workspace.title, path: workspace.path, sessionIds: [...workspace.sessionIds] }
    selfInitiatedDeletions.add(workspaceId)
    try {
      await ctx.workspaceController.delete({ workspaceId })
    } catch (error) {
      selfInitiatedDeletions.delete(workspaceId)
      respond(res, 500, { ok: false, error: `workspace-delete-failed: ${String(error?.message ?? error)}` })
      return
    }
    const result = { ok: true, workspace: { workspaceId, title: captured.title, status: 'deleted' }, sessions: null, folder: null }
    if (body?.deleteSessions === true && captured.sessionIds.length > 0) {
      result.sessions = []
      for (const sessionId of captured.sessionIds) {
        const self = ctx.agents.currentInitiator?.()?.id
        if (self && String(sessionId) === String(self)) {
          result.sessions.push({ id: String(sessionId), status: 'refused-self-delete' })
        } else {
          result.sessions.push(await purgeSession(String(sessionId)))
        }
      }
    }
    if (body?.deleteFiles === true) {
      result.folder = await removeFolder(captured.path)
    }
    respond(res, 200, result)
  }

  function handleInfo(req, res) {
    respond(res, 200, {
      ok: true,
      version: VERSION,
      home,
      sessionsRoot,
      projcacheDir,
      offers: [...offers.keys()],
      pendingRemovals: [...pendingSessions.keys()],
      debug: debugRing,
    })
  }

  const routes = [
    { path: '/plugin-delete/api/info', method: 'GET', handler: handleInfo },
    { path: '/plugin-delete/api/pending', method: 'GET', handler: handlePending },
    { path: '/plugin-delete/api/dismiss', method: 'POST', handler: handleDismiss },
    { path: '/plugin-delete/api/apply', method: 'POST', handler: handleApply },
    { path: '/plugin-delete/api/ws-info', method: 'POST', handler: handleWsInfo },
    { path: '/plugin-delete/api/delete-workspace', method: 'POST', handler: handleDeleteWorkspace },
    { path: '/plugin-delete/api/delete-sessions', method: 'POST', handler: handleDeleteSessions },
    { path: '/plugin-delete/api/debug', method: 'POST', handler: handleDebug },
  ]

  ctx.effect(() => {
    const dispose = ctx.webServer.register({
      kind: 'prefix',
      path: '/plugin-delete/api',
      async handler(req, res) {
        const pathname = String(req.url ?? '').split('?')[0].replace(/\/+$/, '') || '/'
        const method = String(req.method ?? 'GET').toUpperCase()
        const match = routes.find((route) => route.path === pathname)
        try {
          if (!match) return respond(res, 404, { ok: false, error: 'not-found' })
          if (method !== match.method) return respond(res, 405, { ok: false, error: 'method-not-allowed' })
          return await match.handler(req, res)
        } catch (error) {
          info(`route ${pathname} failed`, error)
          try {
            respond(res, 500, { ok: false, error: String(error?.message ?? error) })
          } catch {}
        }
      },
    })
    return dispose
  }, 'plugin-delete: http routes')

  /* ---------------- agent tool ---------------- */

  ctx.effect(() => {
    const dispose = ctx.tools.register({
      name: 'delete_records',
      description:
        'Permanently delete harness records this plugin owns: session logs (conversation history) by session id, and every file inside a workspace folder. The current session cannot self-delete. Live sessions are stopped first and their files are removed when they close. A folder delete is irreversible: there is no trash.',
      // Direct registration takes wire-format JSON Schema, not defineTool's shorthand.
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            description: "'sessions' deletes the listed session records; 'folder' deletes every file inside folderPath.",
          },
          sessionIds: { type: 'array', items: { type: 'string' }, description: 'Session ids for action=sessions.' },
          folderPath: { type: 'string', description: 'Absolute workspace folder path for action=folder.' },
        },
        required: ['action'],
        additionalProperties: false,
      },
      output: {
        schema: { type: 'object' },
        render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
      },
      async execute(args, exec) {
        void exec
        if (args.action === 'sessions') {
          const ids = Array.isArray(args.sessionIds) ? args.sessionIds.map(String) : []
          if (!ids.length) throw new Error('action=sessions needs a non-empty sessionIds list')
          const self = ctx.agents.currentInitiator?.()?.id
          const results = []
          for (const sessionId of ids) {
            if (self && sessionId === String(self)) {
              results.push({ id: sessionId, status: 'refused-self-delete' })
            } else {
              results.push(await purgeSession(sessionId))
            }
          }
          return { action: 'sessions', results }
        }
        if (args.action === 'folder') {
          if (!args.folderPath) throw new Error('action=folder needs folderPath')
          return { action: 'folder', folder: await removeFolder(args.folderPath) }
        }
        throw new Error(`unknown action ${String(args.action)}`)
      },
    })
    return dispose
  }, 'plugin-delete: delete_records tool')
}
