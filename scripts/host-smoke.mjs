// Isolated built-host smoke. No profile, Loader, HTTP listener, or checkout writes.
// Run: node scripts/host-smoke.mjs [checkout]
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as plugin from '../index.js'
import Ajv from 'ajv'

const checkoutArg = process.argv[2] ?? process.env.DSH_CHECKOUT
if (!checkoutArg) throw new Error('Configure DSH_CHECKOUT or pass the built DSH checkout path: node scripts/host-smoke.mjs <checkout>')
const checkout = path.resolve(checkoutArg)
const built = async (relative) => import(pathToFileURL(path.join(checkout, relative)).href)
const [{ Context }, { default: ToolRuntime }, { default: SystemPrompt }, { default: AgentRegistry }] = await Promise.all([
  built('vendor/cordis/lib/index.js'),
  built('packages/core/tools/lib/index.js'),
  built('packages/core/system-prompt/lib/index.js'),
  built('packages/core/agent/lib/index.js'),
])
const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-delete-host-smoke-'))
assert.equal(path.dirname(root), os.tmpdir())
assert.ok(path.basename(root).startsWith('dsh-delete-host-smoke-'))
const home = path.join(root, 'isolated-home')
const sessionsRoot = path.join(home, 'sessions')
const projcacheDir = path.join(home, 'storages/session_projcache/sessions')
const fixtureDir = (id) => path.join(sessionsRoot, 'fixture-project', id)
const exists = async (file) => access(file).then(() => true, () => false)
const checks = []
const check = (label) => { checks.push(label); console.log(`PASS ${label}`) }
const calls = []
const routes = new Set()
const removed = []
const ctx = new Context()
let fiber
try {
  await mkdir(projcacheDir, { recursive: true })
  for (const id of ['self-fixture', 'cold-fixture', 'live-fixture', 'unscoped-fixture', 'cancelled-fixture']) {
    await mkdir(fixtureDir(id), { recursive: true })
    await writeFile(path.join(fixtureDir(id), 'sentinel.txt'), `isolated ${id}`)
    await writeFile(path.join(projcacheDir, `${id}.json`), '{}')
  }
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(AgentRegistry)
  const agents = ctx.get('agents')
  const tools = ctx.get('tools')
  assert.ok(tools instanceof ToolRuntime)
  assert.ok(agents instanceof AgentRegistry)
  ctx.provide('webServer', {
    register(route) { routes.add(route); return () => routes.delete(route) },
  })
  ctx.provide('workspaceRegistry', {
    list: () => [],
    async archiveSession(id, options) { calls.push(['archive', id, options]) },
    async unarchiveSession(id) { calls.push(['unarchive', id]) },
    async unpinSession(id) { calls.push(['unpin', id]) },
  })
  ctx.provide('workspaceController', { async delete() { throw new Error('not used by smoke') } })
  ctx.on('api-session/removed', (id) => { removed.push(id) })
  // The session/agent DTO is a fixture, but registry and AsyncLocalStorage are real.
  const self = { id: 'self-fixture', session: { id: 'self-fixture' } }
  const live = { id: 'live-fixture', session: { id: 'live-fixture' } }
  const cancelled = { id: 'cancelled-fixture', session: { id: 'cancelled-fixture' } }
  const detach = [self, live, cancelled].map(agent => agents.enter(agent, undefined))
  fiber = await ctx.plugin(plugin, { home, sessionsRoot, projcacheDir })
  const schemas = tools.schemas()
  assert.equal(schemas.length, 1)
  const schema = schemas[0]
  assert.equal(schema.name, 'delete_records')
  assert.equal(schema.parameters.type, 'object')
  assert.deepEqual(Object.keys(schema.parameters.properties), ['action', 'sessionIds', 'folderPath'])
  assert.deepEqual(schema.parameters.required, ['action'])
  assert.equal(schema.parameters.additionalProperties, false)
  assert.equal(schema.execute, undefined)
  assert.equal(schema.output, undefined)
  assert.deepEqual((await ctx.get('systemPrompt').assemble()).tools, schemas)
  assert.equal(routes.size, 1)
  console.log('MODEL_SCHEMA ' + JSON.stringify(schema))
  check('real Cordis plugin load, real ToolRuntime.schemas(), real prompt projection')

  let seq = 0
  const execute = (args, initiator = self) => {
    const invoke = () => tools.execute({
      callId: `host-smoke-${++seq}`, name: 'delete_records', arguments: args,
      signal: new AbortController().signal, agent: initiator,
    })
    return initiator ? agents.withInitiator(initiator, invoke) : invoke()
  }
  const selfResult = await execute({ action: 'sessions', sessionIds: [self.id] })
  assert.equal(selfResult.isError, false)
  assert.deepEqual(selfResult.value.results, [{ id: self.id, status: 'refused-self-delete' }])
  assert.equal(await readFile(path.join(fixtureDir(self.id), 'sentinel.txt'), 'utf8'), `isolated ${self.id}`)
  assert.equal(calls.length, 0)
  check('self-delete refused through real tools.execute + real agents.withInitiator; sentinel intact')

  const mixed = await execute({ action: 'sessions', sessionIds: [self.id, 'cold-fixture'] })
  assert.equal(mixed.isError, false)
  assert.deepEqual(mixed.value.results.map(x => x.status), ['refused-self-delete', 'deleted'])
  assert.equal(await exists(fixtureDir(self.id)), true)
  assert.equal(await exists(fixtureDir('cold-fixture')), false)
  assert.equal(await exists(path.join(projcacheDir, 'cold-fixture.json')), false)
  assert.ok(removed.includes('cold-fixture'))
  check('mixed self/cold request refuses only self; deletes disposable cold record/cache')

  const validate = new Ajv({ strict: true }).compile(schema.parameters)
  assert.equal(validate({ action: 'sessions', sessionIds: [self.id] }), true)
  assert.equal(validate({ action: 'sessions', sessionIds: [7] }), false)
  assert.equal(validate({ action: 'sessions', sessionIds: [self.id], unexpected: true }), false)
  assert.equal(validate({}), false)
  check('actual projected schema compiles in strict Ajv and rejects invalid shapes')
  const invalid = await execute({ action: 'sessions', sessionIds: [7] })
  assert.equal(invalid.isError, false)
  assert.deepEqual(invalid.value.results, [{ id: '7', status: 'absent' }])
  const extra = await execute({ action: 'sessions', sessionIds: [self.id], unexpected: true })
  assert.equal(extra.isError, false)
  const missing = await execute({})
  assert.equal(missing.isError, true)
  check('LIMITATION: direct registration does not enforce parameter schema during tools.execute')

  const pending = await execute({ action: 'sessions', sessionIds: [live.id] })
  assert.deepEqual(pending.value.results, [{ id: live.id, status: 'pending-close' }])
  assert.deepEqual(calls.find(x => x[0] === 'archive'), ['archive', live.id, { stopActivity: true }])
  assert.equal(await exists(fixtureDir(live.id)), true)
  // Session persistence is mocked: this is an explicit fixture disposal event,
  // not a real SessionStore shutdown. Wait on the plugin's completion event.
  const deleted = new Promise(resolve => {
    const off = ctx.on('api-session/removed', id => { if (id === live.id) { off(); resolve() } })
  })
  ctx.emit('session/disposed', live.session)
  await Promise.race([deleted, new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error('deferred removal timed out')), 5000)
    timer.unref()
  })])
  assert.equal(await exists(fixtureDir(live.id)), false)
  check('live record preserved until mocked session/disposed, then physically removed')

  // Demonstrates a boundary limitation safely, on an owned cold dummy record.
  const boundaryProbe = await tools.execute({
    callId: 'without-initiator', name: 'delete_records',
    arguments: { action: 'sessions', sessionIds: ['unscoped-fixture'] },
    signal: new AbortController().signal,
    agent: { id: 'unscoped-fixture', session: { id: 'unscoped-fixture' } },
  })
  assert.equal(boundaryProbe.value.results[0].status, 'deleted')
  check('LIMITATION: exec.agent alone does not establish initiator/self protection')

  const refusedHome = await execute({ action: 'folder', folderPath: home })
  assert.equal(refusedHome.value.folder.status, 'refused')
  assert.equal(refusedHome.value.folder.reason, 'inside-dsh-home')
  check('isolated DSH home folder deletion refused')
  await execute({ action: 'sessions', sessionIds: [cancelled.id] })
  await fiber.dispose()
  fiber = undefined
  assert.deepEqual(tools.schemas(), [])
  assert.equal(routes.size, 0)
  assert.deepEqual((await ctx.get('systemPrompt').assemble()).tools, [])
  const afterDispose = await execute({ action: 'sessions', sessionIds: [self.id] })
  assert.equal(afterDispose.isError, true)
  ctx.emit('session/disposed', cancelled.session)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(await exists(fixtureDir(cancelled.id)), true)
  check('fiber disposal removes tools/prompt/routes and cancels pending deletion listener/timer')
  fiber = await ctx.plugin(plugin, { home, sessionsRoot, projcacheDir })
  assert.equal(tools.schemas().length, 1)
  assert.equal(routes.size, 1)
  await fiber.dispose()
  fiber = undefined
  assert.deepEqual(tools.schemas(), [])
  for (const off of detach) off()
  check('plugin reload registers once and subsequent unload cleans registry')
  console.log('SUMMARY ' + JSON.stringify({ passed: checks.length, checks, checkout, isolatedFixtureRoot: root }))
} finally {
  if (fiber) await fiber.dispose()
  await ctx.fiber.dispose()
  // Delete only the unique path we created; never derive this from plugin args.
  assert.equal(path.dirname(root), os.tmpdir())
  assert.ok(path.basename(root).startsWith('dsh-delete-host-smoke-'))
  await rm(root, { recursive: true, force: true })
  console.log('CLEANUP isolated fixtures and Cordis root disposed')
}
