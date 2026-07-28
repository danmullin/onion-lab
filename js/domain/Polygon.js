(function (SA) {
  /** @typedef {[number, number]} Point */

  const Polygon = {
    /** @returns {Point[]} */
    rectPoints(w, h) {
      return [
        [0, 0],
        [w, 0],
        [w, h],
        [0, h],
      ]
    },

    /** @param {Point[]} points @param {number} ox @param {number} oy */
    toAbsolute(points, ox, oy) {
      return points.map((p) => [p[0] + ox, p[1] + oy])
    },

    /** @param {Point[]} abs @param {number} ox @param {number} oy */
    toRelative(abs, ox, oy) {
      return abs.map((p) => [p[0] - ox, p[1] - oy])
    },

    clone(points) {
      return points.map((p) => [p[0], p[1]])
    },

    /** @param {Point[]} points */
    boundsFromPoints(points) {
      if (!points || !points.length) return { x: 0, y: 0, w: 1, h: 1 }
      let minX = points[0][0]
      let minY = points[0][1]
      let maxX = points[0][0]
      let maxY = points[0][1]
      for (let i = 1; i < points.length; i++) {
        const p = points[i]
        if (p[0] < minX) minX = p[0]
        if (p[1] < minY) minY = p[1]
        if (p[0] > maxX) maxX = p[0]
        if (p[1] > maxY) maxY = p[1]
      }
      return {
        x: Math.round(minX),
        y: Math.round(minY),
        w: Math.max(1, Math.round(maxX - minX)),
        h: Math.max(1, Math.round(maxY - minY)),
      }
    },

    /** @param {Point[]} points @param {number} w @param {number} h */
    isRect(points, w, h) {
      if (!points || points.length !== 4) return false
      const r = Polygon.rectPoints(w, h)
      for (let i = 0; i < 4; i++) {
        const p = points[i]
        const q = r[i]
        if (Math.abs(p[0] - q[0]) > 0.5 || Math.abs(p[1] - q[1]) > 0.5) return false
      }
      return true
    },

    /** @param {Point[]} points @param {number} dx @param {number} dy */
    translate(points, dx, dy) {
      return points.map((p) => [p[0] + dx, p[1] + dy])
    },

    /**
     * @param {Point[]} points
     * @param {number} oldW
     * @param {number} oldH
     * @param {number} newW
     * @param {number} newH
     */
    scaleToBounds(points, oldW, oldH, newW, newH) {
      if (oldW < 1 || oldH < 1) return Polygon.rectPoints(newW, newH)
      const sx = newW / oldW
      const sy = newH / oldH
      return points.map((p) => [Math.round(p[0] * sx), Math.round(p[1] * sy)])
    },

    /**
     * @param {Point[]} points
     * @param {number} vi
     * @param {number} x
     * @param {number} y
     */
    moveVertex(points, vi, x, y) {
      const out = Polygon.clone(points)
      out[vi] = [Math.round(x), Math.round(y)]
      return out
    },

    /**
     * @param {Point[]} points
     * @param {number} vi
     */
    deleteVertex(points, vi) {
      if (points.length <= 3) return Polygon.clone(points)
      const out = Polygon.clone(points)
      out.splice(vi, 1)
      return out
    },

    /**
     * @param {Point[]} points abs or rel sheet coords
     * @param {number} x
     * @param {number} y
     * @param {number} maxDist
     */
    insertOnEdge(points, x, y, maxDist) {
      if (points.length < 2) return { points: Polygon.clone(points), index: -1 }
      let bestI = -1
      let bestD = maxDist
      let bestPt = null
      const n = points.length
      for (let i = 0; i < n; i++) {
        const a = points[i]
        const b = points[(i + 1) % n]
        const hit = Polygon.nearestOnSegment(a, b, x, y)
        if (hit.d < bestD) {
          bestD = hit.d
          bestI = i
          bestPt = hit.pt
        }
      }
      if (bestI < 0 || !bestPt) return { points: Polygon.clone(points), index: -1 }
      const out = Polygon.clone(points)
      out.splice(bestI + 1, 0, [Math.round(bestPt[0]), Math.round(bestPt[1])])
      return { points: out, index: bestI + 1 }
    },

    /** @param {Point} a @param {Point} b @param {number} x @param {number} y */
    nearestOnSegment(a, b, x, y) {
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const len2 = dx * dx + dy * dy
      let t = 0
      if (len2 > 0) {
        t = ((x - a[0]) * dx + (y - a[1]) * dy) / len2
        if (t < 0) t = 0
        else if (t > 1) t = 1
      }
      const px = a[0] + t * dx
      const py = a[1] + t * dy
      const d = Math.hypot(x - px, y - py)
      return { pt: [px, py], d }
    },

    /**
     * @param {Point[]} absPoints sheet-space
     * @param {number} x
     * @param {number} y
     * @param {number} slop
     */
    hitTestVertex(absPoints, x, y, slop) {
      for (let i = 0; i < absPoints.length; i++) {
        const p = absPoints[i]
        if (Math.abs(x - p[0]) <= slop && Math.abs(y - p[1]) <= slop) return i
      }
      return -1
    },

    /**
     * @param {CanvasRenderingContext2D} ctx
     * @param {Point[]} relPoints relative to frame origin
     * @param {number} ox dest x
     * @param {number} oy dest y
     * @param {number} scale
     */
    buildPath(ctx, relPoints, ox, oy, scale) {
      if (!relPoints || relPoints.length < 3) return false
      ctx.beginPath()
      const p0 = relPoints[0]
      ctx.moveTo(ox + p0[0] * scale, oy + p0[1] * scale)
      for (let i = 1; i < relPoints.length; i++) {
        const p = relPoints[i]
        ctx.lineTo(ox + p[0] * scale, oy + p[1] * scale)
      }
      ctx.closePath()
      return true
    },

    /**
     * Draw a frame from sheet or baked image with optional polygon clip.
     * @param {CanvasRenderingContext2D} ctx
     * @param {CanvasImageSource|null} src
     * @param {{ x:number,y:number,w:number,h:number, points?:Point[], file?:string }} frame
     * @param {number} dx
     * @param {number} dy
     * @param {number} dw
     * @param {number} dh
     * @param {{ baked?: CanvasImageSource|null, useClip?: boolean }} [opts]
     */
    drawFrame(ctx, src, frame, dx, dy, dw, dh, opts = {}) {
      const baked = opts.baked || null
      if (baked) {
        ctx.drawImage(baked, dx, dy, dw, dh)
        return
      }
      if (!src || !frame) return
      const points = frame.points
      const useClip = opts.useClip !== false && points && points.length >= 3 && !Polygon.isRect(points, frame.w, frame.h)
      const sx = dw / Math.max(1, frame.w)
      const sy = dh / Math.max(1, frame.h)
      if (useClip) {
        ctx.save()
        Polygon.buildPath(ctx, points, dx, dy, sx, sy)
        ctx.clip()
        ctx.drawImage(src, frame.x, frame.y, frame.w, frame.h, dx, dy, dw, dh)
        ctx.restore()
      } else {
        ctx.drawImage(src, frame.x, frame.y, frame.w, frame.h, dx, dy, dw, dh)
      }
    },

    /** Largest w/h among timeline frames (for uniform anim scale). */
    maxFrameBounds(frames) {
      let maxW = 1
      let maxH = 1
      for (const f of frames || []) {
        if (f.w > maxW) maxW = f.w
        if (f.h > maxH) maxH = f.h
      }
      return { maxW, maxH }
    },

    /**
     * One scale for every frame in an anim — fits the largest bbox in the view.
     * Smaller frames draw smaller; nothing stretches per frame to fill the slot.
     */
    uniformScaleToFit(frames, viewW, viewH, pad = 0) {
      const { maxW, maxH } = Polygon.maxFrameBounds(frames)
      const innerW = Math.max(1, viewW - pad * 2)
      const innerH = Math.max(1, viewH - pad * 2)
      return Math.min(innerW / maxW, innerH / maxH)
    },

    /**
     * Place a frame at uniform scale.
     * Align box.anchorX/ax and box.anchorY/ay (0–1 in frame) to the view's bottom-center feet point.
     * @param {'bottom-center'|'center'} [anchor]
     */
    layoutFrame(box, scale, viewW, viewH, anchor = 'bottom-center', pad = 0) {
      const innerW = viewW - pad * 2
      const innerH = viewH - pad * 2
      const dw = box.w * scale
      const dh = box.h * scale
      const ax =
        box.anchorX != null ? box.anchorX : box.ax != null ? box.ax : 0.5
      const ay = box.anchorY != null ? box.anchorY : box.ay != null ? box.ay : 1
      let dx
      let dy
      if (anchor === 'center') {
        dx = pad + (innerW - dw) / 2
        dy = pad + (innerH - dh) / 2
      } else {
        // Slot feet point = bottom-center of view; map frame anchor there
        dx = pad + innerW / 2 - ax * dw
        dy = pad + innerH - ay * dh
      }
      return { dx, dy, dw, dh, scale, ax, ay }
    },
  }

  SA.Polygon = Polygon
})(window.SpriteAnim)
