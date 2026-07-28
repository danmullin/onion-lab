(function (SA) {
  /**
   * Magenta / chroma background helpers for detection and display keying.
   */
  class ChromaKey {
    /**
     * @param {{ r?: number, g?: number, b?: number, tol?: number }} [settings]
     */
    constructor(settings = {}) {
      this.r = settings.r != null ? settings.r : 240
      this.g = settings.g != null ? settings.g : 4
      this.b = settings.b != null ? settings.b : 218
      this.tol = settings.tol != null ? settings.tol : 140
      /** When true, only alpha decides background (native transparent PNGs). */
      this.alphaOnly = !!settings.alphaOnly
    }

    /** @param {{ r: number, g: number, b: number, tol: number, alphaOnly?: boolean }} s */
    set(s) {
      this.r = s.r
      this.g = s.g
      this.b = s.b
      this.tol = s.tol
      if (s.alphaOnly != null) this.alphaOnly = !!s.alphaOnly
    }

    toJSON() {
      return { r: this.r, g: this.g, b: this.b, tol: this.tol, alphaOnly: !!this.alphaOnly }
    }

    /**
     * @param {number} r
     * @param {number} g
     * @param {number} b
     * @param {number} a
     */
    isBackground(r, g, b, a) {
      if (a < 20) return true
      if (this.alphaOnly) return false
      const dist = Math.abs(r - this.r) + Math.abs(g - this.g) + Math.abs(b - this.b)
      const mag = Math.min(r, b) - g
      const bright = r >= 170 && b >= 150 && g <= 110
      const dark = r >= 100 && b >= 100 && g <= 45 && Math.abs(r - b) <= 55
      const fringe = mag >= 50 && Math.min(r, b) >= 100 && g <= 145
      const hotPink = Math.min(r, b) >= 200 && g <= 160 && mag >= 40
      if (bright || dark || fringe || hotPink || dist < this.tol) return true
      if (r + g + b <= 42) return true
      return false
    }

    /**
     * True if the image has meaningful transparency (not a fully-opaque sheet).
     * @param {HTMLImageElement|HTMLCanvasElement} img
     */
    static imageHasAlpha(img) {
      const w = img.naturalWidth || img.width
      const h = img.naturalHeight || img.height
      if (!w || !h) return false
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const { data } = ctx.getImageData(0, 0, w, h)
      const step = Math.max(1, Math.floor(Math.min(w, h) / 96))
      let translucent = 0
      let total = 0
      for (let y = 0; y < h; y += step) {
        for (let x = 0; x < w; x += step) {
          const a = data[(y * w + x) * 4 + 3]
          total++
          if (a < 250) translucent++
        }
      }
      if (!total) return false
      // Require a real share of non-opaque pixels (skips JPEG / solid opaque PNG)
      return translucent / total >= 0.01 && translucent >= 8
    }

    /**
     * @param {HTMLImageElement|HTMLCanvasElement} img
     * @returns {HTMLCanvasElement}
     */
    keyToCanvas(img) {
      const w = img.naturalWidth || img.width
      const h = img.naturalHeight || img.height
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      if (this.alphaOnly) {
        // Native alpha already correct — nothing to key; keep checkerboard visibility
        return c
      }
      const image = ctx.getImageData(0, 0, w, h)
      const d = image.data
      for (let i = 0; i < d.length; i += 4) {
        if (this.isBackground(d[i], d[i + 1], d[i + 2], d[i + 3])) {
          d[i] = d[i + 1] = d[i + 2] = 0
          d[i + 3] = 0
        } else {
          const mag = Math.min(d[i], d[i + 2]) - d[i + 1]
          if (mag >= 25 && Math.min(d[i], d[i + 2]) >= 85 && d[i + 1] < 160) {
            const t = Math.min(1, (mag - 25) / 55)
            const spill = Math.min(d[i], d[i + 2]) * t * 0.55
            d[i] = Math.max(0, Math.round(d[i] - spill))
            d[i + 2] = Math.max(0, Math.round(d[i + 2] - spill))
            d[i + 3] = Math.round(d[i + 3] * (1 - t * 0.9))
            if (d[i + 3] < 8) {
              d[i] = d[i + 1] = d[i + 2] = 0
              d[i + 3] = 0
            }
          }
        }
      }
      ctx.putImageData(image, 0, 0)
      return c
    }

    /**
     * Guess chroma key from sheet borders (corners + edge strip).
     * @param {HTMLImageElement|HTMLCanvasElement} img
     * @returns {{ r: number, g: number, b: number, tol: number }|null}
     */
    static detectFromImage(img) {
      const w = img.naturalWidth || img.width
      const h = img.naturalHeight || img.height
      if (!w || !h) return null
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      ctx.drawImage(img, 0, 0)
      const { data } = ctx.getImageData(0, 0, w, h)

      const border = Math.max(2, Math.min(8, Math.floor(Math.min(w, h) * 0.04)))
      const step = Math.max(1, Math.floor(Math.min(w, h) / 128))
      /** @type {number[]} */
      const samples = []

      const push = (x, y) => {
        const i = (y * w + x) * 4
        const a = data[i + 3]
        if (a < 24) return
        samples.push(data[i], data[i + 1], data[i + 2])
      }

      for (let x = 0; x < w; x += step) {
        for (let t = 0; t < border; t++) {
          push(x, t)
          push(x, h - 1 - t)
        }
      }
      for (let y = border; y < h - border; y += step) {
        for (let t = 0; t < border; t++) {
          push(t, y)
          push(w - 1 - t, y)
        }
      }

      if (samples.length < 24) return null

      // Quantize to find dominant border color
      const q = 16
      /** @type {Map<number, { n: number, r: number, g: number, b: number }>} */
      const bins = new Map()
      for (let i = 0; i < samples.length; i += 3) {
        const r = samples[i]
        const g = samples[i + 1]
        const b = samples[i + 2]
        const key = ((r / q) | 0) * 1000000 + ((g / q) | 0) * 1000 + ((b / q) | 0)
        let bin = bins.get(key)
        if (!bin) {
          bin = { n: 0, r: 0, g: 0, b: 0 }
          bins.set(key, bin)
        }
        bin.n++
        bin.r += r
        bin.g += g
        bin.b += b
      }

      let best = null
      for (const bin of bins.values()) {
        if (!best || bin.n > best.n) best = bin
      }
      if (!best || best.n < 3) return null

      const r = Math.round(best.r / best.n)
      const g = Math.round(best.g / best.n)
      const b = Math.round(best.b / best.n)

      // Tolerance from spread of samples near the chosen key
      let distSum = 0
      let distN = 0
      let nearN = 0
      for (let i = 0; i < samples.length; i += 3) {
        const dist =
          Math.abs(samples[i] - r) + Math.abs(samples[i + 1] - g) + Math.abs(samples[i + 2] - b)
        if (dist < 90) {
          distSum += dist
          distN++
          nearN++
        }
      }
      // Need a convincing border majority — otherwise don't override defaults
      const sampleCount = samples.length / 3
      if (nearN / sampleCount < 0.35) return null

      const meanDist = distN ? distSum / distN : 40
      const tol = Math.max(80, Math.min(200, Math.round(meanDist * 3.2 + 55)))

      return { r, g, b, tol }
    }
  }

  SA.ChromaKey = ChromaKey
})(window.SpriteAnim)
