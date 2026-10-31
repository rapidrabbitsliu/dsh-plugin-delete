import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

const source = readFileSync(new URL('../client.js', import.meta.url), 'utf8')

// Mount the real client entry and its capture listener; no HTTP or records.
function mount(t, fetch = () => { throw new Error('Unexpected HTTP request') }) {
  let definition, overlay, snapshot
  const effects = []
  const listeners = new Map()
  const React = {
    createElement: (...args) => args,
    useSyncExternalStore(subscribe, getSnapshot) { snapshot = getSnapshot; return getSnapshot() },
    useEffect(effect) { effects.push(effect) },
    useState: initial => [initial, () => {}],
    useRef: () => ({ current: null }),
    useCallback: fn => fn,
  }
  const window = {
    __ModuleLoader__: { load(module) { definition = module.factory(() => React) } },
    addEventListener(name, fn, capture) { assert.equal(capture, true); listeners.set(name, fn) },
    removeEventListener(name, fn, capture) {
      assert.equal(capture, true)
      assert.equal(listeners.get(name), fn)
      listeners.delete(name)
    },
  }
  vm.runInNewContext(source, { window, fetch, setTimeout: () => 1 })
  definition.apply({
    locale: { register() {} },
    slots: {
      inject(name, setup) { setup() },
      register(slot, component) { if (slot.name === 'shell.overlay') overlay = component },
    },
  })
  overlay({ t: key => key })
  // First effect owns the click listener. Do not start the HTTP polling effect.
  const cleanup = effects[0]()
  let disposed = false
  const dispose = () => { if (!disposed) { disposed = true; cleanup() } }
  t.after(dispose)
  return {
    listeners, dispose,
    current: () => snapshot().current,
    renderDialog() {
      const tree = overlay({ t: key => key })
      const entry = tree.find(node => Array.isArray(node) && node[1]?.item?.kind === 'workspace-pre')
      assert.ok(entry)
      return entry[0](entry[1])
    },
    click(target) {
      const event = {
        target, defaultPrevented: false, stopped: false,
        preventDefault() { this.defaultPrevented = true },
        stopPropagation() { this.stopped = true },
      }
      listeners.get('click')(event)
      return event
    },
  }
}

function target({ name = 'dsh-plugin-delete', text = '', aria = '', role = null, ancestor = {}, nested = false, workspace = true } = {}) {
  const row = { workspaceId: 'workspace-test', label: name, cwd: 'D:/example', sessionCount: 1 }
  const owner = { memoizedProps: workspace ? { group: row, label: name, ...ancestor } : ancestor, return: null }
  const interactive = {
    tagName: 'BUTTON', textContent: text,
    getAttribute: key => key === 'role' ? role : key === 'aria-label' ? aria : null,
    closest: selector => selector.startsWith('.') ? null : interactive,
    __reactFiber$test: { memoizedProps: {}, return: owner },
  }
  return nested ? {
    tagName: 'path', getAttribute: () => null,
    closest: selector => selector.startsWith('.') ? null : interactive,
    parentElement: interactive,
  } : interactive
}

for (const name of ['dsh-plugin-delete', 'my-remove-project', '删除项目', '移除工具', 'Delete workspace', '删除工作区', 'my-project']) {
  for (const action of ['Workspace actions', 'New session in']) {
    test(`${action} ${name} does not open a delete dialog`, t => {
      const client = mount(t)
      const event = client.click(target({ name, aria: `${action} ${name}`, ancestor: { item: { id: 'delete' } } }))
      assert.equal(event.defaultPrevented, false)
      assert.equal(event.stopped, false)
      assert.equal(client.current(), null)
    })
  }
}

for (const text of ['删除工作区', 'Delete workspace', '  Delete \n workspace  ']) {
  for (const nested of [false, true]) {
    test(`actual menu item ${JSON.stringify(text)}, nested=${nested}, opens confirmation only`, t => {
      const client = mount(t)
      const event = client.click(target({ text, role: 'menuitem', nested }))
      assert.equal(event.defaultPrevented, true)
      assert.equal(event.stopped, true)
      assert.equal(client.current().kind, 'workspace-pre')
      assert.equal(client.current().workspaceId, 'workspace-test')
      assert.equal(client.current().title, 'dsh-plugin-delete')
    })
  }
}

for (const options of [
  { role: 'menuitem', text: 'Rename', ancestor: { label: '删除工作区', item: { id: 'delete' } } },
  { role: 'menuitem', text: 'Delete session' },
  { role: 'menuitem', text: 'Remove workspace' },
  { role: 'menuitem', text: 'dsh-plugin-delete' },
  { role: 'menuitem', text: 'Rename', aria: 'Delete workspace' },
  { text: 'Delete workspace' },
  { role: 'menuitem', text: 'Delete workspace', workspace: false },
]) {
  test(`non-command or unresolved workspace passes through: ${JSON.stringify(options)}`, t => {
    const client = mount(t)
    const event = client.click(target(options))
    assert.equal(event.defaultPrevented, false)
    assert.equal(client.current(), null)
  })
}

test('workspace confirmation allows both checkboxes unchecked and submits both flags false', async t => {
  const requests = []
  const client = mount(t, async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) })
    return { ok: true, json: async () => ({ sessions: null, folder: null }) }
  })
  client.click(target({ text: 'Delete workspace', role: 'menuitem' }))
  const tree = client.renderDialog()
  const elements = []
  function visit(node) {
    if (!Array.isArray(node)) return
    elements.push(node)
    for (const child of node.slice(2)) visit(child)
  }
  visit(tree)
  const checkboxes = elements.filter(node => node[0] === 'input')
  assert.equal(checkboxes.length, 2)
  assert.ok(checkboxes.every(node => node[1].checked === false))
  const confirm = elements.find(node => node[0] === 'button' && node[2] === 'ws.pre.confirm')
  assert.ok(confirm)
  assert.notEqual(confirm[1].disabled, true)
  await confirm[1].onClick()
  assert.deepEqual(requests, [{
    url: '/plugin-delete/api/delete-workspace',
    body: { workspaceId: 'workspace-test', deleteSessions: false, deleteFiles: false },
  }])
})

test('unmount removes the capture listener', t => {
  const client = mount(t)
  assert.equal(client.listeners.size, 1)
  client.dispose()
  assert.equal(client.listeners.size, 0)
})
