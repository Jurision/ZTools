/* eslint-disable @typescript-eslint/explicit-function-return-type -- Runtime JavaScript uses JSDoc return types; it is shipped without a transpiler. */
/* Original local implementation. No eval, network or global input hooks. */
;(function (root, factory) {
  const api = factory()
  if (typeof module === 'object' && module.exports) module.exports = api
  else root.PaperCore = api
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict'
  const MAX_EXPRESSION = 2000
  const MAX_ROWS = 2000
  const MAX_PAPERS = 1000
  const functions = {
    sqrt: Math.sqrt,
    abs: Math.abs,
    floor: Math.floor,
    ceil: Math.ceil,
    round: Math.round,
    sin: Math.sin,
    cos: Math.cos,
    tan: Math.tan,
    ln: Math.log,
    log: Math.log10,
    exp: Math.exp,
    min: Math.min,
    max: Math.max,
    sum: (...values) => values.reduce((a, b) => a + b, 0),
    avg: (...values) => values.reduce((a, b) => a + b, 0) / values.length
  }

  /**
   * Calculate an arithmetic expression using a bounded recursive parser.
   * @param {string} expression User arithmetic expression.
   * @returns {number|null} Finite result, or null for an empty expression.
   * @throws {Error} Invalid syntax, excessive depth, division by zero or non-finite result.
   */
  function calculate(expression) {
    const text = String(expression)
      .trim()
      .replace(/（/g, '(')
      .replace(/）/g, ')')
      .replace(/[×]/g, '*')
      .replace(/[÷]/g, '/')
      .replace(/[−–]/g, '-')
    if (!text) return null
    if (text.length > MAX_EXPRESSION) throw new Error('算式过长')
    const tokens = []
    const plainPattern = /\s*(?:(\d+(?:\.\d*)?|\.\d+)([eE][+-]?\d+)?|([a-zA-Z]+)|([+\-*/^%(),]))/gy
    const groupedPattern =
      /\s*(?:(\d{1,3}(?:,\d{3})+(?:\.\d*)?|\d+(?:\.\d*)?|\.\d+)([eE][+-]?\d+)?|([a-zA-Z]+)|([+\-*/^%(),]))/gy
    const brackets = []
    let offset = 0
    while (offset < text.length) {
      // A comma inside a function call always separates arguments. Elsewhere it may
      // group thousands, so sum(1,200) stays two arguments while 1,200+3 is 1203.
      const pattern = brackets.includes('function') ? plainPattern : groupedPattern
      pattern.lastIndex = offset
      const found = pattern.exec(text)
      if (!found) throw new Error('不支持的字符或算式格式')
      const token = found[1]
        ? { number: Number(found[1].replace(/,/g, '') + (found[2] || '')) }
        : found[3] || found[4]
      if (token === '(')
        brackets.push(
          typeof tokens.at(-1) === 'string' && /^[a-zA-Z]+$/.test(tokens.at(-1))
            ? 'function'
            : 'group'
        )
      if (token === ')') brackets.pop()
      tokens.push(token)
      offset = pattern.lastIndex
    }
    let cursor = 0
    let depth = 0
    /**
     * Consume one required delimiter.
     * @param {string} token Required token.
     * @returns {void} No return value.
     * @throws {Error} Delimiter is missing.
     */
    function requireToken(token) {
      if (tokens[cursor++] !== token) throw new Error('括号或参数不完整')
    }
    /**
     * Parse a number, a constant or a function call.
     * @returns {number} Parsed primary value.
     * @throws {Error} Unexpected token, unknown function or nesting overflow.
     */
    function primary() {
      if (++depth > 80) throw new Error('括号嵌套过深')
      try {
        const token = tokens[cursor++]
        if (token && typeof token === 'object') return token.number
        if (token === '(') {
          const value = add()
          requireToken(')')
          return value
        }
        if (token === 'pi') return Math.PI
        if (token === 'e') return Math.E
        if (typeof token === 'string' && Object.hasOwn(functions, token)) {
          requireToken('(')
          const values = [add()]
          while (tokens[cursor] === ',') {
            cursor++
            values.push(add())
          }
          requireToken(')')
          const variadic = ['min', 'max', 'sum', 'avg'].includes(token)
          if (!variadic && values.length !== 1) throw new Error('此函数只接受一个参数')
          return functions[token](...values)
        }
        throw new Error('算式不完整或包含未知函数')
      } finally {
        depth--
      }
    }
    /**
     * Parse a postfix percentage (20% means 0.2).
     * @returns {number} Percentage-adjusted number.
     */
    function percent() {
      let value = primary()
      while (tokens[cursor] === '%') {
        cursor++
        value /= 100
      }
      return value
    }
    /**
     * Parse right-associative powers.
     * @returns {number} Exponentiation result.
     */
    function power() {
      const value = percent()
      if (tokens[cursor] === '^') {
        cursor++
        return value ** unary()
      }
      return value
    }
    /**
     * Parse unary signs with a recursion limit shared by signed expressions.
     * @returns {number} Signed result.
     * @throws {Error} Excessive recursion.
     */
    function unary() {
      if (++depth > 80) throw new Error('算式嵌套过深')
      try {
        if (tokens[cursor] === '+') {
          cursor++
          return unary()
        }
        if (tokens[cursor] === '-') {
          cursor++
          return -unary()
        }
        return power()
      } finally {
        depth--
      }
    }
    /**
     * Parse multiplication and division.
     * @returns {number} Product or quotient.
     * @throws {Error} Division by zero.
     */
    function multiply() {
      let value = unary()
      while (['*', '/', 'x', 'X'].includes(tokens[cursor])) {
        const operator = tokens[cursor++]
        const right = unary()
        if (operator === '/' && right === 0) throw new Error('不能除以零')
        value = operator === '/' ? value / right : value * right
      }
      return value
    }
    /**
     * Parse addition and subtraction.
     * @returns {number} Expression result.
     */
    function add() {
      let value = multiply()
      while (tokens[cursor] === '+' || tokens[cursor] === '-') {
        const operator = tokens[cursor++]
        const right = multiply()
        value = operator === '+' ? value + right : value - right
      }
      return value
    }
    const result = add()
    if (cursor !== tokens.length) throw new Error('算式中缺少运算符')
    if (!Number.isFinite(result)) throw new Error('结果超出范围或函数参数无效')
    return Object.is(result, -0) ? 0 : result
  }

  /**
   * Format a floating point result for readable display.
   * @param {number|null} value Calculated result.
   * @returns {string} Result text without unnecessary binary-float noise.
   */
  function formatResult(value) {
    return value === null ? '' : String(Number(value.toPrecision(14)))
  }

  /**
   * Generate a local date-based paper title.
   * @param {number} now Creation timestamp.
   * @returns {string} Date and time including minutes.
   */
  function defaultTitle(now) {
    return new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    }).format(new Date(now))
  }

  /**
   * Check for meaningful expression or remark content.
   * @param {object} paper A paper document.
   * @returns {boolean} Whether the paper contains any user content.
   */
  function hasContent(paper) {
    return paper.calcList.some((row) => row.expression.trim() || row.remark.trim())
  }

  /**
   * Validate a persisted/imported document without trusting embedded fields.
   * @param {object} raw Candidate document.
   * @param {number} fallbackTime Timestamp used when legacy time is missing.
   * @returns {object} Plain normalized paper document.
   * @throws {Error} Invalid shape, overly large content or invalid date.
   */
  function normalizePaper(raw, fallbackTime) {
    if (
      !raw ||
      typeof raw !== 'object' ||
      !Array.isArray(raw.calcList) ||
      raw.calcList.length > MAX_ROWS
    )
      throw new Error('稿纸格式不正确或行数过多')
    const legacyTime = Number(String(raw._id || '').replace(/^paper\//, ''))
    const createAt = Number(raw.createAt || legacyTime || fallbackTime)
    if (!Number.isFinite(createAt) || createAt <= 0 || createAt > 8.64e15)
      throw new Error('稿纸时间无效')
    const calcList = raw.calcList.map((row) => {
      if (
        !row ||
        typeof row.expression !== 'string' ||
        row.expression.length > MAX_EXPRESSION ||
        (row.remark != null && (typeof row.remark !== 'string' || row.remark.length > 2000))
      )
        throw new Error('算式或备注格式不正确')
      return { expression: row.expression, remark: row.remark || '' }
    })
    if (!calcList.length) calcList.push({ expression: '', remark: '' })
    return {
      _id: String(raw._id || ''),
      ...(typeof raw._rev === 'string' ? { _rev: raw._rev } : {}),
      label: typeof raw.label === 'string' ? raw.label.slice(0, 120) : defaultTitle(createAt),
      createAt,
      updateAt: Number.isFinite(raw.updateAt) ? raw.updateAt : createAt,
      calcList,
      ...(typeof raw.sourceId === 'string' ? { sourceId: raw.sourceId } : {})
    }
  }

  /**
   * Manage paper identity, revisions and recoverable save failures.
   */
  class PaperStore {
    /**
     * Load only this plugin's paper namespace and create an unsaved working sheet.
     * @param {object} db Synchronous ZTools-compatible get/put/allDocs database adapter.
     * @param {Function} now Clock used for deterministic tests.
     * @returns {PaperStore} Initialized store.
     * @throws {Error} Database read or schema validation fails.
     */
    constructor(db, now = Date.now) {
      this.db = db
      this.now = now
      this.dirty = new Set()
      this.counter = 0
      const documents = db.allDocs('paper/')
      if (!Array.isArray(documents)) throw new Error('无法读取稿纸，请勿继续编辑')
      if (documents.length > MAX_PAPERS) throw new Error('稿纸数量超出支持范围，请先备份')
      this.papers = documents
        .filter((doc) => !doc._deleted)
        .map((doc) => normalizePaper(doc, now()))
        .sort((a, b) => b.createAt - a.createAt || b._id.localeCompare(a._id))
      this.currentId = null
      if (this.papers.length >= MAX_PAPERS) this.currentId = this.papers[0]._id
      else this.create()
    }

    /**
     * Get the currently selected paper.
     * @returns {object} Current document.
     */
    current() {
      return this.papers.find((paper) => paper._id === this.currentId)
    }

    /**
     * Create a paper, reusing only a never-saved empty working paper.
     * @returns {object} Selected new or reusable document.
     * @throws {Error} The paper limit has been reached.
     */
    create() {
      const blank = this.papers.find(
        (paper) => !paper._rev && !paper.sourceId && !hasContent(paper)
      )
      if (blank) {
        this.currentId = blank._id
        return blank
      }
      if (this.papers.length >= MAX_PAPERS) throw new Error('稿纸数量已达上限，请先导出备份')
      const now = this.now()
      let id
      do {
        id = `paper/${now}-${++this.counter}`
      } while (this.papers.some((paper) => paper._id === id))
      const paper = {
        _id: id,
        label: defaultTitle(now),
        createAt: now,
        updateAt: now,
        calcList: [{ expression: '', remark: '' }]
      }
      this.papers.unshift(paper)
      this.currentId = id
      return paper
    }

    /**
     * Switch to an existing document without creating a new snapshot.
     * @param {string} id Target paper identity.
     * @returns {object} Selected paper.
     * @throws {Error} Unknown document.
     */
    select(id) {
      const paper = this.papers.find((item) => item._id === id)
      if (!paper) throw new Error('稿纸不存在')
      this.currentId = id
      return paper
    }

    /**
     * Mark a paper dirty after validating its editable fields.
     * @param {object} paper Paper changed by the editor.
     * @returns {void} No return value.
     * @throws {Error} Invalid content.
     */
    changed(paper) {
      normalizePaper(paper, this.now())
      paper.updateAt = this.now()
      this.dirty.add(paper._id)
    }

    /**
     * Save pending papers and retain failed revisions for a visible retry.
     * @returns {number} Count of successfully persisted documents.
     * @throws {Error} A write fails; remaining changes stay dirty.
     */
    flush() {
      let saved = 0
      for (const id of Array.from(this.dirty)) {
        const paper = this.papers.find((item) => item._id === id)
        if (!paper) continue
        if (!paper._rev && !paper.sourceId && !hasContent(paper)) {
          this.dirty.delete(id)
          continue
        }
        const result = this.db.put(JSON.parse(JSON.stringify(paper)))
        if (!result || result.ok !== true || typeof result.rev !== 'string')
          throw new Error(
            result && result.name === 'conflict'
              ? '保存冲突：内容仍在当前窗口，请导出备份后重新打开'
              : '保存失败：内容仍在当前窗口，请重试或导出备份'
          )
        paper._rev = result.rev
        this.dirty.delete(id)
        saved++
      }
      return saved
    }

    /**
     * Import validated legacy JSON without overwriting or deleting source documents.
     * @param {unknown} input JSON array or an object containing papers.
     * @returns {{imported:number,skipped:number}} Import counts.
     * @throws {Error} Invalid input or persistence failure; dirty imported docs remain recoverable.
     */
    importLegacy(input) {
      const raw = Array.isArray(input) ? input : input && input.papers
      if (!Array.isArray(raw) || raw.length > MAX_PAPERS)
        throw new Error('请选择有效的稿纸 JSON 导出文件')
      // Validate the complete import before changing any in-memory records.
      const candidates = raw.map((item) => normalizePaper(item, this.now()))
      const seen = new Set(this.papers.map((paper) => paper.sourceId).filter(Boolean))
      let imported = 0
      let skipped = 0
      const additions = []
      for (const candidate of candidates) {
        if (!candidate._id || !candidate._id.startsWith('paper/'))
          throw new Error('导入记录缺少稿纸标识')
        if (seen.has(candidate._id)) {
          skipped++
          continue
        }
        seen.add(candidate._id)
        const sourceId = candidate._id
        delete candidate._rev
        candidate.sourceId = sourceId
        candidate._id = `paper/import-${encodeURIComponent(sourceId)}`
        if (this.papers.some((paper) => paper._id === candidate._id))
          throw new Error('导入标识冲突')
        additions.push(candidate)
      }
      if (this.papers.length + additions.length > MAX_PAPERS)
        throw new Error('导入后稿纸数量超过上限')
      for (const paper of additions) {
        this.papers.push(paper)
        this.dirty.add(paper._id)
        imported++
      }
      this.papers.sort((a, b) => b.createAt - a.createAt || b._id.localeCompare(a._id))
      this.flush()
      return { imported, skipped }
    }

    /**
     * Create a text-only portable export, including unsaved recoverable content.
     * @returns {object} Versioned JSON export payload.
     */
    export() {
      return {
        format: 'ztools-paper-next',
        version: 1,
        papers: this.papers
          .filter((paper) => paper._rev || hasContent(paper))
          .map((paper) => {
            const clean = JSON.parse(JSON.stringify(paper))
            delete clean._rev
            return clean
          })
      }
    }
  }
  return { calculate, formatResult, defaultTitle, hasContent, normalizePaper, PaperStore, MAX_ROWS }
})
