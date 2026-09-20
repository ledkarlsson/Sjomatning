# Sjömätning GPS för Android



Android 8 eller senare. GPS startar automatiskt när appen öppnas, efter att exakt plats har tillåtits. Ingen punkt sparas automatiskt.



1. Ange namn och djup. Tryck **＋ Lägg till punkt här** en gång per punkt.

2. Punkten visas direkt i listan med djup, datum, tid och koordinater.

3. **Ändra** ändrar punktens djup och koordinater. Ursprunglig tid behålls.

4. **Ta bort** tar bort vald punkt efter bekräftelse.

5. **Synka punkter** skickar nya och ändrade punkter samt borttagningar till webben med din personliga nyckel. Nyckeln anges i en gemensam dialog vid första Synka eller Fältmanus. Den valideras innan åtgärden fortsätter och sparas i appens privata SharedPreferences, undantagna från Android-backup. Den finns kvar efter omstart. Om servern avvisar själva nyckeln tas den bort och dialogen öppnas direkt; en utgången session återställs med giltig sparad nyckel och nätverksfel behåller nyckeln. Det finns inget separat nyckelfält i appvyn.



Punkter lagras i SQLite utan krav på internet. Äldre appversioners mätningar migreras utan att punkter eller synkkvitton försvinner. Varje punkt har ett eget djup, även i äldre flerpunktsfiler. Avsnitt visas inte i gränssnittet; äldre filgrupper behålls internt för kompatibel synk. Datum och tid exporteras i UTC.



Synk laddar först upp ny filversion och köar sedan borttagning av föregående version. Kön sparas i SQLite och återförsök sker vid nästa synk. Endast webbkopior som appen har synkkvitto för, på inloggat konto, tas bort. Borttagna lokala punkter återskapas inte vid synk. Andra konton uppdateras först när man synkar med respektive nyckel. Webbändringar hämtas inte tillbaka till telefonen.



GPS kräver färsk position (högst 15 sekunder, högst 30 meters rapporterad osäkerhet). Fysisk GPS, skärmlås och batterisparläge måste provas på telefonen. Android-backup är avstängd; avinstallation raderar lokala data. Installera uppdateringar över befintlig app.



## Bygga och publicera



Java 17, SDK Platform 35, Build Tools 35.0.0. Ange SDK-sökväg i `local.properties` och kör från `android/`:



```powershell

./gradlew.bat assembleDebug testDebugUnitTest lintDebug

```



APK finns i `app/build/outputs/apk/debug/app-debug.apk`. Kopiera till `web/downloads/Sjomatning-GPS-0.1.8.apk` från projektroten och kör `npm run web:deploy`. Installationssidan finns på `/android/`. APK:n är debug-signerad för direkt installation; behåll samma signeringsnyckel för uppdateringar.



Testerna omfattar GPS-behörighet, automatisk start, databasuppgradering, punktlista, validering, redigering, borttagning, kontogränser och återförsök av synk. `SJOMATNING_LIVE_TEST=1` aktiverar dessutom ett syntetiskt produktionsprov med projektets git-ignorerade administratörsnyckel och efterföljande rensning.



Sjökartan är inbyggd i appen och använder samma OpenStreetMap-grundkarta och OpenSeaMap-sjömärken som webbappen. Kartbilder behöver internet och använder WebViews normala HTTP-cache. Positionen visas blå när den är aktuell och grå när den är gammal. Kartan kan zoomas och panoreras; Min position återupptar följning. Visa fältmanus hämtar georefererade PDF-, WCI- och KAP-filer från webbbiblioteket med personlig nyckel. Dölj fältmanus ersätter bilderna med genomskinliga fyrkanter längs manusens geografiska utbredning. Sessionen finns endast i minnet och har samma behörigheter som webbnyckeln. Manus utan geodata kan inte placeras på kartan. Rasterbilder begränsas till 1024 pixlar per sida och totalt 24 miljoner pixlar för telefonens minne. PDF visar första sidan, liksom webbens kartlager.


## Lokal lagring och automatisk synkning (0.1.8)

Vid kallstart synkas punkter och fältmanus automatiskt om en webbnyckel redan är sparad. Första gången anger du nyckeln via Synka punkter eller Visa fältmanus. Synka punkter uppdaterar också de lokala manusen. Ingen punkt skapas automatiskt.

PDF-, WCI- och KAP-original sparas beständigt i appens privata `files/library` (inte i en rensningsbar cache). Biblioteket skiljs åt per nyckel. Serverns fil-id identifierar ett oföränderligt original, så oförändrade filer hämtas inte igen. Nya manus hämtas, filnamn uppdateras och borttagna manus rensas efter en fullständig synkning. En avbruten hämtning ersätter aldrig den tidigare filförteckningen. Nätverksfel behåller lokala filer och nyckeln; sparade manus kan öppnas offline. Kartbilder använder fortfarande WebViews HTTP-cache och garanteras inte offline.

Synkning uppdaterar diskbiblioteket. Manus som redan är ritade läses från det uppdaterade biblioteket nästa gång appen öppnas. Avinstallation eller Rensa lagring raderar appens lokala data.
