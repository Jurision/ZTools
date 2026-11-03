/* eslint-disable @typescript-eslint/explicit-function-return-type, @typescript-eslint/no-require-imports -- Standalone node:test CommonJS fixture uses JSDoc. */
const test = require('node:test')
const assert = require('node:assert/strict')
const { calculate, formatResult, PaperStore } = require('./core.js')

/**
 * Create a revision-aware in-memory fixture database, never a production connection.
 * @param {Array<object>} seed Initial documents.
 * @returns {object} Test database adapter with simulated errors.
 */
function database(seed = []) {
  const docs = new Map(seed.map((doc) => [doc._id, structuredClone(doc)]))
  return {
    docs,
    writes: 0,
    fail: false,
    allDocs(prefix) {
      return [...docs.values()]
        .filter((doc) => doc._id.startsWith(prefix))
        .map((doc) => structuredClone(doc))
    },
    put(doc) {
      this.writes++
      if (this.fail) return { error: true, name: 'unavailable' }
      const old = docs.get(doc._id)
      if (old && doc._rev !== old._rev) return { error: true, name: 'conflict' }
      const rev = String(Number((old?._rev || '0').split('-')[0]) + 1) + '-fixture'
      docs.set(doc._id, { ...structuredClone(doc), _rev: rev })
      return { ok: true, rev }
    }
  }
}

test('operator precedence, percent, signs, functions and Chinese punctuation', () => {
  for (const [expression, expected] of [
    ['2+3*4', 14],
    ['（2+3）×4', 20],
    ['200*10%', 20],
    ['2^3^2', 512],
    ['-2^2', -4],
    ['(-2)^2', 4],
    ['2^-2', 0.25],
    ['.5+1.5', 2],
    ['sum(1,2,3)', 6],
    ['avg(2,4,6)', 4],
    ['sqrt(9)+abs(-2)', 5],
    ['min(4,5)', 4],
    ['max(4,5)', 5],
    ['round(1.7)', 2],
    ['sin(pi/2)', 1],
    ['1e3+2', 1002],
    ['8÷2', 4],
    ['1,000+200', 1200],
    ['12,345,678.9/10', 1234567.8900000001],
    ['sum(1,200)', 201],
    ['sum(1,2)', 3],
    ['(1,000+2)*3', 3006],
    ['2x3', 6],
    ['2 X (3+4)', 14],
    ['', null]
  ])
    assert.equal(calculate(expression), expected, expression)
  assert.equal(formatResult(calculate('0.1+0.2')), '0.3')
})

test('untrusted expression text cannot execute code or produce invalid results', () => {
  for (const expression of [
    'globalThis.compromised=1',
    'process.exit()',
    'constructor(1)',
    'alert(1)',
    '2(3)',
    '1/0',
    'sqrt(-1)',
    '1e999',
    '1+',
    'max()',
    'round(1,2)',
    '1,00',
    '('.repeat(90) + '1' + ')'.repeat(90),
    '-'.repeat(100) + '1',
    '1'.repeat(2001)
  ])
    assert.throws(() => calculate(expression), undefined, expression.slice(0, 40))
  assert.equal(globalThis.compromised, undefined)
})

test('repeated new never stacks unsaved blank papers and does not write blank records', () => {
  const db = database()
  const store = new PaperStore(db, () => 100000)
  const first = store.current()
  store.create()
  store.create()
  assert.equal(store.papers.length, 1)
  assert.equal(store.current(), first)
  store.changed(first)
  store.flush()
  assert.equal(db.writes, 0)
})

test('editing older paper saves same identity/revision and preserves creation ordering', () => {
  const db = database()
  let time = 100000
  const store = new PaperStore(db, () => time++)
  const first = store.current()
  first.calcList[0] = { expression: '1+2', remark: 'first' }
  store.changed(first)
  store.flush()
  const created = first.createAt
  const second = store.create()
  second.calcList[0].expression = '4*5'
  store.changed(second)
  store.flush()
  store.select(first._id)
  first.calcList[0].expression = '2+3'
  store.changed(first)
  store.flush()
  assert.equal(db.docs.size, 2)
  assert.equal(db.docs.get(first._id).createAt, created)
  assert.equal(db.docs.get(first._id)._rev, '2-fixture')
  assert.equal(store.papers[0]._id, second._id)
  const reopened = new PaperStore(db, () => time++)
  assert.equal(reopened.papers.length, 3) // A fresh blank plus saved history.
  assert.equal(reopened.papers[1]._id, second._id)
  assert.equal(reopened.papers[2].calcList[0].expression, '2+3')
  assert.equal(reopened.papers[2].calcList[0].remark, 'first')
})

test('failed save retains dirty data for retry and export instead of claiming success', () => {
  const db = database()
  const store = new PaperStore(db, () => 100000)
  store.current().calcList[0].expression = '8/2'
  store.changed(store.current())
  db.fail = true
  assert.throws(() => store.flush(), /保存失败/)
  assert.equal(store.dirty.size, 1)
  assert.equal(store.export().papers[0].calcList[0].expression, '8/2')
  db.fail = false
  store.flush()
  assert.equal(store.dirty.size, 0)
  assert.equal(db.docs.size, 1)
})

test('revision conflict does not overwrite a different writer', () => {
  const db = database([
    {
      _id: 'paper/1000',
      _rev: '1-fixture',
      label: 'Old',
      createAt: 1000,
      calcList: [{ expression: '1', remark: '' }]
    }
  ])
  const store = new PaperStore(db, () => 100000)
  const paper = store.select('paper/1000')
  db.docs.get(paper._id)._rev = '2-external'
  paper.calcList[0].expression = '99'
  store.changed(paper)
  assert.throws(() => store.flush(), /保存冲突/)
  assert.equal(db.docs.get(paper._id).calcList[0].expression, '1')
  assert.equal(
    store.export().papers.find((doc) => doc._id === paper._id).calcList[0].expression,
    '99'
  )
})

test('legacy import preserves labels/remarks/time and source is not mutated; repeat is idempotent', () => {
  const db = database()
  const store = new PaperStore(db, () => 100000)
  const legacy = [
    {
      _id: 'paper/12345',
      _rev: '8-old',
      label: '<b>Original</b>',
      calcList: [{ expression: '10+20', remark: 'memo' }]
    }
  ]
  const before = JSON.stringify(legacy)
  assert.deepEqual(store.importLegacy(legacy), { imported: 1, skipped: 0 })
  assert.deepEqual(store.importLegacy(legacy), { imported: 0, skipped: 1 })
  assert.equal(JSON.stringify(legacy), before)
  const imported = store.papers.find((doc) => doc.sourceId === 'paper/12345')
  assert.equal(imported.createAt, 12345)
  assert.equal(imported.label, '<b>Original</b>')
  assert.equal(imported.calcList[0].remark, 'memo')
  assert.equal(imported._rev, '1-fixture')
  assert.equal(db.docs.size, 1)
})

test('invalid import rejects all candidates before adding records', () => {
  const store = new PaperStore(database(), () => 100000)
  assert.throws(
    () =>
      store.importLegacy([
        { _id: 'paper/100', calcList: [{ expression: '2+2' }] },
        { _id: 'bad/101', calcList: [{ expression: '3+3' }] }
      ]),
    /标识/
  )
  assert.equal(store.papers.length, 1)
  assert.equal(store.dirty.size, 0)
  assert.throws(
    () =>
      store.importLegacy([{ _id: 'paper/100', calcList: [{ expression: { toString: 'bad' } }] }]),
    /格式/
  )
})

test('remarks-only sheets persist and are never treated as reusable blank', () => {
  const db = database()
  const store = new PaperStore(db, () => 100000)
  const note = store.current()
  note.calcList[0].remark = 'Need to retain this note'
  store.changed(note)
  store.flush()
  store.create()
  assert.equal(store.papers.length, 2)
  assert.equal(db.docs.get(note._id).calcList[0].remark, 'Need to retain this note')
})
