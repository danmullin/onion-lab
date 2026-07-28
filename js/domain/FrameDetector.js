(function (SA) {
  /**
   * Connected-component frame detection on chroma-keyed sheets.
   */
  class FrameDetector {
    /**
     * @param {*} [chroma]
     */
    constructor(chroma = new SA.ChromaKey()) {
      this.chroma = chroma
    }

    /**
     * Morphological close (dilate then erode) to reconnect thin chromakey-eaten handles.
     * @param {Uint8Array} fg
     * @param {number} w
     * @param {number} h
     * @param {number} radius
     * @returns {Uint8Array}
     */
    closeMask(fg, w, h, radius) {
      const r = Math.max(0, radius | 0)
      if (r <= 0) return fg
      let cur = fg
      for (let pass = 0; pass < r; pass++) {
        cur = this._dilateMask(cur, w, h)
      }
      for (let pass = 0; pass < r; pass++) {
        cur = this._erodeMask(cur, w, h)
      }
      return cur
    }

    /** @param {Uint8Array} src @param {number} w @param {number} h */
    _dilateMask(src, w, h) {
      const out = new Uint8Array(w * h)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let on = 0
          for (let dy = -1; dy <= 1 && !on; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx
              const ny = y + dy
              if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
              if (src[ny * w + nx]) {
                on = 1
                break
              }
            }
          }
          out[y * w + x] = on
        }
      }
      return out
    }

    /** @param {Uint8Array} src @param {number} w @param {number} h */
    _erodeMask(src, w, h) {
      const out = new Uint8Array(w * h)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let on = 1
          for (let dy = -1; dy <= 1 && on; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx
              const ny = y + dy
              if (nx < 0 || ny < 0 || nx >= w || ny >= h || !src[ny * w + nx]) {
                on = 0
                break
              }
            }
          }
          out[y * w + x] = on
        }
      }
      return out
    }

    /** AABB union of two boxes. */
    unionBox(a, b) {
      const x0 = Math.min(a.x, b.x)
      const y0 = Math.min(a.y, b.y)
      const x1 = Math.max(a.x + a.w, b.x + b.w)
      const y1 = Math.max(a.y + a.h, b.y + b.h)
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
    }

    boxArea(b) {
      return Math.max(0, b.w) * Math.max(0, b.h)
    }

    /**
     * Derived attach distance for fragment absorb / snap grow.
     * Merge 0 → no attach floor (critical for transparent sheets with gutters).
     * @param {number} mergeGap
     */
    attachGapFromMerge(mergeGap) {
      const g = Math.max(0, mergeGap | 0)
      if (g <= 0) return 0
      return Math.max(g * 2, g + 8)
    }

    /**
     * @param {HTMLImageElement|HTMLCanvasElement} img
     * @param {{
     *   mergeGap?: number,
     *   minW?: number,
     *   minH?: number,
     *   pad?: number,
     *   minPixels?: number,
     *   bridge?: number,
     *   absorb?: boolean,
     *   fragmentMax?: number,
     *   attachGap?: number
     * }} [opts]
     * @returns {{ x: number, y: number, w: number, h: number }[]}
     */
    detect(img, opts = {}) {
      const w = img.naturalWidth || img.width
      const h = img.naturalHeight || img.height
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const { data } = ctx.getImageData(0, 0, w, h)
      const alphaOnly = !!(this.chroma && this.chroma.alphaOnly)
      const minW = opts.minW != null ? opts.minW : 16
      const minH = opts.minH != null ? opts.minH : 16
      // Transparent sheets: trust open alpha lanes — don't seal gutters by default
      const mergeGap = opts.mergeGap != null ? opts.mergeGap : alphaOnly ? 0 : 8
      const pad = opts.pad != null ? opts.pad : 0
      const minPixels = opts.minPixels != null ? opts.minPixels : 24
      const bridge = opts.bridge != null ? opts.bridge : alphaOnly ? 0 : 2
      const attachGap =
        opts.attachGap != null ? opts.attachGap : this.attachGapFromMerge(mergeGap)
      // Absorb is for chroma weapon fragments; off for alpha unless attachGap > 0 and opted in
      const doAbsorb =
        opts.absorb != null ? !!opts.absorb : !alphaOnly && attachGap > 0
      const fragmentMax = opts.fragmentMax != null ? opts.fragmentMax : 48

      let fg = new Uint8Array(w * h)
      for (let i = 0, p = 0; i < data.length; i += 4, p++) {
        fg[p] = this.chroma.isBackground(data[i], data[i + 1], data[i + 2], data[i + 3]) ? 0 : 1
      }
      if (bridge > 0) {
        fg = this.closeMask(fg, w, h, bridge)
      }

      const seen = new Uint8Array(w * h)
      /** @type {{ x: number, y: number, w: number, h: number }[]} */
      const boxes = []
      const qx = new Int32Array(w * h)
      const qy = new Int32Array(w * h)

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const start = y * w + x
          if (!fg[start] || seen[start]) continue
          let qh = 0
          let qt = 0
          qx[qt] = x
          qy[qt] = y
          qt++
          seen[start] = 1
          let minX = x
          let maxX = x
          let minY = y
          let maxY = y
          let count = 0
          while (qh < qt) {
            const cx = qx[qh]
            const cy = qy[qh]
            qh++
            count++
            if (cx < minX) minX = cx
            if (cx > maxX) maxX = cx
            if (cy < minY) minY = cy
            if (cy > maxY) maxY = cy
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (!dx && !dy) continue
                const nx = cx + dx
                const ny = cy + dy
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
                const ni = ny * w + nx
                if (!fg[ni] || seen[ni]) continue
                seen[ni] = 1
                qx[qt] = nx
                qy[qt] = ny
                qt++
              }
            }
          }
          const bw = maxX - minX + 1
          const bh = maxY - minY + 1
          if (count < minPixels || bw < minW || bh < minH) continue
          boxes.push({ x: minX, y: minY, w: bw, h: bh })
        }
      }

      let merged = this.mergeNearby(boxes, mergeGap)
      if (doAbsorb) {
        merged = this.absorbFragments(merged, attachGap, fragmentMax)
      }
      merged = merged.filter((b) => b.w >= minW && b.h >= minH)
      if (pad) {
        merged = merged.map((b) => ({
          x: Math.max(0, b.x - pad),
          y: Math.max(0, b.y - pad),
          w: Math.min(w - Math.max(0, b.x - pad), b.w + pad * 2),
          h: Math.min(h - Math.max(0, b.y - pad), b.h + pad * 2),
        }))
      }
      merged.sort((a, b) => {
        const row = a.y - b.y
        if (Math.abs(row) > Math.min(a.h, b.h) * 0.45) return row
        return a.x - b.x
      })
      return merged
    }

    /**
     * @param {{ x: number, y: number, w: number, h: number }[]} boxes
     * @param {number} gap
     */
    mergeNearby(boxes, gap) {
      if (!boxes.length || gap <= 0) return boxes.slice()
      const out = boxes.map((b) => ({ ...b }))
      let changed = true
      while (changed) {
        changed = false
        for (let i = 0; i < out.length; i++) {
          for (let j = i + 1; j < out.length; j++) {
            const a = out[i]
            const b = out[j]
            if (!this.near(a, b, gap)) continue
            out[i] = this.unionBox(a, b)
            out.splice(j, 1)
            changed = true
            break
          }
          if (changed) break
        }
      }
      return out
    }

    /**
     * Absorb small weapon/detail fragments into nearby larger islands.
     * @param {{ x: number, y: number, w: number, h: number }[]} boxes
     * @param {number} attachGap
     * @param {number} [fragmentMax]
     */
    absorbFragments(boxes, attachGap, fragmentMax = 48) {
      if (!boxes.length || attachGap <= 0) return boxes.slice()
      const out = boxes.map((b) => ({ ...b }))
      let changed = true
      while (changed) {
        changed = false
        for (let i = 0; i < out.length; i++) {
          for (let j = 0; j < out.length; j++) {
            if (i === j) continue
            const frag = out[i]
            const host = out[j]
            const aFrag = this.boxArea(frag)
            const aHost = this.boxArea(host)
            if (aHost <= aFrag) continue
            const maxSide = Math.max(frag.w, frag.h)
            const isFrag = maxSide <= fragmentMax || aFrag < aHost * 0.35
            if (!isFrag) continue
            if (!this.near(frag, host, attachGap)) continue
            // Prefer closest host if multiple; for simplicity take first match then re-loop
            out[j] = this.unionBox(frag, host)
            out.splice(i, 1)
            changed = true
            break
          }
          if (changed) break
        }
      }
      return out
    }

    /**
     * Grow a seed island by unioning every near island iteratively
     * (small seeds pull in larger bodies; fragments also attach).
     * @param {{ x: number, y: number, w: number, h: number }} seed
     * @param {{ x: number, y: number, w: number, h: number }[]} islands
     * @param {number} attachGap
     * @param {{ x: number, y: number, w: number, h: number }|null} [sel] also pull islands overlapping selection
     */
    growIsland(seed, islands, attachGap, sel) {
      if (!seed) return null
      let grown = { ...seed }
      const used = new Set()
      // Mark seed match
      for (let i = 0; i < islands.length; i++) {
        const isl = islands[i]
        if (
          isl.x === seed.x &&
          isl.y === seed.y &&
          isl.w === seed.w &&
          isl.h === seed.h
        ) {
          used.add(i)
          break
        }
      }
      let changed = true
      while (changed) {
        changed = false
        for (let i = 0; i < islands.length; i++) {
          if (used.has(i)) continue
          const isl = islands[i]
          const nearGrown = this.near(grown, isl, attachGap)
          const ovSel = sel ? this.overlapArea(sel, isl) : 0
          const ovGrown = this.overlapArea(grown, isl)
          if (!nearGrown && ovSel <= 0 && ovGrown <= 0) continue
          grown = this.unionBox(grown, isl)
          used.add(i)
          changed = true
        }
      }
      return grown
    }

    /**
     * @param {{ x: number, y: number, w: number, h: number }} a
     * @param {{ x: number, y: number, w: number, h: number }} b
     * @param {number} gap
     */
    near(a, b, gap) {
      const ax1 = a.x + a.w
      const ay1 = a.y + a.h
      const bx1 = b.x + b.w
      const by1 = b.y + b.h
      const sepX = Math.max(0, Math.max(a.x, b.x) - Math.min(ax1, bx1))
      const sepY = Math.max(0, Math.max(a.y, b.y) - Math.min(ay1, by1))
      const gapX = a.x > bx1 ? a.x - bx1 : b.x > ax1 ? b.x - ax1 : 0
      const gapY = a.y > by1 ? a.y - by1 : b.y > ay1 ? b.y - ay1 : 0
      if (gapX === 0 && gapY === 0) return true
      if (gapX === 0 && gapY <= gap) return true
      if (gapY === 0 && gapX <= gap) return true
      return sepX <= gap && sepY <= gap && gapX + gapY <= gap * 2
    }

    /**
     * @param {{ x: number, y: number, w: number, h: number }} sel
     * @param {{ x: number, y: number, w: number, h: number }[]} islands
     */
    nearestIsland(sel, islands) {
      if (!islands.length) return null
      const sc = { x: sel.x + sel.w * 0.5, y: sel.y + sel.h * 0.5 }
      let best = null
      let bestScore = Infinity
      for (const isl of islands) {
        const ic = { x: isl.x + isl.w * 0.5, y: isl.y + isl.h * 0.5 }
        const dist = Math.hypot(ic.x - sc.x, ic.y - sc.y)
        const ov = this.overlapArea(sel, isl)
        const score = (ov > 0 ? 0 : 100000) + dist - ov * 0.02
        if (score < bestScore) {
          bestScore = score
          best = isl
        }
      }
      return best
    }

    overlapArea(a, b) {
      const x0 = Math.max(a.x, b.x)
      const y0 = Math.max(a.y, b.y)
      const x1 = Math.min(a.x + a.w, b.x + b.w)
      const y1 = Math.min(a.y + a.h, b.y + b.h)
      return Math.max(0, x1 - x0) * Math.max(0, y1 - y0)
    }
  }

  SA.FrameDetector = FrameDetector
})(window.SpriteAnim)
