(function (SA) {
  const $ = SA.$
  const on = SA.on
  const rgbToHex = SA.rgbToHex
  const hexToRgb = SA.hexToRgb
  const CharacterSession = SA.CharacterSession
  const DetectBox = SA.DetectBox
  const ChromaKey = SA.ChromaKey
  const FrameDetector = SA.FrameDetector
  const ExportProfiles = SA.ExportProfiles
  const SessionStore = SA.SessionStore
  const SheetView = SA.SheetView
  const TimelineView = SA.TimelineView
  const PreviewPlayer = SA.PreviewPlayer
  const Polygon = SA.Polygon
  const PackExporter = SA.PackExporter

  /**
   * Top-level studio controller: wires domain, views, and DOM.
   */
  class AnimStudioApp {
    constructor() {
      this.session = new CharacterSession()
      this.chroma = new ChromaKey()
      this.detector = new FrameDetector(this.chroma)
      this.store = new SessionStore()
      this.historyLocked = false
      this.nudgeNeedsHistory = true
      this.selectedDetect = -1
      /** @type {number[]} multi-select set; includes primary when non-empty */
      this.selectedDetects = []
      this.selectedTl = -1
      this.selectedVertex = -1
      this.exportProfile = 'generic'
      this.pickChromaMode = false
      /** Current master sheet uses native alpha (chroma disabled). */
      this.sheetHasAlpha = false
      /** @type {Record<string, HTMLImageElement>} */
      this.previewBgCache = Object.create(null)
      this.previewBgId = ''
      this.previewOnion = false
      this.previewFlipX = false
      this.previewScale = 1
      /** Preview pane width in the sheet/preview split (px) */
      this.previewPaneW = 340
      this._sheetSplitDragging = false

      this.sheetView = new SheetView($('sheetCanvas'), $('sheetStage'), {
        onSelect: (i) => this.selectDetect(i),
        onToggleSelect: (i) => this.toggleDetectSelection(i),
        onSelectMarquee: (rect) => this.selectDetectsEnclosed(rect),
        onClearSelection: () => this.clearDetectSelection(),
        onSnap: () => this.snapSelected(),
        onMarquee: (box) => this.insertDetectBox(box),
        onHistoryResize: () => this.pushHistory('resize box'),
        onHistoryMove: () => this.pushHistory('move box'),
        onHistoryVertex: () => this.pushHistory('edit polygon'),
        onBoxUpdate: (index, data) => this.setBoxFromData(index, data),
        onInsertVertex: (index, absPoints, vi) => this.insertVertex(index, absPoints, vi),
        onVertexSelect: (vi) => this.selectVertex(vi),
        onPickChroma: (rgb) => this.applyPickedChroma(rgb),
        onLiveEdit: () => this.afterLiveBoxEdit(),
        onCommitBox: () =>
          this.reindexFrames(
            this.selectedDetect >= 0 ? this.session.frames[this.selectedDetect] : null
          ),
        onZoomChange: () => this.syncZoomLabel(),
      })

      this.timelineView = new TimelineView($('timeline'), {
        getSource: () => this.sheetView.displaySource(),
        onSelect: (i) => {
          this.selectedTl = i
          this.preview.scrubTo(i)
          if (this.popoutOpen && this.popoutPreview) this.popoutPreview.scrubTo(i)
          this.timelineView.render(this.resolvedTimeline(), this.selectedTl)
          this.syncTlDurationUi()
          this.refreshPreview()
        },
        onReorder: (from, to) => this.reorderTimeline(from, to),
      })

      this.preview = new PreviewPlayer($('previewCanvas'), $('previewFrame'), $('previewStage'), {
        stage: $('previewStage'),
        onResize: () => this.refreshPreview(),
        onFrame: (fi) => this.syncTimelinePlayhead(fi),
      })
      this.popoutPreview = new PreviewPlayer(
        $('previewPopoutCanvas'),
        $('popoutFrame'),
        $('previewPopoutCanvas'),
        {
          scaleMode: 'native',
          pad: 8,
          onFrame: (fi) => this.syncTimelinePlayhead(fi),
        }
      )
      this.popoutOpen = false
      /** Space-held hand pan on the preview stage */
      this.previewPanMode = false
      /** @type {{ startX: number, startY: number, scrollLeft: number, scrollTop: number }|null} */
      this.previewSpacePan = null
    }

    setPreviewPanMode(on) {
      this.previewPanMode = !!on
      const stage = $('previewStage')
      if (!stage) return
      stage.classList.toggle('panning', this.previewPanMode)
      if (!this.previewPanMode) {
        this.previewSpacePan = null
        stage.classList.remove('panning-drag')
      }
    }

    /** Apply stored/default preview pane width to the sheet-row split. */
    applyPreviewPaneWidth(px) {
      const row = $('sheetRow')
      if (!row) return
      const w = Math.max(240, Math.round(+px || 340))
      this.previewPaneW = w
      row.style.setProperty('--preview-pane-w', w + 'px')
      this.updatePreviewDockLayout()
    }

    /**
     * When the preview pane is wide enough, park controls in a vertical rail.
     * Threshold ~460px dock width (stage + side menu).
     */
    updatePreviewDockLayout() {
      const dock = $('previewDock')
      if (!dock) return
      const wide = dock.clientWidth >= 460
      dock.classList.toggle('preview-dock-wide', wide)
    }

    bindSheetSplit() {
      const split = $('sheetSplit')
      const row = $('sheetRow')
      if (!split || !row) return

      const onMove = (ev) => {
        if (!this._sheetSplitDragging) return
        const rect = row.getBoundingClientRect()
        const fromRight = rect.right - ev.clientX
        const maxW = Math.max(240, rect.width - 180)
        const w = Math.max(240, Math.min(maxW, fromRight))
        this.applyPreviewPaneWidth(w)
      }
      const onUp = () => {
        if (!this._sheetSplitDragging) return
        this._sheetSplitDragging = false
        document.body.classList.remove('resizing-panes')
      }

      on(split, 'mousedown', (ev) => {
        if (ev.button !== 0) return
        ev.preventDefault()
        this._sheetSplitDragging = true
        document.body.classList.add('resizing-panes')
      })
      on(split, 'dblclick', () => {
        this.applyPreviewPaneWidth(340)
        this.setFooter('Preview pane reset to default width')
      })
      on(window, 'mousemove', onMove)
      on(window, 'mouseup', onUp)
      on(window, 'blur', onUp)

      if (typeof ResizeObserver !== 'undefined') {
        const dock = $('previewDock')
        if (dock) {
          this._previewDockRo = new ResizeObserver(() => this.updatePreviewDockLayout())
          this._previewDockRo.observe(dock)
        }
      }
      this.applyPreviewPaneWidth(this.previewPaneW)
    }

    /** @param {number} zoom */
    setPreviewZoom(zoom) {
      const next = Math.max(0.5, Math.min(8, Math.round(+zoom * 100) / 100))
      if (Math.abs(next - this.previewScale) < 0.001) {
        this.syncPreviewZoomLabel()
        return
      }
      this.previewScale = next
      this.syncPreviewZoomLabel()
      this.refreshPreview()
    }

    syncPreviewZoomLabel() {
      const el = $('btnPreviewZoomLabel')
      if (el) el.textContent = Math.round(this.previewScale * 100) + '%'
    }

    /**
     * Zoom steps: 50% → 100% → 150% → 200% → 300% → 400% → 600% → 800%
     * @param {number} dir -1 | +1
     */
    nudgePreviewZoom(dir) {
      const steps = [0.5, 1, 1.5, 2, 3, 4, 6, 8]
      let i = 0
      let best = Infinity
      for (let s = 0; s < steps.length; s++) {
        const d = Math.abs(steps[s] - this.previewScale)
        if (d < best) {
          best = d
          i = s
        }
      }
      const next = steps[Math.max(0, Math.min(steps.length - 1, i + (dir | 0)))]
      this.setPreviewZoom(next)
    }

    /**
     * Keep timeline selection (and scroll) on the frame shown in preview.
     * @param {number} fi
     */
    syncTimelinePlayhead(fi) {
      if (typeof fi !== 'number' || fi < 0) return
      if (this.selectedTl === fi) return
      this.selectedTl = fi
      this.timelineView.setSelectedIndex(fi, { scroll: true, smooth: false })
      this.syncTlDurationUi()
      if ($('btnPlay')) $('btnPlay').textContent = this.preview.playing ? 'Pause' : 'Play'
      if (this.popoutOpen && $('btnPopoutPlay')) {
        $('btnPopoutPlay').textContent = this.popoutPreview.playing ? 'Pause' : 'Play'
      }
    }

    slot() {
      return this.session.activeSlot()
    }

    /** Live timeline geometry for the active anim. */
    resolvedTimeline() {
      return this.slot().resolveFrames(this.session)
    }

    frames() {
      return this.session.frames
    }

    start() {
      this.bindUi()
      this.bindSheetSplit()
      this.syncChromaColorUi()
      this.syncZoomLabel()
      this.syncPreviewZoomLabel()
      const profileEl = $('exportProfile')
      if (profileEl) this.exportProfile = profileEl.value || 'generic'
      this.syncExportProfileUi()
      this.renderTabs()
      this.loadSlotIntoUi()
      this.refreshExport()
      this.updateHistoryButtons()
      if (this.store.has()) {
        this.setFooter('Saved session available — Load session to restore')
      }
    }

    /** Update pack button label for the active export profile. */
    syncExportProfileUi() {
      const pack = $('btnDownloadPack')
      if (pack) {
        pack.textContent =
          this.exportProfile === 'godot' ? 'Download Godot pack' : 'Download PNG pack'
        pack.title =
          this.exportProfile === 'godot'
            ? 'Zip: sheet PNG + onionlab.json + Godot 4 importer addon'
            : 'Zip of baked PNGs + JSON'
      }
    }

    // ── History ────────────────────────────────────────────────────────────
    pushHistory(label) {
      if (this.historyLocked) return
      const snap = this.captureState()
      this.session.history.push(snap, label)
      this.updateHistoryButtons()
    }

    captureState() {
      this.stashUiIntoSlot()
      return this.session.captureState(this.selectedDetect, this.selectedTl)
    }

    updateHistoryButtons() {
      const h = this.session.history
      ;['btnUndo', 'btnUndo2', 'btnRedo', 'btnRedo2'].forEach((id) => {
        const el = $(id)
        if (!el) return
        el.disabled = id.includes('Undo') ? !h.canUndo : !h.canRedo
      })
    }

    undo() {
      const h = this.session.history
      const entry = h.undo(this.captureState())
      if (!entry) {
        this.setFooter('Nothing to undo')
        return
      }
      this.applyState(entry.snap)
      this.setFooter(entry.label ? `Undo: ${entry.label}` : 'Undo')
    }

    redo() {
      const h = this.session.history
      const entry = h.redo(this.captureState())
      if (!entry) {
        this.setFooter('Nothing to redo')
        return
      }
      this.applyState(entry.snap)
      this.setFooter(entry.label ? `Redo: ${entry.label}` : 'Redo')
    }

    applyState(snap) {
      this.historyLocked = true
      this.session.applyState(snap)
      this.selectedDetect = snap.selectedDetect != null ? snap.selectedDetect : -1
      this.selectedTl = snap.selectedTl != null ? snap.selectedTl : -1
      if (this.selectedDetect >= this.frames().length) {
        this.selectedDetect = this.frames().length - 1
      }
      this.selectedDetects = this.selectedDetect >= 0 ? [this.selectedDetect] : []
      const tl = this.resolvedTimeline()
      if (this.selectedTl >= tl.length) {
        this.selectedTl = tl.length - 1
      }
      $('sheetName').value = this.session.masterSheetName
      $('animFps').value = String(this.slot().fps)
      $('animLoop').checked = this.slot().loop
      this.renderTabs()
      this.syncSheetView()
      this.historyLocked = false
      this.updateHistoryButtons()
      this.ensureMasterImageLoaded(() => this.redrawAll())
    }

    // ── Slot / UI sync ─────────────────────────────────────────────────────
    stashUiIntoSlot() {
      const s = this.slot()
      this.session.masterSheetName = $('sheetName').value.trim()
      s.fps = +$('animFps').value || 6
      s.loop = $('animLoop').checked
      const dir = $('animDirection')
      if (dir) s.direction = dir.value || 'forward'
    }

    /** Load fps/loop for active tab; keep master sheet on canvas. */
    loadSlotIntoUi() {
      const s = this.slot()
      $('sheetName').value = this.session.masterSheetName
      $('animFps').value = String(s.fps)
      $('animLoop').checked = !!s.loop
      const dir = $('animDirection')
      if (dir) dir.value = s.direction || 'forward'
      if (this.selectedDetect >= this.frames().length) {
        this.selectedDetect = this.frames().length - 1
      }
      this.selectedDetects =
        this.selectedDetect >= 0
          ? this.selectedDetects.filter((i) => i < this.frames().length)
          : []
      if (this.selectedDetect >= 0 && !this.selectedDetects.includes(this.selectedDetect)) {
        this.selectedDetects = [this.selectedDetect]
      }
      const tlLen = s.frameIds.length
      if (this.selectedTl >= tlLen) this.selectedTl = tlLen - 1
      this.syncTlDurationUi()
      this.ensureMasterImageLoaded(() => {
        this.syncSheetView()
        this.redrawAll()
      })
    }

    syncTlDurationUi() {
      const el = $('tlDurationMs')
      if (!el) return
      const s = this.slot()
      if (this.selectedTl < 0 || this.selectedTl >= s.frameIds.length) {
        el.value = ''
        el.placeholder = 'auto'
        el.disabled = true
        return
      }
      el.disabled = false
      const raw = s.frameDurationsMs[this.selectedTl]
      el.value = raw != null && raw > 0 ? String(raw) : ''
      el.placeholder = String(s.defaultDurationMs())
    }

    applyTlDurationFromUi() {
      const el = $('tlDurationMs')
      if (!el || el.disabled) return
      const s = this.slot()
      if (this.selectedTl < 0 || this.selectedTl >= s.frameIds.length) return
      s.syncDurationsLength()
      const v = el.value.trim()
      if (!v) {
        s.frameDurationsMs[this.selectedTl] = null
      } else {
        s.frameDurationsMs[this.selectedTl] = Math.max(16, Math.round(+v || 0))
      }
      this.refreshPreview()
      this.refreshExport()
    }

    ensureMasterImageLoaded(done) {
      const url = this.session.masterDataUrl
      if (!url) {
        this._loadedMasterUrl = null
        this.sheetView.setImage(null)
        this.setSheetAlphaMode(false)
        if (done) done()
        return
      }
      if (this.sheetView.sheetImg && this._loadedMasterUrl === url) {
        if (done) done()
        return
      }
      const img = new Image()
      img.onload = () => {
        this._loadedMasterUrl = url
        this.sheetView.setImage(img)
        this.setSheetAlphaMode(ChromaKey.imageHasAlpha(img))
        if (done) done()
      }
      img.onerror = () => {
        this.setFooter('Failed to load master sheet')
        if (done) done()
      }
      img.src = url
    }

    syncSheetView() {
      this.readChromaFromUi()
      const showTransparency = this.sheetHasAlpha || !!$('hideChroma').checked
      this.sheetView.setChroma(this.chroma, showTransparency, this.sheetHasAlpha)
      this.sheetView.setBoxes(
        this.frames(),
        this.selectedDetect,
        this.selectedVertex,
        this.session.activeFrameIdSet(),
        this.selectedDetects
      )
    }

    readChromaFromUi() {
      this.chroma.set({
        r: +$('chromaR').value,
        g: +$('chromaG').value,
        b: +$('chromaB').value,
        tol: +$('chromaTol').value,
        alphaOnly: this.sheetHasAlpha,
      })
      this.detector.chroma = this.chroma
    }

    /**
     * Enable/disable chroma key UI based on whether the sheet has native alpha.
     * Alpha sheets get Merge/Bridge zeroed so open transparent gutters stay open.
     * @param {boolean} hasAlpha
     */
    setSheetAlphaMode(hasAlpha) {
      const next = !!hasAlpha
      const wasAlpha = this.sheetHasAlpha
      this.sheetHasAlpha = next
      this.chroma.alphaOnly = next

      if (next && !wasAlpha) {
        // Remember chroma-oriented settings so we can restore on opaque sheets
        this._chromaDetectPrefs = {
          mergeGap: +$('mergeGap').value,
          bridge: $('bridge') ? +$('bridge').value : 2,
        }
        // Transparent gutters are intentional — morphological close / AABB merge
        // will glue an entire packed sheet into one bbox.
        if ($('mergeGap')) $('mergeGap').value = '0'
        if ($('bridge')) $('bridge').value = '0'
      } else if (!next && wasAlpha && this._chromaDetectPrefs) {
        if ($('mergeGap')) $('mergeGap').value = String(this._chromaDetectPrefs.mergeGap)
        if ($('bridge')) $('bridge').value = String(this._chromaDetectPrefs.bridge)
        this._chromaDetectPrefs = null
      }

      const hide = $('hideChroma')
      if (hide) {
        if (next) {
          hide.checked = true
          hide.disabled = true
        } else {
          hide.disabled = false
        }
      }
      const hideLabel = $('hideChromaLabel')
      if (hideLabel) {
        hideLabel.textContent = next
          ? 'Native transparency (chroma off)'
          : 'Hide chroma on sheet & preview'
      }
      const alphaNote = $('alphaSheetNote')
      if (alphaNote) {
        alphaNote.hidden = !next
        if (next) {
          alphaNote.textContent =
            'Native alpha — chroma off. Merge/Bridge set to 0 so transparent gutters split sprites. Raise Merge slightly only if a weapon is a separate island.'
        }
      }
      ;['chromaColor', 'chromaR', 'chromaG', 'chromaB', 'chromaTol', 'btnPickChroma'].forEach(
        (id) => {
          const el = $(id)
          if (el) el.disabled = next
        }
      )
      if (next && this.pickChromaMode) {
        this.setPickChromaMode(false)
      }
      this.sheetView.keyedDirty = true
    }

    syncChromaColorUi() {
      const el = $('chromaColor')
      if (!el) return
      el.value = rgbToHex(+$('chromaR').value, +$('chromaG').value, +$('chromaB').value)
    }

    setChromaRgb(r, g, b, opts = {}) {
      $('chromaR').value = String(r | 0)
      $('chromaG').value = String(g | 0)
      $('chromaB').value = String(b | 0)
      if (opts.tol != null) $('chromaTol').value = String(opts.tol | 0)
      this.syncChromaColorUi()
      this.readChromaFromUi()
      this.sheetView.keyedDirty = true
      if (opts.redetect && this.sheetView.sheetImg) {
        this.runDetect(false)
        return
      }
      this.redrawAll()
    }

    /** Sample sheet borders and apply detected key (before frame detect). */
    autoDetectChroma(img) {
      const guess = ChromaKey.detectFromImage(img)
      if (!guess) return false
      this.setChromaRgb(guess.r, guess.g, guess.b, { tol: guess.tol })
      return true
    }

    setPickChromaMode(on) {
      if (on && this.sheetHasAlpha) {
        this.setFooter('Chroma pick disabled — sheet has native transparency')
        return
      }
      this.pickChromaMode = !!on
      this.sheetView.setPickMode(this.pickChromaMode)
      const btn = $('btnPickChroma')
      if (btn) btn.classList.toggle('pick-active', this.pickChromaMode)
      if (this.pickChromaMode) {
        this.setFooter('Pick chroma: click the sheet background · Esc to cancel')
      }
    }

    applyPickedChroma(rgb) {
      this.setChromaRgb(rgb.r, rgb.g, rgb.b, { redetect: true })
      this.setPickChromaMode(false)
      this.setFooter(`Chroma set to rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`)
    }

    detectOpts(extra = {}) {
      const mergeGap = +$('mergeGap').value
      const bridgeEl = $('bridge')
      return {
        minW: +$('minW').value,
        minH: +$('minH').value,
        mergeGap,
        bridge: bridgeEl ? +bridgeEl.value : this.sheetHasAlpha ? 0 : 2,
        pad: +$('boxPad').value,
        // Alpha sheets: connectivity only via real alpha (no weapon-fragment absorb)
        absorb: this.sheetHasAlpha ? false : undefined,
        ...extra,
      }
    }

    runDetect(pushHist) {
      if (!this.sheetView.sheetImg) return
      if (pushHist) this.pushHistory('re-detect')
      this.readChromaFromUi()
      const boxes = this.detector.detect(this.sheetView.sheetImg, this.detectOpts())
      this.session.setFrames(boxes, () => this.session.allocDetectId())
      // New pool ids — clear all anim timelines
      for (const d of this.session.animDefs) {
        this.session.slots[d.id].setFrameIds([])
      }
      this.selectedDetect = this.frames().length ? 0 : -1
      this.selectedDetects = this.selectedDetect >= 0 ? [this.selectedDetect] : []
      this.selectedTl = -1
      this.syncSheetView()
      this.redrawAll()
    }

    /**
     * Normalize and apply a detect-box selection.
     * @param {number[]} indices
     * @param {number} [primary]
     */
    setDetectSelection(indices, primary) {
      const n = this.frames().length
      const uniq = [...new Set((indices || []).filter((i) => i >= 0 && i < n))].sort((a, b) => a - b)
      this.selectedDetects = uniq
      if (primary != null && uniq.includes(primary)) {
        this.selectedDetect = primary
      } else {
        this.selectedDetect = uniq.length ? uniq[0] : -1
      }
      this.selectedTl = -1
      this.selectedVertex = -1
      this.nudgeNeedsHistory = true
      this.syncBoxNudge()
      this.syncVertexLabel()
      this.syncSheetView()
      this.sheetView.draw()
      this.timelineView.render(this.resolvedTimeline(), this.selectedTl)
      this.refreshPreview()
    }

    clearDetectSelection() {
      this.setDetectSelection([])
    }

    /** @param {number} i */
    isDetectSelected(i) {
      return this.selectedDetects.includes(i)
    }

    /**
     * Select every pool box fully enclosed by rect (sheet space).
     * @param {{ x: number, y: number, w: number, h: number }} rect
     */
    selectDetectsEnclosed(rect) {
      if (!rect) {
        this.clearDetectSelection()
        return
      }
      const x1 = rect.x + rect.w
      const y1 = rect.y + rect.h
      const hit = []
      this.frames().forEach((b, i) => {
        if (b.x >= rect.x && b.y >= rect.y && b.x + b.w <= x1 && b.y + b.h <= y1) {
          hit.push(i)
        }
      })
      this.setDetectSelection(hit, hit.length ? hit[0] : undefined)
      if (hit.length) {
        this.setFooter(
          hit.length === 1 ? `Box ${hit[0]} selected` : `${hit.length} boxes selected`
        )
      } else {
        this.setFooter('No boxes enclosed')
      }
    }

    /** @param {number} i */
    toggleDetectSelection(i) {
      if (i < 0 || !this.frames()[i]) return
      const set = new Set(this.selectedDetects)
      if (set.has(i)) {
        set.delete(i)
        const next = [...set].sort((a, b) => a - b)
        const primary =
          this.selectedDetect === i
            ? next.length
              ? next[next.length - 1]
              : undefined
            : this.selectedDetect
        this.setDetectSelection(next, primary)
      } else {
        set.add(i)
        this.setDetectSelection([...set], i)
      }
    }

    selectDetect(i) {
      this.setDetectSelection(i >= 0 ? [i] : [], i >= 0 ? i : undefined)
    }

    selectVertex(vi) {
      if (this.selectedDetects.length > 1) return
      this.selectedVertex = vi
      this.syncVertexLabel()
      this.syncSheetView()
      this.sheetView.draw()
    }

    syncVertexLabel() {
      const el = $('vertexStatus')
      if (!el) return
      if (this.selectedDetects.length > 1) {
        el.textContent = `${this.selectedDetects.length} boxes selected · Delete removes all`
        return
      }
      const b = this.frames()[this.selectedDetect]
      if (!b) {
        el.textContent = ''
        return
      }
      const n = b.points.length
      el.textContent =
        this.selectedVertex >= 0
          ? `Vertex ${this.selectedVertex + 1} / ${n} · Alt+click edge to add · Delete removes vertex`
          : `${n} vertices · Alt+click edge to add point`
    }

    setBoxFromData(index, data) {
      const prev = this.session.frames[index]
      const merged = {
        ...(prev ? prev.toJSON() : {}),
        ...data,
        id: data.id != null ? data.id : prev && prev.id,
      }
      if (data.anchorX == null && data.ax == null && prev) {
        merged.anchorX = prev.anchorX
      }
      if (data.anchorY == null && data.ay == null && prev) {
        merged.anchorY = prev.anchorY
      }
      this.session.frames[index] = DetectBox.from(merged, () => this.session.allocDetectId())
    }

    insertVertex(index, absPoints, vertexIndex) {
      const box = this.frames()[index]
      if (!box) return
      const b = Polygon.boundsFromPoints(absPoints)
      const rel = Polygon.toRelative(absPoints, b.x, b.y)
      this.setBoxFromData(index, {
        x: b.x,
        y: b.y,
        w: b.w,
        h: b.h,
        id: box.id,
        points: rel,
      })
      this.selectedVertex = vertexIndex
      this.syncBoxNudge()
      this.syncVertexLabel()
      this.redrawAll()
    }

    setBoxPoints(index, relPoints, vertexIndex) {
      const box = this.frames()[index]
      if (!box) return
      box.setPoints(relPoints)
      if (vertexIndex != null && vertexIndex >= 0) this.selectedVertex = vertexIndex
      this.syncBoxNudge()
      this.syncVertexLabel()
    }

    setDetectRect(index, rect, keepId) {
      const prev = this.frames()[index]
      const id = keepId != null ? keepId : prev && prev.id
      let points
      if (!prev) {
        points = Polygon.rectPoints(rect.w, rect.h)
      } else if (Polygon.isRect(prev.points, prev.w, prev.h)) {
        points = Polygon.rectPoints(rect.w, rect.h)
      } else if (prev.w !== rect.w || prev.h !== rect.h) {
        points = Polygon.scaleToBounds(prev.points, prev.w, prev.h, rect.w, rect.h)
      } else {
        points = Polygon.clone(prev.points)
      }
      this.setBoxFromData(index, { ...rect, id, points })
    }

    resetSelectedShape() {
      if (this.selectedDetects.length > 1) {
        this.setFooter('Select a single box to reset shape')
        return
      }
      const box = this.frames()[this.selectedDetect]
      if (!box) return
      this.pushHistory('reset shape')
      box.points = Polygon.rectPoints(box.w, box.h)
      this.selectedVertex = -1
      this.redrawAll()
      this.setFooter('Shape reset to rectangle')
    }

    deleteSelectedVertex() {
      if (this.selectedDetects.length > 1) return false
      const box = this.frames()[this.selectedDetect]
      if (!box || this.selectedVertex < 0) return false
      if (box.points.length <= 3) {
        this.setFooter('Need at least 3 vertices')
        return true
      }
      this.pushHistory('delete vertex')
      box.setPoints(Polygon.deleteVertex(box.points, this.selectedVertex))
      this.selectedVertex = Math.min(this.selectedVertex, box.points.length - 1)
      this.redrawAll()
      return true
    }

    /** Delete all selected detect boxes (one undo step). */
    deleteSelectedDetects() {
      const indices =
        this.selectedDetects.length > 0
          ? this.selectedDetects.slice()
          : this.selectedDetect >= 0
            ? [this.selectedDetect]
            : []
      const valid = indices.filter((i) => this.frames()[i])
      if (!valid.length) return
      const n = valid.length
      this.pushHistory(n > 1 ? 'delete boxes' : 'delete box')
      this.session.removeFramesAt(valid)
      this.selectedDetect = -1
      this.selectedDetects = []
      this.selectedVertex = -1
      this.reindexFrames(null)
      this.setFooter(n === 1 ? 'Deleted detect box' : `Deleted ${n} detect boxes`)
    }

    afterLiveBoxEdit() {
      this.syncBoxNudge()
      this.timelineView.render(this.resolvedTimeline(), this.selectedTl)
      this.refreshPreview()
      this.refreshExport()
    }

    reindexFrames(prefer) {
      if (prefer) {
        this.session.sortFramesRowMajor()
        this.selectedDetect =
          prefer.id != null
            ? this.session.frameIndexById(prefer.id)
            : this.frames().findIndex(
                (b) => b.x === prefer.x && b.y === prefer.y && b.w === prefer.w && b.h === prefer.h
              )
        this.selectedDetects = this.selectedDetect >= 0 ? [this.selectedDetect] : []
      } else if (this.frames().length) {
        this.session.sortFramesRowMajor()
        if (this.selectedDetect >= this.frames().length) {
          this.selectedDetect = this.frames().length - 1
        }
        this.selectedDetects = this.selectedDetect >= 0 ? [this.selectedDetect] : []
      } else {
        this.selectedDetect = -1
        this.selectedDetects = []
      }
      const tlLen = this.slot().frameIds.length
      if (!tlLen) {
        this.selectedTl = -1
      } else if (this.selectedTl >= tlLen) {
        this.selectedTl = tlLen - 1
      }
      this.redrawAll()
    }

    insertDetectBox(box) {
      this.pushHistory('add box')
      const added = DetectBox.from(box, () => this.session.allocDetectId())
      const at = this.selectedDetect >= 0 ? this.selectedDetect + 1 : this.frames().length
      this.session.frames.splice(at, 0, added)
      this.selectedDetect = at
      this.selectedDetects = [at]
      this.reindexFrames(added)
      this.setFooter(`Detect box ${this.selectedDetect} added`)
    }

    // ── Timeline ───────────────────────────────────────────────────────────
    appendTimelineBox(box) {
      this.pushHistory('add to timeline')
      this.slot().appendFrame(box.id)
      this.selectedTl = this.slot().frameIds.length - 1
      const times = this.slot().frameIds.filter((id) => id === box.id).length
      this.redrawAll({ scrollToSelected: true })
      this.syncTlDurationUi()
      this.setFooter(
        times > 1
          ? `Added pool #${box.id} again · ${times}× on this timeline (slot ${this.selectedTl})`
          : `Added pool #${box.id} → slot ${this.selectedTl}`
      )
    }

    /**
     * Append a reverse echo of the current timeline (skip last to avoid doubling the peak).
     * e.g. 0,1,2,3 → 0,1,2,3,2,1,0 — good for slight reverse finishes.
     */
    appendTimelineReverse() {
      const slot = this.slot()
      const ids = slot.frameIds
      if (ids.length < 2) {
        this.setFooter('Need at least 2 timeline frames to append reverse')
        return
      }
      this.pushHistory('append reverse')
      slot.syncDurationsLength()
      const len = ids.length
      const added = []
      for (let i = len - 2; i >= 0; i--) {
        ids.push(ids[i])
        slot.frameDurationsMs.push(
          slot.frameDurationsMs[i] != null ? slot.frameDurationsMs[i] : null
        )
        added.push(ids[i])
      }
      this.selectedTl = ids.length - 1
      this.redrawAll({ scrollToSelected: true })
      this.syncTlDurationUi()
      this.setFooter(`Appended reverse · +${added.length} slots (ping-pong)`)
    }

    reorderTimeline(from, to) {
      this.pushHistory('reorder timeline')
      const slot = this.slot()
      const ids = slot.frameIds
      slot.syncDurationsLength()
      const item = ids.splice(from, 1)[0]
      const dur = slot.frameDurationsMs.splice(from, 1)[0]
      ids.splice(to, 0, item)
      slot.frameDurationsMs.splice(to, 0, dur)
      this.selectedTl = to
      this.redrawAll()
      this.syncTlDurationUi()
    }

    // ── Snap / split / etc ─────────────────────────────────────────────────
    snapSelected() {
      if (!this.sheetView.sheetImg) {
        this.setFooter('Load a sheet first')
        return
      }
      if (this.selectedDetects.length > 1) {
        this.setFooter('Select a single box to snap')
        return
      }
      if (this.selectedDetect < 0 || !this.frames()[this.selectedDetect]) {
        this.setFooter('Select a detect box first')
        return
      }
      this.pushHistory('snap')
      this.readChromaFromUi()
      const minW = Math.max(4, Math.floor(+$('minW').value * 0.5) || 4)
      const minH = Math.max(4, Math.floor(+$('minH').value * 0.5) || 4)
      const mergeGap = +$('mergeGap').value || 0
      const attachGap = this.detector.attachGapFromMerge(mergeGap)
      // Raw islands (no AABB merge) but keep mask bridge so thin hafts reconnect;
      // then grow the seed with fragment-attach rules so axe + body reunite.
      const islands = this.detector.detect(this.sheetView.sheetImg, {
        ...this.detectOpts(),
        mergeGap: 0,
        absorb: false,
        minW,
        minH,
        minPixels: 16,
      })
      const sel = this.frames()[this.selectedDetect]
      const nearest = this.detector.nearestIsland(sel, islands)
      if (!nearest) {
        this.setFooter('No nearby object to snap to')
        return
      }
      const grown = this.detector.growIsland(nearest, islands, attachGap, sel) || nearest
      this.setDetectRect(this.selectedDetect, grown, sel.id)
      this.reindexFrames(this.frames()[this.selectedDetect])
      this.setFooter(`Snapped box ${this.selectedDetect} (${grown.w}×${grown.h})`)
    }

    // ── Render ─────────────────────────────────────────────────────────────
    renderTabs() {
      const el = $('animTabs')
      el.innerHTML = ''
      const hasMaster = !!this.session.masterDataUrl
      for (const d of this.session.animDefs) {
        const s = this.session.slots[d.id]
        const wrap = document.createElement('div')
        const canClose = this.session.animDefs.length > 1
        wrap.className =
          'tab-wrap' +
          (d.id === this.session.activeAnimId ? ' active' : '') +
          (canClose ? ' has-close' : '')

        const btn = document.createElement('button')
        btn.type = 'button'
        btn.className = 'tab' + (d.id === this.session.activeAnimId ? ' active' : '')
        btn.title = 'Click to select · click again to rename'
        const n = s.frameIds.length
        const badge = n ? n + 'f' : hasMaster ? 'sheet' : '—'
        const label = document.createElement('span')
        label.className = 'tab-label'
        label.textContent = d.label
        const badgeEl = document.createElement('span')
        badgeEl.className = 'badge'
        badgeEl.textContent = badge
        btn.appendChild(label)
        btn.appendChild(badgeEl)
        btn.addEventListener('click', (ev) => {
          ev.preventDefault()
          if (d.id === this.session.activeAnimId) {
            this.beginTabRename(d.id, label)
          } else {
            this.switchAnim(d.id)
          }
        })
        wrap.appendChild(btn)

        if (canClose) {
          const close = document.createElement('button')
          close.type = 'button'
          close.className = 'tab-close'
          close.title = 'Remove anim tab'
          close.textContent = '×'
          close.addEventListener('click', (ev) => {
            ev.preventDefault()
            ev.stopPropagation()
            this.removeAnimTab(d.id)
          })
          wrap.appendChild(close)
        }

        el.appendChild(wrap)
      }

      const add = document.createElement('button')
      add.type = 'button'
      add.className = 'tab-add'
      add.title = 'Add animation tab'
      add.setAttribute('aria-label', 'Add animation')
      add.innerHTML =
        '<svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">' +
        '<path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
        '</svg>'
      add.addEventListener('click', () => this.addAnimTab())
      el.appendChild(add)
    }

    /** @param {string} id @param {HTMLElement} labelEl */
    beginTabRename(id, labelEl) {
      const d = this.session.animDefs.find((x) => x.id === id)
      if (!d || !labelEl || labelEl.querySelector('input')) return
      const input = document.createElement('input')
      input.type = 'text'
      input.className = 'tab-rename'
      input.value = d.label
      input.setAttribute('maxlength', '40')
      const finish = (commit) => {
        if (!input.parentNode) return
        const next = commit ? input.value : d.label
        const changed = String(next || '').trim() !== d.label
        if (commit && changed) this.pushHistory('rename anim')
        this.session.renameAnim(id, next)
        this.renderTabs()
        this.refreshExport()
      }
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault()
          finish(true)
        } else if (ev.key === 'Escape') {
          ev.preventDefault()
          finish(false)
        }
      })
      input.addEventListener('blur', () => finish(true))
      input.addEventListener('click', (ev) => ev.stopPropagation())
      labelEl.textContent = ''
      labelEl.appendChild(input)
      input.focus()
      input.select()
    }

    addAnimTab() {
      this.stashUiIntoSlot()
      this.pushHistory('add anim tab')
      const id = this.session.addAnim()
      this.switchAnim(id)
      this.setFooter('Added anim tab — click again to rename')
      // Enter rename immediately
      requestAnimationFrame(() => {
        const active = document.querySelector('#animTabs .tab.active .tab-label')
        if (active) this.beginTabRename(id, /** @type {HTMLElement} */ (active))
      })
    }

    /** @param {string} id */
    removeAnimTab(id) {
      if (this.session.animDefs.length <= 1) {
        this.setFooter('Keep at least one anim tab')
        return
      }
      this.stashUiIntoSlot()
      this.pushHistory('remove anim tab')
      const next = this.session.removeAnim(id)
      this.selectedTl = -1
      this.preview.stop()
      this.session.setActiveAnim(next)
      this.renderTabs()
      this.loadSlotIntoUi()
      this.updateHistoryButtons()
      this.setFooter('Removed anim tab')
    }

    switchAnim(id) {
      this.stashUiIntoSlot()
      this.session.setActiveAnim(id)
      this.selectedDetect = -1
      this.selectedDetects = []
      this.selectedTl = -1
      this.preview.stop()
      this.renderTabs()
      this.loadSlotIntoUi()
      this.updateHistoryButtons()
    }

    updateDetectStatus() {
      const el = $('detectStatus')
      if (!this.sheetView.sheetImg) {
        el.textContent = 'No sheet loaded'
        el.className = 'hint'
        return
      }
      const n = this.frames().length
      const used = this.slot().frameIds.length
      el.textContent = n
        ? `${n} frame${n === 1 ? '' : 's'} in pool · ${used} in this anim · ${this.sheetView.natural.w}×${this.sheetView.natural.h}`
        : 'No frames detected — tweak chroma/min size and Re-detect'
      el.className = n ? 'hint status-ok' : 'hint warn'
    }

    syncBoxNudge() {
      const multi = this.selectedDetects.length > 1
      ;['boxX', 'boxY', 'boxW', 'boxH', 'boxAnchorX', 'boxAnchorY'].forEach((id) => {
        const el = $(id)
        if (el) el.disabled = multi
      })
      const b = this.frames()[this.selectedDetect]
      if (!b || multi) {
        ;['boxX', 'boxY', 'boxW', 'boxH', 'boxAnchorX', 'boxAnchorY'].forEach((id) => {
          const el = $(id)
          if (el) el.value = ''
        })
        this.syncVertexLabel()
        return
      }
      $('boxX').value = String(b.x)
      $('boxY').value = String(b.y)
      $('boxW').value = String(b.w)
      $('boxH').value = String(b.h)
      const axEl = $('boxAnchorX')
      const ayEl = $('boxAnchorY')
      if (axEl) axEl.value = String(Math.round((b.anchorX != null ? b.anchorX : 0.5) * 100))
      if (ayEl) ayEl.value = String(Math.round((b.anchorY != null ? b.anchorY : 1) * 100))
      this.syncVertexLabel()
    }

    applyBoxFromInputs() {
      if (this.selectedDetects.length > 1) return
      if (this.selectedDetect < 0 || !this.frames()[this.selectedDetect]) return
      const x = +$('boxX').value
      const y = +$('boxY').value
      const w = +$('boxW').value
      const h = +$('boxH').value
      if (![x, y, w, h].every((n) => Number.isFinite(n))) return
      if (this.nudgeNeedsHistory) {
        this.pushHistory('nudge box')
        this.nudgeNeedsHistory = false
      }
      this.setDetectRect(this.selectedDetect, { x, y, w: Math.max(1, w), h: Math.max(1, h) })
      this.applyAnchorFromInput(false)
      this.syncSheetView()
      this.sheetView.draw()
      this.timelineView.render(this.resolvedTimeline(), this.selectedTl)
      this.refreshPreview()
      this.refreshExport()
    }

    applyAnchorFromInput(pushHist) {
      if (this.selectedDetects.length > 1) return
      const box = this.frames()[this.selectedDetect]
      const axEl = $('boxAnchorX')
      const ayEl = $('boxAnchorY')
      if (!box || !axEl || !ayEl) return
      const pctX = +axEl.value
      const pctY = +ayEl.value
      if (![pctX, pctY].every((n) => Number.isFinite(n))) return
      const ax = DetectBox.clamp01(pctX / 100, 0.5)
      const ay = DetectBox.clamp01(pctY / 100, 1)
      const curX = box.anchorX != null ? box.anchorX : 0.5
      const curY = box.anchorY != null ? box.anchorY : 1
      if (Math.abs(ax - curX) < 0.0005 && Math.abs(ay - curY) < 0.0005) return
      if (pushHist) this.pushHistory('move anchor')
      box.anchorX = ax
      box.anchorY = ay
      this.syncSheetView()
      this.sheetView.draw()
      this.timelineView.render(this.resolvedTimeline(), this.selectedTl)
      this.refreshPreview()
      this.refreshExport()
    }

    /** Arrow-key nudge for the selected detect box. Shift = 10px. */
    nudgeSelectedBox(dx, dy) {
      if (this.selectedDetects.length > 1) return false
      const box = this.frames()[this.selectedDetect]
      if (!box || (!dx && !dy)) return false
      const nat = this.sheetView.natural
      const maxX = Math.max(0, (nat.w || 0) - box.w)
      const maxY = Math.max(0, (nat.h || 0) - box.h)
      const nx = Math.max(0, Math.min(maxX, box.x + dx))
      const ny = Math.max(0, Math.min(maxY, box.y + dy))
      const adx = nx - box.x
      const ady = ny - box.y
      if (!adx && !ady) return false
      if (this.nudgeNeedsHistory) {
        this.pushHistory('nudge box')
        this.nudgeNeedsHistory = false
      }
      box.moveBy(adx, ady)
      this.syncBoxNudge()
      this.syncSheetView()
      this.sheetView.draw()
      this.timelineView.render(this.resolvedTimeline(), this.selectedTl)
      this.refreshPreview()
      this.refreshExport()
      return true
    }

    refreshPreview() {
      if (!this.preview) return
      const s = this.slot()
      const hide = this.sheetHasAlpha || !!$('hideChroma').checked
      const frames = this.resolvedTimeline()
      const getSource = () => this.sheetView.displaySource()
      s.syncDurationsLength()
      const durationsMs = frames.map((_, i) => s.durationAt(i))
      const sequence = s.playbackIndices()
      const opts = {
        fps: s.fps,
        loop: s.loop,
        direction: s.direction || 'forward',
        durationsMs,
        sequence,
        flipX: this.previewFlipX,
        onion: this.previewOnion,
        viewScale: this.previewScale,
      }
      this.preview.setAnim(frames, opts, getSource, hide)
      if (this.popoutOpen && this.popoutPreview) {
        this.popoutPreview.setAnim(
          frames,
          { ...opts, viewScale: Math.max(1, this.previewScale) },
          getSource,
          hide
        )
        this.popoutPreview.setBackground(this.preview.background)
      }
      if (this.preview.playing && frames.length) {
        this.preview.drawFrame(this.preview.frame)
      } else if (this.selectedTl >= 0 && frames[this.selectedTl]) {
        this.preview.frame = this.selectedTl
        this.preview.drawFrame(this.selectedTl)
      } else {
        this.preview.drawBase()
        this.preview.labelEl.textContent = 'frame —'
        this.preview._syncKeyedChrome()
      }
      if (this.popoutOpen && this.popoutPreview) {
        if (this.popoutPreview.playing && frames.length) {
          this.popoutPreview.drawFrame(this.popoutPreview.frame)
        } else if (this.selectedTl >= 0 && frames[this.selectedTl]) {
          this.popoutPreview.drawFrame(this.selectedTl)
        } else if (frames.length) {
          this.popoutPreview.drawFrame(0)
        } else {
          this.popoutPreview.drawBase()
          if (this.popoutPreview.labelEl) this.popoutPreview.labelEl.textContent = 'frame —'
          this.popoutPreview._syncKeyedChrome()
        }
        $('btnPopoutPlay').textContent = this.popoutPreview.playing ? 'Pause' : 'Play'
      }
      $('btnPlay').textContent = this.preview.playing ? 'Pause' : 'Play'
      this.syncTlDurationUi()
    }

    openPreviewPopout() {
      const frames = this.resolvedTimeline()
      if (!frames.length) {
        this.setFooter('Add frames to the timeline first')
        return
      }
      const el = $('previewPopout')
      if (!el) return
      el.hidden = false
      this.popoutOpen = true
      this.popoutPreview.setBackground(this.preview.background)
      const fpsEl = $('popoutFps')
      if (fpsEl) fpsEl.value = String(this.slot().fps || 6)
      this.refreshPreview()
      if (this.preview.playing) {
        this.popoutPreview.playing = false
        this.popoutPreview.play()
      } else {
        this.popoutPreview.stop()
        this.popoutPreview.drawFrame(
          this.selectedTl >= 0 && frames[this.selectedTl] ? this.selectedTl : 0
        )
      }
      $('btnPopoutPlay').textContent = this.popoutPreview.playing ? 'Pause' : 'Play'
      const { maxW, maxH } = Polygon.maxFrameBounds(frames)
      this.setFooter(`1:1 pop-out · ${maxW}×${maxH}px sprite bounds`)
    }

    closePreviewPopout() {
      const el = $('previewPopout')
      if (el) el.hidden = true
      this.popoutOpen = false
      if (this.popoutPreview) {
        this.popoutPreview.stop()
        this.popoutPreview.playing = false
      }
    }

    /**
     * Load a scenic backdrop into the preview (cover-fit), or clear.
     * @param {string} id empty | plains | forest | desert
     */
    setPreviewBackground(id) {
      const next = id || ''
      this.previewBgId = next
      const sel = $('previewBg')
      if (sel && sel.value !== next) sel.value = next
      if (!next) {
        this.preview.setBackground(null)
        if (this.popoutPreview) this.popoutPreview.setBackground(null)
        this.refreshPreview()
        return
      }
      const cached = this.previewBgCache[next]
      if (cached && cached.complete) {
        this.preview.setBackground(cached)
        if (this.popoutPreview) this.popoutPreview.setBackground(cached)
        this.refreshPreview()
        return
      }
      const img = new Image()
      img.onload = () => {
        this.previewBgCache[next] = img
        if (this.previewBgId !== next) return
        this.preview.setBackground(img)
        if (this.popoutPreview) this.popoutPreview.setBackground(img)
        this.refreshPreview()
      }
      img.onerror = () => {
        this.setFooter('Failed to load preview background: ' + next)
        this.preview.setBackground(null)
        if (this.popoutPreview) this.popoutPreview.setBackground(null)
        this.refreshPreview()
      }
      img.src = 'assets/preview-bg/' + next + '.jpg'
    }

    redrawAll(opts) {
      this.syncSheetView()
      this.sheetView.draw()
      this.timelineView.render(this.resolvedTimeline(), this.selectedTl, opts)
      this.syncBoxNudge()
      this.updateDetectStatus()
      this.refreshPreview()
      this.refreshExport()
      this.renderTabs()
      this.updateHistoryButtons()
    }

    buildExportObject() {
      this.stashUiIntoSlot()
      this.session.id = $('charId').value.trim() || 'character'
      if (this.exportProfile === 'godot') return ExportProfiles.godot(this.session)
      return ExportProfiles.generic(this.session)
    }

    refreshExport() {
      try {
        $('exportBox').value = JSON.stringify(this.buildExportObject(), null, 2)
      } catch (err) {
        $('exportBox').value = String(err)
      }
    }

    async getKeyedSourceForSlot() {
      if (this.sheetView.sheetImg) {
        return this.sheetView.displaySource()
      }
      const url = this.session.masterDataUrl
      if (!url) return null
      const img = await new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => resolve(image)
        image.onerror = () => reject(new Error('failed to load master sheet'))
        image.src = url
      })
      if (!$('hideChroma').checked && !this.sheetHasAlpha) return img
      if (this.sheetHasAlpha) return img
      this.readChromaFromUi()
      return this.chroma.keyToCanvas(img)
    }

    async downloadPack() {
      try {
        this.stashUiIntoSlot()
        this.session.id = $('charId').value.trim() || 'character'
        if (this.exportProfile === 'godot') {
          const src = await this.getKeyedSourceForSlot()
          if (!src) throw new Error('Load a sheet first')
          const blob = await SA.GodotPackExporter.buildZip(this.session, src)
          const id = this.session.id
          const a = document.createElement('a')
          a.href = URL.createObjectURL(blob)
          a.download = `${id}-godot.zip`
          a.click()
          URL.revokeObjectURL(a.href)
          this.setFooter(`Downloaded ${id}-godot.zip (sheet + onionlab.json + importer addon)`)
          return
        }
        const blob = await PackExporter.buildZip(this.session, () => this.getKeyedSourceForSlot())
        const id = this.session.id
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `${id}-png-pack.zip`
        a.click()
        URL.revokeObjectURL(a.href)
        this.setFooter(`Downloaded ${id}-png-pack.zip (baked PNGs + JSON with file refs)`)
      } catch (err) {
        this.setFooter('Pack failed: ' + err.message)
        alert(err.message)
      }
    }

    async downloadGif() {
      if (this._gifBusy) return
      const btn = $('btnDownloadGif')
      const prevLabel = btn ? btn.textContent : 'Download GIF'
      this._gifBusy = true
      if (btn) {
        btn.style.setProperty('--busy-min-w', `${Math.max(btn.offsetWidth, 88)}px`)
        btn.classList.add('is-busy')
        btn.disabled = true
        btn.setAttribute('aria-busy', 'true')
        btn.replaceChildren()
        const spin = document.createElement('span')
        spin.className = 'btn-spinner'
        spin.setAttribute('aria-hidden', 'true')
        btn.appendChild(spin)
      }
      const yieldUi = () =>
        new Promise((resolve) => {
          requestAnimationFrame(() => setTimeout(resolve, 0))
        })
      try {
        await yieldUi()
        this.stashUiIntoSlot()
        const s = this.slot()
        const frames = this.resolvedTimeline()
        if (!frames.length) throw new Error('Add frames to the timeline first')
        const src = await this.getKeyedSourceForSlot()
        if (!src) throw new Error('Load a sheet first')
        await yieldUi()
        const sequence = s.playbackIndices()
        const { maxW, maxH } = Polygon.maxFrameBounds(frames)
        const pad = 4
        const W = Math.max(1, maxW + pad * 2)
        const H = Math.max(1, maxH + pad * 2)
        const gifFrames = []
        for (let si = 0; si < sequence.length; si++) {
          if (si > 0) await yieldUi()
          const ti = sequence[si]
          const box = frames[ti]
          if (!box) continue
          const c = document.createElement('canvas')
          c.width = W
          c.height = H
          const ctx = c.getContext('2d', { willReadFrequently: true })
          ctx.imageSmoothingEnabled = false
          ctx.clearRect(0, 0, W, H)
          const { dx, dy, dw, dh } = Polygon.layoutFrame(
            box,
            1,
            W,
            H,
            'bottom-center',
            pad
          )
          Polygon.drawFrame(ctx, src, box, dx, dy, dw, dh)
          const imageData = ctx.getImageData(0, 0, W, H)
          const delayCs = Math.max(2, Math.round(s.durationAt(ti) / 10))
          gifFrames.push({
            width: W,
            height: H,
            data: imageData.data,
            delayCs,
          })
        }
        if (!gifFrames.length) throw new Error('No frames to encode')
        this.setFooter('Encoding GIF…')
        await yieldUi()
        const bytes = await SA.GifEncoder.encodeAsync(gifFrames, {
          loop: s.loop ? 0 : 1,
          transparent: true,
        })
        await yieldUi()
        const id = ($('charId').value.trim() || 'asset') + '-' + (s.id || 'anim')
        const blob = new Blob([bytes], { type: 'image/gif' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `${id}.gif`
        a.click()
        URL.revokeObjectURL(a.href)
        this.setFooter(`Downloaded ${id}.gif`)
      } catch (err) {
        this.setFooter('GIF failed: ' + err.message)
        alert(err.message)
      } finally {
        this._gifBusy = false
        if (btn) {
          btn.classList.remove('is-busy')
          btn.disabled = false
          btn.removeAttribute('aria-busy')
          btn.style.removeProperty('--busy-min-w')
          btn.textContent = prevLabel
        }
      }
    }

    stepPreview(delta) {
      this.preview.step(delta)
      this.selectedTl = this.preview.frame
      if (this.popoutOpen && this.popoutPreview) {
        this.popoutPreview.scrubTo(this.selectedTl)
      }
      this.timelineView.render(this.resolvedTimeline(), this.selectedTl, {
        scrollToSelected: true,
      })
      this.syncTlDurationUi()
      $('btnPlay').textContent = 'Play'
    }

    setFooter(msg) {
      $('footerStatus').textContent = msg || ''
    }

    syncZoomLabel() {
      const el = $('btnZoomLabel')
      if (el) el.textContent = this.sheetView.zoomLabel()
    }

    // ── File / session ─────────────────────────────────────────────────────
    loadImageFile(file) {
      if (!file) return
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = /** @type {string} */ (reader.result)
        const img = new Image()
        img.onload = () => {
          this.pushHistory('load sheet')
          this.session.masterDataUrl = dataUrl
          this._loadedMasterUrl = dataUrl
          this.session.masterSheetName = file.name
          $('sheetName').value = this.session.masterSheetName
          this.sheetView.setImage(img)
          // New sheet → one fresh anim tab + empty pool
          this.session.frames = []
          this.session.resetAnimsToDefault()
          this.selectedDetect = -1
          this.selectedDetects = []
          this.selectedTl = -1
          this.selectedVertex = -1
          const hasAlpha = ChromaKey.imageHasAlpha(img)
          this.setSheetAlphaMode(hasAlpha)
          let chromaOk = false
          if (!hasAlpha) {
            chromaOk = this.autoDetectChroma(img)
          }
          this.runDetect(false)
          this.renderTabs()
          this.loadSlotIntoUi()
          this.setFooter(
            hasAlpha
              ? `Loaded ${file.name} · native transparency · chroma off · 1 anim tab`
              : chromaOk
                ? `Loaded ${file.name} · 1 anim tab · chroma auto rgb(${$('chromaR').value},${$('chromaG').value},${$('chromaB').value})`
                : `Loaded ${file.name} · 1 anim tab · re-detected frames`
          )
        }
        img.src = dataUrl
      }
      reader.readAsDataURL(file)
    }

    saveSession() {
      this.stashUiIntoSlot()
      const payload = {
        ...this.session.toSerializable(),
        chroma: this.chroma.toJSON(),
        minW: +$('minW').value,
        minH: +$('minH').value,
        mergeGap: +$('mergeGap').value,
        bridge: $('bridge') ? +$('bridge').value : 2,
        boxPad: +$('boxPad').value,
        hideChroma: !!$('hideChroma').checked,
        sheetHasAlpha: this.sheetHasAlpha,
        previewBg: this.previewBgId || '',
        previewOnion: this.previewOnion,
        previewFlipX: this.previewFlipX,
        previewScale: this.previewScale,
        previewPaneW: this.previewPaneW,
        exportProfile: this.exportProfile,
      }
      this.store.save(payload)
      this.setFooter('Session saved')
    }

    loadSession() {
      try {
        const data = this.store.load()
        if (!data) throw new Error('No saved session')
        this.applySession(data)
        this.setFooter('Session restored')
      } catch (err) {
        this.setFooter('Load failed: ' + err.message)
      }
    }

    applySession(data) {
      this.session = new CharacterSession({
        id: data.charId,
        animDefs: data.animDefs,
      })
      $('charId').value = this.session.id
      if (data.chroma) {
        $('chromaR').value = data.chroma.r
        $('chromaG').value = data.chroma.g
        $('chromaB').value = data.chroma.b
        $('chromaTol').value = data.chroma.tol
        this.syncChromaColorUi()
      }
      if (data.minW != null) $('minW').value = data.minW
      if (data.minH != null) $('minH').value = data.minH
      if (data.mergeGap != null) $('mergeGap').value = data.mergeGap
      if (data.bridge != null && $('bridge')) $('bridge').value = data.bridge
      if (data.boxPad != null) $('boxPad').value = data.boxPad
      if (data.hideChroma != null) $('hideChroma').checked = !!data.hideChroma
      this.session.loadFromSerializable(data)
      this._loadedMasterUrl = null
      this.selectedDetect = -1
      this.selectedDetects = []
      this.selectedTl = -1
      // Alpha mode applied when master image finishes loading
      if (data.sheetHasAlpha != null) {
        this.setSheetAlphaMode(!!data.sheetHasAlpha)
      }
      if (data.previewBg != null) {
        this.setPreviewBackground(String(data.previewBg || ''))
      }
      if (data.previewOnion != null) {
        this.previewOnion = !!data.previewOnion
        if ($('previewOnion')) $('previewOnion').checked = this.previewOnion
      }
      if (data.previewFlipX != null) {
        this.previewFlipX = !!data.previewFlipX
        if ($('previewFlipX')) $('previewFlipX').checked = this.previewFlipX
      }
      if (data.previewScale != null) {
        this.previewScale = Math.max(0.5, Math.min(8, +data.previewScale || 1))
        this.syncPreviewZoomLabel()
      }
      if (data.previewPaneW != null) {
        this.applyPreviewPaneWidth(data.previewPaneW)
      }
      if (data.exportProfile && $('exportProfile')) {
        const profile =
          data.exportProfile === 'mistwood' ? 'generic' : data.exportProfile
        $('exportProfile').value = profile
        this.exportProfile = profile
        this.syncExportProfileUi()
      }
      this.renderTabs()
      this.loadSlotIntoUi()
    }

    importCharacterJson(text) {
      const parsed = JSON.parse(text)
      let id = $('charId').value.trim()
      let entry = parsed[id]
      if (!entry) {
        const keys = Object.keys(parsed)
        if (keys.length === 1) {
          id = keys[0]
          entry = parsed[id]
          $('charId').value = id
        } else if (parsed.anims) {
          entry = parsed
        } else {
          throw new Error('Could not find character entry in JSON')
        }
      }
      this.session.id = id
      const sharedSheet = entry.sheet || ''
      if (sharedSheet) {
        this.session.masterSheetName = sharedSheet
        $('sheetName').value = sharedSheet
      }
      this.session.frames = []
      const anims = entry.anims || {}
      const animIds = Object.keys(anims)
      if (!animIds.length) throw new Error('No anims in JSON')
      const defs = animIds.map((aid) => {
        const a = anims[aid] || {}
        return {
          id: aid,
          label: a.label || aid,
          fps: a.fps != null ? a.fps : 8,
          loop: a.loop != null ? !!a.loop : true,
        }
      })
      this.session.rebuildAnims(defs)
      for (const d of this.session.animDefs) {
        const a = anims[d.id]
        if (!a) continue
        const s = this.session.slots[d.id]
        if (a.sheet && a.sheet !== sharedSheet) s.sheetName = a.sheet
        else s.sheetName = ''
        s.fps = a.fps != null ? a.fps : s.fps
        s.loop = a.loop != null ? !!a.loop : s.loop
        const ids = []
        for (const f of a.frames || []) {
          ids.push(this.session.ensureFrameFromGeometry(f))
        }
        s.setFrameIds(ids)
      }
      this.session.sortFramesRowMajor()
      this.session.setActiveAnim(
        this.session.animDefs.find((d) => this.session.slots[d.id].frameIds.length)?.id ||
          this.session.firstAnimId()
      )
      this.renderTabs()
      this.loadSlotIntoUi()
      this.setFooter(`Imported ${id} — load master sheet PNG to preview`)
    }

    // ── Bindings ───────────────────────────────────────────────────────────
    bindUi() {
      on($('dropZone'), 'click', () => $('fileInput').click())
      on($('fileInput'), 'change', () => {
        const f = $('fileInput').files && $('fileInput').files[0]
        this.loadImageFile(f)
        $('fileInput').value = ''
      })
      ;['dragenter', 'dragover'].forEach((t) => {
        on($('dropZone'), t, (e) => {
          e.preventDefault()
          $('dropZone').classList.add('drag')
        })
      })
      ;['dragleave', 'drop'].forEach((t) => {
        on($('dropZone'), t, (e) => {
          e.preventDefault()
          $('dropZone').classList.remove('drag')
        })
      })
      on($('dropZone'), 'drop', (e) => {
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
        this.loadImageFile(f)
      })

      on($('btnDetect'), 'click', () => this.runDetect(true))
      on($('btnZoomIn'), 'click', () => {
        this.sheetView.zoomIn()
        this.syncZoomLabel()
      })
      on($('btnZoomOut'), 'click', () => {
        this.sheetView.zoomOut()
        this.syncZoomLabel()
      })
      on($('btnZoomLabel'), 'click', () => {
        this.sheetView.zoomReset()
        this.syncZoomLabel()
      })
      on($('btnZoomFit'), 'click', () => {
        this.sheetView.zoomFit()
        this.syncZoomLabel()
      })
      on($('hideChroma'), 'change', () => {
        if (this.sheetHasAlpha) {
          $('hideChroma').checked = true
          return
        }
        this.sheetView.keyedDirty = true
        this.redrawAll()
      })
      on($('chromaColor'), 'input', () => {
        if (this.sheetHasAlpha) return
        const rgb = hexToRgb($('chromaColor').value)
        if (!rgb) return
        this.setChromaRgb(rgb.r, rgb.g, rgb.b)
      })
      on($('btnPickChroma'), 'click', () => {
        if (this.sheetHasAlpha) {
          this.setFooter('Chroma pick disabled — sheet has native transparency')
          return
        }
        if (!this.sheetView.sheetImg) {
          this.setFooter('Load a sheet first')
          return
        }
        this.setPickChromaMode(!this.pickChromaMode)
      })
      ;['chromaR', 'chromaG', 'chromaB', 'chromaTol'].forEach((id) => {
        on($(id), 'change', () => {
          if (this.sheetHasAlpha) return
          if (id.startsWith('chroma') && id !== 'chromaTol') this.syncChromaColorUi()
          this.sheetView.keyedDirty = true
          this.redrawAll()
        })
        if (id === 'chromaR' || id === 'chromaG' || id === 'chromaB') {
          on($(id), 'input', () => {
            if (this.sheetHasAlpha) return
            this.syncChromaColorUi()
          })
        }
      })
      ;['minW', 'minH', 'mergeGap', 'bridge', 'boxPad'].forEach((id) => {
        on($(id), 'change', () => {
          if (!this.sheetView.sheetImg) return
          this.pushHistory('detect settings')
          this.runDetect(false)
        })
      })

      on($('sheetName'), 'input', () => {
        this.session.masterSheetName = $('sheetName').value.trim()
        this.refreshExport()
      })
      on($('animFps'), 'input', () => {
        const fps = Math.max(1, Math.min(60, +$('animFps').value || 6))
        this.slot().fps = fps
        const pop = $('popoutFps')
        if (pop) pop.value = String(fps)
        this.refreshPreview()
        this.refreshExport()
      })
      on($('animLoop'), 'change', () => {
        this.slot().loop = $('animLoop').checked
        this.refreshPreview()
        this.refreshExport()
      })
      on($('animDirection'), 'change', () => {
        this.slot().direction = $('animDirection').value || 'forward'
        this.refreshPreview()
        this.refreshExport()
      })
      on($('btnApplyFps'), 'click', () => {
        this.pushHistory('apply fps durations')
        this.slot().applyFpsToAllDurations()
        this.syncTlDurationUi()
        this.refreshPreview()
        this.refreshExport()
        this.setFooter('Cleared per-frame holds — using anim FPS')
      })
      on($('tlDurationMs'), 'change', () => this.applyTlDurationFromUi())
      on($('tlDurationMs'), 'input', () => this.applyTlDurationFromUi())
      ;['charId'].forEach((id) => {
        on($(id), 'input', () => this.refreshExport())
        on($(id), 'change', () => this.refreshExport())
      })

      on($('btnAddAll'), 'click', () => {
        this.pushHistory('add all frames')
        for (const b of this.frames()) {
          this.slot().appendFrame(b.id)
        }
        this.selectedTl = this.slot().frameIds.length - 1
        this.redrawAll({ scrollToSelected: true })
        this.syncTlDurationUi()
        this.setFooter('Added all pool boxes (re-run to append another pass)')
      })
      on($('btnAppendReverse'), 'click', () => this.appendTimelineReverse())
      on($('btnClearTl'), 'click', () => {
        this.pushHistory('clear timeline')
        this.slot().setFrameIds([])
        this.selectedTl = -1
        this.redrawAll()
        this.syncTlDurationUi()
      })
      on($('btnDup'), 'click', () => {
        const slot = this.slot()
        const ids = slot.frameIds
        if (this.selectedTl < 0 || ids[this.selectedTl] == null) return
        this.pushHistory('duplicate timeline frame')
        slot.syncDurationsLength()
        ids.splice(this.selectedTl + 1, 0, ids[this.selectedTl])
        slot.frameDurationsMs.splice(
          this.selectedTl + 1,
          0,
          slot.frameDurationsMs[this.selectedTl]
        )
        this.selectedTl++
        this.redrawAll({ scrollToSelected: true })
        this.syncTlDurationUi()
        this.setFooter(`Duplicated slot → pool #${ids[this.selectedTl]} again`)
      })
      on($('btnDel'), 'click', () => {
        const slot = this.slot()
        const ids = slot.frameIds
        if (this.selectedTl < 0) return
        this.pushHistory('delete timeline frame')
        slot.syncDurationsLength()
        ids.splice(this.selectedTl, 1)
        slot.frameDurationsMs.splice(this.selectedTl, 1)
        if (this.selectedTl >= ids.length) this.selectedTl = ids.length - 1
        this.redrawAll()
        this.syncTlDurationUi()
      })

      ;['boxX', 'boxY', 'boxW', 'boxH'].forEach((id) => {
        on($(id), 'input', () => this.applyBoxFromInputs())
        on($(id), 'change', () => this.applyBoxFromInputs())
        on($(id), 'focus', () => {
          this.nudgeNeedsHistory = true
        })
        on($(id), 'blur', () => {
          this.nudgeNeedsHistory = true
        })
      })
      on($('boxAnchorX'), 'input', () => {
        const push = this.nudgeNeedsHistory
        if (push) this.nudgeNeedsHistory = false
        this.applyAnchorFromInput(push)
      })
      on($('boxAnchorY'), 'input', () => {
        const push = this.nudgeNeedsHistory
        if (push) this.nudgeNeedsHistory = false
        this.applyAnchorFromInput(push)
      })
      on($('boxAnchorX'), 'change', () => this.applyAnchorFromInput(false))
      on($('boxAnchorY'), 'change', () => this.applyAnchorFromInput(false))
      ;['boxAnchorX', 'boxAnchorY'].forEach((id) => {
        on($(id), 'focus', () => {
          this.nudgeNeedsHistory = true
        })
      })
      on($('btnResetAnchor'), 'click', () => {
        if (this.selectedDetects.length > 1) {
          this.setFooter('Select a single box to edit anchor')
          return
        }
        const box = this.frames()[this.selectedDetect]
        if (!box) return
        this.pushHistory('center anchor')
        box.anchorX = 0.5
        box.anchorY = 1
        this.syncBoxNudge()
        this.redrawAll()
      })
      on($('btnSnapAnchorBottom'), 'click', () => {
        if (this.selectedDetects.length > 1) {
          this.setFooter('Select a single box to edit anchor')
          return
        }
        const box = this.frames()[this.selectedDetect]
        if (!box) return
        this.pushHistory('snap anchor bottom')
        box.anchorY = 1
        this.syncBoxNudge()
        this.redrawAll()
      })

      on($('btnResetShape'), 'click', () => this.resetSelectedShape())
      on($('btnAddPoint'), 'click', () => {
        this.setFooter('Alt+click a polygon edge to insert a vertex')
      })

      on($('btnAddSelected'), 'click', () => {
        if (this.selectedDetects.length > 1) {
          this.pushHistory('add boxes to timeline')
          for (const i of this.selectedDetects) {
            const b = this.frames()[i]
            if (b) this.slot().appendFrame(b.id)
          }
          this.selectedTl = this.slot().frameIds.length - 1
          this.redrawAll({ scrollToSelected: true })
          this.syncTlDurationUi()
          this.setFooter(`Added ${this.selectedDetects.length} boxes to timeline`)
          return
        }
        const b = this.frames()[this.selectedDetect]
        if (!b) return
        this.appendTimelineBox(b)
      })
      on($('btnSnapDetect'), 'click', () => this.snapSelected())
      ;['btnUndo', 'btnUndo2'].forEach((id) => on($(id), 'click', () => this.undo()))
      ;['btnRedo', 'btnRedo2'].forEach((id) => on($(id), 'click', () => this.redo()))

      on($('btnDupDetect'), 'click', () => {
        if (this.selectedDetects.length > 1) {
          this.setFooter('Select a single box to duplicate')
          return
        }
        const src = this.frames()[this.selectedDetect]
        if (!src) {
          this.setFooter('Select a detect box first')
          return
        }
        const gap = Math.max(2, +$('mergeGap').value || 2)
        this.insertDetectBox({
          x: src.x + src.w + gap,
          y: src.y,
          w: src.w,
          h: src.h,
        })
      })
      on($('btnSplitDetect'), 'click', () => {
        if (this.selectedDetects.length > 1) {
          this.setFooter('Select a single box to split')
          return
        }
        const src = this.frames()[this.selectedDetect]
        if (!src) {
          this.setFooter('Select a detect box first')
          return
        }
        if (src.w < 8) {
          this.setFooter('Box too narrow to split')
          return
        }
        this.pushHistory('split box')
        const leftW = Math.floor(src.w / 2)
        const rightW = src.w - leftW
        this.setDetectRect(this.selectedDetect, { x: src.x, y: src.y, w: leftW, h: src.h }, src.id)
        const added = DetectBox.from(
          { x: src.x + leftW, y: src.y, w: rightW, h: src.h },
          () => this.session.allocDetectId()
        )
        this.session.frames.splice(this.selectedDetect + 1, 0, added)
        this.selectedDetect = this.selectedDetect + 1
        this.reindexFrames(added)
      })
      on($('btnNewDetect'), 'click', () => {
        if (!this.sheetView.sheetImg) {
          this.setFooter('Load a sheet first')
          return
        }
        const w = Math.max(24, +$('minW').value || 24)
        const h = Math.max(24, +$('minH').value || 24)
        const base = this.frames()[this.selectedDetect]
        this.insertDetectBox({
          x: base ? base.x + base.w + 4 : 8,
          y: base ? base.y : 8,
          w,
          h,
        })
      })
      on($('btnDelDetect'), 'click', () => this.deleteSelectedDetects())

      on($('btnPlay'), 'click', () => {
        this.preview.play()
        $('btnPlay').textContent = this.preview.playing ? 'Pause' : 'Play'
      })
      on($('btnStop'), 'click', () => {
        this.preview.stop()
        this.selectedTl = this.preview.frame
        this.timelineView.render(this.resolvedTimeline(), this.selectedTl)
        this.refreshPreview()
      })
      on($('btnPrevFrame'), 'click', () => this.stepPreview(-1))
      on($('btnNextFrame'), 'click', () => this.stepPreview(1))
      on($('btnPopout'), 'click', () => this.openPreviewPopout())
      on($('btnPopoutClose'), 'click', () => this.closePreviewPopout())
      on($('btnPopoutPlay'), 'click', () => {
        if (!this.popoutOpen) return
        this.popoutPreview.play()
        $('btnPopoutPlay').textContent = this.popoutPreview.playing ? 'Pause' : 'Play'
      })
      on($('btnPopoutStop'), 'click', () => {
        if (!this.popoutOpen) return
        this.popoutPreview.stop()
        this.selectedTl = this.popoutPreview.frame
        this.refreshPreview()
      })
      on($('btnPopoutPrev'), 'click', () => {
        if (!this.popoutOpen) return
        this.popoutPreview.step(-1)
        this.selectedTl = this.popoutPreview.frame
        this.preview.scrubTo(this.selectedTl)
        this.timelineView.render(this.resolvedTimeline(), this.selectedTl, {
          scrollToSelected: true,
        })
        this.syncTlDurationUi()
      })
      on($('btnPopoutNext'), 'click', () => {
        if (!this.popoutOpen) return
        this.popoutPreview.step(1)
        this.selectedTl = this.popoutPreview.frame
        this.preview.scrubTo(this.selectedTl)
        this.timelineView.render(this.resolvedTimeline(), this.selectedTl, {
          scrollToSelected: true,
        })
        this.syncTlDurationUi()
      })
      on($('popoutFps'), 'input', () => {
        const fps = Math.max(1, Math.min(60, +$('popoutFps').value || 6))
        this.slot().fps = fps
        $('animFps').value = String(fps)
        this.preview.fps = fps
        if (this.popoutPreview) this.popoutPreview.fps = fps
        this.refreshPreview()
        this.refreshExport()
      })
      on($('previewPopout'), 'click', (ev) => {
        if (ev.target === $('previewPopout')) this.closePreviewPopout()
      })
      on($('previewBg'), 'change', () => {
        this.setPreviewBackground($('previewBg').value)
      })
      on($('previewOnion'), 'change', () => {
        this.previewOnion = !!$('previewOnion').checked
        this.refreshPreview()
      })
      on($('previewFlipX'), 'change', () => {
        this.previewFlipX = !!$('previewFlipX').checked
        this.refreshPreview()
      })
      on($('btnPreviewZoomIn'), 'click', () => this.nudgePreviewZoom(1))
      on($('btnPreviewZoomOut'), 'click', () => this.nudgePreviewZoom(-1))
      on($('btnPreviewZoomLabel'), 'click', () => this.setPreviewZoom(1))
      const stage = $('previewStage')
      if (stage) {
        on(stage, 'wheel', (ev) => {
          if (!ev.ctrlKey && !ev.metaKey) return
          ev.preventDefault()
          this.nudgePreviewZoom(ev.deltaY > 0 ? -1 : 1)
        })
        on(stage, 'mousedown', (ev) => {
          if (!this.previewPanMode || ev.button !== 0) return
          ev.preventDefault()
          this.previewSpacePan = {
            startX: ev.clientX,
            startY: ev.clientY,
            scrollLeft: stage.scrollLeft,
            scrollTop: stage.scrollTop,
          }
          stage.classList.add('panning-drag')
        })
        on(window, 'mousemove', (ev) => {
          if (!this.previewSpacePan) return
          const p = this.previewSpacePan
          stage.scrollLeft = p.scrollLeft - (ev.clientX - p.startX)
          stage.scrollTop = p.scrollTop - (ev.clientY - p.startY)
        })
        const endPreviewPan = () => {
          if (!this.previewSpacePan) return
          this.previewSpacePan = null
          stage.classList.remove('panning-drag')
        }
        on(window, 'mouseup', endPreviewPan)
        on(window, 'blur', endPreviewPan)
      }
      this.syncPreviewZoomLabel()

      on($('btnExport'), 'click', async () => {
        this.refreshExport()
        try {
          await navigator.clipboard.writeText($('exportBox').value)
          this.setFooter('Copied export JSON')
        } catch {
          $('exportBox').select()
          this.setFooter('Clipboard blocked — select & copy manually')
        }
      })
      on($('btnDownload'), 'click', () => {
        this.refreshExport()
        const id = $('charId').value.trim() || 'character'
        const blob = new Blob([$('exportBox').value], { type: 'application/json' })
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download =
          this.exportProfile === 'godot' ? `${id}.onionlab.json` : `${id}.anims.json`
        a.click()
        URL.revokeObjectURL(a.href)
        this.setFooter(`Downloaded ${a.download}`)
      })
      on($('btnDownloadPack'), 'click', () => this.downloadPack())
      on($('btnDownloadGif'), 'click', () => {
        void this.downloadGif()
      })
      on($('btnSaveSession'), 'click', () => this.saveSession())
      on($('btnLoadSession'), 'click', () => this.loadSession())
      on($('btnImport'), 'click', () => {
        const text = prompt('Paste character JSON (full { id: {...} } or anims object)')
        if (!text) return
        try {
          this.importCharacterJson(text)
          this.refreshExport()
        } catch (err) {
          this.setFooter('Import failed: ' + err.message)
          alert(err.message)
        }
      })

      const profile = $('exportProfile')
      if (profile) {
        on(profile, 'change', () => {
          this.exportProfile = profile.value
          this.syncExportProfileUi()
          this.refreshExport()
        })
      }

      window.addEventListener('keydown', (ev) => {
        const tag = (ev.target && /** @type {HTMLElement} */ (ev.target).tagName) || ''
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
        if (ev.code === 'Space') {
          if (ev.repeat) {
            ev.preventDefault()
            return
          }
          ev.preventDefault()
          this.sheetView.setPanMode(true)
          this.setPreviewPanMode(true)
        } else if ((ev.key === 'p' || ev.key === 'P') && !ev.ctrlKey && !ev.metaKey) {
          ev.preventDefault()
          $('btnPlay').click()
        } else if (ev.key === 'Escape') {
          if (this.popoutOpen) {
            ev.preventDefault()
            this.closePreviewPopout()
          } else if (this.pickChromaMode) {
            ev.preventDefault()
            this.setPickChromaMode(false)
            this.setFooter('Chroma pick cancelled')
          } else if (this.selectedDetects.length || this.selectedDetect >= 0) {
            ev.preventDefault()
            this.clearDetectSelection()
            this.setFooter('Selection cleared')
          }
        } else if (
          ev.key === 'ArrowLeft' ||
          ev.key === 'ArrowRight' ||
          ev.key === 'ArrowUp' ||
          ev.key === 'ArrowDown'
        ) {
          if (this.selectedDetects.length > 1) return
          if (this.selectedDetect < 0 || !this.frames()[this.selectedDetect]) return
          ev.preventDefault()
          const step = ev.shiftKey ? 10 : 1
          let dx = 0
          let dy = 0
          if (ev.key === 'ArrowLeft') dx = -step
          else if (ev.key === 'ArrowRight') dx = step
          else if (ev.key === 'ArrowUp') dy = -step
          else if (ev.key === 'ArrowDown') dy = step
          this.nudgeSelectedBox(dx, dy)
        } else if (ev.key === 'Delete' || ev.key === 'Backspace') {
          ev.preventDefault()
          if (this.selectedDetects.length <= 1 && this.deleteSelectedVertex()) return
          if (
            this.selectedDetects.length > 0 ||
            (this.selectedDetect >= 0 && this.frames()[this.selectedDetect])
          ) {
            this.deleteSelectedDetects()
          } else {
            $('btnDel').click()
          }
        } else if (ev.key === 'z' || ev.key === 'Z') {
          ev.preventDefault()
          this.undo()
        } else if (ev.key === 'r' || ev.key === 'R') {
          ev.preventDefault()
          this.redo()
        } else if (ev.key === 's' || ev.key === 'S') {
          ev.preventDefault()
          this.snapSelected()
        } else if (ev.key === 'Enter' || ev.key === 'a' || ev.key === 'A') {
          ev.preventDefault()
          $('btnAddSelected').click()
        } else if ((ev.key === '=' || ev.key === '+') && (ev.ctrlKey || ev.metaKey)) {
          ev.preventDefault()
          this.sheetView.zoomIn()
          this.syncZoomLabel()
        } else if ((ev.key === '-' || ev.key === '_') && (ev.ctrlKey || ev.metaKey)) {
          ev.preventDefault()
          this.sheetView.zoomOut()
          this.syncZoomLabel()
        } else if (ev.key === '0' && (ev.ctrlKey || ev.metaKey)) {
          ev.preventDefault()
          this.sheetView.zoomReset()
          this.syncZoomLabel()
        }
      })

      window.addEventListener('keyup', (ev) => {
        if (ev.code === 'Space') {
          this.sheetView.setPanMode(false)
          this.setPreviewPanMode(false)
        }
        if (
          ev.key === 'ArrowLeft' ||
          ev.key === 'ArrowRight' ||
          ev.key === 'ArrowUp' ||
          ev.key === 'ArrowDown'
        ) {
          this.nudgeNeedsHistory = true
        }
      })

      window.addEventListener('blur', () => {
        this.sheetView.setPanMode(false)
        this.setPreviewPanMode(false)
      })
    }
  }

  SA.AnimStudioApp = AnimStudioApp
})(window.SpriteAnim)
