@tool
extends EditorPlugin

const IMPORTER := preload("res://addons/onion_lab_importer/onion_import.gd")

func _enter_tree() -> void:
	add_tool_menu_item("Onion Lab: Import JSON…", _on_import_menu)


func _exit_tree() -> void:
	remove_tool_menu_item("Onion Lab: Import JSON…")


func _on_import_menu() -> void:
	var dialog := EditorFileDialog.new()
	dialog.file_mode = EditorFileDialog.FILE_MODE_OPEN_FILE
	dialog.access = EditorFileDialog.ACCESS_RESOURCES
	dialog.add_filter("*.onionlab.json", "Onion Lab Godot JSON")
	dialog.add_filter("*.json", "JSON")
	dialog.title = "Import Onion Lab"
	EditorInterface.get_base_control().add_child(dialog)
	dialog.popup_centered_ratio(0.5)
	dialog.file_selected.connect(func(path: String) -> void:
		var err := IMPORTER.import_onion_json(path)
		if err != OK:
			push_error("Onion Lab import failed: %s" % error_string(err))
		else:
			print("Onion Lab import OK → SpriteFrames next to ", path)
		dialog.queue_free()
	)
	dialog.canceled.connect(dialog.queue_free)
