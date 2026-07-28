@tool
extends RefCounted

## Import an Onion Lab `.onionlab.json` (+ sibling texture) into a SpriteFrames `.tres`.


static func import_onion_json(json_path: String) -> Error:
	var f := FileAccess.open(json_path, FileAccess.READ)
	if f == null:
		return FileAccess.get_open_error()
	var parsed: Variant = JSON.parse_string(f.get_as_text())
	f.close()
	if typeof(parsed) != TYPE_DICTIONARY:
		return ERR_INVALID_DATA

	var data: Dictionary = parsed
	var tex_name: String = str(data.get("texture", ""))
	var base_dir := json_path.get_base_dir()
	var tex_path := base_dir.path_join(tex_name) if not tex_name.is_empty() else ""
	if tex_path.is_empty() or not ResourceLoader.exists(tex_path):
		var guess := json_path.get_basename() + ".png"
		if ResourceLoader.exists(guess):
			tex_path = guess
		else:
			push_error("Texture not found for Onion Lab import: %s" % tex_name)
			return ERR_FILE_NOT_FOUND

	var atlas: Texture2D = load(tex_path)
	if atlas == null:
		return ERR_CANT_OPEN

	var animations: Dictionary = data.get("animations", {})
	var sf := SpriteFrames.new()
	if sf.has_animation(&"default"):
		sf.remove_animation(&"default")

	for anim_name in animations.keys():
		var anim: Dictionary = animations[anim_name]
		var aname := StringName(str(anim_name))
		sf.add_animation(aname)
		sf.set_animation_loop(aname, bool(anim.get("loop", true)))
		var fps := float(anim.get("fps", 10))
		if fps <= 0.0:
			fps = 10.0
		sf.set_animation_speed(aname, fps)
		var frames: Array = anim.get("frames", [])
		for fr in frames:
			if typeof(fr) != TYPE_DICTIONARY:
				continue
			var region: Dictionary = fr.get("region", {})
			var at := AtlasTexture.new()
			at.atlas = atlas
			at.region = Rect2(
				float(region.get("x", 0)),
				float(region.get("y", 0)),
				float(region.get("w", 1)),
				float(region.get("h", 1))
			)
			var dur_sec := float(fr.get("duration", 0.1))
			if dur_sec <= 0.0:
				dur_sec = 0.1
			# Relative duration: seconds * FPS (Godot time = relative / speed)
			sf.add_frame(aname, at, dur_sec * fps)
		var direction := str(anim.get("direction", "forward"))
		if direction == "reverse" and frames.size() > 1:
			_reverse_animation(sf, aname)
		elif direction == "pingpong" and frames.size() > 1:
			_pingpong_animation(sf, aname)

	var out_path := json_path.get_basename() + ".spriteframes.tres"
	var err := ResourceSaver.save(sf, out_path)
	if err != OK:
		return err

	var scene := PackedScene.new()
	var root := AnimatedSprite2D.new()
	root.name = str(data.get("name", "OnionLab"))
	root.sprite_frames = sf
	if sf.get_animation_names().size() > 0:
		root.animation = sf.get_animation_names()[0]
		root.autoplay = root.animation
	scene.pack(root)
	ResourceSaver.save(scene, json_path.get_basename() + ".tscn")
	return OK


static func _reverse_animation(sf: SpriteFrames, aname: StringName) -> void:
	var count := sf.get_frame_count(aname)
	var textures: Array = []
	var durs: Array = []
	for i in count:
		textures.append(sf.get_frame_texture(aname, i))
		durs.append(sf.get_frame_duration(aname, i))
	sf.clear(aname)
	for i in range(count - 1, -1, -1):
		sf.add_frame(aname, textures[i], durs[i])


static func _pingpong_animation(sf: SpriteFrames, aname: StringName) -> void:
	var count := sf.get_frame_count(aname)
	if count < 2:
		return
	var textures: Array = []
	var durs: Array = []
	for i in count:
		textures.append(sf.get_frame_texture(aname, i))
		durs.append(sf.get_frame_duration(aname, i))
	for i in range(count - 2, 0, -1):
		sf.add_frame(aname, textures[i], durs[i])
