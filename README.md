# Sjömätning

En Windowsapp för att öppna fältmanus, kalibrera vanliga PDF-kartor och visa SeaClear-loggar med mätspår och djup. Appen är byggd i Electron för att kart- och visualiseringslogiken senare ska kunna återanvändas i en mobil lösning.

## Kom igång

Krav: Node.js 22 eller senare.

```powershell
npm install
npm start
```

I appen:

1. Öppna ett fältmanus i PDF-format med knappen eller dra PDF-filen direkt till appfönstret.
2. Om PDF:en är en GeoPDF läses georefereringen automatiskt.
3. För ett vanligt PDF-manus: ange latitud och longitud för en känd punkt, välj **Placera referenspunkt** och klicka på punkten i kartan. Upprepa med minst två diagonalt placerade punkter; tre punkter ger en bättre affin kalibrering. Kalibreringen sparas lokalt.
4. Lägg till en eller flera `.TXT`- eller `.CSV`-loggar. Spår och djup visas ovanpå kartan.

Vattenstånd läses ur loggfilnamn av formen `20240716_33.53_Pioner_Husholmen_trace.TXT` och korrigeras mot normalvattennivån 33,00 meter. Råfilen ändras aldrig.

## Test och Windowsbygge

```powershell
npm test
npm run lint
npm run make
```

Installationsfil, blockmap och `latest.yml` hamnar i `out/`. `latest.yml` och blockmap-filen används av den automatiska uppdateringen.

## GitHub Actions och releaser

Workflow-filen `.github/workflows/windows.yml` kör tester och skapar Windowsbyggen för varje push och pull request. Byggena går att hämta som GitHub Actions-artefakter.

För att publicera en version:

1. Ändra `version` i `package.json`, exempelvis till `0.1.1`.
2. Committa ändringen.
3. Skapa och pusha motsvarande tagg:

```powershell
git tag v0.1.1
git push origin main --tags
```

Taggen måste matcha versionen i `package.json`. Workflow-flödet skapar då en GitHub Release med installationen och uppdateringsmetadata. Installerade program söker efter nya versioner vid start och därefter var tionde minut, laddar ner dem i bakgrunden och erbjuder installation.

GitHub-repot måste vara publikt för tokenfri automatisk uppdatering. Windowsbyggena är ännu inte kodsignerade, så Windows SmartScreen kan visa en varning tills ett kodsigneringscertifikat konfigureras.

## Tidigare planeringsanteckningar

Ja – ett smalt program för själva datainsamlingen är fullt rimligt att bygga. Betydligt enklare än en komplett ersättare till SeaClear.

SeaClear exporterar redan enkla textloggar med datum, tid, GPS-position, fart och ekolodsdjup.
En faktisk loggrad ser ungefär ut så här:
2024-07-16,09:09:23,58.48687,15.67577,0.9,4.6
Jonas Pythonprogram glesar mätpunkterna till ungefär 25 meters mellanrum, men behåller den grundaste mellanliggande punkten.
Han ville kunna se mätpunkterna direkt på fältmanuset, kontrollera flera loggfiler tillsammans och slippa hantera både dator och pappersmanus under mätningen.
Den långsiktiga planen är uttryckligen en insamlingsmjukvara som gör att mätning kan ske med fler båtar.
Problem som redan förekommit är kommunikationsavbrott, långsam uppdatering, fel inställning av ekolodsgivaren och djup korrigerat mot fel vattennivå.
Min bedömning
Nivå	Innehåll	Grov arbetsinsats
Enkel prototyp	Läser NMEA 0183, visar position/djup och sparar rålogg	3–7 utvecklingsdagar
Användbar fältversion	Fältmanus, spår, markeringar, varningar, inställningar och paketering	2–4 veckor
Robust för föreningen	Testad på flera båtar, återanslutning, kalibrering, metadata och export	4–8 veckor
Fungerar med ”vilken båt som helst”	NMEA 0183/2000, olika plottrar, gateways och loggformat	Betydligt större projekt

Det svåraste är alltså inte att läsa GPS- och djupdata. Det är att göra programmet tillförlitligt när båtar och instrument beter sig olika.

Ett vettigt första program

Jag skulle begränsa första versionen till:

Val av seriell port eller NMEA-data över nätverk.
Tydliga statuslampor för GPS och ekolod.
Aktuell position, fart, djup och senaste uppdatering.
Starta och stoppa en mätsession.
Spara både den helt råa NMEA-strömmen och en normaliserad CSV-fil.
Visa färdspåret och aktuellt djup.
Lägg till manuell notering, punktlodning eller markering.
Varna vid för gammal position, förlorat djup eller orimliga hopp.

Varje session bör dessutom lagra båt, operatör, instrument, avståndet mellan GPS-antenn och givare, enheter, vattenstånd/referensnivå och vilket fältmanus som användes. Framför allt ska rådata aldrig skrivas över när vattenståndskorrigering eller gallring görs.

Fältmanuset är den knepigare delen

Att bara visa en PDF är enkelt. Att lägga GPS-positionen korrekt ovanpå den kräver att man känner till dokumentets geografiska koordinater.

SeaClears WCI-versioner verkar redan vara georefererade. De vanliga PDF-manusen är däremot sannolikt inte direkt maskinläsbara. Programmet behöver därför antingen:

läsa det georefererade WCI-/kartformatet,
använda en separat kalibreringsfil, eller
låta användaren peka ut några kända positioner på PDF:en.

Jag skulle därför bygga i ordningen:

rå NMEA-loggning,
status och manuella noteringar,
georefererat fältmanus,
stöd för fler instrument och båtar.

Python passar bra eftersom Jonas efterbehandling redan är skriven där. En liten skrivbordsapp i Python/PySide6 kan återanvända hans befintliga algoritmer. Alternativt kan Signal K användas som mottagarlager och gränssnittet göras som en lokal webbapp.

Min rekommendation är att inte börja med att bygga en ny komplett sjökortsplotter. Bygg en robust ”svart låda” för rådata först och låt SeaClear/OpenCPN hantera kartvisningen under den första säsongen. När loggningen är bevisat stabil kan fältmanuset byggas in.
Appen kan hämta Roxens publicerade dygnsvattenstånd från Tekniska verken. Välj dag i panelen **Vattenstånd** och använd vid behov nivån som korrigering för alla importerade körningar. Värdena anges i RH00 och kräver internetanslutning.

Mätspår kan öppnas med filväljaren eller dras direkt till arbetsytan. Appen stöder SeaClear-spår som TXT/CSV och binära TRC-filer. Äldre waypoint-TXT läses också; där används det okorrigerade värdet efter `Ekolod:` så att appens vattenståndskorrigering inte räknas två gånger.

Med **Öppna mapp** inventerar appen PDF-manus och mätspår även i undermappar. Listan visar vilka manus som har inbäddad geodata samt format, filstorlek och antal punkter för varje spår. Filer öppnas eller läggs till direkt från listan.

Flera mappar kan läggas till med filväljaren eller genom drag-and-drop. Identiska filer identifieras med SHA-256 och importeras bara en gång. När kartan har geodata visar både biblioteket och listan över importerade spår hur många punkter som ryms inom kartan.

Varje push till `main` får en unik version och publiceras automatiskt som en GitHub Release tillsammans med `latest.yml`. Installerade versioner hämtar uppdateringen i bakgrunden och visar en knapp för att starta om och installera när den är klar.

Appen använder en separat Chromium-cache och tillåter bara en körande instans. Det förhindrar Windows-felet `Unable to move/create cache` vid snabb omstart och efter automatisk uppdatering.

Versionsnummer och UTC-byggdatum visas i både fönstertiteln och apphuvudet. Releaseflödet stämplar båda värdena i paketet före Windows-bygget.
