(function (SA) {
  class FrameBaker {
    /**
     * @param {CanvasImageSource} source keyed or raw sheet
     * @param {{ x:number,y:number,w:number,h:number,points?:number[][] }} frame
     * @returns {HTMLCanvasElement}
     */
    static bake(source, frame) {
      const w = Math.max(1, frame.w | 0)
      const h = Math.max(1, frame.h | 0)
      const c = document.createElement('canvas')
      c.width = w
      c.height = h
      const ctx = c.getContext('2d')
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, w, h)
      const points = frame.points && frame.points.length >= 3
        ? frame.points
        : SA.Polygon.rectPoints(w, h)
      ctx.save()
      SA.Polygon.buildPath(ctx, points, 0, 0, 1)
      ctx.clip()
      ctx.drawImage(source, frame.x, frame.y, w, h, 0, 0, w, h)
      ctx.restore()
      return c
    }

    /**
     * @param {HTMLCanvasElement} canvas
     * @returns {Promise<Blob>}
     */
    static toBlob(canvas) {
      return new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
      })
    }
  }

  SA.FrameBaker = FrameBaker
})(window.SpriteAnim)
