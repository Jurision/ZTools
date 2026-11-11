/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/explicit-function-return-type -- Node tests. */
const test = require('node:test')
const assert = require('node:assert/strict')
const core = require('../calculation-paper-next/core.js')
const { PaperStore } = core
globalThis.PaperCore = core
require('./history.js')
/**
 * Build a detached fake database and original-editor model.
 * @param {Array} initial Fixture documents.
 * @returns {object} Fixture controller and records.
 */
function fixture(initial = []) {
  const records = new Map(initial.map((doc) => [doc._id, structuredClone(doc)]))
  let failed = false
  let tick = 1700000000000
  const db = {
    allDocs: () => [...records.values()].map((doc) => structuredClone(doc)),
    put: (doc) => {
      if (failed || (records.has(doc._id) && records.get(doc._id)._rev !== doc._rev))
        return { ok: false, name: 'conflict' }
      doc._rev = String(Number(doc._rev || 0) + 1)
      records.set(doc._id, structuredClone(doc))
      return { ok: true, rev: doc._rev }
    }
  }
  const store = new PaperStore(db, () => ++tick)
  const app = {
    state: { calcList: [{ expression: '', result: '' }] },
    setState: (state, callback) => {
      Object.assign(app.state, state)
      callback?.()
    }
  }
  const history = globalThis.PaperHistory.controller(app, store, (rows) => {
    app.state.calcList = rows
  })
  return {
    records,
    store,
    app,
    history,
    fail: () => {
      failed = true
    }
  }
}
test('direct original row mutations autosave, retain identity and omit computed results', async () => {
  const f = fixture()
  f.app.state.calcList[0] = { expression: '0.1+0.2', result: '0.3', remark: '备注' }
  f.history.capture()
  await new Promise((resolve) => setTimeout(resolve, 550))
  assert.equal(f.records.size, 1)
  const id = f.store.currentId
  assert.deepEqual(f.records.get(id).calcList, [{ expression: '0.1+0.2', remark: '备注' }])
  f.app.state.calcList[0].expression = '4/34'
  assert.equal(f.history.save('原稿'), true)
  assert.equal(f.store.currentId, id)
  assert.equal(f.records.size, 1)
  assert.equal(f.records.get(id).label, '原稿')
})
test('new and old paper navigation preserves records and reuses blank', () => {
  const f = fixture([
    { _id: 'paper/1500000000000', _rev: '1', label: '已有', calcList: [{ expression: '2+3' }] }
  ])
  f.history.navigate('paper/1500000000000')
  assert.equal(f.app.state.calcList[0].expression, '2+3')
  f.app.state.calcList[0].expression = '2+4'
  assert.equal(f.history.navigate(), true)
  const blankId = f.store.currentId
  f.history.navigate()
  assert.equal(f.store.currentId, blankId)
  assert.equal(f.records.get('paper/1500000000000').calcList[0].expression, '2+4')
  assert.equal(f.records.size, 1)
})
test('failed save blocks navigation and preserves original editor content', () => {
  const f = fixture()
  f.app.state.calcList[0].expression = '300000*1.15'
  const id = f.store.currentId
  f.fail()
  assert.equal(f.history.navigate(), false)
  assert.equal(f.store.currentId, id)
  assert.equal(f.app.state.calcList[0].expression, '300000*1.15')
  assert.equal(f.store.dirty.has(id), true)
})
test('original drawer delete does not resurrect its active record', () => {
  const f = fixture()
  f.app.state.calcList[0].expression = '123'
  f.history.flush()
  const id = f.store.currentId
  f.records.delete(id)
  f.history.removed(id)
  f.history.flush()
  assert.equal(f.records.has(id), false)
  assert.equal(f.app.state.calcList[0].expression, '')
})
test('renaming a brand-new blank paper persists it and new papers stay separate', () => {
  const f = fixture()
  const id = f.store.currentId
  assert.equal(f.history.rename(id, '  报价  '), true)
  assert.equal(f.records.get(id).label, '报价')
  assert.equal(f.history.navigate(), true)
  assert.notEqual(f.store.currentId, id)
  assert.equal(f.store.papers.length, 2)
})
test('renaming a non-current paper keeps the active sheet and its content', () => {
  const f = fixture([
    { _id: 'paper/1500000000000', _rev: '1', label: '旧', calcList: [{ expression: '2+3' }] }
  ])
  f.app.state.calcList[0].expression = '7*8'
  assert.equal(f.history.rename('paper/1500000000000', '月底对账'), true)
  assert.equal(f.records.get('paper/1500000000000').label, '月底对账')
  assert.equal(f.records.get('paper/1500000000000').calcList[0].expression, '2+3')
  assert.equal(f.records.get(f.store.currentId).calcList[0].expression, '7*8')
})
test('an empty rename restores the automatic date title', () => {
  const f = fixture([
    { _id: 'paper/1500000000000', _rev: '1', label: '旧', calcList: [{ expression: '2+3' }] }
  ])
  assert.equal(f.history.rename('paper/1500000000000', '   '), true)
  assert.equal(f.records.get('paper/1500000000000').label, core.defaultTitle(1500000000000))
  assert.equal(f.history.rename('missing', '名字'), false)
})
test('history search matches names, formulas, remarks and local dates, then restores all rows', () => {
  const time = new Date(2026, 10, 4, 6, 21).getTime()
  const id = `paper/${time}`
  const f = fixture([
    {
      _id: id,
      _rev: '1',
      label: '测试 USD',
      calcList: [{ expression: '200000*1.5', remark: '报价备注' }]
    },
    { _id: 'paper/1500000000000', _rev: '1', label: '另一份', calcList: [{ expression: '2+3' }] }
  ])
  for (const text of [
    '测试',
    '  usd ',
    'ＵＳＤ',
    '200000*1.5',
    '报价备注',
    '2026/11/04',
    '2026-11-04',
    '06:21'
  ]) {
    f.history.search(text)
    assert.deepEqual(
      f.history.visiblePapers().map((paper) => paper._id),
      [id],
      text
    )
  }
  f.history.search('完全不匹配')
  assert.deepEqual(f.history.visiblePapers(), [])
  f.history.search('  ')
  assert.deepEqual(f.history.visiblePapers(), f.store.papers)
})
test('search is read-only and includes unsaved active formulas without switching sheets', () => {
  const f = fixture([
    { _id: 'paper/1500000000000', _rev: '1', label: '测试', calcList: [{ expression: '2+3' }] }
  ])
  const activeId = f.store.currentId
  f.app.state.calcList[0] = { expression: '998877*2', remark: '未保存备注' }
  const originalRecords = structuredClone([...f.records.values()])
  const originalPapers = structuredClone(f.store.papers)
  for (const text of ['测试', '未保存备注', '998877*2', '无结果', '']) {
    f.history.search(text)
    const matches = f.history.visiblePapers()
    if (text === '未保存备注' || text === '998877*2') {
      assert.deepEqual(
        matches.map((paper) => paper._id),
        [activeId]
      )
    }
    assert.equal(f.store.currentId, activeId)
    assert.equal(f.app.state.calcList[0].expression, '998877*2')
    assert.deepEqual([...f.records.values()], originalRecords)
    assert.deepEqual(f.store.papers, originalPapers)
    assert.equal(f.store.dirty.size, 0)
  }
  f.history.flush()
  assert.equal(f.records.get(activeId).calcList[0].expression, '998877*2')
})
