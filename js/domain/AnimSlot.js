(function (SA) {
  /** Fresh sessions / new sheets start with one generic tab. */
  const DEFAULT_ANIM_DEFS = [{ id: 'anim1', label: 'Anim 1', fps: 8, loop: true }]

  const DIRECTIONS = { forward: 1, reverse: 1, pingpong: 1 }

  class AnimSlot {
    /**
     * @param {{ id: string, label: string, fps?: number, loop?: boolean, direction?: string }} def
     */
    constructor(def) {
      this.id = def.id
      this.label = def.label
      this.fps = def.fps != null ? def.fps : 8
      this.loop = !!def.loop
      /** @type {'forward'|'reverse'|'pingpong'} */
      this.direction = DIRECTIONS[def.direction] ? def.direction : 'forward'
      /** Ordered refs into CharacterSession.frames by DetectBox.id */
      /** @type {number[]} */
      this.frameIds = []
      /**
       * Per-slot duration in ms; null / omit = inherit from anim FPS.
       * @type {(number|null)[]}
       */
      this.frameDurationsMs = []
      /** Optional per-anim sheet override (v1 unused for load; export may emit) */
      this.sheetName = ''
      /** @type {string|null} */
      this.dataUrl = null
    }

    defaultDurationMs() {
      return Math.max(16, Math.round(1000 / (this.fps || 6)))
    }

    /**
     * @param {number} index
     * @returns {number}
     */
    durationAt(index) {
      const raw = this.frameDurationsMs[index]
      if (raw != null && raw > 0) return Math.max(16, Math.round(+raw))
      return this.defaultDurationMs()
    }

    /** @param {number[]} ids @param {(number|null)[]} [durations] */
    setFrameIds(ids, durations) {
      this.frameIds = (ids || []).map((id) => id | 0)
      if (durations && durations.length === this.frameIds.length) {
        this.frameDurationsMs = durations.map((d) =>
          d == null || !(+d > 0) ? null : Math.max(16, Math.round(+d))
        )
      } else {
        this.frameDurationsMs = this.frameIds.map(() => null)
      }
    }

    /** Keep durations aligned after length changes. */
    syncDurationsLength() {
      while (this.frameDurationsMs.length < this.frameIds.length) this.frameDurationsMs.push(null)
      if (this.frameDurationsMs.length > this.frameIds.length) {
        this.frameDurationsMs.length = this.frameIds.length
      }
    }

    /**
     * @param {number} boxId
     * @param {number|null} [durationMs]
     */
    appendFrame(boxId, durationMs) {
      this.frameIds.push(boxId | 0)
      this.frameDurationsMs.push(durationMs != null && durationMs > 0 ? Math.round(durationMs) : null)
    }

    /** @param {number} boxId */
    unlinkFrameId(boxId) {
      const nextIds = []
      const nextDur = []
      for (let i = 0; i < this.frameIds.length; i++) {
        if (this.frameIds[i] === boxId) continue
        nextIds.push(this.frameIds[i])
        nextDur.push(this.frameDurationsMs[i] != null ? this.frameDurationsMs[i] : null)
      }
      this.frameIds = nextIds
      this.frameDurationsMs = nextDur
    }

    /** Apply anim FPS to every slot (clears custom holds). */
    applyFpsToAllDurations() {
      this.frameDurationsMs = this.frameIds.map(() => null)
    }

    /**
     * Timeline indices for one playback pass (before loop restart).
     * @returns {number[]}
     */
    playbackIndices() {
      const n = this.frameIds.length
      if (!n) return []
      const fwd = []
      for (let i = 0; i < n; i++) fwd.push(i)
      if (this.direction === 'reverse') return fwd.reverse()
      if (this.direction === 'pingpong') {
        if (n === 1) return [0]
        return fwd.concat(fwd.slice(1, -1).reverse())
      }
      return fwd
    }

    /**
     * Neighbor timeline index for onion (timeline space), wrapping with loop.
     * @param {number} fi
     * @param {number} delta -1 | +1
     */
    onionNeighbor(fi, delta) {
      const n = this.frameIds.length
      if (n < 2) return -1
      let j = fi + delta
      if (this.loop) {
        j = ((j % n) + n) % n
        return j === fi ? -1 : j
      }
      if (j < 0 || j >= n) return -1
      return j
    }

    /**
     * Resolve timeline geometry from the shared frame pool.
     * @param {*} session CharacterSession
     * @returns {InstanceType<typeof SA.TimelineFrame>[]}
     */
    resolveFrames(session) {
      const out = []
      for (const id of this.frameIds) {
        const box = session.frameById(id)
        if (!box) continue
        out.push(
          new SA.TimelineFrame({
            x: box.x,
            y: box.y,
            w: box.w,
            h: box.h,
            srcId: box.id,
            anchorX: box.anchorX,
            anchorY: box.anchorY,
            points: SA.Polygon.clone(box.points),
          })
        )
      }
      return out
    }

    /**
     * @param {*} session
     * @param {boolean} [includeFiles]
     * @param {string} [masterSheet]
     */
    toExportAnim(session, includeFiles, masterSheet) {
      const sheet = this.sheetName || masterSheet || `${this.id}.png`
      const resolved = this.resolveFrames(session)
      // Durations follow frameIds order; skip missing boxes by matching srcId walk
      const frames = []
      let ti = 0
      for (let i = 0; i < this.frameIds.length; i++) {
        const box = session.frameById(this.frameIds[i])
        if (!box) continue
        const f = resolved[ti++]
        if (!f) continue
        const json = f.toExportJSON(includeFiles)
        json.duration_ms = this.durationAt(i)
        frames.push(json)
      }
      return {
        sheet,
        fps: this.fps,
        loop: !!this.loop,
        direction: this.direction || 'forward',
        frames,
      }
    }
  }

  SA.DEFAULT_ANIM_DEFS = DEFAULT_ANIM_DEFS
  SA.AnimSlot = AnimSlot
})(window.SpriteAnim)
