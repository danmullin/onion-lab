(function (SA) {
  /** Embedded Godot 4 addon sources so file:// zip export works offline. */
  const ADDON_FILES = {
    "addons/onion_lab_importer/plugin.cfg": "[plugin]\r\n\r\nname=\"Onion Lab Importer\"\r\ndescription=\"Import Onion Lab .onionlab.json + sheet PNG into SpriteFrames for AnimatedSprite2D.\"\r\nauthor=\"Onion Lab\"\r\nversion=\"1.0\"\r\nscript=\"plugin.gd\"\r\n",
    "addons/onion_lab_importer/plugin.gd": "@tool\r\nextends EditorPlugin\r\n\r\nconst IMPORTER := preload(\"res://addons/onion_lab_importer/onion_import.gd\")\r\n\r\nfunc _enter_tree() -> void:\r\n\tadd_tool_menu_item(\"Onion Lab: Import JSON…\", _on_import_menu)\r\n\r\n\r\nfunc _exit_tree() -> void:\r\n\tremove_tool_menu_item(\"Onion Lab: Import JSON…\")\r\n\r\n\r\nfunc _on_import_menu() -> void:\r\n\tvar dialog := EditorFileDialog.new()\r\n\tdialog.file_mode = EditorFileDialog.FILE_MODE_OPEN_FILE\r\n\tdialog.access = EditorFileDialog.ACCESS_RESOURCES\r\n\tdialog.add_filter(\"*.onionlab.json\", \"Onion Lab Godot JSON\")\r\n\tdialog.add_filter(\"*.json\", \"JSON\")\r\n\tdialog.title = \"Import Onion Lab\"\r\n\tEditorInterface.get_base_control().add_child(dialog)\r\n\tdialog.popup_centered_ratio(0.5)\r\n\tdialog.file_selected.connect(func(path: String) -> void:\r\n\t\tvar err := IMPORTER.import_onion_json(path)\r\n\t\tif err != OK:\r\n\t\t\tpush_error(\"Onion Lab import failed: %s\" % error_string(err))\r\n\t\telse:\r\n\t\t\tprint(\"Onion Lab import OK → SpriteFrames next to \", path)\r\n\t\tdialog.queue_free()\r\n\t)\r\n\tdialog.canceled.connect(dialog.queue_free)\r\n",
    "addons/onion_lab_importer/onion_import.gd": "@tool\r\nextends RefCounted\r\n\r\n## Import an Onion Lab `.onionlab.json` (+ sibling texture) into a SpriteFrames `.tres`.\r\n\r\n\r\nstatic func import_onion_json(json_path: String) -> Error:\r\n\tvar f := FileAccess.open(json_path, FileAccess.READ)\r\n\tif f == null:\r\n\t\treturn FileAccess.get_open_error()\r\n\tvar parsed: Variant = JSON.parse_string(f.get_as_text())\r\n\tf.close()\r\n\tif typeof(parsed) != TYPE_DICTIONARY:\r\n\t\treturn ERR_INVALID_DATA\r\n\r\n\tvar data: Dictionary = parsed\r\n\tvar tex_name: String = str(data.get(\"texture\", \"\"))\r\n\tvar base_dir := json_path.get_base_dir()\r\n\tvar tex_path := base_dir.path_join(tex_name) if not tex_name.is_empty() else \"\"\r\n\tif tex_path.is_empty() or not ResourceLoader.exists(tex_path):\r\n\t\tvar guess := json_path.get_basename() + \".png\"\r\n\t\tif ResourceLoader.exists(guess):\r\n\t\t\ttex_path = guess\r\n\t\telse:\r\n\t\t\tpush_error(\"Texture not found for Onion Lab import: %s\" % tex_name)\r\n\t\t\treturn ERR_FILE_NOT_FOUND\r\n\r\n\tvar atlas: Texture2D = load(tex_path)\r\n\tif atlas == null:\r\n\t\treturn ERR_CANT_OPEN\r\n\r\n\tvar animations: Dictionary = data.get(\"animations\", {})\r\n\tvar sf := SpriteFrames.new()\r\n\tif sf.has_animation(&\"default\"):\r\n\t\tsf.remove_animation(&\"default\")\r\n\r\n\tfor anim_name in animations.keys():\r\n\t\tvar anim: Dictionary = animations[anim_name]\r\n\t\tvar aname := StringName(str(anim_name))\r\n\t\tsf.add_animation(aname)\r\n\t\tsf.set_animation_loop(aname, bool(anim.get(\"loop\", true)))\r\n\t\tvar fps := float(anim.get(\"fps\", 10))\r\n\t\tif fps <= 0.0:\r\n\t\t\tfps = 10.0\r\n\t\tsf.set_animation_speed(aname, fps)\r\n\t\tvar frames: Array = anim.get(\"frames\", [])\r\n\t\tfor fr in frames:\r\n\t\t\tif typeof(fr) != TYPE_DICTIONARY:\r\n\t\t\t\tcontinue\r\n\t\t\tvar region: Dictionary = fr.get(\"region\", {})\r\n\t\t\tvar at := AtlasTexture.new()\r\n\t\t\tat.atlas = atlas\r\n\t\t\tat.region = Rect2(\r\n\t\t\t\tfloat(region.get(\"x\", 0)),\r\n\t\t\t\tfloat(region.get(\"y\", 0)),\r\n\t\t\t\tfloat(region.get(\"w\", 1)),\r\n\t\t\t\tfloat(region.get(\"h\", 1))\r\n\t\t\t)\r\n\t\t\tvar dur_sec := float(fr.get(\"duration\", 0.1))\r\n\t\t\tif dur_sec <= 0.0:\r\n\t\t\t\tdur_sec = 0.1\r\n\t\t\t# Relative duration: seconds * FPS (Godot time = relative / speed)\r\n\t\t\tsf.add_frame(aname, at, dur_sec * fps)\r\n\t\tvar direction := str(anim.get(\"direction\", \"forward\"))\r\n\t\tif direction == \"reverse\" and frames.size() > 1:\r\n\t\t\t_reverse_animation(sf, aname)\r\n\t\telif direction == \"pingpong\" and frames.size() > 1:\r\n\t\t\t_pingpong_animation(sf, aname)\r\n\r\n\tvar out_path := json_path.get_basename() + \".spriteframes.tres\"\r\n\tvar err := ResourceSaver.save(sf, out_path)\r\n\tif err != OK:\r\n\t\treturn err\r\n\r\n\tvar scene := PackedScene.new()\r\n\tvar root := AnimatedSprite2D.new()\r\n\troot.name = str(data.get(\"name\", \"OnionLab\"))\r\n\troot.sprite_frames = sf\r\n\tif sf.get_animation_names().size() > 0:\r\n\t\troot.animation = sf.get_animation_names()[0]\r\n\t\troot.autoplay = root.animation\r\n\tscene.pack(root)\r\n\tResourceSaver.save(scene, json_path.get_basename() + \".tscn\")\r\n\treturn OK\r\n\r\n\r\nstatic func _reverse_animation(sf: SpriteFrames, aname: StringName) -> void:\r\n\tvar count := sf.get_frame_count(aname)\r\n\tvar textures: Array = []\r\n\tvar durs: Array = []\r\n\tfor i in count:\r\n\t\ttextures.append(sf.get_frame_texture(aname, i))\r\n\t\tdurs.append(sf.get_frame_duration(aname, i))\r\n\tsf.clear(aname)\r\n\tfor i in range(count - 1, -1, -1):\r\n\t\tsf.add_frame(aname, textures[i], durs[i])\r\n\r\n\r\nstatic func _pingpong_animation(sf: SpriteFrames, aname: StringName) -> void:\r\n\tvar count := sf.get_frame_count(aname)\r\n\tif count < 2:\r\n\t\treturn\r\n\tvar textures: Array = []\r\n\tvar durs: Array = []\r\n\tfor i in count:\r\n\t\ttextures.append(sf.get_frame_texture(aname, i))\r\n\t\tdurs.append(sf.get_frame_duration(aname, i))\r\n\tfor i in range(count - 2, 0, -1):\r\n\t\tsf.add_frame(aname, textures[i], durs[i])\r\n",
    "addons/onion_lab_importer/README.md": "# Onion Lab Importer (Godot 4)\r\n\r\n1. Copy the `addons/onion_lab_importer` folder into your Godot project `res://addons/`.\r\n2. Project → Project Settings → Plugins → enable **Onion Lab Importer**.\r\n3. Copy the exported `.png` + `.onionlab.json` into `res://` (same folder).\r\n4. Project → Tools → **Onion Lab: Import JSON…** and pick the JSON.\r\n\r\nCreates `.spriteframes.tres` and a sample `.tscn` with AnimatedSprite2D beside the JSON.\r\n"
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
      const sheetName = session.masterSheetName || `${charId}.png`
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
      zip.add(`${charId}.onionlab.json`, enc.encode(JSON.stringify(meta, null, 2)))

      for (const [p, text] of Object.entries(ADDON_FILES)) {
        zip.add(p, enc.encode(text))
      }

      zip.add(
        'README-GODOT.txt',
        enc.encode(
          'Onion Lab → Godot 4 pack\n\n' +
            '1. Copy addons/onion_lab_importer into your Godot project res://addons/\n' +
            '2. Enable the plugin in Project Settings → Plugins\n' +
            '3. Place ' +
            sheetName +
            ' and ' +
            charId +
            '.onionlab.json in the same res:// folder\n' +
            '4. Project → Tools → Onion Lab: Import JSON…\n'
        )
      )

      return zip.build()
    }
  }

  SA.GodotPackExporter = GodotPackExporter
})(window.SpriteAnim)
