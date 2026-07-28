(function (SA) {
  /**
   * Timeline strip of ordered frame thumbnails.
   */
  class TimelineView {
    /**
     * @param {HTMLElement} root
     * @param {{ getSource: Function, onSelect: Function, onReorder: Function }} hooks
     */
    constructor(root, hooks) {
      this.root = root
      this.hooks = hooks
      this.selectedIndex = -1
      this.dragFrom = -1
    }

    /**
     * @param {any[]} frames
     * @param {number} selectedIndex
     * @param {{ scrollToSelected?: boolean }} [opts]
     */
    render(frames, selectedIndex, opts) {
      this.selectedIndex = selectedIndex
      this.root.innerHTML = ''
      if (!frames.length) {
        const empty = document.createElement('div')
        empty.className = 'tl-empty'
        empty.textContent =
          'Select a pool box, then Add selected → this anim (same box can be added more than once)'
        this.root.appendChild(empty)
        return
      }
      const src = this.hooks.getSource()
      frames.forEach((box, i) => {
        const cell = document.createElement('div')
        cell.className = 'tl-cell' + (i === selectedIndex ? ' selected' : '')
        cell.draggable = true
        const c = document.createElement('canvas')
        c.width = 68
        c.height = 68
        const ctx = c.getContext('2d')
        ctx.imageSmoothingEnabled = false
        ctx.fillStyle = '#0a0c10'
        ctx.fillRect(0, 0, 68, 68)
        if (src) {
          const scale = Math.min(64 / box.w, 64 / box.h)
          const dw = box.w * scale
          const dh = box.h * scale
          const dx = (68 - dw) / 2
          const dy = (68 - dh) / 2
          SA.Polygon.drawFrame(ctx, src, box, dx, dy, dw, dh)
        }
        const idx = document.createElement('div')
        idx.className = 'idx'
        idx.textContent = String(i)
        const poolId = box.srcId != null ? box.srcId : box.id
        idx.title =
          poolId != null
            ? `Timeline slot ${i} · pool box #${poolId} (same pool box can appear more than once)`
            : `Timeline slot ${i}`
        if (poolId != null) {
          const src = document.createElement('div')
          src.className = 'src-id'
          src.textContent = '#' + poolId
          cell.appendChild(src)
        }
        cell.appendChild(c)
        cell.appendChild(idx)
        cell.addEventListener('click', (e) => {
          e.stopPropagation()
          this.hooks.onSelect(i)
        })
        cell.addEventListener('dragstart', () => {
          this.dragFrom = i
        })
        cell.addEventListener('dragover', (e) => {
          e.preventDefault()
          cell.classList.add('drag-over')
        })
        cell.addEventListener('dragleave', () => cell.classList.remove('drag-over'))
        cell.addEventListener('drop', (e) => {
          e.preventDefault()
          cell.classList.remove('drag-over')
          if (this.dragFrom < 0 || this.dragFrom === i) return
          this.hooks.onReorder(this.dragFrom, i)
          this.dragFrom = -1
        })
        this.root.appendChild(cell)
      })
      if (opts && opts.scrollToSelected) this.scrollToIndex(selectedIndex)
    }

    /**
     * Update selection highlight without rebuilding thumbnails (playback playhead).
     * @param {number} index
     * @param {{ scroll?: boolean, smooth?: boolean }} [opts]
     */
    setSelectedIndex(index, opts) {
      if (index == null || index < 0) return
      if (this.selectedIndex === index && !(opts && opts.scroll)) return
      this.selectedIndex = index
      const cells = this.root.querySelectorAll('.tl-cell')
      cells.forEach((cell, i) => {
        cell.classList.toggle('selected', i === index)
      })
      if (opts && opts.scroll) {
        this.scrollToIndex(index, { smooth: !!(opts && opts.smooth) })
      }
    }

    /**
     * Keep a timeline slot in horizontal view (e.g. after append).
     * @param {number} index
     * @param {{ smooth?: boolean }} [opts]
     */
    scrollToIndex(index, opts) {
      if (index == null || index < 0) return
      const cell = this.root.children[index]
      if (!cell || typeof cell.scrollIntoView !== 'function') return
      const smooth = !opts || opts.smooth !== false
      // Defer so layout has the new cell width
      requestAnimationFrame(() => {
        cell.scrollIntoView({
          behavior: smooth ? 'smooth' : 'auto',
          block: 'nearest',
          inline: 'nearest',
        })
      })
    }
  }

  SA.TimelineView = TimelineView
})(window.SpriteAnim)
