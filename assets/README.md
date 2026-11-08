# Wolf Strike – asset drop folder

Everything in this folder is **optional**. When a file is missing the game uses its
procedural placeholder (skinned primitive characters, placeholder guns, generated arena,
synthesized sounds). Drop a correctly named file in, reload (`npm run dev` picks new files up
automatically; for a build run `npm run build` again) – **no gameplay code changes are needed**.
Files are discovered at build time by Vite (`src/assets/assetFiles.ts`), so the game never
requests files that don't exist.

All mapping / tuning lives in **`src/config/assets.ts`** (scale, rotation, clip names, anchors).

| File | Replaces |
|---|---|
| `models/humans/human.glb` | human soldier (both teams) |
| `models/wolves/normal_wolf.glb` | Normal Wolf |
| `models/wolves/smart_wolf.glb` | Smart Wolf |
| `models/wolves/power_wolf.glb` | Power Wolf |
| `models/wolves/ice_wolf.glb` | Ice Wolf |
| `models/wolves/guardian_wolf.glb` | Guardian Wolf |
| `models/weapons/assault_rifle.glb` | first-person VK-7 rifle (+ arms, if the file has them) |
| `models/weapons/pistol.glb` | first-person RX-9 pistol |
| `animations/wolves/*.glb` | extra clips added to **every** wolf model (retargeted by bone name) |
| `animations/humans/*.glb` | extra clips added to the human model |
| `maps/arena.glb` | arena visuals (collision stays in `src/world/ArenaLayout.ts`) |
| `audio/<sound>.mp3/.ogg/.wav/.m4a` | one synthesized sound (see names below) |
| `effects/` | reserved for future VFX textures – effects are procedural today |

## Model conventions

* Binary glTF **`.glb`** with embedded textures (a `.gltf` + `.bin` pair is not bundled).
* 1 unit = 1 metre, model faces **+Z**, feet at **y = 0**. If yours differs, fix it with
  `scale`, `rotationY`, `yOffset` in `src/config/assets.ts`.
* Characters are skinned meshes; collision, hitboxes and gameplay never depend on the mesh.

## Animation clips

Clip names are matched case-insensitively against the candidate lists in `config/assets.ts`
(exact name first, then "contains"). Default candidates:

| Logical clip | Wolf clip names tried | Human clip names tried |
|---|---|---|
| idle | `idle`, `stand` | `idle`, `aim_idle` |
| walk / run | `walk` / `run`, `sprint`, `gallop` | `walk` / `run`, `jog` |
| jump / fall / land | `jump_start`, `jump`, `leap` / `fall`, `air` / `land` | `jump` / `fall` / `land` |
| claw_left | `claw_left`, `claw_l`, `attack_left`, `attack1` … | – |
| claw_right | `claw_right`, `claw_r`, `attack_right`, `attack2` … | – |
| claw_finisher | `claw_finisher`, `claw_both`, `attack3` … | – |
| hurt / death | `hurt`, `hit` / `death`, `die` | same |
| wall_climb | `wall_climb`, `climb` | – |
| abilities | `dash` / `maul`, `slam` / `frost` / `block`, `guard` | – |
| fire / reload | – | `fire`, `shoot` / `reload` |
| transform | `transform`, `roar`, `howl` | `transform` |

**Claw timing:** gameplay decides *when* a claw hits (`hitTime` in `config/wolves.ts`). The
driver time-scales each attack clip so its strike frame lands exactly on that moment:
set `strikeFrame.claw_left = 0.4` (normalized time of the impact frame in your clip).

**Shared clip files** (`animations/wolves/*.glb`): a GLB that contains only a skeleton +
animations. Each clip is retargeted onto every wolf instance by matching node/bone names, so
one claw pack can serve all five wolves. A clip that the model itself already has wins.

## Anchors (optional nodes)

Name empty nodes / bones so effects attach to them (matching is "contains", case-insensitive):

* claws: `claw_tip_l` / `claw_tip_r` (or `hand_l`, `lefthand`, `mixamorig:LeftHand` …) → claw trails
* `head` → name tag / camera helpers
* weapons: `muzzle` → muzzle flash + tracers; a node named `mag…` is animated during reloads

## Sound names

`rifle, pistol, dry, reload, claw, clawHit, roar, unroar, jump, land, hit, headshot, kill, sp,
dash, slam, frost, shield, death, ui, hurt, spawn, climb` – e.g. `audio/rifle.ogg`.

All assets must be your own or properly licensed. Do not use assets ripped from other games.
