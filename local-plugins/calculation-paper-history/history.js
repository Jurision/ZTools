/* eslint-disable @typescript-eslint/explicit-function-return-type -- Standalone runtime uses JSDoc. */
;(function (scope) {
  'use strict'
  let active
  /**
   * Preserve only editable original rows, never cached calculation results.
   * @param {Array} rows Original calculator rows.
   * @returns {Array} Portable rows.
   */
  function cleanRows(rows) {
    return rows.map(({ expression, remark }) => ({
      expression: expression || '',
      remark: remark || ''
    }))
  }
  /**
   * Synchronize the original calculator with revision-aware paper storage.
   * @param {object} app Original calculator instance.
   * @param {object} store PaperStore instance.
   * @param {Function} refresh Original row restoration method.
   * @param {Function} notify Save and navigation feedback callback.
   * @returns {object} History controller.
   */
  function controller(app, store, refresh, notify = () => {}) {
    let timer
    let restoring = false
    const api = {
      app,
      store,
      /**
       * Capture mutations made directly by original row components.
       * @returns {void} No return value.
       */
      capture() {
        if (restoring) return
        const paper = store.current()
        const rows = cleanRows(app.state.calcList)
        if (JSON.stringify(rows) === JSON.stringify(cleanRows(paper.calcList))) return
        paper.calcList = rows
        store.changed(paper)
        clearTimeout(timer)
        timer = setTimeout(api.flush, 500)
        notify('正在保存…')
      },
      /**
       * Flush synchronously before changing identity.
       * @returns {boolean} Save succeeded.
       */
      flush() {
        clearTimeout(timer)
        try {
          api.capture()
          clearTimeout(timer)
          store.flush()
          notify(store.current()._rev ? '已自动保存' : '输入后自动保存')
          return true
        } catch (error) {
          notify(error.message, true)
          return false
        }
      },
      /**
       * Restore original editor rows using its own recalculation path.
       * @returns {void} No return value.
       */
      restore() {
        restoring = true
        refresh(cleanRows(store.current().calcList))
        // React commits the restoration before releasing mutation detection.
        app.setState({}, () => {
          restoring = false
          notify('输入后自动保存')
        })
      },
      /**
       * Switch records only after durable saving succeeds.
       * @param {string} id Existing ID, or empty for a new paper.
       * @returns {boolean} Navigation succeeded.
       */
      navigate(id) {
        if (!api.flush()) return false
        if (id) store.select(id)
        else store.create()
        api.restore()
        return true
      },
      /**
       * Rename and save the active record through the original save dialog.
       * @param {string} label User-entered label.
       * @returns {boolean} Save succeeded.
       */
      save(label) {
        api.capture()
        store.current().label = label || store.current().label
        store.changed(store.current())
        return api.flush()
      },
      /**
       * Rename any listed paper; an empty name restores its automatic date title.
       * @param {string} id Paper identity.
       * @param {string} label User-entered name.
       * @returns {boolean} Save succeeded or nothing changed.
       */
      rename(id, label) {
        const paper = store.papers.find((item) => item._id === id)
        if (!paper) return false
        const next =
          String(label || '')
            .trim()
            .slice(0, 120) || scope.PaperCore.defaultTitle(paper.createAt)
        if (next === paper.label) {
          notify(paper._rev ? '已自动保存' : '输入后自动保存')
          return true
        }
        if (id === store.currentId) api.capture()
        paper.label = next
        store.changed(paper)
        return api.flush()
      },
      /**
       * Forget a record explicitly removed through the original drawer.
       * @param {string} id Successfully deleted ID.
       * @returns {void} No return value.
       */
      removed(id) {
        store.papers = store.papers.filter((paper) => paper._id !== id)
        store.dirty.delete(id)
        if (store.currentId === id) {
          clearTimeout(timer)
          store.create()
          api.restore()
        }
        notify('已删除稿纸')
      }
    }
    return api
  }
  /**
   * Mount a narrow date sidebar without replacing original editor markup.
   * @param {object} history History controller.
   * @returns {Function} Feedback renderer.
   */
  function mount(history) {
    const aside = document.createElement('aside')
    aside.id = 'paper-history'
    aside.setAttribute('aria-label', '稿纸历史')
    const button = document.createElement('button')
    button.id = 'history-new'
    button.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>新建稿纸</span>'
    button.onclick = () => history.navigate()
    const list = document.createElement('nav')
    list.id = 'history-list'
    const status = document.createElement('button')
    status.id = 'history-status'
    status.onclick = () => history.flush()
    aside.append(list, status, button)
    // Original window click handler focuses the last formula; history owns its clicks.
    aside.addEventListener('click', (event) => event.stopPropagation())
    document.body.append(aside)
    // Rename state survives list rebuilds triggered by autosave feedback.
    let editing = null
    let rebuilding = false
    let last = ['', false]
    const render = (message = last[0], error = last[1]) => {
      last = [message, error]
      status.textContent = message
      status.dataset.error = String(error)
      rebuilding = true
      list.replaceChildren()
      rebuilding = false
      for (const paper of history.store.papers) {
        const row = document.createElement('div')
        row.className = 'history-row'
        row.setAttribute('aria-current', String(paper._id === history.store.currentId))
        const date = document.createElement('span')
        date.textContent = new Date(paper.createAt).toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        })
        const automatic = scope.PaperCore.defaultTitle(paper.createAt)
        if (editing?.id === paper._id) {
          row.append(editor(date, automatic))
          list.append(row)
          continue
        }
        const item = document.createElement('button')
        item.className = 'history-item'
        item.dataset.id = paper._id
        item.setAttribute('aria-current', row.getAttribute('aria-current'))
        item.append(date)
        if (paper.label && paper.label !== automatic) {
          const label = document.createElement('small')
          label.textContent = paper.label
          item.append(label)
        }
        item.onclick = () => history.navigate(paper._id)
        item.ondblclick = () => startEditing(paper)
        const rename = document.createElement('button')
        rename.className = 'history-rename'
        rename.title = '重命名'
        rename.setAttribute('aria-label', '重命名')
        rename.innerHTML =
          '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/></svg>'
        rename.onclick = () => startEditing(paper)
        row.append(item, rename)
        list.append(row)
      }
      const input = list.querySelector('.history-rename-input')
      if (input) {
        input.focus()
        input.setSelectionRange(editing.start, editing.end)
      }
    }
    /**
     * Begin inline renaming with the whole current name selected.
     * @param {object} paper Paper to rename.
     * @returns {void} No return value.
     */
    function startEditing(paper) {
      const value = paper.label === scope.PaperCore.defaultTitle(paper.createAt) ? '' : paper.label
      editing = { id: paper._id, value, start: 0, end: value.length }
      render()
    }
    /**
     * Commit or abandon the pending rename exactly once.
     * @param {boolean} save Whether to persist the typed name.
     * @returns {void} No return value.
     */
    function finishEditing(save) {
      if (!editing) return
      const { id, value } = editing
      editing = null
      if (!save || !history.rename(id, value)) render()
    }
    /**
     * Build the inline name field; the original editor never sees its keystrokes.
     * @param {HTMLElement} date Creation date label.
     * @param {string} automatic Automatic title shown as the placeholder.
     * @returns {HTMLElement} Editing block.
     */
    function editor(date, automatic) {
      const block = document.createElement('div')
      block.className = 'history-item editing'
      const input = document.createElement('input')
      input.className = 'history-rename-input'
      input.maxLength = 120
      input.value = editing.value
      input.placeholder = automatic
      const remember = () => {
        if (!editing) return
        editing.value = input.value
        editing.start = input.selectionStart
        editing.end = input.selectionEnd
      }
      input.oninput = remember
      input.onselect = remember
      input.onkeyup = remember
      input.onkeydown = (event) => {
        event.stopPropagation()
        if (event.isComposing) return
        if (event.key === 'Enter') {
          event.preventDefault()
          finishEditing(true)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          finishEditing(false)
        }
      }
      input.onblur = () => {
        if (!rebuilding) finishEditing(true)
      }
      block.append(date, input)
      return block
    }
    return render
  }
  /**
   * Add history around the original class, leaving original rows and evaluator intact.
   * @param {Function} Base Original application React class.
   * @returns {Function} History-enabled subclass.
   */
  function extend(Base) {
    return class extends Base {
      /**
       * Wrap callbacks before their first React render.
       * @param {...unknown} args Original constructor arguments.
       * @returns {object} Original calculator with history bridge.
       */
      constructor(...args) {
        super(...args)
        try {
          const store = new scope.PaperCore.PaperStore(scope.ztools.db)
          const refresh = this.handleRefreshPaper
          this.history = controller(this, store, refresh, (message, error) =>
            this.historyFeedback?.(message, error)
          )
          const change = this.handleExpressionChange
          this.handleExpressionChange = (...values) => {
            change(...values)
            this.history.capture()
          }
          this.handleRefreshPaper = (rows, id) => (id ? this.history.navigate(id) : refresh(rows))
          this.handleSavePaper = (label) => {
            if (this.history.save(label)) this.handleCloseSaveDialog()
          }
          active = this.history
        } catch (error) {
          this.historyError = error.message
        }
      }
      /**
       * Install sidebar and lifecycle flushes.
       * @returns {void} No return value.
       */
      componentDidMount() {
        super.componentDidMount()
        if (!this.history) {
          this.showMessage(this.historyError, 'error')
          document.querySelectorAll('textarea').forEach((input) => {
            input.disabled = true
          })
          return
        }
        this.historyFeedback = mount(this.history)
        this.history.restore()
        scope.addEventListener('blur', () => this.history.flush())
        scope.addEventListener('beforeunload', () => this.history.flush())
        scope.ztools.onPluginOut?.(() => this.history.flush())
        scope.addEventListener('keydown', (event) => {
          if (
            (event.ctrlKey || event.metaKey) &&
            event.code === 'KeyN' &&
            !event.repeat &&
            !event.isComposing
          ) {
            event.preventDefault()
            this.history.navigate()
          }
        })
      }
      /**
       * Capture remark, clear and host payload changes.
       * @returns {void} No return value.
       */
      componentDidUpdate() {
        this.history?.capture()
      }
    }
  }
  scope.PaperHistory = {
    extend,
    controller,
    cleanRows,
    get active() {
      return active
    },
    removed: (id) => active?.removed(id)
  }
})(typeof window === 'undefined' ? globalThis : window)
