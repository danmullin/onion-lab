(function (SA) {
  /** @typedef {{ x: number, y: number, w: number, h: number, srcId?: number, points?: number[][], file?: string, anchorX?: number, anchorY?: number, ax?: number, ay?: number }} FrameData */

  function clamp01(v, fallback) {
    if (SA.DetectBox && SA.DetectBox.clamp01) return SA.DetectBox.clamp01(v, fallback)
    const n = Number(v)
    if (!Number.isFinite(n)) return fallback
    if (n < 0) return 0
    if (n > 1) return 1
    return Math.round(n * 1000) / 1000
  }

  class TimelineFrame {
    /** @param {FrameData} data */
    constructor(data) {
      this.x = data.x | 0
      this.y = data.y | 0
      this.w = Math.max(1, data.w | 0)
      this.h = Math.max(1, data.h | 0)
      this.anchorX = clamp01(
        data.anchorX != null ? data.anchorX : data.ax != null ? data.ax : 0.5,
        0.5
      )
      this.anchorY = clamp01(
        data.anchorY != null ? data.anchorY : data.ay != null ? data.ay : 1,
        1
      )
      if (data.srcId != null) this.srcId = data.srcId
      if (data.file) this.file = data.file
      if (data.points && data.points.length >= 3) {
        this.points = SA.Polygon.clone(data.points)
      } else {
        this.points = SA.Polygon.rectPoints(this.w, this.h)
      }
    }

    /** @returns {FrameData} */
    toJSON() {
      const out = { x: this.x, y: this.y, w: this.w, h: this.h }
      if (Math.abs(this.anchorX - 0.5) > 0.001) out.ax = this.anchorX
      if (Math.abs(this.anchorY - 1) > 0.001) out.ay = this.anchorY
      if (this.srcId != null) out.srcId = this.srcId
      if (this.file) out.file = this.file
      if (!SA.Polygon.isRect(this.points, this.w, this.h)) {
        out.points = SA.Polygon.clone(this.points)
      }
      return out
    }

    /** Export: `ax`/`ay` = character anchor in frame (0–1). */
    toExportJSON(includeFile) {
      const out = { x: this.x, y: this.y, w: this.w, h: this.h }
      if (Math.abs(this.anchorX - 0.5) > 0.001) out.ax = this.anchorX
      if (Math.abs(this.anchorY - 1) > 0.001) out.ay = this.anchorY
      if (!SA.Polygon.isRect(this.points, this.w, this.h)) {
        out.points = SA.Polygon.clone(this.points)
      }
      if (includeFile && this.file) out.file = this.file
      return out
    }

    /** @param {*} box DetectBox */
    syncFromBox(box) {
      this.x = box.x
      this.y = box.y
      this.w = box.w
      this.h = box.h
      this.anchorX = box.anchorX != null ? box.anchorX : 0.5
      this.anchorY = box.anchorY != null ? box.anchorY : 1
      this.points = SA.Polygon.clone(box.points)
      delete this.file
    }

    clone() {
      return new TimelineFrame(this.toJSON())
    }
  }

  SA.TimelineFrame = TimelineFrame
})(window.SpriteAnim)
