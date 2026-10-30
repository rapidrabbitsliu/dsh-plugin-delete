import assert from 'node:assert/strict'
import test from 'node:test'
import path from 'node:path'
import Ajv from 'ajv'
import { apply } from '../index.js'

// Exercise the real plugin entry point without mounting HTTP routes or touching records.
function mount() {
  const registered = new Map()
  const listeners = new Set()
  const cleanups = []
  const calls = []
  const ctx = {
    effect(setup) {
      const cleanup = setup()
      if (cleanup) cleanups.push(cleanup)
      return cleanup
    },
    on(event, listener) {
      const entry = { event, listener }
      listeners.add(entry)
      return () => listeners.delete(entry)
    },
    emit(...args) { calls.push(args) },
    workspaceRegistry: { list: () => [] },
    agents: {
      currentInitiator: () => ({ id: 'current-session' }),
      get() { throw new Error('Unexpected access to a real session') },
    },
    webServer: { register: () => () => {} },
    tools: {
      register(definition) {
        registered.set(definition.name, definition)
        return () => registered.delete(definition.name)
      },
    },
  }
  apply(ctx)
  return {
    tool: registered.get('delete_records'), registered, listeners, calls,
    dispose() { for (const cleanup of cleanups.reverse()) cleanup() },
  }
}

function fixture(t) {
  const mounted = mount()
  t.after(() => mounted.dispose())
  return mounted
}

test('registered parameters are strict-valid object-rooted JSON Schema', (t) => {
  const { tool } = fixture(t)
  // Round-trip the same fields sent in an OpenAI-compatible function definition.
  const wire = JSON.parse(JSON.stringify({ type: 'function', function: {
    name: tool.name, description: tool.description, parameters: tool.parameters,
  } }))
  const schema = wire.function.parameters
  assert.equal(schema.type, 'object')
  assert.deepEqual(schema.required, ['action'])
  assert.equal(schema.additionalProperties, false)
  const ajv = new Ajv({ strict: true })
  assert.equal(ajv.validateSchema(schema), true)
  const validate = ajv.compile(schema)
  for (const args of [
    { action: 'sessions', sessionIds: ['example-session'] },
    { action: 'folder', folderPath: 'C:/example' },
  ]) assert.equal(validate(args), true, JSON.stringify(validate.errors))
  for (const args of [
    {}, { sessionIds: ['example-session'] }, { action: 1 },
    { action: 'sessions', sessionIds: [123] },
    { action: 'folder', folderPath: 123 },
    { action: 'sessions', unexpected: true },
  ]) assert.equal(validate(args), false, JSON.stringify(args))
})

test('Ajv rejects the original shorthand passed directly to registration', () => {
  const original = {
    action: { type: 'string', required: true },
    sessionIds: { type: 'array', items: { type: 'string' } },
    folderPath: { type: 'string' },
  }
  assert.throws(() => new Ajv({ strict: true }).compile(original), /unknown keyword/)
})

test('invalid action arguments retain runtime guards', async (t) => {
  const { tool } = fixture(t)
  await assert.rejects(tool.execute({ action: 'sessions', sessionIds: [] }, {}), /non-empty sessionIds/)
  await assert.rejects(tool.execute({ action: 'folder' }, {}), /needs folderPath/)
  await assert.rejects(tool.execute({ action: 'unknown' }, {}), /unknown action/)
})

test('current session self-delete is refused without accessing files', async (t) => {
  const { tool, calls } = fixture(t)
  assert.deepEqual(await tool.execute({ action: 'sessions', sessionIds: ['current-session'] }, {}), {
    action: 'sessions', results: [{ id: 'current-session', status: 'refused-self-delete' }],
  })
  assert.deepEqual(calls, [])
})

test('drive root deletion is refused before filesystem access', async (t) => {
  const { tool } = fixture(t)
  const root = path.parse(process.cwd()).root
  assert.deepEqual(await tool.execute({ action: 'folder', folderPath: root }, {}), {
    action: 'folder', folder: { path: root, status: 'refused', reason: 'drive-root' },
  })
})

test('disposing the plugin unregisters its tool and event listener', () => {
  const mounted = mount()
  assert.equal(mounted.registered.size, 1)
  assert.equal(mounted.listeners.size, 1)
  mounted.dispose()
  assert.equal(mounted.registered.size, 0)
  assert.equal(mounted.listeners.size, 0)
})
