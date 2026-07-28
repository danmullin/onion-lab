(function (SA) {
  /**
   * Animation preview playback.
   * Canvas buffer tracks its laid-out CSS size via ResizeObserver (fit mode),
   * or locks to 1:1 sprite pixels (native mode — pop-out).
   * Supports per-frame durations, playback direction, onion ghosts, flip/scale.
   */
  class PreviewPlayer {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {HTMLElement} labelEl
     * @param {HTMLElement} [keyedTarget]
     * @param {{
     *   onResize?: () => void,
     *   onFrame?: (fi: number) => void,
     *   scaleMode?: 'fit'|'native',
     *   pad?: number,
     *   stage?: HTMLElement|null
     * }} [opts]
     */
    constructor(canvas, labelEl, keyedTarget, opts) {
      this.canvas = canvas
      this.ctx = canvas.getContext('2d')
      this.labelEl = labelEl
      this.stage = (opts && opts.stage) || canvas.parentElement
      this.keyedTarget = keyedTarget || this.stage || canvas
      this.onResize = opts && opts.onResize
      /** Fired when the displayed timeline frame index changes (play / scrub / step). */
      this.onFrame = opts && opts.onFrame
      this.scaleMode = (opts && opts.scaleMode) || 'fit'
      this.pad = opts && opts.pad != null ? opts.pad : 8
      this.playing = false
      /** Timeline index (source frame) */
      this.frame = 0
      /** Index into playback sequence */
      this.seqIndex = 0
      this.acc = 0
      this.lastTs = 0
      this._reportedFrame = -1
      this.frames = []
      /** @type {number[]} ms per timeline index */
      this.durationsMs = []
      /** @type {number[]} timeline indices in play order for one cycle */
      this.sequence = []
      this.fps = 6
      this.loop = true
      this.direction = 'forward'
      this.getSource = null
      this.hideChroma = false
      /** @type {CanvasImageSource|null} */
      this.background = null
      this.drawScale = 1
      /** Zoom factor — dock enlarges the scrollable canvas; native multiplies pixel size */
      this.viewScale = 1
      this.flipX = false
      this.onion = false
      this._syncing = false
      this._syncCanvasSize({ notify: false })
      if (typeof ResizeObserver !== 'undefined' && this.scaleMode === 'fit') {
        const observeEl = this.stage || canvas
        this._ro = new ResizeObserver(() => this._syncCanvasSize())
        this._ro.observe(observeEl)
      }
      requestAnimationFrame((t) => this._tick(t))
    }

    /**
     * @param {{ notify?: boolean }} [opts]
     * @returns {boolean}
     */
    _syncCanvasSize(opts) {
      if (this._syncing) return false
      const notify = !opts || opts.notify !== false
      let nextW
      let nextH
      const vs = Math.max(0.5, Math.min(8, this.viewScale || 1))
      this.viewScale = vs
      if (this.scaleMode === 'native') {
        const { maxW, maxH } = SA.Polygon.maxFrameBounds(this.frames)
        const pad = this.pad
        nextW = Math.max(1, Math.round((maxW + pad * 2) * vs))
        nextH = Math.max(1, Math.round((maxH + pad * 2) * vs))
        this.canvas.style.width = nextW + 'px'
        this.canvas.style.height = nextH + 'px'
        this.drawScale = vs
      } else {
        // Viewport = stage; canvas grows with zoom so scroll pans the magnified view
        const stage = this.stage || this.canvas.parentElement
        const rect = stage
          ? stage.getBoundingClientRect()
          : this.canvas.getBoundingClientRect()
        const baseW = Math.max(1, Math.round(rect.width) || 360)
        const baseH = Math.max(1, Math.round(rect.height) || 420)
        nextW = Math.max(1, Math.round(baseW * vs))
        nextH = Math.max(1, Math.round(baseH * vs))
        this.canvas.style.width = nextW + 'px'
        this.canvas.style.height = nextH + 'px'
        // Fit into the magnified canvas → sprite scales with zoom
        this.drawScale = this.frames.length
          ? SA.Polygon.uniformScaleToFit(this.frames, nextW, nextH, this.pad)
          : 1
      }
      if (this.canvas.width === nextW && this.canvas.height === nextH) {
        return false
      }
      this._syncing = true
      this.canvas.width = nextW
      this.canvas.height = nextH
      if (this.scaleMode === 'native') {
        this.drawScale = vs
      } else if (this.frames.length) {
        this.drawScale = SA.Polygon.uniformScaleToFit(
          this.frames,
          this.canvas.width,
          this.canvas.height,
          this.pad
        )
      }
      try {
        if (notify && typeof this.onResize === 'function') this.onResize()
      } finally {
        this._syncing = false
      }
      return true
    }

    /** @param {CanvasImageSource|null} img */
    setBackground(img) {
      this.background = img || null
      this._syncKeyedChrome()
    }

    _syncKeyedChrome() {
      const showChecker = this.hideChroma && !this.background
      this.keyedTarget.classList.toggle('keyed', showChecker)
      if (this.stage && this.stage !== this.keyedTarget) {
        this.stage.classList.toggle('keyed', showChecker)
      }
    }

    /**
     * @param {any[]} frames
     * @param {{
     *   fps: number,
     *   loop: boolean,
     *   direction?: string,
     *   durationsMs?: number[],
     *   sequence?: number[],
     *   flipX?: boolean,
     *   onion?: boolean,
     *   viewScale?: number
     * }} opts
     * @param {() => CanvasImageSource|null} getSource
     * @param {boolean} hideChroma
     */
    setAnim(frames, opts, getSource, hideChroma) {
      this.frames = frames
      this.fps = opts.fps || 6
      this.loop = !!opts.loop
      this.direction = opts.direction || 'forward'
      this.durationsMs = (opts.durationsMs || []).slice()
      while (this.durationsMs.length < frames.length) {
        this.durationsMs.push(Math.max(16, Math.round(1000 / this.fps)))
      }
      this.sequence =
        opts.sequence && opts.sequence.length
          ? opts.sequence.slice()
          : frames.map((_, i) => i)
      if (opts.flipX != null) this.flipX = !!opts.flipX
      if (opts.onion != null) this.onion = !!opts.onion
      if (opts.viewScale != null) {
        this.viewScale = Math.max(0.5, Math.min(8, +opts.viewScale || 1))
      }
      this.getSource = getSource
      this.hideChroma = hideChroma
      this._syncCanvasSize()
      // drawScale already set by _syncCanvasSize
      if (this.frame >= frames.length) this.frame = Math.max(0, frames.length - 1)
      // Keep seqIndex pointing at current timeline frame if possible
      const at = this.sequence.indexOf(this.frame)
      this.seqIndex = at >= 0 ? at : 0
      if (this.sequence.length) this.frame = this.sequence[this.seqIndex]
      this._syncKeyedChrome()
    }

    play() {
      if (!this.frames.length || !this.sequence.length) return
      this.playing = !this.playing
      if (this.playing) {
        this.acc = 0
        this.lastTs = performance.now()
      }
    }

    stop() {
      this.playing = false
      this.seqIndex = 0
      this.frame = this.sequence.length ? this.sequence[0] : 0
      this.acc = 0
      this._emitFrame()
    }

    /**
     * Jump to a timeline frame index (stops playback).
     * @param {number} timelineIndex
     */
    scrubTo(timelineIndex) {
      if (!this.frames.length) return
      this.playing = false
      this.acc = 0
      const ti = Math.max(0, Math.min(this.frames.length - 1, timelineIndex | 0))
      this.frame = ti
      const at = this.sequence.indexOf(ti)
      this.seqIndex = at >= 0 ? at : 0
      this.drawFrame(this.frame)
      this._emitFrame()
    }

    /** Step ±1 along the playback sequence (stops playback). */
    step(delta) {
      if (!this.sequence.length) return
      this.playing = false
      this.acc = 0
      let next = this.seqIndex + (delta | 0)
      if (this.loop) {
        next = ((next % this.sequence.length) + this.sequence.length) % this.sequence.length
      } else {
        next = Math.max(0, Math.min(this.sequence.length - 1, next))
      }
      this.seqIndex = next
      this.frame = this.sequence[this.seqIndex]
      this.drawFrame(this.frame)
      this._emitFrame()
    }

    /** Notify app when playhead timeline index changes. */
    _emitFrame() {
      if (typeof this.onFrame !== 'function') return
      if (this.frame === this._reportedFrame) return
      this._reportedFrame = this.frame
      this.onFrame(this.frame)
    }

    drawBackground() {
      const ctx = this.ctx
      const W = this.canvas.width
      const H = this.canvas.height
      const img = this.background
      if (!img) return false
      const iw = /** @type {any} */ (img).naturalWidth || img.width || 0
      const ih = /** @type {any} */ (img).naturalHeight || img.height || 0
      if (!iw || !ih) return false
      const scale = Math.max(W / iw, H / ih)
      const dw = iw * scale
      const dh = ih * scale
      const dx = (W - dw) / 2
      const dy = (H - dh) / 2
      ctx.imageSmoothingEnabled = true
      ctx.drawImage(img, dx, dy, dw, dh)
      ctx.imageSmoothingEnabled = false
      return true
    }

    drawBase() {
      const ctx = this.ctx
      const W = this.canvas.width
      const H = this.canvas.height
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, W, H)
      if (this.drawBackground()) return
      if (!this.hideChroma) {
        ctx.fillStyle = '#0a0c10'
        ctx.fillRect(0, 0, W, H)
      }
    }

    /**
     * @param {number} fi timeline index
     */
    _drawSpriteAt(fi) {
      const box = this.frames[fi]
      const src = this.getSource ? this.getSource() : null
      if (!src || !box) return
      const W = this.canvas.width
      const H = this.canvas.height
      const scale = this.drawScale || 1
      const { dx, dy, dw, dh } = SA.Polygon.layoutFrame(
        box,
        scale,
        W,
        H,
        'bottom-center',
        this.pad
      )
      const ctx = this.ctx
      ctx.save()
      if (this.flipX) {
        ctx.translate(W, 0)
        ctx.scale(-1, 1)
      }
      const drawDx = this.flipX ? W - dx - dw : dx
      SA.Polygon.drawFrame(ctx, src, box, drawDx, dy, dw, dh)
      ctx.restore()
    }

    /**
     * Bright silhouette + edge outline so near-identical frames still show drift.
     * @param {number} fi
     * @param {[number, number, number]} rgb
     */
    _drawOnionGhost(fi, rgb) {
      const box = this.frames[fi]
      const src = this.getSource ? this.getSource() : null
      if (!src || !box) return
      const W = this.canvas.width
      const H = this.canvas.height
      const scale = this.drawScale || 1
      const { dx, dy, dw, dh } = SA.Polygon.layoutFrame(
        box,
        scale,
        W,
        H,
        'bottom-center',
        this.pad
      )
      const tw = Math.max(1, Math.ceil(dw))
      const th = Math.max(1, Math.ceil(dh))
      const tmp = document.createElement('canvas')
      tmp.width = tw
      tmp.height = th
      const tctx = tmp.getContext('2d')
      tctx.imageSmoothingEnabled = false
      SA.Polygon.drawFrame(tctx, src, box, 0, 0, dw, dh)
      const img = tctx.getImageData(0, 0, tw, th)
      const d = img.data
      const mask = new Uint8Array(tw * th)
      for (let i = 0, p = 0; i < d.length; i += 4, p++) {
        mask[p] = d[i + 3] > 28 ? 1 : 0
      }
      // Solid body tint + bright edge outline in one buffer
      const ghost = tctx.createImageData(tw, th)
      const gd = ghost.data
      for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
          const p = y * tw + x
          if (!mask[p]) continue
          const i = p * 4
          const edgePx =
            x === 0 ||
            y === 0 ||
            x === tw - 1 ||
            y === th - 1 ||
            !mask[p - 1] ||
            !mask[p + 1] ||
            !mask[p - tw] ||
            !mask[p + tw]
          gd[i] = rgb[0]
          gd[i + 1] = rgb[1]
          gd[i + 2] = rgb[2]
          gd[i + 3] = edgePx ? 235 : 100
        }
      }
      tctx.clearRect(0, 0, tw, th)
      tctx.putImageData(ghost, 0, 0)

      const ctx = this.ctx
      ctx.save()
      if (this.flipX) {
        ctx.translate(W, 0)
        ctx.scale(-1, 1)
      }
      const drawDx = this.flipX ? W - dx - dw : dx
      ctx.globalCompositeOperation = 'source-over'
      ctx.drawImage(tmp, drawDx, dy, dw, dh)
      // Feet / anchor tick so registration drift is obvious even when silhouettes match
      const ax = (box.anchorX != null ? box.anchorX : 0.5) * dw
      const ay = (box.anchorY != null ? box.anchorY : 1) * dh
      const px = drawDx + ax
      const py = dy + ay
      ctx.strokeStyle = `rgb(${rgb[0]},${rgb[1]},${rgb[2]})`
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(px - 5, py)
      ctx.lineTo(px + 5, py)
      ctx.moveTo(px, py - 5)
      ctx.lineTo(px, py + 5)
      ctx.stroke()
      ctx.restore()
    }

    /** @param {number} fi */
    drawFrame(fi) {
      const W = this.canvas.width
      const H = this.canvas.height
      this.drawBase()
      const box = this.frames[fi]
      if (this.labelEl) {
        if (!box) {
          this.labelEl.textContent = 'frame —'
        } else {
          const n = this.frames.length
          const width = String(n).length
          const cur = String(fi + 1).padStart(width, '0')
          const tot = String(n).padStart(width, '0')
          this.labelEl.textContent = `frame ${cur}/${tot}`
        }
      }
      if (!box) return

      if (this.onion && this.frames.length > 1) {
        const prev = this._onionIndex(fi, -1)
        const next = this._onionIndex(fi, 1)
        // Prev = green, next = blue — outlines + feet ticks for alignment
        if (prev >= 0) this._drawOnionGhost(prev, [40, 255, 120])
        if (next >= 0) this._drawOnionGhost(next, [90, 170, 255])
      }
      this._drawSpriteAt(fi)
    }

    /**
     * @param {number} fi
     * @param {number} delta
     */
    _onionIndex(fi, delta) {
      const seq = this.sequence
      if (!seq.length) return -1
      let at = seq.indexOf(fi)
      if (at < 0) at = this.seqIndex
      let j = at + delta
      if (this.loop) {
        j = ((j % seq.length) + seq.length) % seq.length
        return seq[j]
      }
      if (j < 0 || j >= seq.length) return -1
      return seq[j]
    }

    _frameDurationSec(timelineIndex) {
      const ms = this.durationsMs[timelineIndex]
      if (ms != null && ms > 0) return ms / 1000
      return 1 / (this.fps || 6)
    }

    _tick(ts) {
      requestAnimationFrame((t) => this._tick(t))
      if (!this.playing) return
      const n = this.sequence.length
      if (!n) {
        this.playing = false
        return
      }
      const dt = Math.min(0.1, (ts - this.lastTs) / 1000)
      this.lastTs = ts
      const ti = this.sequence[this.seqIndex]
      const frameDur = this._frameDurationSec(ti)
      this.acc += dt
      while (this.acc >= frameDur) {
        this.acc -= frameDur
        if (this.seqIndex < n - 1) {
          this.seqIndex++
        } else if (this.loop) {
          this.seqIndex = 0
        } else {
          this.playing = false
          break
        }
      }
      this.frame = this.sequence[this.seqIndex]
      this.drawFrame(this.frame)
      this._emitFrame()
    }
  }

  SA.PreviewPlayer = PreviewPlayer
})(window.SpriteAnim)
