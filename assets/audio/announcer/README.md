# Spiker (announcer) voice lines

The user's own recordings, unchanged (original file names). Rules and thresholds:
`src/config/announcer.ts` · playback: `src/audio/announcer/`.

| file                                          | plays when                                              | priority |
|-----------------------------------------------|---------------------------------------------------------|----------|
| `Bölgedeki tüm düşmanları haklayın.mp3`       | the match goes live (after the 5 → 1 countdown)         | 2        |
| `ZAFER!.mp3`                                  | the local player's team wins the match                  | 1        |
| `kaybettin.mp3`                               | the local player's team loses the match                 | 1        |
| `SON 1 DAKİKA.mp3`                            | remaining match time crosses 60 s (once per match)      | 2        |
| `SON 30 SANİYE.mp3`                           | remaining match time crosses 30 s (once per match)      | 2        |
| `öncü takım bir karargahı ele geçirdi.mp3`    | ÖNCÜLER capture a headquarters (İşgal zone)             | 3        |
| `yağmacı takım bir karargahı ele geçirdi.mp3` | YAĞMACILAR capture a headquarters (İşgal zone)          | 3        |
| `vahşi kurt.mp3`                              | 6 wolf-form kills in one life                           | 4        |
| `SAVAŞÇI KURT.mp3`                            | 8 wolf-form kills                                       | 4        |
| `EFSANE KURT!.mp3`                            | 10 wolf-form kills                                      | 4        |
| `KURTLARIN EFENDİSİ.mp3`                      | 12 wolf-form kills                                      | 4        |
| `ikide iki.mp3`                               | 2nd kill of a streak (reset on death)                   | 5        |
| `üçte üç.mp3`                                 | 3rd kill                                                | 5        |
| `dörtte dört.mp3`                             | 4th kill                                                | 5        |
| `beşte beş.mp3`                               | 5th kill                                                | 5        |

Console: `wsAnnouncer.list()`, `wsAnnouncer.play("victory")`, `wsAnnouncer.playAll()`,
`wsAnnouncer.status()`, `wsAnnouncer.counts()`, `wsAnnouncer.sim.kill()` … (see Game.announcerApi).
Debug panel (F3 / DBG): SPİKER section.
