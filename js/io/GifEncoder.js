(function (SA) {
  /**
   * Tiny GIF89a encoder (no dither). Enough for sprite-sized frames.
   * Input frames: { width, height, data: Uint8ClampedArray RGBA, delayCs: number centiseconds }
   * Transparent GIFs: alpha < threshold → palette index 0 (GCE transparent color).
   */
  class GifEncoder {
    /**
     * @param {{ width: number, height: number, data: Uint8ClampedArray|Uint8Array, delayCs?: number }[]} frames
     * @param {{ loop?: number, transparent?: boolean, alphaThreshold?: number }} [opts]
     * @returns {Uint8Array}
     */
    static encode(frames, opts) {
      if (!frames || !frames.length) throw new Error('No frames')
      const w = frames[0].width | 0
      const h = frames[0].height | 0
      const loop = opts && opts.loop != null ? opts.loop : 0
      const transparent = !opts || opts.transparent !== false
      const alphaThreshold =
        opts && opts.alphaThreshold != null ? opts.alphaThreshold | 0 : 16

      const parts = []
      const pushBytes = (arr) => {
        parts.push(arr instanceof Uint8Array ? arr : new Uint8Array(arr))
      }
      // Header
      pushBytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) // GIF89a

      const { palette, indexFrames } = GifEncoder._quantize(
        frames,
        transparent,
        alphaThreshold
      )

      const gctSize = palette.length
      const gctPow = Math.max(0, Math.ceil(Math.log2(Math.max(2, gctSize))) - 1)
      const gctCount = 1 << (gctPow + 1)

      // Logical screen
      const ls = new Uint8Array(7)
      ls[0] = w & 255
      ls[1] = (w >> 8) & 255
      ls[2] = h & 255
      ls[3] = (h >> 8) & 255
      ls[4] = 0x80 | (gctPow & 7) // GCT flag + size
      ls[5] = 0 // bg index (transparent slot when enabled)
      ls[6] = 0 // pixel aspect
      pushBytes(ls)

      const gct = new Uint8Array(gctCount * 3)
      for (let i = 0; i < palette.length; i++) {
        gct[i * 3] = palette[i][0]
        gct[i * 3 + 1] = palette[i][1]
        gct[i * 3 + 2] = palette[i][2]
      }
      pushBytes(gct)

      // Netscape loop extension
      pushBytes([0x21, 0xff, 0x0b])
      pushBytes([0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30]) // NETSCAPE2.0
      pushBytes([0x03, 0x01, loop & 255, (loop >> 8) & 255, 0x00])

      for (let fi = 0; fi < indexFrames.length; fi++) {
        const delayCs = Math.max(2, frames[fi].delayCs != null ? frames[fi].delayCs | 0 : 10)
        // Graphic control: disposal 2 (restore bg) + optional transparent color index 0
        const packed = transparent ? 0x09 : 0x08
        pushBytes([
          0x21,
          0xf9,
          0x04,
          packed,
          delayCs & 255,
          (delayCs >> 8) & 255,
          transparent ? 0x00 : 0x00,
          0x00,
        ])
        // Image descriptor
        const id = new Uint8Array(10)
        id[0] = 0x2c
        id[1] = 0
        id[2] = 0
        id[3] = 0
        id[4] = 0
        id[5] = w & 255
        id[6] = (w >> 8) & 255
        id[7] = h & 255
        id[8] = (h >> 8) & 255
        id[9] = 0
        pushBytes(id)
        const minCode = Math.max(2, gctPow + 1)
        pushBytes([minCode])
        const lzw = GifEncoder._lzw(indexFrames[fi], minCode)
        // Sub-blocks
        let off = 0
        while (off < lzw.length) {
          const n = Math.min(255, lzw.length - off)
          pushBytes([n])
          pushBytes(lzw.subarray(off, off + n))
          off += n
        }
        pushBytes([0])
      }
      pushBytes([0x3b]) // trailer

      let total = 0
      for (const p of parts) total += p.length
      const out = new Uint8Array(total)
      let o = 0
      for (const p of parts) {
        out.set(p, o)
        o += p.length
      }
      return out
    }

    /**
     * Shared palette. When transparent, index 0 is reserved (never matched for opaque pixels).
     * Prefers exact RGB (sprites usually fit in 255). Falls back to median-cut if needed.
     * @param {{ width:number, height:number, data:Uint8Array|Uint8ClampedArray }[]} frames
     * @param {boolean} transparent
     * @param {number} alphaThreshold
     */
    static _quantize(frames, transparent, alphaThreshold) {
      const key = (r, g, b) => (r << 16) | (g << 8) | b
      /** @type {Map<number, number>} */
      const counts = new Map()
      for (const fr of frames) {
        const d = fr.data
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < alphaThreshold) continue
          const k = key(d[i], d[i + 1], d[i + 2])
          counts.set(k, (counts.get(k) || 0) + 1)
        }
      }

      const maxOpaque = transparent ? 255 : 256
      /** @type {number[][]} */
      let opaqueColors
      if (counts.size <= maxOpaque) {
        opaqueColors = [...counts.keys()].map((k) => [
          (k >> 16) & 255,
          (k >> 8) & 255,
          k & 255,
        ])
      } else {
        opaqueColors = GifEncoder._medianCut(counts, maxOpaque)
      }

      /** @type {number[][]} */
      const palette = []
      const indexOf = new Map()
      if (transparent) palette.push([0, 0, 0])
      for (const rgb of opaqueColors) {
        indexOf.set(key(rgb[0], rgb[1], rgb[2]), palette.length)
        palette.push(rgb)
      }
      if (palette.length < 2) palette.push([0, 0, 0])

      const colorStart = transparent ? 1 : 0
      const findNearest = (r, g, b) => {
        const k = key(r, g, b)
        if (indexOf.has(k)) return indexOf.get(k)
        let best = colorStart
        let bestD = 1e18
        for (let i = colorStart; i < palette.length; i++) {
          const p = palette[i]
          const dr = p[0] - r
          const dg = p[1] - g
          const db = p[2] - b
          const dd = dr * dr + dg * dg + db * db
          if (dd < bestD) {
            bestD = dd
            best = i
          }
        }
        return best
      }

      const indexFrames = frames.map((fr) => {
        const d = fr.data
        const idx = new Uint8Array(fr.width * fr.height)
        let p = 0
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] < alphaThreshold) idx[p++] = 0
          else idx[p++] = findNearest(d[i], d[i + 1], d[i + 2])
        }
        return idx
      })
      return { palette, indexFrames }
    }

    /**
     * Median-cut palette reduction for >255 unique opaque colors.
     * @param {Map<number, number>} counts key→pixel count
     * @param {number} maxColors
     * @returns {number[][]}
     */
    static _medianCut(counts, maxColors) {
      /** @type {{ r:number, g:number, b:number, n:number }[]} */
      const points = []
      for (const [k, n] of counts) {
        points.push({
          r: (k >> 16) & 255,
          g: (k >> 8) & 255,
          b: k & 255,
          n,
        })
      }

      /** @type {{ r:number, g:number, b:number, n:number }[][]} */
      let boxes = [points]
      while (boxes.length < maxColors) {
        let bi = -1
        let bestRange = -1
        for (let i = 0; i < boxes.length; i++) {
          const box = boxes[i]
          if (box.length < 2) continue
          let minR = 255
          let maxR = 0
          let minG = 255
          let maxG = 0
          let minB = 255
          let maxB = 0
          for (const p of box) {
            if (p.r < minR) minR = p.r
            if (p.r > maxR) maxR = p.r
            if (p.g < minG) minG = p.g
            if (p.g > maxG) maxG = p.g
            if (p.b < minB) minB = p.b
            if (p.b > maxB) maxB = p.b
          }
          const range = Math.max(maxR - minR, maxG - minG, maxB - minB)
          if (range > bestRange) {
            bestRange = range
            bi = i
          }
        }
        if (bi < 0 || bestRange <= 0) break
        const box = boxes[bi]
        let minR = 255
        let maxR = 0
        let minG = 255
        let maxG = 0
        let minB = 255
        let maxB = 0
        for (const p of box) {
          if (p.r < minR) minR = p.r
          if (p.r > maxR) maxR = p.r
          if (p.g < minG) minG = p.g
          if (p.g > maxG) maxG = p.g
          if (p.b < minB) minB = p.b
          if (p.b > maxB) maxB = p.b
        }
        const rangeR = maxR - minR
        const rangeG = maxG - minG
        const rangeB = maxB - minB
        const channel =
          rangeR >= rangeG && rangeR >= rangeB ? 'r' : rangeG >= rangeB ? 'g' : 'b'
        box.sort((a, b) => a[channel] - b[channel])
        let total = 0
        for (const p of box) total += p.n
        let acc = 0
        let split = Math.floor(box.length / 2)
        for (let i = 0; i < box.length; i++) {
          acc += box[i].n
          if (acc >= total / 2) {
            split = Math.max(1, Math.min(box.length - 1, i + 1))
            break
          }
        }
        const left = box.slice(0, split)
        const right = box.slice(split)
        boxes.splice(bi, 1, left, right)
      }

      return boxes.map((box) => {
        let r = 0
        let g = 0
        let b = 0
        let n = 0
        for (const p of box) {
          r += p.r * p.n
          g += p.g * p.n
          b += p.b * p.n
          n += p.n
        }
        if (!n) return [0, 0, 0]
        return [Math.round(r / n), Math.round(g / n), Math.round(b / n)]
      })
    }

    /** @param {Uint8Array} indexStream @param {number} minCodeSize */
    static _lzw(indexStream, minCodeSize) {
      const clear = 1 << minCodeSize
      const eoi = clear + 1
      let codeSize = minCodeSize + 1
      let nextCode = eoi + 1

      const bitBuf = []
      let cur = 0
      let curBits = 0
      const writeCode = (code) => {
        cur |= (code & 0xffff) << curBits
        curBits += codeSize
        while (curBits >= 8) {
          bitBuf.push(cur & 255)
          cur >>= 8
          curBits -= 8
        }
      }

      // Byte-as-char keys so palette indices 10–255 stay single symbols.
      const ch = (i) => String.fromCharCode(i & 255)

      let table = Object.create(null)
      const reset = () => {
        table = Object.create(null)
        codeSize = minCodeSize + 1
        nextCode = eoi + 1
      }

      writeCode(clear)
      reset()
      if (!indexStream.length) {
        writeCode(eoi)
        if (curBits > 0) bitBuf.push(cur & 255)
        return new Uint8Array(bitBuf)
      }

      let w = ch(indexStream[0])
      for (let i = 1; i < indexStream.length; i++) {
        const k = ch(indexStream[i])
        const wk = w + k
        if (table[wk] != null) {
          w = wk
        } else {
          const code = w.length === 1 ? w.charCodeAt(0) : table[w]
          writeCode(code)
          // Bump code size AFTER writing with the old width.
          if (nextCode >= 4096) {
            writeCode(clear)
            reset()
          } else {
            if (nextCode > (1 << codeSize) - 1 && codeSize < 12) codeSize++
            table[wk] = nextCode++
          }
          w = k
        }
      }
      writeCode(w.length === 1 ? w.charCodeAt(0) : table[w])
      writeCode(eoi)
      if (curBits > 0) bitBuf.push(cur & 255)
      return new Uint8Array(bitBuf)
    }
  }

  SA.GifEncoder = GifEncoder
})(window.SpriteAnim)
