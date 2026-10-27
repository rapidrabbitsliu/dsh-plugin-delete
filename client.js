/**
 * Client half of @dsh-plugins-collection/dsh-plugin-delete (Module Loader lane, plain JS, no JSX).
 *
 * - Registers a "Delete session" row in each session's menu.
 * - Intercepts the host's workspace "..." menu delete item and shows the
 *   unified dialog (registration delete + optional session-record and
 *   folder-content removal) in place of the host's own confirmation.
 * - Registers one persistent `shell.overlay` entry that owns the dialogs and
 *   long-polls the Host half for cleanup offers as a backstop.
 * - Custom controls copy host markup/behavior and style only with
 *   `--dsw-alias-*` theme tokens.
 */
window.__ModuleLoader__.load({
  id: '@dsh-plugins-collection/dsh-plugin-delete',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'plugin-delete'

    const en = {
      'menu.delete': 'Delete session',
      'session.title': 'Delete session',
      'session.body': 'Permanently delete the conversation record of “{title}”? The history is removed for good. Files in the workspace folder are kept.',
      'session.untitled': 'Untitled session',
      'action.delete': 'Delete',
      'action.cancel': 'Cancel',
      'action.close': 'Close',
      'phase.busy': 'Deleting…',
      'result.deleted': 'Records deleted.',
      'result.pending': 'The session is closing; its records will be removed automatically.',
      'error.generic': 'Delete failed.',
      'ws.title': 'Clean up deleted workspace',
      'ws.body': 'Workspace “{title}” was removed from the list. Choose what else to delete:',
      'ws.sessions': 'Delete its {count} session record(s)',
      'ws.sessions-none': 'Delete session records (none found)',
      'ws.files': 'Delete all files in {path}',
      'ws.files-hint': 'The folder and everything inside it are permanently deleted. There is no trash.',
      'action.keep': 'Keep',
      'ws.res.records': 'Deleted {count} session record(s).',
      'ws.res.pending': '{count} session(s) are closing; their records will be removed automatically.',
      'ws.res.failed': 'Failed to delete {count} session record(s).',
      'ws.res.folder': 'Folder contents deleted.',
      'ws.res.folder-missing': 'The folder no longer exists.',
      'ws.res.refused': 'Folder delete refused ({reason}).',
      'ws.res.failed-folder': 'Folder delete failed.',
      'ws.res.none': 'Nothing was deleted.',
      'ws.pre.title': 'Delete workspace',
      'ws.pre.body': 'This removes “{name}” from the workspace list. Its sessions will appear under Ungrouped unless deleted below.',
      'ws.pre.confirm': 'Delete workspace',
      'ws.pre.pending': 'Deleting workspace…',
      'ws.pre.res.workspace': 'Workspace removed from the list.',
    }

    const zh = {
      'menu.delete': '删除会话',
      'session.title': '删除会话',
      'session.body': '要彻底删除「{title}」的会话记录吗？聊天记录将被永久移除，工作区文件夹中的文件不受影响。',
      'session.untitled': '未命名会话',
      'action.delete': '删除',
      'action.cancel': '取消',
      'action.close': '关闭',
      'phase.busy': '正在删除…',
      'result.deleted': '记录已删除。',
      'result.pending': '会话正在关闭，其记录将在关闭后自动删除。',
      'error.generic': '删除失败。',
      'ws.title': '清理已删除的工作区',
      'ws.body': '工作区「{title}」已从列表移除。是否继续删除：',
      'ws.sessions': '删除其 {count} 条会话记录',
      'ws.sessions-none': '删除会话记录（未找到）',
      'ws.files': '删除「{path}」下的所有文件',
      'ws.files-hint': '该文件夹及其全部内容将被永久删除，无法恢复。',
      'action.keep': '保留',
      'ws.res.records': '已删除 {count} 条会话记录。',
      'ws.res.pending': '{count} 个会话正在关闭，其记录将自动删除。',
      'ws.res.failed': '有 {count} 条会话记录删除失败。',
      'ws.res.folder': '文件夹内容已删除。',
      'ws.res.folder-missing': '该文件夹已不存在。',
      'ws.res.refused': '文件夹删除被拒绝（{reason}）。',
      'ws.res.failed-folder': '文件夹删除失败。',
      'ws.res.none': '未删除任何内容。',
      'ws.pre.title': '删除工作区',
      'ws.pre.body': '将把「{name}」从工作区列表中移除。文件夹与会话记录默认保留，其会话将显示在“未分组”下；如需一并删除，请勾选下方选项。',
      'ws.pre.confirm': '删除工作区',
      'ws.pre.pending': '正在删除工作区…',
      'ws.pre.res.workspace': '工作区已从列表移除。',
    }

    const CSS = `
.pd-backdrop{position:fixed;inset:0;z-index:40;display:flex;align-items:center;justify-content:center;padding:24px;pointer-events:auto;background:color-mix(in srgb, var(--dsw-alias-bg-base) 55%, transparent)}
.pd-card{box-sizing:border-box;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l1);border-radius:12px;padding:18px 20px;width:min(460px, 100%);box-shadow:0 16px 48px color-mix(in srgb, var(--dsw-alias-bg-base) 75%, transparent);outline:none;font-size:13px;line-height:1.6}
.pd-title{margin:0 0 8px;font-size:15px;font-weight:600}
.pd-body{margin:0 0 10px;color:var(--dsw-alias-label-secondary);overflow-wrap:anywhere}
.pd-option{display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;margin-bottom:8px;cursor:pointer}
.pd-option:hover{background:var(--dsw-alias-bg-layer-1)}
.pd-option[aria-disabled="true"]{opacity:0.55;cursor:default}
.pd-option input{margin:3px 0 0;accent-color:var(--dsw-alias-brand-primary)}
.pd-option-main{display:flex;flex-direction:column;gap:2px}
.pd-hint{color:var(--dsw-alias-label-secondary);font-size:12px;overflow-wrap:anywhere}
.pd-error{margin:0 0 10px;color:var(--dsw-alias-state-error-primary)}
.pd-lines{margin:0 0 10px;color:var(--dsw-alias-label-secondary);display:flex;flex-direction:column;gap:4px}
.pd-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}
.pd-btn{font:inherit;font-size:13px;border-radius:8px;padding:6px 16px;cursor:pointer;border:1px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-primary)}
.pd-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-1)}
.pd-btn-danger{border-color:transparent;background:var(--dsw-alias-state-error-primary);color:#fff}
.pd-btn-danger:hover:not(:disabled){background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 88%, var(--dsw-alias-bg-base));color:#fff}
.pd-btn:disabled{opacity:0.6;cursor:default}
.pd-busy{display:inline-flex;align-items:center;gap:8px;color:var(--dsw-alias-label-secondary)}
.pd-spinner{width:14px;height:14px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:pd-rotate 0.9s linear infinite}
@keyframes pd-rotate{to{transform:rotate(360deg)}}
.pd-menu-item{display:flex;width:100%;align-items:center;gap:8px;padding:6px 10px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-state-error-primary);font:inherit;font-size:13px;text-align:start;cursor:pointer}
.pd-menu-item:hover{background:color-mix(in srgb, var(--dsw-alias-state-error-primary) 12%, transparent)}
.pd-menu-item:focus-visible{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:-1px}
`

    /* ---------------- shared dialog store ---------------- */

    const subscribers = new Set()
    const queue = []
    let current = null
    let snapshot = { current: null }

    function notify() {
      snapshot = { current }
      subscribers.forEach((fn) => fn())
    }
    function openDialog(entry) {
      if (current) {
        if (!queue.some((queued) => sameEntry(queued, entry))) queue.push(entry)
        return
      }
      current = entry
      notify()
    }
    function closeCurrent() {
      current = queue.shift() ?? null
      notify()
    }
    function sameEntry(a, b) {
      if (!a || !b || a.kind !== b.kind) return false
      if (a.kind === 'session') return a.sessionId === b.sessionId
      if (a.kind === 'workspace-pre') return a.workspaceId === b.workspaceId
      return a.offer.offerId === b.offer.offerId
    }
    function subscribe(fn) {
      subscribers.add(fn)
      return () => subscribers.delete(fn)
    }
    function getSnapshot() {
      return snapshot
    }

    /* ---------------- shared helpers ---------------- */

    let appCtx = null

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    async function jsonFetch(path, init) {
      const response = await fetch(path, init)
      let data = null
      try {
        data = await response.json()
      } catch {}
      if (!response.ok) {
        throw new Error(String(data?.error ?? `HTTP ${response.status}`))
      }
      return data ?? {}
    }

    /** Stop running work / release the main-view reference, then drop records. */
    async function archiveQuietly(sessionId) {
      try {
        await appCtx.uiWorkspace.archiveSession(sessionId, { stopActivity: true })
      } catch {}
    }

    /* ---------------- shared pieces ---------------- */

    function StyleTag() {
      return h('style', { 'data-plugin-delete': 'style' }, CSS)
    }

    function GlyphTrash() {
      return h('svg', {
        'aria-hidden': true,
        width: 14,
        height: 14,
        viewBox: '0 0 16 16',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.4,
        'stroke-linecap': 'round',
      },
        h('path', { d: 'M2.5 4.2h11' }),
        h('path', { d: 'M6.3 4.2V2.8h3.4v1.4' }),
        h('path', { d: 'M3.9 4.2l.7 8.4a1.2 1.2 0 0 0 1.2 1.1h4.4a1.2 1.2 0 0 0 1.2-1.1l.7-8.4' }),
        h('path', { d: 'M6.7 6.8v4.6M9.3 6.8v4.6' }))
    }

    function Modal(props) {
      const { onClose, labelledBy, children } = props
      const ref = React.useRef(null)
      React.useEffect(() => {
        ref.current?.focus?.()
      }, [])
      return h('div', {
        className: 'pd-backdrop',
        onMouseDown: (event) => {
          if (onClose && event.target === event.currentTarget) onClose()
        },
      }, h('div', {
        ref,
        className: 'pd-card',
        role: 'dialog',
        'aria-modal': true,
        tabIndex: -1,
        'aria-labelledby': labelledBy,
        onKeyDown: (event) => {
          if (event.key === 'Escape' && onClose) onClose()
        },
      }, children))
    }

    function BusyLine(props) {
      return h('div', { className: 'pd-busy' }, h('span', { className: 'pd-spinner' }), props.label)
    }

    /* ---------------- dialogs ---------------- */

    function SessionDialog(props) {
      const { item, t } = props
      const [phase, setPhase] = React.useState('confirm')
      const [note, setNote] = React.useState('')
      const confirmRef = React.useRef(null)
      React.useEffect(() => {
        confirmRef.current?.focus?.()
      }, [])

      const dismiss = React.useCallback(() => closeCurrent(), [])

      async function confirm() {
        setPhase('busy')
        try {
          await archiveQuietly(item.sessionId)
          const data = await jsonFetch('/plugin-delete/api/delete-sessions', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ids: [item.sessionId] }),
          })
          const result = (data.results ?? [])[0] ?? {}
          if (result.status === 'failed') {
            setNote(String(result.error ?? t('error.generic')))
            setPhase('error')
            return
          }
          if (result.status === 'pending-close') {
            setNote(t('result.pending'))
            setPhase('info')
            setTimeout(dismiss, 1800)
            return
          }
          setNote(t('result.deleted'))
          setPhase('info')
          setTimeout(dismiss, 900)
        } catch (error) {
          setNote(String(error?.message ?? error))
          setPhase('error')
        }
      }

      const titleText = item.title || t('session.untitled')
      return h(Modal, {
        onClose: phase === 'busy' ? null : dismiss,
        labelledBy: 'plugin-delete-session-title',
      },
        h('h2', { className: 'pd-title', id: 'plugin-delete-session-title' }, t('session.title')),
        phase === 'confirm' && h(React.Fragment, null,
          h('p', { className: 'pd-body' }, t('session.body', { title: titleText }))),
        phase === 'busy' && h(React.Fragment, null,
          h('p', { className: 'pd-body' }, titleText),
          h(BusyLine, { label: t('phase.busy') })),
        phase === 'info' && h(React.Fragment, null,
          h('p', { className: 'pd-body' }, note)),
        phase === 'error' && h(React.Fragment, null,
          h('p', { className: 'pd-error' }, note)),
        h('div', { className: 'pd-actions' },
          phase === 'confirm' && h(React.Fragment, null,
            h('button', { className: 'pd-btn', onClick: dismiss }, t('action.cancel')),
            h('button', { ref: confirmRef, className: 'pd-btn pd-btn-danger', onClick: confirm }, t('action.delete'))),
          phase === 'busy' && h('button', { className: 'pd-btn', disabled: true }, t('phase.busy')),
          (phase === 'info' || phase === 'error') && h('button', {
            className: 'pd-btn',
            onClick: dismiss,
            autoFocus: true,
          }, t('action.close'))))
    }

    function WorkspaceDialog(props) {
      const { item, t } = props
      const offer = item.offer
      const sessionIds = Array.isArray(offer.sessionIds) ? offer.sessionIds : []
      const [doSessions, setDoSessions] = React.useState(sessionIds.length > 0)
      const [doFiles, setDoFiles] = React.useState(false)
      const [phase, setPhase] = React.useState('confirm')
      const [lines, setLines] = React.useState([])
      const [error, setError] = React.useState('')
      const confirmRef = React.useRef(null)
      React.useEffect(() => {
        confirmRef.current?.focus?.()
      }, [])

      const dismiss = React.useCallback(() => {
        jsonFetch('/plugin-delete/api/dismiss', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ offerIds: [offer.offerId] }),
        }).catch(() => {})
        closeCurrent()
      }, [offer.offerId])

      async function confirm() {
        setPhase('busy')
        setError('')
        try {
          if (doSessions) {
            for (const sessionId of sessionIds) await archiveQuietly(sessionId)
          }
          const data = await jsonFetch('/plugin-delete/api/apply', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              offerId: offer.offerId,
              deleteSessions: doSessions,
              deleteFiles: doFiles,
            }),
          })
          const out = []
          const sessions = Array.isArray(data.sessions) ? data.sessions : []
          const deleted = sessions.filter((entry) => entry.status === 'deleted' || entry.status === 'absent').length
          const pending = sessions.filter((entry) => entry.status === 'pending-close').length
          const failed = sessions.filter((entry) => entry.status === 'failed').length
          if (deleted > 0) out.push(t('ws.res.records', { count: deleted }))
          if (pending > 0) out.push(t('ws.res.pending', { count: pending }))
          if (failed > 0) out.push(t('ws.res.failed', { count: failed }))
          const folder = data.folder
          if (folder && folder.status === 'deleted') out.push(t('ws.res.folder'))
          else if (folder && folder.status === 'missing') out.push(t('ws.res.folder-missing'))
          else if (folder && folder.status === 'refused') out.push(t('ws.res.refused', { reason: folder.reason }))
          else if (folder && folder.status === 'failed') out.push(t('ws.res.failed-folder'))
          if (!out.length) out.push(t('ws.res.none'))
          setLines(out)
          setPhase('done')
        } catch (err) {
          setError(String(err?.message ?? err))
          setPhase('error')
        }
      }

      return h(Modal, {
        onClose: phase === 'busy' ? null : dismiss,
        labelledBy: 'plugin-delete-ws-title',
      },
        h('h2', { className: 'pd-title', id: 'plugin-delete-ws-title' }, t('ws.title')),
        phase === 'confirm' && h(React.Fragment, null,
          h('p', { className: 'pd-body' }, t('ws.body', { title: offer.title || offer.path })),
          h('label', {
            className: 'pd-option',
            'aria-disabled': sessionIds.length === 0 ? 'true' : 'false',
          },
            h('input', {
              type: 'checkbox',
              checked: doSessions,
              disabled: sessionIds.length === 0,
              onChange: (event) => setDoSessions(event.target.checked),
            }),
            h('span', { className: 'pd-option-main' },
              h('span', null, sessionIds.length > 0
                ? t('ws.sessions', { count: sessionIds.length })
                : t('ws.sessions-none')))),
          h('label', { className: 'pd-option' },
            h('input', {
              type: 'checkbox',
              checked: doFiles,
              onChange: (event) => setDoFiles(event.target.checked),
            }),
            h('span', { className: 'pd-option-main' },
              h('span', null, t('ws.files', { path: offer.path })),
              h('span', { className: 'pd-hint' }, t('ws.files-hint'))))),
        phase === 'busy' && h(BusyLine, { label: t('phase.busy') }),
        phase === 'done' && h('div', { className: 'pd-lines' },
          lines.map((line, index) => h('p', { key: index }, line))),
        phase === 'error' && h('p', { className: 'pd-error' }, error),
        h('div', { className: 'pd-actions' },
          phase === 'confirm' && h(React.Fragment, null,
            h('button', { className: 'pd-btn', onClick: dismiss }, t('action.keep')),
            h('button', {
              ref: confirmRef,
              className: 'pd-btn pd-btn-danger',
              onClick: confirm,
              disabled: !doSessions && !doFiles,
            }, t('action.delete'))),
          phase === 'busy' && h('button', { className: 'pd-btn', disabled: true }, t('phase.busy')),
          (phase === 'done' || phase === 'error') && h('button', {
            className: 'pd-btn',
            onClick: dismiss,
            autoFocus: true,
          }, t('action.close'))))
    }

    /**
     * Unified delete dialog: shown in place of the host's own
     * "Delete workspace" confirmation. Removes the registration and, when
     * checked, also purges session records and the folder in one round-trip.
     */
    function WorkspacePreDialog(props) {
      const { item, t } = props
      const [sessionIds, setSessionIds] = React.useState(null) // null while resolving
      const [doSessions, setDoSessions] = React.useState(false)
      const [doFiles, setDoFiles] = React.useState(false)
      const [phase, setPhase] = React.useState('confirm')
      const [lines, setLines] = React.useState([])
      const [error, setError] = React.useState('')
      const confirmRef = React.useRef(null)
      React.useEffect(() => {
        confirmRef.current?.focus?.()
      }, [])
      React.useEffect(() => {
        let alive = true
        jsonFetch('/plugin-delete/api/ws-info', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ workspaceId: item.workspaceId }),
        }).then((data) => {
          if (alive) setSessionIds(Array.isArray(data.workspace?.sessionIds) ? data.workspace.sessionIds : [])
        }).catch(() => {
          if (alive) setSessionIds([])
        })
        return () => { alive = false }
      }, [item.workspaceId])

      const ids = sessionIds ?? []
      const dismiss = React.useCallback(() => closeCurrent(), [])

      async function confirm() {
        setPhase('busy')
        setError('')
        try {
          if (doSessions) {
            for (const sessionId of ids) await archiveQuietly(sessionId)
          }
          const data = await jsonFetch('/plugin-delete/api/delete-workspace', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              workspaceId: item.workspaceId,
              deleteSessions: doSessions,
              deleteFiles: doFiles,
            }),
          })
          const out = [t('ws.pre.res.workspace')]
          const sessions = Array.isArray(data.sessions) ? data.sessions : []
          const deleted = sessions.filter((entry) => entry.status === 'deleted' || entry.status === 'absent').length
          const pending = sessions.filter((entry) => entry.status === 'pending-close').length
          const failed = sessions.filter((entry) => entry.status === 'failed' || entry.status === 'refused-self-delete').length
          if (deleted > 0) out.push(t('ws.res.records', { count: deleted }))
          if (pending > 0) out.push(t('ws.res.pending', { count: pending }))
          if (failed > 0) out.push(t('ws.res.failed', { count: failed }))
          const folder = data.folder
          if (folder && folder.status === 'deleted') out.push(t('ws.res.folder'))
          else if (folder && folder.status === 'missing') out.push(t('ws.res.folder-missing'))
          else if (folder && folder.status === 'refused') out.push(t('ws.res.refused', { reason: folder.reason }))
          else if (folder && folder.status === 'failed') out.push(t('ws.res.failed-folder'))
          setLines(out)
          setPhase('done')
        } catch (err) {
          setError(String(err?.message ?? err))
          setPhase('error')
        }
      }

      return h(Modal, {
        onClose: phase === 'busy' ? null : dismiss,
        labelledBy: 'plugin-delete-ws-pre-title',
      },
        h('h2', { className: 'pd-title', id: 'plugin-delete-ws-pre-title' }, t('ws.pre.title')),
        phase === 'confirm' && h(React.Fragment, null,
          h('p', { className: 'pd-body' }, t('ws.pre.body', { name: item.title || item.path || item.workspaceId })),
          h('label', {
            className: 'pd-option',
            'aria-disabled': ids.length === 0 ? 'true' : 'false',
          },
            h('input', {
              type: 'checkbox',
              checked: doSessions && ids.length > 0,
              disabled: ids.length === 0,
              onChange: (event) => setDoSessions(event.target.checked),
            }),
            h('span', { className: 'pd-option-main' },
              h('span', null, ids.length > 0
                ? t('ws.sessions', { count: ids.length })
                : t('ws.sessions-none')))),
          h('label', { className: 'pd-option' },
            h('input', {
              type: 'checkbox',
              checked: doFiles,
              onChange: (event) => setDoFiles(event.target.checked),
            }),
            h('span', { className: 'pd-option-main' },
              h('span', null, t('ws.files', { path: item.path || item.workspaceId })),
              h('span', { className: 'pd-hint' }, t('ws.files-hint'))))),
        phase === 'busy' && h(BusyLine, { label: t('ws.pre.pending') }),
        phase === 'done' && h('div', { className: 'pd-lines' },
          lines.map((line, index) => h('p', { key: index }, line))),
        phase === 'error' && h('p', { className: 'pd-error' }, error),
        h('div', { className: 'pd-actions' },
          phase === 'confirm' && h(React.Fragment, null,
            h('button', { className: 'pd-btn', onClick: dismiss }, t('action.cancel')),
            h('button', {
              ref: confirmRef,
              className: 'pd-btn pd-btn-danger',
              onClick: confirm,
              disabled: !doSessions && !doFiles,
            }, t('ws.pre.confirm'))),
          phase === 'busy' && h('button', { className: 'pd-btn', disabled: true }, t('ws.pre.pending')),
          (phase === 'done' || phase === 'error') && h('button', {
            className: 'pd-btn',
            onClick: dismiss,
            autoFocus: true,
          }, t('action.close'))))
    }

    /* ---------------- host-menu interception ---------------- */

    /** Exact host labels of the workspace delete control (en + zh). */
    const HOST_DELETE_LABELS = new Set(['删除工作区', 'Delete workspace'])
    const DELETE_HINT_RE = /删除|移除/
    const DELETE_HINT_RE_EN = /\bdelete\b|\bremove\b/i
    const INTERACTIVE_SELECTOR = 'button,a,[role="button"],[role="menuitem"],[role="menuitemradio"],[role="option"]'

    const collapseText = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim()

    function looksLikeWorkspaceRow(value) {
      return !!value && typeof value === 'object' && !Array.isArray(value) &&
        typeof value.workspaceId === 'string' && value.workspaceId &&
        ('sessionCount' in value || 'label' in value || 'cwd' in value)
    }

    function pickWorkspaceFromProps(props) {
      if (!props || typeof props !== 'object') return null
      if (looksLikeWorkspaceRow(props.row)) return props.row
      if (looksLikeWorkspaceRow(props.workspace)) return props.workspace
      for (const key of Object.keys(props)) {
        const value = props[key]
        if (looksLikeWorkspaceRow(value)) return value
      }
      if (typeof props.workspaceId === 'string' && props.workspaceId) {
        return {
          workspaceId: props.workspaceId,
          label: typeof props.title === 'string' ? props.title : '',
          cwd: typeof props.path === 'string' ? props.path : '',
        }
      }
      return null
    }

    function fiberFrom(el) {
      let node = el
      for (let depth = 0; node && depth < 10; depth += 1) {
        const fiberKey = Object.keys(node).find((key) => key.startsWith('__reactFiber$'))
        if (fiberKey) return node[fiberKey]
        node = node.parentElement
      }
      return null
    }

    /**
     * Decide whether a click asks to delete a workspace: an interactive
     * ancestor carrying delete-looking text, or fiber props naming the
     * delete menu item; then walk the fiber chain (through portals) for the
     * owning workspace row view.
     */
    function analyzeClick(target) {
      const analysis = { tag: target.tagName ? String(target.tagName).toLowerCase() : '', role: null, text: '', deleteHint: false, workspaceId: null, acted: false }
      analysis.role = (target.getAttribute && target.getAttribute('role')) || null
      const interactive = typeof target.closest === 'function' ? target.closest(INTERACTIVE_SELECTOR) : null
      if (interactive) {
        const text = collapseText(interactive.textContent)
        if (text) {
          analysis.text = text.slice(0, 48)
          if (HOST_DELETE_LABELS.has(text) || DELETE_HINT_RE.test(text) || DELETE_HINT_RE_EN.test(text)) analysis.deleteHint = true
        }
        const aria = collapseText(interactive.getAttribute && interactive.getAttribute('aria-label'))
        if (!analysis.text && aria) analysis.text = aria.slice(0, 48)
        if (!analysis.deleteHint && aria && (DELETE_HINT_RE.test(aria) || DELETE_HINT_RE_EN.test(aria))) analysis.deleteHint = true
      }
      let fiber = fiberFrom(target)
      for (let hops = 0; fiber && hops < 400; hops += 1) {
        const props = fiber.memoizedProps
        if (props && typeof props === 'object') {
          if (!analysis.deleteHint) {
            const item = props.item
            if (item && typeof item === 'object' && String(item.id) === 'delete') analysis.deleteHint = true
            const label = typeof props.label === 'string' ? collapseText(props.label) : ''
            if (!analysis.deleteHint && label && (HOST_DELETE_LABELS.has(label) || DELETE_HINT_RE.test(label) || DELETE_HINT_RE_EN.test(label))) analysis.deleteHint = true
          }
          const row = pickWorkspaceFromProps(props)
          if (row) {
            analysis.workspaceId = row.workspaceId
            analysis.title = typeof row.label === 'string' ? row.label : ''
            analysis.path = typeof row.cwd === 'string' ? row.cwd : ''
            break
          }
        }
        fiber = fiber.return
      }
      return analysis
    }

    let probeTimer = null
    let probePending = null
    function debugReport(entry) {
      probePending = entry
      if (probeTimer) return
      probeTimer = setTimeout(() => {
        probeTimer = null
        const payload = probePending
        probePending = null
        if (!payload) return
        jsonFetch('/plugin-delete/api/debug', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        }).catch(() => {})
      }, 350)
    }

    /**
     * Earliest-possible capture (window, capture phase). Recognized deletes
     * are taken over with the unified dialog; everything else proceeds to
     * the host flow, where the post-delete cleanup offer still works as a
     * backstop. Suspicious clicks are reported to the Host ring buffer.
     */
    function installDeleteInterceptor() {
      const onClick = (event) => {
        let analysis = null
        try {
          if (event.defaultPrevented) return
          const target = event.target
          if (!target || typeof target.getAttribute !== 'function') return
          if (typeof target.closest === 'function' && (target.closest('.pd-card') || target.closest('.pd-menu-item'))) return
          analysis = analyzeClick(target)
          if (analysis.deleteHint && analysis.workspaceId) {
            event.preventDefault()
            event.stopPropagation()
            openDialog({ kind: 'workspace-pre', workspaceId: analysis.workspaceId, title: analysis.title || '', path: analysis.path || '' })
            analysis.acted = true
          }
          const interesting = analysis.deleteHint || analysis.workspaceId || analysis.acted ||
            (analysis.text && (DELETE_HINT_RE.test(analysis.text) || DELETE_HINT_RE_EN.test(analysis.text)))
          if (interesting) debugReport(analysis)
        } catch (error) {
          try {
            debugReport({ error: String(error?.message ?? error), text: analysis?.text ?? '', tag: analysis?.tag ?? '', role: analysis?.role ?? '' })
          } catch {}
        }
      }
      window.addEventListener('click', onClick, true)
      return () => window.removeEventListener('click', onClick, true)
    }

    /* ---------------- entry components ---------------- */

    function DialogHost(props) {
      const { t } = props
      const state = React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

      React.useEffect(() => installDeleteInterceptor(), [])

      React.useEffect(() => {
        let stopped = false
        const controller = new AbortController()
        const seen = new Set()
        async function loop() {
          while (!stopped) {
            try {
              const data = await jsonFetch('/plugin-delete/api/pending', { signal: controller.signal })
              for (const offer of data.offers ?? []) {
                if (seen.has(offer.offerId)) continue
                seen.add(offer.offerId)
                openDialog({ kind: 'workspace', offer })
              }
            } catch (error) {
              if (stopped) break
              await sleep(4000)
            }
          }
        }
        loop().catch(() => {})
        return () => {
          stopped = true
          controller.abort()
        }
      }, [])

      const item = state.current
      return h(React.Fragment, null,
        h(StyleTag),
        item && item.kind === 'session' && h(SessionDialog, { key: `session-${item.sessionId}`, item, t }),
        item && item.kind === 'workspace-pre' && h(WorkspacePreDialog, { key: `ws-pre-${item.workspaceId}`, item, t }),
        item && item.kind === 'workspace' && h(WorkspaceDialog, { key: item.offer.offerId, item, t }))
    }

    function DeleteSessionRow(props) {
      const { sessionId, displayTitle, useMenuOpenState, t } = props
      const [, setMenuOpen] = useMenuOpenState()
      return h('button', {
        type: 'button',
        role: 'menuitem',
        className: 'pd-menu-item',
        onClick: (event) => {
          event.stopPropagation()
          setMenuOpen(false)
          openDialog({ kind: 'session', sessionId, title: displayTitle })
        },
      }, h(GlyphTrash), h('span', null, t('menu.delete')))
    }

    return {
      inject: ['slots', 'locale', 'uiWorkspace'],
      apply(clientCtx) {
        appCtx = clientCtx
        clientCtx.locale.register(NS, { en, zh })
        clientCtx.slots.inject('shell.overlay', () => clientCtx.slots.register({
          name: 'shell.overlay',
          id: 'plugin-delete.dialogs',
          order: 50,
          locale: NS,
        }, DialogHost))
        clientCtx.slots.inject('sidebar.workspaces.session.menu.item', () => clientCtx.slots.register({
          name: 'sidebar.workspaces.session.menu.item',
          id: 'plugin-delete.delete-session',
          order: 500,
          locale: NS,
        }, DeleteSessionRow))
      },
    }
  },
})
