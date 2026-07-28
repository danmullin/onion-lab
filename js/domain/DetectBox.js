(function (SA) {
  /** @typedef {{ x: number, y: number, w: number, h: number }} Rect */

  class DetectBox {
    /**
     * @param {Rect & { id?: number, points?: number[][], anchorX?: number, anchorY?: number, ax?: number, ay?: number }} rect
     * @param {number} id
     */
    constructor(rect, id) {
      this.id = id
      this.x = rect.x | 0
      this.y = rect.y | 0
      this.w = Math.max(1, rect.w | 0)
      this.h = Math.max(1, rect.h | 0)
      /** Character center X in box: 0 = left, 0.5 = center, 1 = right */
      this.anchorX = DetectBox.clamp01(
        rect.anchorX != null ? rect.anchorX : rect.ax != null ? rect.ax : 0.5,
        0.5
      )
      /** Character center Y in box: 0 = top, 1 = bottom (default feet on bottom) */
      this.anchorY = DetectBox.clamp01(
        rect.anchorY != null ? rect.anchorY : rect.ay != null ? rect.ay : 1,
        1
      )
      if (rect.points && rect.points.length >= 3) {
        this.points = SA.Polygon.clone(rect.points)
        const b = SA.Polygon.boundsFromPoints(this.points)
        if (!rect.w && !rect.h) {
          this.x = b.x
          this.y = b.y
          this.w = b.w
          this.h = b.h
          this.points = SA.Polygon.toRelative(this.points, b.x, b.y)
        }
      } else {
        this.points = SA.Polygon.rectPoints(this.w, this.h)
      }
    }

    /** @param {number} v @param {number} [fallback=0.5] */
    static clamp01(v, fallback = 0.5) {
      const n = Number(v)
      if (!Number.isFinite(n)) return fallback
      if (n < 0) return 0
      if (n > 1) return 1
      return Math.round(n * 1000) / 1000
    }

    /** @deprecated use clamp01 */
    static clampAnchor(v) {
      return DetectBox.clamp01(v, 0.5)
    }

    /** Absolute character-anchor point on the sheet. */
    anchorPoint() {
      return {
        x: this.x + this.anchorX * this.w,
        y: this.y + this.anchorY * this.h,
      }
    }

    /**
     * Set anchor from sheet coords.
     * @param {number} sheetX
     * @param {number} sheetY
     * @param {{ snapBottom?: boolean, snapPx?: number }} [opts]
     *   snapBottom: magnetic snap to ay=1 when near bottom (default true)
     */
    setAnchorFromSheet(sheetX, sheetY, opts = {}) {
      const snapBottom = opts.snapBottom !== false
      const snapPx = opts.snapPx != null ? opts.snapPx : 6
      let ax = this.w > 0 ? (sheetX - this.x) / this.w : 0.5
      let ay = this.h > 0 ? (sheetY - this.y) / this.h : 1
      if (snapBottom && this.h > 0) {
        const distFromBottom = this.y + this.h - sheetY
        if (distFromBottom >= -snapPx && distFromBottom <= snapPx) ay = 1
      }
      this.anchorX = DetectBox.clamp01(ax, 0.5)
      this.anchorY = DetectBox.clamp01(ay, 1)
      return this
    }

    /** @returns {object} */
    toJSON() {
      const out = { id: this.id, x: this.x, y: this.y, w: this.w, h: this.h }
      if (Math.abs(this.anchorX - 0.5) > 0.001) out.anchorX = this.anchorX
      if (Math.abs(this.anchorY - 1) > 0.001) out.anchorY = this.anchorY
      if (!SA.Polygon.isRect(this.points, this.w, this.h)) {
        out.points = SA.Polygon.clone(this.points)
      }
      return out
    }

    absPoints() {
      return SA.Polygon.toAbsolute(this.points, this.x, this.y)
    }

    /** @param {number[][]} relPoints */
    setPoints(relPoints) {
      this.points = SA.Polygon.clone(relPoints)
      const b = SA.Polygon.boundsFromPoints(
        SA.Polygon.toAbsolute(this.points, this.x, this.y)
      )
      this.x = b.x
      this.y = b.y
      this.w = b.w
      this.h = b.h
      this.points = SA.Polygon.toRelative(this.points, this.x, this.y)
      return this
    }

    /** @param {Rect} rect */
    setRect(rect) {
      const oldW = this.w
      const oldH = this.h
      const oldPoints = SA.Polygon.clone(this.points)
      this.x = rect.x | 0
      this.y = rect.y | 0
      this.w = Math.max(1, rect.w | 0)
      this.h = Math.max(1, rect.h | 0)
      if (SA.Polygon.isRect(oldPoints, oldW, oldH)) {
        this.points = SA.Polygon.rectPoints(this.w, this.h)
      } else {
        this.points = SA.Polygon.scaleToBounds(oldPoints, oldW, oldH, this.w, this.h)
      }
      return this
    }

    /** @param {number} dx @param {number} dy */
    moveBy(dx, dy) {
      this.x += dx
      this.y += dy
      return this
    }

    clone() {
      return DetectBox.from(this.toJSON(), () => this.id)
    }

    /**
     * @param {Rect & { id?: number, points?: number[][], anchorX?: number, anchorY?: number, ax?: number, ay?: number }} rect
     * @param {() => number} nextId
     */
    static from(rect, nextId) {
      const id = rect.id != null ? rect.id : nextId()
      return new DetectBox(rect, id)
    }
  }

  SA.DetectBox = DetectBox
})(window.SpriteAnim)
