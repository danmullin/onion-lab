(function (SA) {
  /**
   * Tiny GIF89a encoder (no dither). Enough for sprite-sized frames.
   * Input frames: { width, height, data: Uint8ClampedArray RGBA, delayCs: number centiseconds }
   */
  class GifEncoder {
    /**
     * @param {{ width: number, height: number, data: Uint8ClampedArray|Uint8Array, delayCs?: number }[]} frames
     * @param {{ loop?: number, bgRgb?: [number,number,number] }} [opts]
     * @returns {Uint8Array}
     */
    static encode(frames, opts) {
      if (!frames || !frames.length) throw new Error('No frames')
      const w = frames[0].width | 0
      const h = frames[0].height | 0
      const loop = opts && opts.loop != null ? opts.loop : 0
      const bg = (opts && opts.bgRgb) || [12, 14, 16]

      const parts = []
      const pushBytes = (arr) => {
        parts.push(arr instanceof Uint8Array ? arr : new Uint8Array(arr))
      }
      // Header
      pushBytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]) // GIF89a

      // Global color table from all frames (max 256)
      const { palette, indexFrames } = GifEncoder._quantize(frames, bg)

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
      ls[5] = 0 // bg index
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
        // Graphic control
        pushBytes([0x21, 0xf9, 0x04, 0x00, delayCs & 255, (delayCs >> 8) & 255, 0x00, 0x00])
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
     * Build a shared palette (index 0 = bg for near-transparent).
     * @param {{ width:number, height:number, data:Uint8Array|Uint8ClampedArray }[]} frames
     * @param {[number,number,number]} bg
     */
    static _quantize(frames, bg) {
      const counts = new Map()
      const key = (r, g, b) => (r << 16) | (g << 8) | b
      counts.set(key(bg[0], bg[1], bg[2]), 1e9)
      for (const fr of frames) {
        const d = fr.data
        for (let i = 0; i < d.length; i += 4) {
          const a = d[i + 3]
          let r
          let g
          let b
          if (a < 16) {
            r = bg[0]
            g = bg[1]
            b = bg[2]
          } else {
            r = d[i]
            g = d[i + 1]
            b = d[i + 2]
          }
          // 5-bit crush to limit colors
          r = (r >> 3) << 3
          g = (g >> 3) << 3
          b = (b >> 3) << 3
          const k = key(r, g, b)
          counts.set(k, (counts.get(k) || 0) + 1)
        }
      }
      const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
      const palette = []
      const indexOf = new Map()
      for (let i = 0; i < Math.min(256, sorted.length); i++) {
        const k = sorted[i][0]
        const rgb = [(k >> 16) & 255, (k >> 8) & 255, k & 255]
        indexOf.set(k, palette.length)
        palette.push(rgb)
      }
      const findNearest = (r, g, b) => {
        const k = key((r >> 3) << 3, (g >> 3) << 3, (b >> 3) << 3)
        if (indexOf.has(k)) return indexOf.get(k)
        let best = 0
        let bestD = 1e18
        for (let i = 0; i < palette.length; i++) {
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
          const a = d[i + 3]
          if (a < 16) idx[p++] = 0
          else idx[p++] = findNearest(d[i], d[i + 1], d[i + 2])
        }
        return idx
      })
      return { palette, indexFrames }
    }

    /** @param {Uint8Array} indexStream @param {number} minCodeSize */
    static _lzw(indexStream, minCodeSize) {
      const clear = 1 << minCodeSize
      const eoi = clear + 1
      let codeSize = minCodeSize + 1
      let nextCode = eoi + 1
      const maxCode = () => 1 << codeSize

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

      // Byte-as-char keys so palette indices 10–255 stay single symbols
      // (String(10) has length 2 and used to corrupt the stream → black/static GIFs).
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
          if (nextCode < 4096) {
            table[wk] = nextCode++
            if (nextCode === maxCode() && codeSize < 12) codeSize++
          } else {
            writeCode(clear)
            reset()
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
