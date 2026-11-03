/* eslint-disable @typescript-eslint/explicit-function-return-type -- Static plugin runtime JavaScript documents returns with JSDoc. */
;(function () {
  'use strict'
  const { PaperStore, calculate, formatResult, hasContent, MAX_ROWS } = window.PaperCore
  const host = window.ztools
  const list = document.getElementById('paper-list')
  const rows = document.getElementById('rows')
  const status = document.getElementById('save-state')
  const retry = document.getElementById('retry-save')
  let timer = null
  let store

  /**
   * Set accessible save feedback without reading or logging user content.
   * @param {string} text Feedback text.
   * @param {boolean} error Whether saving failed.
   * @returns {void} No return value.
   */
  function feedback(text, error = false) {
    status.textContent = text
    status.dataset.state = error ? 'error' : 'normal'
    retry.hidden = !error
  }

  /**
   * Build an SVG icon referencing the local symbol sprite.
   * @param {string} name Symbol suffix.
   * @returns {SVGElement} Decorative icon node.
   */
  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    use.setAttribute('href', '#i-' + name)
    svg.setAttribute('aria-hidden', 'true')
    svg.append(use)
    return svg
  }

  /**
   * Persist all pending papers synchronously before navigation or host exit.
   * @returns {boolean} Whether all changes were saved.
   */
  function flush() {
    clearTimeout(timer)
    timer = null
    if (!store) return false
    try {
      store.flush()
      feedback(store.current()._rev ? '已自动保存到本机' : '开始输入后自动保存')
      renderList()
      return true
    } catch (error) {
      feedback(error.message, true)
      return false
    }
  }

  /**
   * Queue a debounced write while preserving the current input focus.
   * @returns {void} No return value.
   */
  function changed() {
    try {
      store.changed(store.current())
      feedback('正在保存…')
      clearTimeout(timer)
      timer = setTimeout(flush, 500)
    } catch (error) {
      feedback(error.message, true)
    }
  }

  /**
   * Render chronological navigation using text nodes only.
   * @returns {void} No return value.
   */
  function renderList() {
    list.replaceChildren()
    for (const paper of store.papers) {
      const button = document.createElement('button')
      button.className = 'paper-item'
      button.dataset.id = paper._id
      button.setAttribute('aria-current', String(paper._id === store.currentId))
      button.title = paper.label
      const text = document.createElement('div')
      const label = document.createElement('strong')
      label.textContent = paper.label
      const meta = document.createElement('small')
      const count = paper.calcList.filter((row) => row.expression.trim()).length
      meta.textContent = count ? count + ' 行计算' : hasContent(paper) ? '备注稿纸' : '空白稿纸'
      text.append(label, meta)
      button.append(icon('paper'), text)
      button.addEventListener('click', () => {
        if (!flush()) return
        store.select(paper._id)
        renderPaper()
      })
      list.append(button)
    }
  }

  /**
   * Update one calculation result without replacing the editor input.
   * @param {object} row Row model.
   * @param {HTMLElement} result Result label.
   * @param {HTMLButtonElement} copy Copy-result control.
   * @returns {void} No return value.
   */
  function updateResult(row, result, copy) {
    try {
      const value = formatResult(calculate(row.expression))
      result.textContent = value ? '= ' + value : ''
      result.dataset.error = 'false'
      copy.dataset.value = value
      copy.hidden = !value
    } catch (error) {
      result.textContent = error.message
      result.dataset.error = 'true'
      copy.hidden = true
    }
  }

  /**
   * Add a row and focus it without touching other papers.
   * @param {number} index Insertion index.
   * @returns {void} No return value.
   */
  function addRow(index) {
    const paper = store.current()
    if (paper.calcList.length >= MAX_ROWS) {
      feedback('此稿纸已达到行数上限，请新建稿纸', true)
      return
    }
    paper.calcList.splice(index, 0, { expression: '', remark: '' })
    changed()
    renderRows(index)
  }

  /**
   * Render expression/remark controls and calculate their displayed results.
   * @param {number|undefined} focusIndex Optional row to focus after rebuilding.
   * @returns {void} No return value.
   */
  function renderRows(focusIndex) {
    rows.replaceChildren()
    store.current().calcList.forEach((row, index) => {
      const card = document.createElement('div')
      card.className = 'calc-row'
      const main = document.createElement('div')
      main.className = 'calc-main'
      const number = document.createElement('span')
      number.className = 'row-number'
      number.textContent = String(index + 1).padStart(2, '0')
      const input = document.createElement('input')
      input.className = 'expression'
      input.value = row.expression
      input.maxLength = 2000
      input.placeholder = '例如 128 × 3 + 60'
      input.spellcheck = false
      input.autocomplete = 'off'
      input.setAttribute('aria-label', '第 ' + (index + 1) + ' 行算式')
      const remove = document.createElement('button')
      remove.className = 'icon-button remove-row'
      remove.setAttribute('aria-label', '删除第 ' + (index + 1) + ' 行')
      remove.title = '删除此行'
      remove.append(icon('trash'))
      const line = document.createElement('div')
      line.className = 'result-line'
      const result = document.createElement('output')
      result.className = 'result'
      const copy = document.createElement('button')
      copy.className = 'result-copy'
      copy.title = '复制计算结果'
      copy.setAttribute('aria-label', '复制第 ' + (index + 1) + ' 行结果')
      copy.append(icon('copy'))
      copy.addEventListener('click', () => {
        try {
          host.copyText(copy.dataset.value)
          feedback('已复制结果')
        } catch {
          feedback('无法复制结果', true)
        }
      })
      const remark = document.createElement('input')
      remark.className = 'remark'
      remark.value = row.remark
      remark.maxLength = 2000
      remark.placeholder = '添加备注（可选）'
      remark.setAttribute('aria-label', '第 ' + (index + 1) + ' 行备注')
      input.addEventListener('input', () => {
        row.expression = input.value
        updateResult(row, result, copy)
        changed()
      })
      input.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' || event.isComposing) return
        event.preventDefault()
        if (index === store.current().calcList.length - 1 && !row.expression.trim()) return
        if (index < store.current().calcList.length - 1)
          rows.querySelectorAll('.expression')[index + 1].focus()
        else addRow(index + 1)
      })
      remark.addEventListener('input', () => {
        row.remark = remark.value
        changed()
      })
      remove.addEventListener('click', () => {
        const paper = store.current()
        // Row deletion is explicit; no background cleanup removes user content.
        paper.calcList.splice(index, 1)
        if (!paper.calcList.length) paper.calcList.push({ expression: '', remark: '' })
        changed()
        renderRows(Math.min(index, paper.calcList.length - 1))
      })
      main.append(number, input, remove)
      line.append(result, copy)
      card.append(main, line, remark)
      rows.append(card)
      updateResult(row, result, copy)
    })
    if (focusIndex !== undefined) rows.querySelectorAll('.expression')[focusIndex]?.focus()
  }

  /**
   * Render the selected sheet heading and editable rows.
   * @returns {void} No return value.
   */
  function renderPaper() {
    const paper = store.current()
    document.getElementById('paper-title').textContent = paper.label
    document.getElementById('paper-date').textContent =
      '创建于 ' + new Date(paper.createAt).toLocaleString('zh-CN', { hour12: false })
    renderList()
    renderRows(0)
    feedback(paper._rev ? '已自动保存到本机' : '开始输入后自动保存')
  }

  /**
   * Start a new paper only after successfully saving pending edits.
   * @returns {void} No return value.
   */
  function newPaper() {
    if (!flush()) return
    try {
      store.create()
      renderPaper()
    } catch (error) {
      feedback(error.message, true)
    }
  }

  try {
    if (!host || !host.db) throw new Error('请在 ZTools 中打开此插件，避免内容保存到错误的位置')
    store = new PaperStore(host.db)
    renderPaper()
  } catch (error) {
    feedback(error.message, true)
    document.querySelectorAll('button').forEach((button) => {
      button.disabled = true
    })
    return
  }
  document.getElementById('new-paper').addEventListener('click', newPaper)
  document
    .getElementById('add-row')
    .addEventListener('click', () => addRow(store.current().calcList.length))
  retry.addEventListener('click', flush)
  document.getElementById('rename-paper').addEventListener('click', () => {
    document.getElementById('rename-input').value = store.current().label
    document.getElementById('rename-dialog').showModal()
    document.getElementById('rename-input').select()
  })
  document.getElementById('rename-dialog').addEventListener('close', (event) => {
    if (event.target.returnValue !== 'confirm') return
    const label = document.getElementById('rename-input').value.trim()
    if (!label) return
    store.current().label = label
    changed()
    document.getElementById('paper-title').textContent = label
    renderList()
  })
  document
    .getElementById('import-papers')
    .addEventListener('click', () => document.getElementById('import-file').click())
  document.getElementById('import-file').addEventListener('change', async (event) => {
    const file = event.target.files[0]
    event.target.value = ''
    if (!file) return
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('导入文件不能超过 10 MB')
      if (!flush()) return
      const result = store.importLegacy(JSON.parse(await file.text()))
      renderList()
      feedback(
        '已导入 ' + result.imported + ' 份，跳过重复 ' + result.skipped + ' 份；原文件未修改'
      )
    } catch (error) {
      feedback(error.message, true)
    }
  })
  document.getElementById('export-papers').addEventListener('click', () => {
    // Export includes recoverable unsaved edits even if the database is unavailable.
    const blob = new Blob([JSON.stringify(store.export(), null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = '计算稿纸备份-' + new Date().toISOString().slice(0, 10) + '.json'
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  })
  window.addEventListener('keydown', (event) => {
    if (event.isComposing || document.querySelector('dialog[open]')) return
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey) {
      if (event.code === 'KeyN') {
        event.preventDefault()
        newPaper()
      }
      if (event.code === 'KeyS') {
        event.preventDefault()
        flush()
      }
    }
  })
  window.addEventListener('blur', flush)
  window.addEventListener('beforeunload', (event) => {
    if (!flush() && store.dirty.size) {
      event.preventDefault()
      event.returnValue = ''
    }
  })
  host.onPluginOut?.(flush)
  host.onPluginEnter?.(() => rows.querySelector('.expression')?.focus())
})()
