(function (SA) {
  class CharacterSession {
    /**
     * @param {{ id?: string, animDefs?: any[] }} [opts]
     */
    constructor(opts = {}) {
      this.id = opts.id != null ? String(opts.id) : ''
      /** Character-level master spritesheet */
      this.masterSheetName = ''
      /** @type {string|null} */
      this.masterDataUrl = null
      /** Shared detect-box / frame pool for all anims */
      /** @type {InstanceType<typeof SA.DetectBox>[]} */
      this.frames = []
      /** @type {Record<string, InstanceType<typeof SA.AnimSlot>>} */
      this.slots = Object.create(null)
      /** @type {{ id: string, label: string, fps?: number, loop?: boolean }[]} */
      this.animDefs = []
      this.nextAnimSeq = 1
      this.nextDetectId = 1
      this.history = new SA.HistoryStack()
      const defs = opts.animDefs || SA.DEFAULT_ANIM_DEFS
      this.rebuildAnims(defs.map((d) => ({ ...d })))
    }

    activeSlot() {
      return this.slots[this.activeAnimId]
    }

    allocDetectId() {
      return this.nextDetectId++
    }

    /** @param {number} n */
    bumpNextDetectId(n) {
      if (typeof n === 'number') this.nextDetectId = Math.max(this.nextDetectId, n)
    }

    /** @param {string} id */
    setActiveAnim(id) {
      if (this.slots[id]) this.activeAnimId = id
    }

    firstAnimId() {
      return this.animDefs[0] ? this.animDefs[0].id : null
    }

    /**
     * Replace all anim tabs/slots (labels + empty timelines unless filled later).
     * @param {{ id: string, label: string, fps?: number, loop?: boolean }[]} defs
     */
    rebuildAnims(defs) {
      const list =
        defs && defs.length
          ? defs.map((d) => ({
              id: String(d.id),
              label: d.label != null ? String(d.label) : String(d.id),
              fps: d.fps != null ? d.fps : 8,
              loop: d.loop != null ? !!d.loop : true,
            }))
          : SA.DEFAULT_ANIM_DEFS.map((d) => ({ ...d }))
      this.slots = Object.create(null)
      this.animDefs = list
      for (const d of list) {
        this.slots[d.id] = new SA.AnimSlot(d)
        const m = /^anim(\d+)$/i.exec(d.id)
        if (m) this.nextAnimSeq = Math.max(this.nextAnimSeq, (+m[1] | 0) + 1)
      }
      this.activeAnimId = list[0].id
    }

    /** Single default tab (new sheet load). */
    resetAnimsToDefault() {
      this.nextAnimSeq = 1
      this.rebuildAnims(SA.DEFAULT_ANIM_DEFS.map((d) => ({ ...d })))
      this.nextAnimSeq = 2
    }

    allocAnimId() {
      let id
      do {
        id = 'anim' + this.nextAnimSeq++
      } while (this.slots[id])
      return id
    }

    /**
     * @param {string} [label]
     * @returns {string} new anim id
     */
    addAnim(label) {
      const id = this.allocAnimId()
      const n = this.animDefs.length + 1
      const def = {
        id,
        label: label && String(label).trim() ? String(label).trim() : 'Anim ' + n,
        fps: 8,
        loop: true,
      }
      this.animDefs.push(def)
      this.slots[id] = new SA.AnimSlot(def)
      return id
    }

    /**
     * @param {string} id
     * @param {string} label
     */
    renameAnim(id, label) {
      const d = this.animDefs.find((x) => x.id === id)
      const s = this.slots[id]
      if (!d || !s) return false
      const next = String(label || '').trim() || d.label
      d.label = next
      s.label = next
      return true
    }

    /**
     * Remove a tab (keeps at least one). Returns new active id.
     * @param {string} id
     */
    removeAnim(id) {
      if (this.animDefs.length <= 1) return this.activeAnimId
      if (!this.slots[id]) return this.activeAnimId
      const idx = this.animDefs.findIndex((d) => d.id === id)
      this.animDefs = this.animDefs.filter((d) => d.id !== id)
      delete this.slots[id]
      if (this.activeAnimId === id) {
        const next = this.animDefs[Math.max(0, idx - 1)] || this.animDefs[0]
        this.activeAnimId = next.id
      }
      return this.activeAnimId
    }

    /** @param {number} id */
    frameById(id) {
      return this.frames.find((b) => b.id === id) || null
    }

    /** @param {number} id */
    frameIndexById(id) {
      return this.frames.findIndex((b) => b.id === id)
    }

    /**
     * @param {any[]} list
     * @param {() => number} [nextId]
     */
    setFrames(list, nextId) {
      const alloc = nextId || (() => this.allocDetectId())
      this.frames = (list || []).map((b) => SA.DetectBox.from(b, alloc))
      for (const b of this.frames) {
        this.bumpNextDetectId(b.id + 1)
      }
    }

    sortFramesRowMajor() {
      this.frames.sort((a, b) => {
        const row = a.y - b.y
        if (Math.abs(row) > Math.min(a.h, b.h) * 0.45) return row
        return a.x - b.x
      })
    }

    /** Remove a pool frame and drop refs from every anim. */
    removeFrameAt(index) {
      const box = this.frames[index]
      if (!box) return null
      this.frames.splice(index, 1)
      for (const d of this.animDefs) {
        this.slots[d.id].unlinkFrameId(box.id)
      }
      return box
    }

    /**
     * Remove several pool frames (highest index first). Returns count removed.
     * @param {number[]} indices
     */
    removeFramesAt(indices) {
      const sorted = [...new Set(indices || [])]
        .filter((i) => typeof i === 'number' && i >= 0 && i < this.frames.length)
        .sort((a, b) => b - a)
      let n = 0
      for (const i of sorted) {
        if (this.removeFrameAt(i)) n++
      }
      return n
    }

    /** Set of frame ids used by the active anim (for sheet highlighting). */
    activeFrameIdSet() {
      const slot = this.activeSlot()
      return new Set(slot ? slot.frameIds : [])
    }

    /**
     * Snapshot for undo (shared pool + all anim refs + master sheet + tab defs).
     * @param {number} selectedDetect
     * @param {number} selectedTl
     */
    captureState(selectedDetect, selectedTl) {
      const slots = {}
      for (const d of this.animDefs) {
        const s = this.slots[d.id]
        slots[d.id] = {
          fps: s.fps,
          loop: s.loop,
          direction: s.direction || 'forward',
          frameIds: s.frameIds.slice(),
          frameDurationsMs: s.frameDurationsMs.slice(),
          sheetName: s.sheetName,
          label: s.label,
        }
      }
      return {
        frames: this.frames.map((b) => b.toJSON()),
        masterSheetName: this.masterSheetName,
        nextDetectId: this.nextDetectId,
        nextAnimSeq: this.nextAnimSeq,
        activeAnim: this.activeAnimId,
        selectedDetect,
        selectedTl,
        animDefs: this.animDefs.map((d) => ({
          id: d.id,
          label: d.label,
          fps: d.fps,
          loop: d.loop,
        })),
        slots,
      }
    }

    /**
     * @param {any} snap
     */
    applyState(snap) {
      this.masterSheetName = snap.masterSheetName || ''
      if (snap.masterDataUrl !== undefined) this.masterDataUrl = snap.masterDataUrl
      if (typeof snap.nextDetectId === 'number') this.nextDetectId = snap.nextDetectId
      if (typeof snap.nextAnimSeq === 'number') this.nextAnimSeq = snap.nextAnimSeq
      this.setFrames(snap.frames || [], () => this.allocDetectId())
      if (snap.animDefs && snap.animDefs.length) {
        this.rebuildAnims(snap.animDefs)
      }
      if (snap.slots) {
        for (const d of this.animDefs) {
          const raw = snap.slots[d.id]
          if (!raw) continue
          const s = this.slots[d.id]
          s.fps = raw.fps != null ? raw.fps : s.fps
          s.loop = !!raw.loop
          if (raw.direction) s.direction = raw.direction
          s.setFrameIds(raw.frameIds || [], raw.frameDurationsMs)
          if (raw.sheetName != null) s.sheetName = raw.sheetName
          if (raw.label != null) {
            s.label = raw.label
            d.label = raw.label
          }
        }
      }
      if (snap.activeAnim && this.slots[snap.activeAnim]) {
        this.activeAnimId = snap.activeAnim
      } else if (!this.slots[this.activeAnimId]) {
        this.activeAnimId = this.firstAnimId()
      }
    }

    toSerializable() {
      const slots = {}
      for (const d of this.animDefs) {
        const s = this.slots[d.id]
        slots[d.id] = {
          fps: s.fps,
          loop: s.loop,
          direction: s.direction || 'forward',
          frameIds: s.frameIds.slice(),
          frameDurationsMs: s.frameDurationsMs.slice(),
          sheetName: s.sheetName,
          dataUrl: s.dataUrl,
          label: s.label,
        }
      }
      return {
        version: 4,
        charId: this.id,
        activeAnim: this.activeAnimId,
        nextDetectId: this.nextDetectId,
        nextAnimSeq: this.nextAnimSeq,
        masterSheetName: this.masterSheetName,
        masterDataUrl: this.masterDataUrl,
        animDefs: this.animDefs.map((d) => ({
          id: d.id,
          label: d.label,
          fps: d.fps,
          loop: d.loop,
        })),
        frames: this.frames.map((b) => b.toJSON()),
        slots,
      }
    }

    /**
     * Infer animDefs from a slots object when older saves omit them.
     * @param {Record<string, any>} slots
     */
    animDefsFromSlots(slots) {
      const keys = Object.keys(slots || {})
      if (!keys.length) return SA.DEFAULT_ANIM_DEFS.map((d) => ({ ...d }))
      return keys.map((id) => {
        const raw = slots[id] || {}
        return {
          id,
          label: raw.label || id,
          fps: raw.fps != null ? raw.fps : 8,
          loop: raw.loop != null ? !!raw.loop : true,
        }
      })
    }

    /**
     * Load session payload (v2/v3 shared pool, or migrate v1 per-slot boxes).
     * @param {any} data
     */
    loadFromSerializable(data) {
      this.id = data.charId || this.id
      if (typeof data.nextDetectId === 'number') this.nextDetectId = data.nextDetectId
      if (typeof data.nextAnimSeq === 'number') this.nextAnimSeq = data.nextAnimSeq

      const defs =
        data.animDefs && data.animDefs.length
          ? data.animDefs
          : this.animDefsFromSlots(data.slots || {})
      this.rebuildAnims(defs)

      if (data.frames || data.masterDataUrl != null || data.version >= 2) {
        this.masterSheetName = data.masterSheetName || ''
        this.masterDataUrl = data.masterDataUrl || null
        this.setFrames(data.frames || [], () => this.allocDetectId())
        for (const d of this.animDefs) {
          const raw = data.slots && data.slots[d.id]
          if (!raw) continue
          const s = this.slots[d.id]
          s.fps = raw.fps != null ? raw.fps : s.fps
          s.loop = !!raw.loop
          if (raw.direction) s.direction = raw.direction
          s.sheetName = raw.sheetName || ''
          s.dataUrl = raw.dataUrl || null
          s.setFrameIds(raw.frameIds || [], raw.frameDurationsMs)
          if (raw.label != null) {
            s.label = raw.label
            d.label = raw.label
          }
        }
      } else {
        this._migrateV1(data)
      }

      if (data.activeAnim && this.slots[data.activeAnim]) {
        this.activeAnimId = data.activeAnim
      } else {
        this.activeAnimId = this.firstAnimId()
      }
    }

    /** @param {any} data */
    _migrateV1(data) {
      const byId = new Map()
      let masterUrl = null
      let masterName = ''

      for (const d of this.animDefs) {
        const raw = data.slots && data.slots[d.id]
        if (!raw) continue
        if (!masterUrl && raw.dataUrl) {
          masterUrl = raw.dataUrl
          masterName = raw.sheetName || ''
        }
        for (const b of raw.detectBoxes || []) {
          const id = b.id != null ? b.id : this.allocDetectId()
          if (!byId.has(id)) {
            byId.set(id, SA.DetectBox.from({ ...b, id }, () => id))
            this.bumpNextDetectId(id + 1)
          }
        }
      }

      this.frames = Array.from(byId.values())
      this.sortFramesRowMajor()
      this.masterDataUrl = masterUrl
      this.masterSheetName = masterName

      for (const d of this.animDefs) {
        const raw = data.slots && data.slots[d.id]
        if (!raw) continue
        const s = this.slots[d.id]
        s.fps = raw.fps != null ? raw.fps : s.fps
        s.loop = !!raw.loop
        s.sheetName = raw.sheetName || ''
        s.dataUrl = null
        const ids = []
        for (const f of raw.timeline || []) {
          if (f.srcId != null && byId.has(f.srcId)) {
            ids.push(f.srcId)
          } else {
            const match = this._findMatchingFrame(f)
            if (match) ids.push(match.id)
            else {
              const added = SA.DetectBox.from(f, () => this.allocDetectId())
              this.frames.push(added)
              byId.set(added.id, added)
              ids.push(added.id)
            }
          }
        }
        s.setFrameIds(ids)
      }
    }

    /** @param {{ x:number,y:number,w:number,h:number }} f */
    _findMatchingFrame(f) {
      return (
        this.frames.find(
          (b) => b.x === (f.x | 0) && b.y === (f.y | 0) && b.w === (f.w | 0) && b.h === (f.h | 0)
        ) || null
      )
    }

    /**
     * Find or create a pool frame matching export geometry; return its id.
     * @param {{ x:number,y:number,w:number,h:number, points?: number[][] }} f
     */
    ensureFrameFromGeometry(f) {
      const existing = this.frames.find((b) => {
        if (b.x !== (f.x | 0) || b.y !== (f.y | 0) || b.w !== (f.w | 0) || b.h !== (f.h | 0)) {
          return false
        }
        if (f.points && f.points.length >= 3) {
          if (!b.points || b.points.length !== f.points.length) return false
          for (let i = 0; i < f.points.length; i++) {
            if (b.points[i][0] !== f.points[i][0] || b.points[i][1] !== f.points[i][1]) {
              return false
            }
          }
        }
        return true
      })
      if (existing) {
        if (f.ax != null || f.anchorX != null) {
          existing.anchorX = SA.DetectBox.clamp01(f.anchorX != null ? f.anchorX : f.ax, 0.5)
        }
        if (f.ay != null || f.anchorY != null) {
          existing.anchorY = SA.DetectBox.clamp01(f.anchorY != null ? f.anchorY : f.ay, 1)
        }
        return existing.id
      }
      const added = SA.DetectBox.from(f, () => this.allocDetectId())
      this.frames.push(added)
      return added.id
    }
  }

  SA.CharacterSession = CharacterSession
})(window.SpriteAnim)
