(function (SA) {
  const HANDLE_MODES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
  const MIN_BOX = 4
  /** Custom cursor: pink ring + white plus (hotspot centered). */
  const CURSOR_ADD_POINT =
    'url("data:image/svg+xml,' +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
        '<circle cx="12" cy="12" r="10" fill="rgba(10,12,16,0.55)" stroke="#0a0c10" stroke-width="2.5"/>' +
        '<circle cx="12" cy="12" r="10" fill="none" stroke="#ff4081" stroke-width="1.75"/>' +
        '<path d="M12 6.5v11M6.5 12h11" stroke="#0a0c10" stroke-width="3.25" stroke-linecap="round"/>' +
        '<path d="M12 6.5v11M6.5 12h11" stroke="#ffffff" stroke-width="1.75" stroke-linecap="round"/>' +
        '</svg>'
    ) +
    '") 12 12, cell'

  class SheetView {
    constructor(canvas, stageEl, hooks = {}) {
      this.canvas = canvas
      this.ctx = canvas.getContext('2d')
      this.stageEl = stageEl
      this.hooks = hooks
      this.sheetImg = null
      this.natural = { w: 0, h: 0 }
      this.boxes = []
      this.selectedIndex = -1
      this.selectedVertex = -1
      /** @type {Set<number>} indices in multi-selection (includes primary) */
      this.selectedIndices = new Set()
      /** @type {Set<number>|null} frame ids used by active anim; null = treat all as active */
      this.activeIds = null
      this.hideChroma = false
      this.chroma = new SA.ChromaKey()
      this.keyedSheet = null
      this.keyedDirty = true
      /** Native transparent sheet — show checkerboard, skip chroma UI. */
      this.alphaSheet = false
      this.drawMarquee = null
      /** Empty-drag selection marquee (distinct from Shift create marquee). */
      this.selectMarquee = null
      this.boxDrag = null
      this.pickMode = false
      /** @type {CanvasRenderingContext2D|null} */
      this._sampleCtx = null
      /** @type {{ x: number, y: number, clientX: number, clientY: number, altKey: boolean, shiftKey: boolean }|null} */
      this._lastPointer = null
      this.zoom = 1
      this.minZoom = 0.25
      this.maxZoom = 8
      this.panMode = false
      this.spacePan = null
      this._bindPointer()
    }

    setPickMode(on) {
      this.pickMode = !!on
      this.stageEl.classList.toggle('pick-chroma', this.pickMode)
    }

    /** @param {number} mx @param {number} my */
    samplePixelAt(mx, my) {
      if (!this._sampleCtx || !this.natural.w) return null
      const x = Math.max(0, Math.min(this.natural.w - 1, Math.floor(mx)))
      const y = Math.max(0, Math.min(this.natural.h - 1, Math.floor(my)))
      const d = this._sampleCtx.getImageData(x, y, 1, 1).data
      return { r: d[0], g: d[1], b: d[2] }
    }

    setImage(img) {
      this.sheetImg = img
      this.keyedDirty = true
      this.keyedSheet = null
      this._sampleCtx = null
      if (img) {
        this.natural = { w: img.naturalWidth, h: img.naturalHeight }
        const c = document.createElement('canvas')
        c.width = this.natural.w
        c.height = this.natural.h
        this._sampleCtx = c.getContext('2d')
        this._sampleCtx.drawImage(img, 0, 0)
        this.applyZoomCss()
      } else {
        this.natural = { w: 0, h: 0 }
        this.canvas.width = 1
        this.canvas.height = 1
        this.canvas.style.width = ''
        this.canvas.style.height = ''
      }
    }

    /** Snap zoom to a nice display step. */
    clampZoom(z) {
      const n = Math.min(this.maxZoom, Math.max(this.minZoom, z))
      return Math.round(n * 100) / 100
    }

    applyZoomCss() {
      if (!this.natural.w) {
        this.canvas.style.width = ''
        this.canvas.style.height = ''
        return
      }
      this.canvas.style.width = `${this.natural.w * this.zoom}px`
      this.canvas.style.height = `${this.natural.h * this.zoom}px`
      if (this.hooks.onZoomChange) this.hooks.onZoomChange(this.zoom)
    }

    /**
     * @param {number} z
     * @param {{ clientX?: number, clientY?: number }} [anchor] keep this screen point over same sheet pixel
     */
    setZoom(z, anchor) {
      const next = this.clampZoom(z)
      if (Math.abs(next - this.zoom) < 0.001) {
        this.applyZoomCss()
        return
      }
      const stage = this.stageEl
      let sheetX = null
      let sheetY = null
      let viewX = 0
      let viewY = 0
      if (anchor && anchor.clientX != null && this.natural.w) {
        const rect = stage.getBoundingClientRect()
        viewX = anchor.clientX - rect.left
        viewY = anchor.clientY - rect.top
        sheetX = (stage.scrollLeft + viewX) / this.zoom
        sheetY = (stage.scrollTop + viewY) / this.zoom
      }
      this.zoom = next
      this.applyZoomCss()
      if (sheetX != null) {
        stage.scrollLeft = sheetX * this.zoom - viewX
        stage.scrollTop = sheetY * this.zoom - viewY
      }
    }

    zoomBy(factor, anchor) {
      this.setZoom(this.zoom * factor, anchor)
    }

    zoomIn(anchor) {
      this.setZoom(this.zoom * 1.25, anchor)
    }

    zoomOut(anchor) {
      this.setZoom(this.zoom / 1.25, anchor)
    }

    zoomReset() {
      this.setZoom(1)
      this.stageEl.scrollLeft = 0
      this.stageEl.scrollTop = 0
    }

    /** Fit sheet in the stage viewport. */
    zoomFit() {
      if (!this.natural.w || !this.natural.h) return
      const pad = 12
      const sw = Math.max(40, this.stageEl.clientWidth - pad)
      const sh = Math.max(40, this.stageEl.clientHeight - pad)
      const z = Math.min(sw / this.natural.w, sh / this.natural.h)
      this.setZoom(z)
      this.stageEl.scrollLeft = 0
      this.stageEl.scrollTop = 0
    }

    zoomLabel() {
      return `${Math.round(this.zoom * 100)}%`
    }

    /** Hold-Space hand tool: drag pans the stage. */
    setPanMode(on) {
      this.panMode = !!on
      this.stageEl.classList.toggle('panning', this.panMode)
      if (!this.panMode) {
        this.spacePan = null
        this.stageEl.classList.remove('panning-drag')
      }
      this.updateHoverCursor()
    }

    setBoxes(boxes, selectedIndex, selectedVertex, activeIds, selectedIndices) {
      this.boxes = boxes
      this.selectedIndex = selectedIndex
      this.selectedVertex = selectedVertex != null ? selectedVertex : -1
      this.activeIds = activeIds instanceof Set ? activeIds : activeIds || null
      this.selectedIndices = new Set(selectedIndices || [])
      if (selectedIndex >= 0) this.selectedIndices.add(selectedIndex)
    }

    setChroma(chroma, hide, alphaSheet) {
      this.chroma = chroma
      this.hideChroma = hide
      this.alphaSheet = !!alphaSheet
      this.keyedDirty = true
      this.keyedSheet = null
    }

    displaySource() {
      if (!this.sheetImg) return null
      // Alpha sheets already transparent — draw as-is over checkerboard
      if (this.alphaSheet) return this.sheetImg
      if (!this.hideChroma) return this.sheetImg
      if (!this.keyedDirty && this.keyedSheet) return this.keyedSheet
      this.keyedSheet = this.chroma.keyToCanvas(this.sheetImg)
      this.keyedDirty = false
      return this.keyedSheet
    }

    updateKeyedChrome() {
      this.stageEl.classList.toggle('keyed', this.hideChroma || this.alphaSheet)
    }

    handleSlop() {
      const rect = this.canvas.getBoundingClientRect()
      if (!rect.width) return 8
      const sx = this.canvas.width / rect.width
      return Math.max(5, 7 * sx)
    }

    handlePoints(b) {
      const cx = b.x + b.w / 2
      const cy = b.y + b.h / 2
      return {
        nw: { x: b.x, y: b.y },
        n: { x: cx, y: b.y },
        ne: { x: b.x + b.w, y: b.y },
        e: { x: b.x + b.w, y: cy },
        se: { x: b.x + b.w, y: b.y + b.h },
        s: { x: cx, y: b.y + b.h },
        sw: { x: b.x, y: b.y + b.h },
        w: { x: b.x, y: cy },
      }
    }

    hitTestHandle(mx, my, b) {
      const pts = this.handlePoints(b)
      const slop = this.handleSlop()
      for (const mode of HANDLE_MODES) {
        const p = pts[mode]
        if (Math.abs(mx - p.x) <= slop && Math.abs(my - p.y) <= slop) return mode
      }
      return null
    }

    /** Character-anchor handle position inside the box. */
    anchorHandlePoint(b) {
      const ax = b.anchorX != null ? b.anchorX : 0.5
      const ay = b.anchorY != null ? b.anchorY : 1
      return { x: b.x + ax * b.w, y: b.y + ay * b.h }
    }

    hitTestAnchor(mx, my, b) {
      const p = this.anchorHandlePoint(b)
      const slop = this.handleSlop() * 1.15
      return Math.abs(mx - p.x) <= slop && Math.abs(my - p.y) <= slop
    }

    drawAnchorHandle(b, sel) {
      const ctx = this.ctx
      const p = this.anchorHandlePoint(b)
      const hs = Math.max(4, this.handleSlop() * 0.65)
      const onBottom = Math.abs((b.anchorY != null ? b.anchorY : 1) - 1) < 0.02
      ctx.beginPath()
      ctx.moveTo(p.x, p.y - hs)
      ctx.lineTo(p.x + hs, p.y)
      ctx.lineTo(p.x, p.y + hs)
      ctx.lineTo(p.x - hs, p.y)
      ctx.closePath()
      ctx.fillStyle = sel ? '#00e5ff' : 'rgba(0, 229, 255, 0.45)'
      ctx.fill()
      ctx.strokeStyle = sel ? '#0a0c10' : 'rgba(10, 12, 16, 0.7)'
      ctx.lineWidth = sel ? 2 : 1
      ctx.stroke()
      if (sel) {
        // Crosshair guides through anchor
        ctx.beginPath()
        ctx.moveTo(b.x, p.y + 0.5)
        ctx.lineTo(b.x + b.w, p.y + 0.5)
        ctx.moveTo(p.x + 0.5, b.y)
        ctx.lineTo(p.x + 0.5, b.y + b.h)
        ctx.strokeStyle = 'rgba(0, 229, 255, 0.35)'
        ctx.lineWidth = 1
        ctx.setLineDash([3, 3])
        ctx.stroke()
        ctx.setLineDash([])
        if (onBottom) {
          ctx.beginPath()
          ctx.moveTo(b.x, b.y + b.h + 0.5)
          ctx.lineTo(b.x + b.w, b.y + b.h + 0.5)
          ctx.strokeStyle = 'rgba(0, 229, 255, 0.55)'
          ctx.stroke()
        }
      }
    }

    hitTestVertex(mx, my, b) {
      return SA.Polygon.hitTestVertex(b.absPoints(), mx, my, this.handleSlop())
    }

    /**
     * Hit-test polygon edges (same threshold as Alt+click insert).
     * @returns {{ edge: number, pt: number[] }|null}
     */
    hitTestEdge(mx, my, b) {
      const abs = b.absPoints()
      if (!abs || abs.length < 2) return null
      const maxDist = this.handleSlop() * 1.5
      let best = null
      let bestD = maxDist
      for (let i = 0; i < abs.length; i++) {
        const a = abs[i]
        const c = abs[(i + 1) % abs.length]
        const hit = SA.Polygon.nearestOnSegment(a, c, mx, my)
        if (hit.d < bestD) {
          bestD = hit.d
          best = { edge: i, pt: hit.pt }
        }
      }
      return best
    }

    cursorForHandle(mode) {
      if (mode === 'n' || mode === 's') return 'ns-resize'
      if (mode === 'e' || mode === 'w') return 'ew-resize'
      if (mode === 'ne' || mode === 'sw') return 'nesw-resize'
      if (mode === 'nw' || mode === 'se') return 'nwse-resize'
      return 'default'
    }

    hitTestBox(mx, my) {
      for (let i = this.boxes.length - 1; i >= 0; i--) {
        const b = this.boxes[i]
        if (mx >= b.x && my >= b.y && mx < b.x + b.w && my < b.y + b.h) return i
      }
      return -1
    }

    /**
     * Update canvas cursor from last pointer / modifiers.
     * @param {{ x: number, y: number, altKey?: boolean, shiftKey?: boolean }|null} [ptr]
     */
    updateHoverCursor(ptr) {
      if (ptr) this._lastPointer = ptr
      const p = this._lastPointer
      if (this.panMode) {
        this.canvas.style.cursor = this.spacePan ? 'grabbing' : 'grab'
        this.stageEl.classList.remove('add-point')
        return
      }
      if (!this.sheetImg || !p || this.pickMode || this.boxDrag || this.drawMarquee || this.selectMarquee) {
        return
      }
      const { x, y } = p
      const altKey = !!p.altKey
      const shiftKey = !!p.shiftKey
      if (shiftKey) {
        this.canvas.style.cursor = 'crosshair'
        return
      }
      if (this.selectedIndex >= 0 && this.boxes[this.selectedIndex]) {
        const sel = this.boxes[this.selectedIndex]
        // Alt + feet anchor → move anchor (keeps bottom-middle resize free otherwise)
        if (altKey && this.hitTestAnchor(x, y, sel)) {
          this.stageEl.classList.remove('add-point')
          this.canvas.style.cursor = 'move'
          return
        }
        if (altKey && this.hitTestEdge(x, y, sel)) {
          this.canvas.style.cursor = CURSOR_ADD_POINT
          this.stageEl.classList.add('add-point')
          return
        }
        this.stageEl.classList.remove('add-point')
        if (this.hitTestVertex(x, y, sel) >= 0) {
          this.canvas.style.cursor = 'crosshair'
          return
        }
        const handle = this.hitTestHandle(x, y, sel)
        if (handle) {
          this.canvas.style.cursor = this.cursorForHandle(handle)
          return
        }
        if (this.hitTestBox(x, y) === this.selectedIndex) {
          this.canvas.style.cursor = 'move'
          return
        }
      } else {
        this.stageEl.classList.remove('add-point')
      }
      this.canvas.style.cursor = this.hitTestBox(x, y) >= 0 ? 'pointer' : 'default'
    }

    canvasCoords(ev) {
      const rect = this.canvas.getBoundingClientRect()
      const sx = this.canvas.width / rect.width
      const sy = this.canvas.height / rect.height
      return {
        x: (ev.clientX - rect.left) * sx,
        y: (ev.clientY - rect.top) * sy,
      }
    }

    clampBox(b) {
      const maxW = this.natural.w || 1
      const maxH = this.natural.h || 1
      let x = b.x
      let y = b.y
      let w = Math.max(MIN_BOX, b.w)
      let h = Math.max(MIN_BOX, b.h)
      if (x < 0) {
        w += x
        x = 0
      }
      if (y < 0) {
        h += y
        y = 0
      }
      if (x + w > maxW) w = maxW - x
      if (y + h > maxH) h = maxH - y
      return {
        x: Math.round(x),
        y: Math.round(y),
        w: Math.max(MIN_BOX, Math.round(w)),
        h: Math.max(MIN_BOX, Math.round(h)),
      }
    }

    resizeBox(orig, mode, mx, my) {
      let x0 = orig.x
      let y0 = orig.y
      let x1 = orig.x + orig.w
      let y1 = orig.y + orig.h
      if (mode.includes('w')) x0 = mx
      if (mode.includes('e')) x1 = mx
      if (mode.includes('n')) y0 = my
      if (mode.includes('s')) y1 = my
      const x = Math.min(x0, x1)
      const y = Math.min(y0, y1)
      return this.clampBox({ x, y, w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) })
    }

    /** @param {CanvasRenderingContext2D} ctx @param {*} b */
    traceBoxPolygon(ctx, b) {
      const abs = b.absPoints()
      ctx.beginPath()
      ctx.moveTo(abs[0][0] + 0.5, abs[0][1] + 0.5)
      for (let i = 1; i < abs.length; i++) {
        ctx.lineTo(abs[i][0] + 0.5, abs[i][1] + 0.5)
      }
      ctx.closePath()
      return abs
    }

    /** High-contrast handle square — readable on light and dark pixels. */
    drawHandleSquare(x, y, hs, fill, active) {
      const ctx = this.ctx
      const size = hs * 2
      const ox = x - hs + 0.5
      const oy = y - hs + 0.5
      ctx.fillStyle = 'rgba(10, 12, 16, 0.92)'
      ctx.fillRect(ox - 1, oy - 1, size + 1, size + 1)
      ctx.strokeStyle = active ? '#ffffff' : '#ff4081'
      ctx.lineWidth = active ? 2 : 1.5
      ctx.strokeRect(ox - 1.5, oy - 1.5, size + 2, size + 2)
      ctx.fillStyle = fill
      ctx.fillRect(ox, oy, size - 1, size - 1)
    }

    drawBoxShape(b, sel, inActive) {
      const ctx = this.ctx
      const strokeOutlined = (outer, inner, outerW, innerW, dash) => {
        this.traceBoxPolygon(ctx, b)
        ctx.setLineDash(dash || [])
        ctx.globalAlpha = 1
        ctx.strokeStyle = outer
        ctx.lineWidth = outerW
        ctx.stroke()
        this.traceBoxPolygon(ctx, b)
        ctx.strokeStyle = inner
        ctx.lineWidth = innerW
        ctx.stroke()
        ctx.setLineDash([])
      }

      if (sel) {
        this.traceBoxPolygon(ctx, b)
        ctx.fillStyle = 'rgba(255, 64, 129, 0.16)'
        ctx.fill()
        strokeOutlined('rgba(10, 12, 16, 0.95)', '#ff4081', 4, 2)
        this.traceBoxPolygon(ctx, b)
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1
        ctx.stroke()
      } else if (inActive) {
        this.traceBoxPolygon(ctx, b)
        ctx.fillStyle = 'rgba(92, 255, 157, 0.10)'
        ctx.fill()
        strokeOutlined('rgba(10, 12, 16, 0.9)', '#5cff9d', 3.5, 1.75)
      } else {
        this.traceBoxPolygon(ctx, b)
        ctx.fillStyle = 'rgba(156, 220, 254, 0.08)'
        ctx.fill()
        strokeOutlined('rgba(10, 12, 16, 0.85)', '#7eb8ff', 3, 1.5, [5, 3])
      }
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    }

    draw() {
      this.updateKeyedChrome()
      if (!this.sheetImg) {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
        return
      }
      const src = this.displaySource()
      const w = this.natural.w
      const h = this.natural.h
      this.canvas.width = w
      this.canvas.height = h
      this.applyZoomCss()
      this.ctx.imageSmoothingEnabled = false
      this.ctx.clearRect(0, 0, w, h)
      this.ctx.drawImage(src, 0, 0)

      this.boxes.forEach((b, i) => {
        const sel = this.selectedIndices.has(i) || i === this.selectedIndex
        const primary = i === this.selectedIndex
        const inActive = !this.activeIds || this.activeIds.has(b.id)
        this.drawBoxShape(b, sel, inActive)
        const label = String(i)
        this.ctx.font = 'bold 12px Segoe UI, sans-serif'
        const tw = this.ctx.measureText(label).width + 6
        if (sel) {
          this.ctx.globalAlpha = 1
          this.ctx.fillStyle = 'rgba(10, 12, 16, 0.92)'
          this.ctx.fillRect(b.x, b.y, tw, 14)
          this.ctx.strokeStyle = primary ? '#ff4081' : '#ff8fb3'
          this.ctx.lineWidth = primary ? 2 : 1.5
          this.ctx.strokeRect(b.x + 0.5, b.y + 0.5, tw - 1, 13)
          this.ctx.fillStyle = '#ffffff'
        } else if (inActive) {
          this.ctx.globalAlpha = 1
          this.ctx.fillStyle = 'rgba(10, 12, 16, 0.88)'
          this.ctx.fillRect(b.x, b.y, tw, 14)
          this.ctx.strokeStyle = '#5cff9d'
          this.ctx.lineWidth = 1.5
          this.ctx.strokeRect(b.x + 0.5, b.y + 0.5, tw - 1, 13)
          this.ctx.fillStyle = '#5cff9d'
        } else {
          this.ctx.globalAlpha = 1
          this.ctx.fillStyle = 'rgba(10, 12, 16, 0.82)'
          this.ctx.fillRect(b.x, b.y, tw, 14)
          this.ctx.strokeStyle = '#7eb8ff'
          this.ctx.lineWidth = 1.5
          this.ctx.strokeRect(b.x + 0.5, b.y + 0.5, tw - 1, 13)
          this.ctx.fillStyle = '#9cdcfe'
        }
        this.ctx.fillText(label, b.x + 3, b.y + 11)
        this.ctx.globalAlpha = 1
        if (primary) {
          const hs = Math.max(3, this.handleSlop() * 0.55)
          const abs = b.absPoints()
          abs.forEach((p, vi) => {
            const active = vi === this.selectedVertex
            this.drawHandleSquare(p[0], p[1], hs, active ? '#ff6b8a' : '#7eb8ff', active)
          })
          const pts = this.handlePoints(b)
          for (const mode of HANDLE_MODES) {
            const p = pts[mode]
            this.drawHandleSquare(p.x, p.y, hs, '#ffd166', false)
          }
          this.drawAnchorHandle(b, true)
        } else if (inActive) {
          this.drawAnchorHandle(b, false)
        }
      })

      if (this.drawMarquee) {
        const x = Math.min(this.drawMarquee.x0, this.drawMarquee.x1)
        const y = Math.min(this.drawMarquee.y0, this.drawMarquee.y1)
        const mw = Math.abs(this.drawMarquee.x1 - this.drawMarquee.x0)
        const mh = Math.abs(this.drawMarquee.y1 - this.drawMarquee.y0)
        this.ctx.strokeStyle = '#7eb8ff'
        this.ctx.setLineDash([4, 3])
        this.ctx.lineWidth = 1
        this.ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, mw - 1), Math.max(0, mh - 1))
        this.ctx.setLineDash([])
      }
      if (this.selectMarquee) {
        const x = Math.min(this.selectMarquee.x0, this.selectMarquee.x1)
        const y = Math.min(this.selectMarquee.y0, this.selectMarquee.y1)
        const mw = Math.abs(this.selectMarquee.x1 - this.selectMarquee.x0)
        const mh = Math.abs(this.selectMarquee.y1 - this.selectMarquee.y0)
        this.ctx.fillStyle = 'rgba(255, 64, 129, 0.10)'
        this.ctx.fillRect(x, y, mw, mh)
        this.ctx.strokeStyle = '#ff4081'
        this.ctx.setLineDash([6, 3])
        this.ctx.lineWidth = 1.5
        this.ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, mw - 1), Math.max(0, mh - 1))
        this.ctx.setLineDash([])
      }
    }

    _boxSnapshot(b) {
      return {
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        id: b.id,
        anchorX: b.anchorX != null ? b.anchorX : 0.5,
        anchorY: b.anchorY != null ? b.anchorY : 1,
        points: SA.Polygon.clone(b.points),
      }
    }

    _bindPointer() {
      this.stageEl.addEventListener(
        'wheel',
        (ev) => {
          if (!this.sheetImg) return
          // Ctrl/Cmd+wheel zooms toward cursor; plain wheel scrolls the stage
          if (!(ev.ctrlKey || ev.metaKey)) return
          ev.preventDefault()
          const factor = ev.deltaY < 0 ? 1.12 : 1 / 1.12
          this.zoomBy(factor, { clientX: ev.clientX, clientY: ev.clientY })
        },
        { passive: false }
      )

      this.canvas.addEventListener('contextmenu', (ev) => {
        ev.preventDefault()
        if (!this.sheetImg || this.boxDrag) return
        const { x, y } = this.canvasCoords(ev)
        const i = this.hitTestBox(x, y)
        if (i < 0) return
        this.selectedIndex = i
        if (this.hooks.onSelect) this.hooks.onSelect(i)
        this.draw()
      })

      this.canvas.addEventListener('dblclick', (ev) => {
        if (!this.sheetImg || ev.shiftKey) return
        ev.preventDefault()
        const { x, y } = this.canvasCoords(ev)
        const i = this.hitTestBox(x, y)
        if (i < 0) return
        this.selectedIndex = i
        if (this.hooks.onSelect) this.hooks.onSelect(i)
        if (this.hooks.onSnap) this.hooks.onSnap()
      })

      this.canvas.addEventListener('mousedown', (ev) => {
        if (!this.sheetImg || ev.button !== 0) return
        if (this.panMode) {
          ev.preventDefault()
          this.spacePan = {
            startX: ev.clientX,
            startY: ev.clientY,
            scrollLeft: this.stageEl.scrollLeft,
            scrollTop: this.stageEl.scrollTop,
          }
          this.stageEl.classList.add('panning-drag')
          this.canvas.style.cursor = 'grabbing'
          return
        }
        const { x, y } = this.canvasCoords(ev)
        if (this.pickMode) {
          ev.preventDefault()
          const rgb = this.samplePixelAt(x, y)
          if (rgb && this.hooks.onPickChroma) this.hooks.onPickChroma(rgb)
          return
        }
        if (ev.shiftKey) {
          ev.preventDefault()
          this.drawMarquee = { x0: x, y0: y, x1: x, y1: y }
          this.draw()
          return
        }
        if (this.selectedIndex >= 0 && this.boxes[this.selectedIndex]) {
          const sel = this.boxes[this.selectedIndex]
          if (ev.altKey) {
            ev.preventDefault()
            // Alt+drag feet anchor (so bottom-middle resize works without Alt)
            if (this.hitTestAnchor(x, y, sel)) {
              if (this.hooks.onHistoryMove) this.hooks.onHistoryMove()
              this.boxDrag = {
                mode: 'anchor',
                index: this.selectedIndex,
                startX: x,
                startY: y,
                orig: this._boxSnapshot(sel),
                moved: false,
                forceFree: !!ev.shiftKey,
              }
              return
            }
            if (this.hooks.onHistoryVertex) this.hooks.onHistoryVertex()
            const abs = sel.absPoints()
            const ins = SA.Polygon.insertOnEdge(abs, x, y, this.handleSlop() * 1.5)
            if (ins.index >= 0 && this.hooks.onInsertVertex) {
              this.hooks.onInsertVertex(this.selectedIndex, ins.points, ins.index)
            }
            return
          }
          const vi = this.hitTestVertex(x, y, sel)
          if (vi >= 0) {
            ev.preventDefault()
            if (this.hooks.onVertexSelect) this.hooks.onVertexSelect(vi)
            if (this.hooks.onHistoryVertex) this.hooks.onHistoryVertex()
            this.boxDrag = {
              mode: 'vertex',
              vertexIndex: vi,
              index: this.selectedIndex,
              startX: x,
              startY: y,
              orig: this._boxSnapshot(sel),
              moved: false,
            }
            return
          }
          const handle = this.hitTestHandle(x, y, sel)
          if (handle) {
            ev.preventDefault()
            if (this.hooks.onHistoryResize) this.hooks.onHistoryResize()
            this.boxDrag = {
              mode: handle,
              index: this.selectedIndex,
              startX: x,
              startY: y,
              orig: this._boxSnapshot(sel),
              moved: false,
            }
            return
          }
          if (this.hitTestBox(x, y) === this.selectedIndex) {
            if (ev.ctrlKey || ev.metaKey) {
              ev.preventDefault()
              if (this.hooks.onToggleSelect) this.hooks.onToggleSelect(this.selectedIndex)
              return
            }
            ev.preventDefault()
            this.boxDrag = {
              mode: 'pending-click',
              index: this.selectedIndex,
              startX: x,
              startY: y,
              orig: this._boxSnapshot(sel),
              moved: false,
            }
            return
          }
        }
        const i = this.hitTestBox(x, y)
        if (i >= 0) {
          ev.preventDefault()
          if (ev.ctrlKey || ev.metaKey) {
            if (this.hooks.onToggleSelect) this.hooks.onToggleSelect(i)
            return
          }
          this.selectedIndex = i
          if (this.hooks.onSelect) this.hooks.onSelect(i)
          this.draw()
          this.boxDrag = {
            mode: 'pending-click',
            index: i,
            startX: x,
            startY: y,
            orig: this._boxSnapshot(this.boxes[i]),
            moved: false,
          }
          return
        }
        // Empty sheet: drag-select marquee
        ev.preventDefault()
        this.selectMarquee = { x0: x, y0: y, x1: x, y1: y }
        this.draw()
      })

      window.addEventListener('mousemove', (ev) => {
        if (this.spacePan) {
          const dx = ev.clientX - this.spacePan.startX
          const dy = ev.clientY - this.spacePan.startY
          this.stageEl.scrollLeft = this.spacePan.scrollLeft - dx
          this.stageEl.scrollTop = this.spacePan.scrollTop - dy
          return
        }
        if (this.drawMarquee || this.selectMarquee) {
          const { x, y } = this.canvasCoords(ev)
          const m = this.drawMarquee || this.selectMarquee
          m.x1 = x
          m.y1 = y
          this.draw()
          return
        }
        if (this.boxDrag && this.boxDrag.mode === 'anchor') {
          const { x, y } = this.canvasCoords(ev)
          if (Math.abs(x - this.boxDrag.startX) + Math.abs(y - this.boxDrag.startY) > 1) {
            this.boxDrag.moved = true
          }
          // Shift held during drag = unlock magnet; also honor initial forceFree
          if (ev.shiftKey) this.boxDrag.forceFree = true
          const orig = this.boxDrag.orig
          const snapBottom = !this.boxDrag.forceFree
          const snapPx = Math.max(4, this.handleSlop() * 0.9)
          let ax = orig.w > 0 ? (x - orig.x) / orig.w : 0.5
          let ay = orig.h > 0 ? (y - orig.y) / orig.h : 1
          if (snapBottom && orig.h > 0) {
            const distFromBottom = orig.y + orig.h - y
            if (distFromBottom >= -snapPx && distFromBottom <= snapPx) ay = 1
          }
          ax = Math.max(0, Math.min(1, ax))
          ay = Math.max(0, Math.min(1, ay))
          if (this.hooks.onBoxUpdate) {
            this.hooks.onBoxUpdate(this.boxDrag.index, {
              x: orig.x,
              y: orig.y,
              w: orig.w,
              h: orig.h,
              id: orig.id,
              points: SA.Polygon.clone(orig.points),
              anchorX: Math.round(ax * 1000) / 1000,
              anchorY: Math.round(ay * 1000) / 1000,
            })
          }
          this.draw()
          if (this.hooks.onLiveEdit) this.hooks.onLiveEdit()
          return
        }
        if (this.boxDrag && this.boxDrag.mode === 'vertex') {
          const { x, y } = this.canvasCoords(ev)
          if (Math.abs(x - this.boxDrag.startX) + Math.abs(y - this.boxDrag.startY) > 1) {
            this.boxDrag.moved = true
          }
          const orig = this.boxDrag.orig
          const abs = SA.Polygon.toAbsolute(orig.points, orig.x, orig.y)
          const nextAbs = SA.Polygon.moveVertex(abs, this.boxDrag.vertexIndex, x, y)
          const b = SA.Polygon.boundsFromPoints(nextAbs)
          const rel = SA.Polygon.toRelative(nextAbs, b.x, b.y)
          if (this.hooks.onBoxUpdate) {
            this.hooks.onBoxUpdate(this.boxDrag.index, {
              x: b.x,
              y: b.y,
              w: b.w,
              h: b.h,
              id: orig.id,
              points: rel,
            })
          }
          this.draw()
          if (this.hooks.onLiveEdit) this.hooks.onLiveEdit()
          return
        }
        if (this.boxDrag && this.boxDrag.mode !== 'pending-click') {
          const { x, y } = this.canvasCoords(ev)
          const dx = x - this.boxDrag.startX
          const dy = y - this.boxDrag.startY
          if (Math.abs(dx) + Math.abs(dy) > 1) this.boxDrag.moved = true
          const orig = this.boxDrag.orig
          let next
          if (this.boxDrag.mode === 'move') {
            next = this.clampBox({
              x: orig.x + dx,
              y: orig.y + dy,
              w: orig.w,
              h: orig.h,
            })
            const rel = SA.Polygon.clone(orig.points)
            if (this.hooks.onBoxUpdate) {
              this.hooks.onBoxUpdate(this.boxDrag.index, {
                ...next,
                id: orig.id,
                points: rel,
              })
            }
          } else {
            next = this.resizeBox(orig, this.boxDrag.mode, x, y)
            let rel
            if (SA.Polygon.isRect(orig.points, orig.w, orig.h)) {
              rel = SA.Polygon.rectPoints(next.w, next.h)
            } else {
              rel = SA.Polygon.scaleToBounds(orig.points, orig.w, orig.h, next.w, next.h)
            }
            if (this.hooks.onBoxUpdate) {
              this.hooks.onBoxUpdate(this.boxDrag.index, {
                ...next,
                id: orig.id,
                points: rel,
              })
            }
          }
          this.selectedIndex = this.boxDrag.index
          this.draw()
          if (this.hooks.onLiveEdit) this.hooks.onLiveEdit()
          return
        }
        if (this.boxDrag && this.boxDrag.mode === 'pending-click') {
          const { x, y } = this.canvasCoords(ev)
          const dx = x - this.boxDrag.startX
          const dy = y - this.boxDrag.startY
          if (Math.abs(dx) + Math.abs(dy) > 3) {
            if (this.hooks.onHistoryMove) this.hooks.onHistoryMove()
            this.boxDrag.mode = 'move'
            this.boxDrag.moved = true
            const orig = this.boxDrag.orig
            const next = this.clampBox({
              x: orig.x + dx,
              y: orig.y + dy,
              w: orig.w,
              h: orig.h,
            })
            if (this.hooks.onBoxUpdate) {
              this.hooks.onBoxUpdate(this.boxDrag.index, {
                ...next,
                id: orig.id,
                points: SA.Polygon.clone(orig.points),
              })
            }
            this.draw()
            if (this.hooks.onLiveEdit) this.hooks.onLiveEdit()
          }
          return
        }
        if (!this.sheetImg) return
        const rect = this.canvas.getBoundingClientRect()
        if (
          ev.clientX < rect.left ||
          ev.clientY < rect.top ||
          ev.clientX > rect.right ||
          ev.clientY > rect.bottom
        ) {
          this.stageEl.classList.remove('add-point')
          return
        }
        const { x, y } = this.canvasCoords(ev)
        this.updateHoverCursor({
          x,
          y,
          clientX: ev.clientX,
          clientY: ev.clientY,
          altKey: ev.altKey,
          shiftKey: ev.shiftKey,
        })
      })

      window.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Alt' && !ev.altKey) return
        if (!this._lastPointer) return
        this.updateHoverCursor({ ...this._lastPointer, altKey: true, shiftKey: ev.shiftKey })
      })
      window.addEventListener('keyup', (ev) => {
        if (ev.key !== 'Alt' && ev.altKey) return
        if (!this._lastPointer) return
        const altStill = ev.key === 'Alt' ? false : ev.altKey
        this.updateHoverCursor({ ...this._lastPointer, altKey: altStill, shiftKey: ev.shiftKey })
      })

      window.addEventListener('mouseup', () => {
        if (this.spacePan) {
          this.spacePan = null
          this.stageEl.classList.remove('panning-drag')
          if (this.panMode) this.canvas.style.cursor = 'grab'
          return
        }
        if (this.selectMarquee) {
          const x = Math.round(Math.min(this.selectMarquee.x0, this.selectMarquee.x1))
          const y = Math.round(Math.min(this.selectMarquee.y0, this.selectMarquee.y1))
          const w = Math.round(Math.abs(this.selectMarquee.x1 - this.selectMarquee.x0))
          const h = Math.round(Math.abs(this.selectMarquee.y1 - this.selectMarquee.y0))
          this.selectMarquee = null
          if (w >= 4 && h >= 4) {
            if (this.hooks.onSelectMarquee) this.hooks.onSelectMarquee({ x, y, w, h })
          } else if (this.hooks.onClearSelection) {
            this.hooks.onClearSelection()
          } else {
            this.draw()
          }
          return
        }
        if (this.drawMarquee) {
          const x = Math.round(Math.min(this.drawMarquee.x0, this.drawMarquee.x1))
          const y = Math.round(Math.min(this.drawMarquee.y0, this.drawMarquee.y1))
          const w = Math.round(Math.abs(this.drawMarquee.x1 - this.drawMarquee.x0))
          const h = Math.round(Math.abs(this.drawMarquee.y1 - this.drawMarquee.y0))
          this.drawMarquee = null
          if (w >= 4 && h >= 4 && this.hooks.onMarquee) {
            this.hooks.onMarquee({ x, y, w, h })
          } else {
            this.draw()
          }
          return
        }
        if (!this.boxDrag) return
        const drag = this.boxDrag
        this.boxDrag = null
        if (drag.mode === 'pending-click' && !drag.moved) {
          this.selectedIndex = drag.index
          if (this.hooks.onSelect) this.hooks.onSelect(drag.index)
          if (this.hooks.onVertexSelect) this.hooks.onVertexSelect(-1)
          this.draw()
          return
        }
        if (this.hooks.onCommitBox) this.hooks.onCommitBox(drag.index)
      })
    }
  }

  SA.SheetView = SheetView
})(window.SpriteAnim)
