(function (SA) {
  /** Minimal store-only ZIP writer (no compression). */
  class ZipWriter {
    constructor() {
      this.files = []
    }

    /** @param {string} name @param {Uint8Array} data */
    add(name, data) {
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
      this.files.push({ name, data: bytes })
    }

    /** @param {string} name @param {Blob} blob */
    async addBlob(name, blob) {
      const buf = await blob.arrayBuffer()
      this.files.push({ name, data: new Uint8Array(buf) })
    }

    build() {
      const parts = []
      const central = []
      let offset = 0
      const enc = new TextEncoder()
      for (const f of this.files) {
        const nameBytes = enc.encode(f.name)
        const crc = ZipWriter.crc32(f.data)
        const local = new DataView(new ArrayBuffer(30 + nameBytes.length))
        local.setUint32(0, 0x04034b50, true)
        local.setUint16(4, 20, true)
        local.setUint16(8, 0, true)
        local.setUint16(10, 0, true)
        local.setUint32(14, crc, true)
        local.setUint32(18, f.data.length, true)
        local.setUint32(22, f.data.length, true)
        local.setUint16(26, nameBytes.length, true)
        local.setUint16(28, 0, true)
        parts.push(new Uint8Array(local.buffer), nameBytes, f.data)
        const localLen = 30 + nameBytes.length + f.data.length
        const cen = new DataView(new ArrayBuffer(46 + nameBytes.length))
        cen.setUint32(0, 0x02014b50, true)
        cen.setUint16(4, 20, true)
        cen.setUint16(6, 20, true)
        cen.setUint16(10, 0, true)
        cen.setUint16(12, 0, true)
        cen.setUint32(16, crc, true)
        cen.setUint32(20, f.data.length, true)
        cen.setUint32(24, f.data.length, true)
        cen.setUint16(28, nameBytes.length, true)
        cen.setUint16(30, 0, true)
        cen.setUint16(32, 0, true)
        cen.setUint16(34, 0, true)
        cen.setUint32(36, 0, true)
        cen.setUint32(40, offset, true)
        central.push(new Uint8Array(cen.buffer), nameBytes)
        offset += localLen
      }
      const centralSize = central.reduce((n, u) => n + u.length, 0)
      const end = new DataView(new ArrayBuffer(22))
      end.setUint32(0, 0x06054b50, true)
      end.setUint16(4, 0, true)
      end.setUint16(6, 0, true)
      end.setUint16(8, this.files.length, true)
      end.setUint16(10, this.files.length, true)
      end.setUint32(12, centralSize, true)
      end.setUint32(16, offset, true)
      end.setUint16(20, 0, true)
      return new Blob([...parts, ...central, new Uint8Array(end.buffer)], {
        type: 'application/zip',
      })
    }

    /** @param {Uint8Array} data */
    static crc32(data) {
      let c = ~0
      for (let i = 0; i < data.length; i++) {
        c = (c >>> 8) ^ ZipWriter.CRC_TABLE[(c ^ data[i]) & 0xff]
      }
      return ~c >>> 0
    }
  }

  ZipWriter.CRC_TABLE = (() => {
    const t = new Uint32Array(256)
    for (let i = 0; i < 256; i++) {
      let c = i
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      t[i] = c >>> 0
    }
    return t
  })()

  class PackExporter {
    /**
     * @param {*} session
     * @param {(slot: *) => Promise<CanvasImageSource|null>|CanvasImageSource|null} getSourceForSlot
     */
    static async buildZip(session, getSourceForSlot) {
      const charId = session.id || 'character'
      const zip = new ZipWriter()
      const anims = {}

      const master = session.masterSheetName || ''
      for (const d of session.animDefs) {
        const slot = session.slots[d.id]
        const resolved = slot.resolveFrames(session)
        if (!resolved.length) continue
        const src = await getSourceForSlot(slot)
        if (!src) continue
        const frames = []
        for (let i = 0; i < resolved.length; i++) {
          const frame = resolved[i]
          const fileName = `${charId}-${d.id}-${i}.png`
          const baked = SA.FrameBaker.bake(src, frame)
          const blob = await SA.FrameBaker.toBlob(baked)
          await zip.addBlob(fileName, blob)
          const exportFrame = frame.toExportJSON(true)
          exportFrame.file = fileName
          exportFrame.w = baked.width
          exportFrame.h = baked.height
          frames.push(exportFrame)
        }
        const anim = {
          fps: slot.fps,
          loop: !!slot.loop,
          direction: slot.direction || 'forward',
          frames,
        }
        for (let i = 0; i < frames.length; i++) {
          frames[i].duration_ms = slot.durationAt(i)
        }
        const sheet = slot.sheetName || master || `${d.id}.png`
        if (!master || (slot.sheetName && slot.sheetName !== master)) {
          anim.sheet = sheet
        }
        anims[d.id] = anim
      }

      const exportObj = {
        name: charId,
        sheet: master || undefined,
        anims,
      }

      zip.add(`${charId}.anims.json`, new TextEncoder().encode(JSON.stringify(exportObj, null, 2)))
      return zip.build()
    }
  }

  SA.ZipWriter = ZipWriter
  SA.PackExporter = PackExporter
})(window.SpriteAnim)
