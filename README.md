# Onion Lab

A local-first **spritesheet animation studio**: detect frames on a master sheet, build per-anim timelines from a shared frame pool, preview playback (with onion skin), and export JSON atlases, PNG packs, GIFs, or Godot 4 packs.

## Model

- **Master sheet** — one PNG for the asset (stays loaded across anim tabs)
- **Shared frame pool** — detect boxes / polygons defined once
- **Anim tabs** — start with one tab on a new sheet; rename by clicking the active tab; **+** adds more. Each tab is an ordered list of frame ids + per-slot duration + fps / loop / direction

Export expands ids into full `{x,y,w,h,points?,duration_ms}` frames for games. Asset JSON may include a top-level `sheet`.

## Timing & preview

- **Per-frame ms** — selected timeline slot; blank inherits anim FPS. **Apply FPS → all** clears holds.
- **Direction** — forward / reverse / ping-pong (playback sequence; Append ↔ reverse still bakes duplicate refs when you want them).
- **Scrub** — ◀ / ▶ in the preview dock (and pop-out); clicking a timeline cell stops and shows that frame.
- **Onion** — ghost prev (green) / next (blue). **flipX** and **1×/2×/3×** are display-only.

## Export profiles

- **Generic** (default) — `{ name, sheet?, anims }` for any visual asset
- **Godot 4** — `{ onion_lab, godot, name, texture, animations }` for `.onionlab.json`. **Download Godot pack** zips the sheet PNG + JSON + `addons/onion_lab_importer` (enable in Project Settings → Plugins, then Project → Tools → Onion Lab: Import JSON…).
- **Download JSON** — profile-shaped export
- **Download PNG pack** — zip of baked transparent PNGs + JSON with `file` per frame (non-Godot profiles)
- **Download GIF** — active anim as animated GIF (honors durations + direction)

## Run

Open `index.html` in your browser (double-click or drag into a tab). No build step or static server required.

Scripts are split into files for clarity, but loaded as classic `<script>` tags onto a shared `window.SpriteAnim` namespace (not ES modules), so `file://` works.

## Layout

- `index.html` — shell + script load order
- `css/` — theme tokens + app chrome
- `js/ns.js` — namespace bootstrap
- `js/domain/` — session, slots, boxes, detection, history, chroma
- `js/render/` — sheet / timeline / preview canvases
- `js/io/` — export profiles, GIF, packs, session persistence
- `godot/addons/onion_lab_importer/` — Godot 4 plugin sources (also embedded in Godot zip export)
- `js/ui/` — DOM helpers
- `js/app/AnimStudioApp.js` — wires everything
- `js/main.js` — boot

## Keyboard

| Key | Action |
|-----|--------|
| Z | Undo |
| R | Redo |
| S | Snap selected box to nearest object |
| Enter / A | Add selected box to active anim timeline |
| Delete | Delete selected vertex, else detect box, else timeline frame |
| Arrow keys | Nudge selected box (Shift = 10px) |
| Ctrl + scroll | Zoom sheet toward cursor |
| Space (hold) + drag | Pan sheet (hand tool) |
| P | Play / pause preview |
| Ctrl + / Ctrl − / Ctrl 0 | Zoom in / out / 100% |
| Shift-drag | Draw a new detect box |
| Alt+click edge | Insert polygon vertex on selected box |

## Polygon frames

Detect boxes are editable polygons. **Alt+click** an edge to add a vertex; drag blue handles to reshape. **Reset shape** returns to a rectangle. Preview, timeline, export, and PNG bake all use the same mask.

## Feet / character anchor

Each box has a cyan diamond (`anchorX`/`anchorY`, export `ax`/`ay`, 0–1 in the frame). Default is bottom-center `(0.5, 1)`.

- **Alt+drag** — free move inside the box; soft **magnetic snap** to the bottom edge
- **Alt+Shift+drag** — unlock magnet (fully free)
- Without Alt, the bottom-middle gold handle still resizes the box

Preview maps that point to the slot’s bottom-center.

## License

MIT — see repository root / GitHub license when published.
