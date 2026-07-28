(function (SA) {
  /**
   * Export JSON shapes for different games / pipelines.
   */
  class ExportProfiles {
    /** @param {*} session */
    static generic(session) {
      const master = session.masterSheetName || ''
      const anims = {}
      for (const d of session.animDefs) {
        const s = session.slots[d.id]
        if (!s.frameIds.length && !s.sheetName) continue
        const anim = s.toExportAnim(session, false, master)
        if (master && (!s.sheetName || s.sheetName === master)) {
          delete anim.sheet
        }
        anims[d.id] = anim
      }
      return {
        name: session.id,
        sheet: master || undefined,
        anims,
      }
    }

    /**
     * Godot 4 metadata companion for AnimatedSprite2D / SpriteFrames importer.
     * @param {*} session
     */
    static godot(session) {
      const master = session.masterSheetName || `${session.id || 'asset'}.png`
      const animations = {}
      for (const d of session.animDefs) {
        const s = session.slots[d.id]
        if (!s.frameIds.length) continue
        const frames = []
        for (let i = 0; i < s.frameIds.length; i++) {
          const box = session.frameById(s.frameIds[i])
          if (!box) continue
          frames.push({
            region: { x: box.x, y: box.y, w: box.w, h: box.h },
            duration: +(s.durationAt(i) / 1000).toFixed(4),
            pivot: {
              ax: box.anchorX != null ? box.anchorX : 0.5,
              ay: box.anchorY != null ? box.anchorY : 1,
            },
            points: box.points && box.points.length >= 3 ? SA.Polygon.clone(box.points) : undefined,
          })
        }
        if (!frames.length) continue
        animations[d.id] = {
          label: d.label || s.label || d.id,
          loop: !!s.loop,
          direction: s.direction || 'forward',
          fps: s.fps,
          frames,
        }
      }
      return {
        onion_lab: 1,
        godot: 4,
        name: session.id || 'asset',
        texture: master,
        animations,
      }
    }
  }

  SA.ExportProfiles = ExportProfiles
})(window.SpriteAnim)
