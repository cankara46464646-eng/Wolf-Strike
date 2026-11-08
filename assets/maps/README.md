# maps

Maps are generated from code (collision + visuals come from the same data):

* `src/world/Sector9Layout.ts` – Sector-9
* `src/world/Maze01Layout.ts` – MAZE-01 (underground lab labyrinth, authored on a 2 m cell grid)
* `src/world/ArenaLayout.ts` – Site K-9

Optional `arena.glb` in this folder: visual replacement for Site K-9 only. Collision always stays in
the layout files. Lobby / room previews live in `assets/ui/maps/<mapId>.jpg` and are rendered from
the maps themselves.
