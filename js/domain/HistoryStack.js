(function (SA) {
  class HistoryStack {
    /** @param {number} [max=100] */
    constructor(max = 100) {
      this.max = max
      /** @type {{ snap: any, json: string, label: string }[]} */
      this.past = []
      /** @type {{ snap: any, json: string, label: string }[]} */
      this.future = []
    }

    get canUndo() {
      return this.past.length > 0
    }

    get canRedo() {
      return this.future.length > 0
    }

    /**
     * @param {any} snap
     * @param {string} [label]
     */
    push(snap, label = '') {
      const json = JSON.stringify(snap)
      if (this.past.length && this.past[this.past.length - 1].json === json) return
      this.past.push({ snap, json, label })
      if (this.past.length > this.max) this.past.shift()
      this.future = []
    }

    /**
     * @param {any} currentSnap
     * @returns {any|null}
     */
    undo(currentSnap) {
      if (!this.past.length) return null
      const prev = this.past.pop()
      this.future.push({
        snap: currentSnap,
        json: JSON.stringify(currentSnap),
        label: prev.label || '',
      })
      return prev
    }

    /**
     * @param {any} currentSnap
     * @returns {any|null}
     */
    redo(currentSnap) {
      if (!this.future.length) return null
      const next = this.future.pop()
      this.past.push({
        snap: currentSnap,
        json: JSON.stringify(currentSnap),
        label: next.label || '',
      })
      return next
    }

    clear() {
      this.past = []
      this.future = []
    }
  }

  SA.HistoryStack = HistoryStack
})(window.SpriteAnim)
