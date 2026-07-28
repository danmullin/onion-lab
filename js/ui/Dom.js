(function (SA) {
  function $(id) {
    return document.getElementById(id)
  }

  function on(el, event, handler) {
    if (!el) return
    el.addEventListener(event, handler)
  }

  function rgbToHex(r, g, b) {
    return (
      '#' +
      [r, g, b]
        .map((v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0'))
        .join('')
    )
  }

  function hexToRgb(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '')
    if (!m) return null
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
  }

  SA.$ = $
  SA.on = on
  SA.rgbToHex = rgbToHex
  SA.hexToRgb = hexToRgb
})(window.SpriteAnim)
