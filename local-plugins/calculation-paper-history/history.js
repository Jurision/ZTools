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
    return (message, error = false) => {
      status.textContent = message
      status.dataset.error = String(error)
      list.replaceChildren()
      for (const paper of history.store.papers) {
        const item = document.createElement('button')
        item.className = 'history-item'
        item.dataset.id = paper._id
        item.setAttribute('aria-current', String(paper._id === history.store.currentId))
        const date = document.createElement('span')
        date.textContent = new Date(paper.createAt).toLocaleString('zh-CN', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false
        })
        const label = document.createElement('small')
        label.textContent = paper.label
        item.append(date)
        if (paper.label && paper.label !== scope.PaperCore.defaultTitle(paper.createAt))
          item.append(label)
        item.onclick = () => history.navigate(paper._id)
        list.append(item)
      }
    }
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
