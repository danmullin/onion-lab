/**
 * Rebuild GodotPackExporter.js ADDON_FILES from godot/addons sources.
 * Run: node tools/_embed_godot_addon.js
 */
const fs = require('fs')
const path = require('path')
const root = path.join(__dirname, '..')
const addonDir = path.join(root, 'godot', 'addons', 'onion_lab_importer')
const files = {
  'addons/onion_lab_importer/plugin.cfg': 'plugin.cfg',
  'addons/onion_lab_importer/plugin.gd': 'plugin.gd',
  'addons/onion_lab_importer/onion_import.gd': 'onion_import.gd',
  'addons/onion_lab_importer/README.md': 'README.md',
}
const entries = []
for (const [zipPath, name] of Object.entries(files)) {
  const text = fs.readFileSync(path.join(addonDir, name), 'utf8')
  entries.push(`    ${JSON.stringify(zipPath)}: ${JSON.stringify(text)}`)
}
const out = `(function (SA) {
  /** Embedded Godot 4 addon sources so file:// zip export works offline. */
  const ADDON_FILES = {
${entries.join(',\n')}
  }

  class GodotPackExporter {
    /**
     * Zip: sheet PNG + onionlab.json + Godot 4 addon.
     * @param {*} session
     * @param {CanvasImageSource} sheetSource display/keyed sheet
     */
    static async buildZip(session, sheetSource) {
      const ZipWriter = SA.ZipWriter
      const charId = session.id || 'asset'
      const sheetName = session.masterSheetName || \`\${charId}.png\`
      const zip = new ZipWriter()
      const enc = new TextEncoder()

      const img = sheetSource
      const iw =
        /** @type {any} */ (img).naturalWidth || /** @type {any} */ (img).width || 0
      const ih =
        /** @type {any} */ (img).naturalHeight || /** @type {any} */ (img).height || 0
      if (!iw || !ih) throw new Error('No sheet image to export')
      const c = document.createElement('canvas')
      c.width = iw
      c.height = ih
      const ctx = c.getContext('2d')
      ctx.imageSmoothingEnabled = false
      ctx.clearRect(0, 0, iw, ih)
      ctx.drawImage(img, 0, 0)
      const blob = await SA.FrameBaker.toBlob(c)
      await zip.addBlob(sheetName, blob)

      const meta = SA.ExportProfiles.godot(session)
      meta.texture = sheetName
      zip.add(\`\${charId}.onionlab.json\`, enc.encode(JSON.stringify(meta, null, 2)))

      for (const [p, text] of Object.entries(ADDON_FILES)) {
        zip.add(p, enc.encode(text))
      }

      zip.add(
        'README-GODOT.txt',
        enc.encode(
          'Onion Lab → Godot 4 pack\\n\\n' +
            '1. Copy addons/onion_lab_importer into your Godot project res://addons/\\n' +
            '2. Enable the plugin in Project Settings → Plugins\\n' +
            '3. Place ' +
            sheetName +
            ' and ' +
            charId +
            '.onionlab.json in the same res:// folder\\n' +
            '4. Project → Tools → Onion Lab: Import JSON…\\n'
        )
      )

      return zip.build()
    }
  }

  SA.GodotPackExporter = GodotPackExporter
})(window.SpriteAnim)
`
fs.writeFileSync(path.join(root, 'js', 'io', 'GodotPackExporter.js'), out)
console.log('Wrote GodotPackExporter.js')
