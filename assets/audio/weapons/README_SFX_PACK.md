# Wolf Strike – Curated Weapon SFX Pack

Bu paket, kullanıcının satın aldığı GameMaster Audio kütüphanesinden Wolf Strike için seçilip düzenlenmiştir.

## Codex entegrasyon kuralı
- `weapon_sfx_manifest.json` dosyasını kaynak eşleştirme olarak kullan.
- Her silahın `fire.mp3` dosyasını yalnız gerçek başarılı shot event'inde çal.
- Her silahın `reload.mp3` dosyasını yalnız kabul edilmiş reload event'inde bir kez çal.
- `dry_fire.mp3` varsa, ammo=0 tetik denemesinde kullan.
- AWM `scope.mp3` dosyasını scope/ADS geçişinde kullan.
- Fire-rate'i sese göre değiştirme; ses gameplay fire-rate'i takip etsin.
- Otomatik silahlarda `fire.mp3` her gerçek mermi event'ine senkron tetiklensin; duplicate/stacking/clipping engellensin.
- Local silah sesi first-person mix; remote silah sesi 3D positional + distance attenuation.
- Tüm silah sesleri SFX Volume'a bağlı olsun.
- `shared/` altındaki flyby ve impact sesleri mermi yakın geçişi / gerçek yüzey çarpışmalarında varyasyonlu kullanılabilir.
- Mevcut damage, fire-rate, recoil, ammo ve TTK değerlerini bu ses paketi yüzünden değiştirme.

## Silahlar
M4A1, AK47, MP5, P90, M870, SPAS12, AWM, M249, Glock17, DesertEagle.

## Not
Reload dosyaları oyun entegrasyonunu kolaylaştırmak için ilgili mekanik parçalar birleştirilerek tek MP3 haline getirildi.
Kaynak 24-bit/96kHz WAV dosyaları web/mobile için 44.1kHz 192kbps MP3'e dönüştürüldü.
