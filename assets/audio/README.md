# audio

Sound overrides: `<soundName>.ogg|mp3|wav|m4a`, e.g. `rifle.ogg`, `claw.wav` (names: `SoundName` in
src/audio/AudioManager.ts). Numbered variants (`<name>_1`, `<name>_2`, ...) are picked at random.

Event-driven gameplay sounds (rules in src/audio/AudioEvents.ts, config in src/config/audio.ts):

| file                          | plays                                                        |
|-------------------------------|--------------------------------------------------------------|
| `movement/wolf_jump.wav` (supplied, final) | all five wolves, once per real jump (ground / wall jump) |
| `movement/footstep.mp3` (supplied) | humans + all wolves: one recorded step per real foot contact |
| `wolf_claw_swing`             | every claw swing, on its attack phase                        |
| `wolf_claw_hit`               | confirmed claw hits only (once per target per swing)         |
| `human/death_01.mp3`, `human/death_02.mp3` (supplied) | human deaths only, strictly alternating 01 → 02 |
| `weapons/m4a1_fire.mp3` (supplied) | one per real M4A1 shot                                  |
| `weapons/m4a1_reload.mp3` (supplied) | one sequence per accepted M4A1 reload                |
| `objectives/isgal_karargah_ele_gecirme.mp3` (supplied) | İşgal capture progress loop    |
| `wolf_death`                  | one per wolf death                                           |

Sounds without a file use temporary synthesized versions. The `human/`, `weapons/`, `objectives/`,
`movement/` and `source/` folders are curated: their files are played by exact path from `AUDIO.clips` (src/config/audio.ts),
never picked as random overrides.

## Spiker (announcer)

`announcer/` holds the Turkish announcer voice lines (the user's recordings, unchanged). They are
loaded by `src/audio/announcer/AnnouncerAudioManager.ts` (not by the SFX override loader) - see
`announcer/README.md` for the event → file table and `src/config/announcer.ts` for every rule.

## Music

`music/oyun_m_zi_i.mp3` (menus), `music/oda_m_zi_i.mp3` (room), `music/match_loading.mp3` (room → match
loading screen only) - the supplied tracks, unchanged, on the MUSIC volume (MusicManager, config MUSIC).
