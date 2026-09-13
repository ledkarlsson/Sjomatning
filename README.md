# Sjömätning

En Windowsapp som visar en karta över sjön Roxen, kan öppna och kalibrera PDF-fältmanus samt visa loggar med mätspår och djup. Kräver internetanslutning.

I appen laddas Roxenkartan automatiskt. Därefter kan du lägga till mätspår direkt. För egna fältmanus:

1. Öppna ett fältmanus i PDF-format via **Lägg till → Välj filer** i biblioteket, eller dra PDF-filen direkt dit. Välj **Gå till plats** för att visa området; manus utan geodata öppnas för kalibrering.
2. Om PDF:en är en GeoPDF läses georefereringen automatiskt.
3. För ett vanligt PDF-manus: ange latitud och longitud för en känd punkt, välj **Placera referenspunkt** och klicka på punkten i kartan. Upprepa med minst två diagonalt placerade punkter; tre punkter ger en bättre affin kalibrering. Kalibreringen sparas lokalt.
4. Lägg till en eller flera `.TXT`- eller `.CSV`-loggar. Spår och djup visas ovanpå kartan.


## Mät direkt från GPS och ekolod

Anslut en NMEA 0183-enhet via USB (eller en USB–seriell-adapter) och använd panelen **GPS och ekolod**:

1. Välj enhetens baudrate, vanligen 4 800, 9 600 eller 38 400 baud.
2. Ange vid behov givarjustering i meter. Värdet läggs till det inkommande djupet.
3. Klicka på **Anslut och starta mätning** och välj USB-porten.
4. Klicka på **Stoppa och spara spåret** när körningen är klar.

Appen stöder GPS-meningarna GGA/RMC och ekolodsmeningarna DPT/DBT. Under körningen skrivs varje mottagen NMEA-mening omedelbart till `raw.nmea`, medan kompletta GPS- och djupmätningar skrivs till `track.csv`. Filerna ligger i den sökväg som visas i livepanelen. Råströmmen ändras aldrig.

Det aktiva spåret syns direkt på kartan och kan exporteras som CSV eller SeaClear waypoint-TXT. För att rätta en felaktig punkt klickar du på spåret i kartan eller väljer **Info och punkttabell**. Där kan rådjup och koordinater ändras eller punkten tas bort. Stoppa en pågående mätning först; spåret läggs då i biblioteket. Vattennivå och generell djupjustering kan fortfarande anges per spår utan att råfilen skrivs om.

Vattenstånd läses ur loggfilnamn av formen `20240716_33.53_Pioner_Husholmen_trace.TXT` och korrigeras mot normalvattennivån 33,00 meter. Råfilen ändras aldrig.


## Kom igång med utveckling

Krav: Node.js 22 eller senare.

```powershell
npm install
npm start
```


## Test och Windowsbygge

```powershell
npm test
npm run lint
npm run make
```

Installationsfil, blockmap och `latest.yml` hamnar i `out/`. `latest.yml` och blockmap-filen används av den automatiska uppdateringen.

## GitHub Actions och releaser

Workflow-filen `.github/workflows/windows.yml` kör tester, syntaxkontroll och Windowsbygge vid push till `main`, pull requests mot `main` och manuell körning via GitHub Actions. Byggena sparas som GitHub Actions-artefakter. Endast push till `main` publicerar en GitHub Release.

För att publicera en ny version:

1. Committa ändringarna på `main`.
2. Pusha till GitHub:

```powershell
git push origin main
```

3. Kontrollera att workflow-körningen **Windowsbygge** blir grön och att den nya versionen finns under **Releases**.

Du behöver inte ändra `version` eller `buildDate` i `package.json` och inte heller skapa en tagg manuellt. Vid push sätter workflow-flödet versionen till `0.2.<GitHub Actions-körningsnummer>` och byggdatumet till dagens UTC-datum. Värdena ändras i byggmiljön och committas inte tillbaka till repot.

När tester, syntaxkontroll och bygge har lyckats skapas releasen med taggen `v0.2.<körningsnummer>`, Windowsinstallationen, blockmap-filen och `latest.yml`. Installerade program söker efter nya versioner vid start och därefter var tionde minut, laddar ner dem i bakgrunden och erbjuder installation.

GitHub-repot måste vara publikt för tokenfri automatisk uppdatering. Windowsbyggena är ännu inte kodsignerade, så Windows SmartScreen kan visa en varning tills ett kodsigneringscertifikat konfigureras.

## Tidigare planeringsanteckningar

En loggrad ser ut ungefär så här:
2024-07-16,09:09:23,58.48687,15.67577,0.9,4.6
Man vill kunna se se mätpunkter direkt på fältmanuset, kontrollera flera loggfiler tillsammans och slippa hantera både dator och pappersmanus under mätningen.
Den långsiktiga planen är uttryckligen en insamlingsmjukvara som gör att mätning kan ske med fler båtar.
Problem som redan förekommit är kommunikationsavbrott, långsam uppdatering, fel inställning av ekolodsgivaren och djup korrigerat mot fel vattennivå.

Bedömningar:
Nivå	Innehåll	Grov arbetsinsats
Enkel prototyp	Läser NMEA 0183, visar position/djup och sparar rålogg	3–7 utvecklingsdagar
Användbar fältversion	Fältmanus, spår, markeringar, varningar, inställningar och paketering	2–4 veckor
Robust för föreningen	Testad på flera båtar, återanslutning, kalibrering, metadata och export	4–8 veckor
Fungerar med ”vilken båt som helst”	NMEA 0183/2000, olika plottrar, gateways och loggformat	Betydligt större projekt

## Ett vettigt första program

Val av seriell port eller NMEA-data över nätverk.
Tydliga statuslampor för GPS och ekolod.
Aktuell position, fart, djup och senaste uppdatering.
Starta och stoppa en mätsession.
Spara både den helt råa NMEA-strömmen och en normaliserad CSV-fil.
Visa färdspåret och aktuellt djup.
Lägg till manuell notering, punktlodning eller markering.
Varna vid för gammal position, förlorat djup eller orimliga hopp.

Varje session bör dessutom lagra båt, operatör, instrument, avståndet mellan GPS-antenn och givare, enheter, vattenstånd/referensnivå och vilket fältmanus som användes. Framför allt ska rådata aldrig skrivas över när vattenståndskorrigering eller gallring görs.

Den inbyggda kostnadsfria översiktskartan täcker hela Sverige med data från OpenStreetMap och OpenSeaMap. Använd mushjulet för att zooma och dra med vänster musknapp för att panorera åt valfritt håll.

Mätspår kan öppnas med filväljaren eller dras direkt till arbetsytan. Appen stöder SeaClear-spår som TXT/CSV och binära TRC-filer. Äldre waypoint-TXT läses också; där används det okorrigerade värdet efter `Ekolod:` så att appens vattenståndskorrigering inte räknas två gånger.

Flera körningar kan visas samtidigt med egna färger. Varje körning har separat vattennivå, manuell djupjustering och valfritt gallringsavstånd. Gallringen följer Pythonunderlagets princip: punkterna glesas till önskat avstånd, samtidigt som en grundaste mellanpunkt behålls när den är viktig. Råpunkterna ändras aldrig. Synliga spår kan exporteras tillsammans som semikolonavgränsad CSV eller som SeaClear-kompatibel waypoint-TXT.

När ett spår läggs till läser appen automatiskt datumet ur filnamnet eller den första mätpunkten och försöker hämta Roxens publicerade vattennivå för dagen. Vattennivån i filnamnet används som reserv om hämtningen inte lyckas. Varje körning kan därefter justeras separat.

Med **Lägg till → Välj mapp** i biblioteket inventerar appen PDF-manus och mätspår även i undermappar. Listan visar vilka manus som har inbäddad geodata samt format, filstorlek och antal punkter för varje spår. Filer öppnas eller läggs till direkt från listan.

Flera mappar kan läggas till med filväljaren eller genom drag-and-drop. Identiska filer identifieras med SHA-256 och importeras bara en gång. När kartan har geodata visar både biblioteket och listan över importerade spår hur många punkter som ryms inom kartan.

Varje lyckat versionsbygge efter push till `main` publiceras automatiskt som en GitHub Release tillsammans med `latest.yml`, enligt flödet ovan. Installerade versioner hämtar uppdateringen i bakgrunden och visar en knapp för att starta om och installera när den är klar. Knappen installerar uppdateringen tyst utan installationsguide och startar sedan programmet igen. Första installationen använder fortfarande installationsguiden.

Appen använder en separat Chromium-cache och tillåter bara en körande instans. Det förhindrar Windows-felet `Unable to move/create cache` vid snabb omstart och efter automatisk uppdatering.

Versionsnummer och UTC-byggdatum visas i både fönstertiteln och apphuvudet. Releaseflödet stämplar båda värdena i paketet före Windows-bygget.

Importerade PDF:er och mätspår kopieras till ett beständigt bibliotek under appens användardata och återställs vid nästa start. Identiska filer lagras bara en gång. Varje post kan tas bort från biblioteket med kryssknappen; aktiv karta eller tillagda spår tas då samtidigt bort från arbetsytan.

Uppdateringsstatusen “Programmet är uppdaterat.” döljs automatiskt efter några sekunder. Status för hämtning, fel eller en installationsklar uppdatering ligger kvar så att användaren hinner agera.

## Plan för funktionalitet motsvarande SeaClear II

Bedömning: 2026-09-13, utifrån [seaclear2.txt](seaclear2.txt) och den aktuella koden i `src/`. Tabellen beskriver implementerat stöd, inte verifierad kompatibilitet med alla instrument eller kartfiler. Målet här är hela funktionaliteten i jämförelsefilen; de äldre anteckningarna ovan beskriver ett tidigare, smalare mål för datainsamling.

### Nuläge och återstående funktioner

| Område i SeaClear II | Nuläge i Sjömätning | Återstår för motsvarande funktionalitet |
| --- | --- | --- |
| GPS och instrumentanslutning | En seriell USB-port; NMEA GGA/RMC och DPT/DBT. Position och djup visas, fart läses från RMC. | Visa fart och kurs, skilj kurs över grund från kompassriktning och stöd anslutning av flera instrument. Verifiera NMEA 0183 från version 1.5 och virtuella COM-portar. |
| Position på kartan | Livepunkter visas som mätspår när både GPS och djup finns. | Egen båtsymbol även utan ekolod, riktningsvisning, automatisk kartcentrering och automatiskt byte av sjökort när båten lämnar kartområdet. |
| Rasterkort och egna kartor | PDF, enkel läsning av GeoPDF-referenspunkter och internetbaserad OSM/OpenSeaMap-karta. | Läs BSB/KAP version 1–3 och GEO/NOS samt egna PNG-, BMP- och andra vanliga bildformat. Lokala kort ska fungera utan internet. Krypterade BSB/CAP ingår inte: SeaClear stöder dem inte enligt underlaget. |
| Kalibrering och geografi | Tvåpunktskalibrering för nordriktad PDF; tre eller fler punkter ger affin anpassning som kan hantera rotation och skevhet. | Kartprojektioner, geodetiska datum och omvandling till GPS-koordinater; kalibrering av bildkort, kontroll av kalibreringsfel och redigerbar kartgräns. Nuvarande affina modell är inte ett generellt projektions- eller datumstöd. |
| Rutter | Saknas. | Skapa, spara, redigera, sammanfoga och aktivera rutter; konvertera spår till rutt. Ingen fast gräns för antal rutter eller ruttpunkter utöver tillgängliga resurser. |
| Aktiv ruttnavigation | Saknas. | Navigering mellan ruttpunkter, bäring, tid till nästa punkt och till ruttens slut, styrindikator, avvikelse från rutt (XTE) och XTE-larm samt navigationsutdata via NMEA. |
| Waypoints | Viss waypoint-TXT kan importeras som djupmätningar; mätpunkter kan exporteras som waypoint-TXT. | Fristående waypoints utan krav på djup, med namn och information; skapa och redigera, spara flera waypointfiler, slå ihop filer och söka en punkt så att rätt karta öppnas och centreras. Ingen fast antalsgräns. |
| Spår | Import av TXT/CSV och en TRC-variant, flera färgade spår, punktredigering, gallring och löpande sparande av livepunkter. | GPS-spår även utan djup, spår till rutt och verifierad återöppning av sparade spår. TRC-läsaren läser nu position/djup men sätter fart till noll och saknar tid; utred och bevara tillgängliga fält. |
| Loggbok | Rå-NMEA och mät-CSV sparas, men separat loggbok saknas. | Manuella och automatiska textposter med tid, position och händelse. En rå instrumentlogg ersätter inte loggboken. |
| Import, export och GPS-överföring | Mätspår importeras; CSV och SeaClear waypoint-TXT exporteras. | Rutter, waypoints och spår via G7ToWin samt G7T och Waypoint+ textformat; uppladdning av rutter och waypoints till kompatibla NMEA-enheter. Befintlig waypoint-export bevisar inte full formatkompatibilitet. |
| Ekolod, vind, kompass och AIS | Ekolod finns delvis via DPT/DBT och manuell givarjustering. | Vind- och kompassdata, AIS-avkodning och mål på kartan; tydliga enheter och hantering av instrumentets respektive användarens djupoffset. |
| GPS-logg, timmar och bränsle | Saknas som sammanställda instrumentvärden. | GPS-baserad distansräknare, timräknare och uppskattad bränsleförbrukning med inställbar förbrukningsmodell. |
| Kartarbetsyta och nattläge | Zoomknappar, mushjul och panorering finns. | Större kartarbetsyta med döljbara paneler, snabbåtkomst via högerklick och nattlägen som även tonar ned själva kartan. |
| Översättning | Svenska texter ligger direkt i gränssnitt och kod. | Externa, användarredigerbara språkfiler, språkval och flera medföljande språk. |

PDF-fältmanus, Roxens vattenstånd, djupkorrigering, gallring och det beständiga filbiblioteket är befintliga funktioner som ska behållas genom arbetet.

### Prioriterad genomförandeplan

Etapperna är föreslagen arbetsordning, inte tidslöften. Varje etapp avslutas med ett demonstrerbart flöde och relevanta automatiserade tester. Kartformat och fysisk instrumentkompatibilitet behöver undersökas innan en trovärdig kalenderplan kan fastställas.

#### Etapp 1 – Tillförlitlig GPS och grundnavigation

- [ ] Separera GPS-navigation och spårloggning från kravet på ekolodsdjup. Visa båtsymbol, position, fart och kurs över grund direkt från GPS.
- [ ] Inför följ-båt-läge med möjlighet att panorera manuellt och återgå till följning.
- [ ] Inför separata tidsstämplar och status för GPS och djup; markera ogiltig eller gammal data. Nu kan ett tidigare djup återanvändas utan ålderskontroll, och ogiltig GPS nollställer inte den sparade positionen.
- [ ] Hantera bortkoppling, återanslutning och normal avslutning av dataströmmen. Testa skrivfel och återställning efter avbruten session.
- [ ] Verifiera att sparade spår kan läsas tillbaka utan förlust av position, tid, fart och djup. Kontrollera även appens egen semikolonavgränsade CSV-export mot importen som nu delar på komma.

**Klart när:** en inspelad GPS-ström utan ekolod visar båten, flyttar kartan och sparar ett återöppningsbart spår. Avbrott och föråldrade värden syns tydligt och ger inte nya till synes giltiga mätningar.

#### Etapp 2 – Sjökort, kalibrering och automatiskt kartbyte

- [ ] Skapa gemensam kartmodell för bild, geografisk utbredning, skala, projektion, datum, kalibrering och kartgräns.
- [ ] Lägg till PNG/BMP och därefter BSB/KAP 1–3 samt GEO/NOS. Samla representativa provfiler och dokumentera vilka varianter som stöds.
- [ ] Utöka kalibreringen med kontrollpunkter, felvisning, datum-/projektionshantering och redigerbar kartgräns.
- [ ] Indexera kartornas täckning och välj lämpligt kort automatiskt vid förflyttning, med möjlighet att välja kort manuellt.

**Klart när:** lokala provkort öppnas utan internet, kända koordinater hamnar inom en i förväg bestämd tolerans och en simulerad färd växlar mellan överlappande kartor. Jämförelsefilen anger inte exakt vilka projektioner och datum SeaClear stöder; den kompatibilitetslistan måste fastställas och verifieras innan full likvärdighet kan hävdas.

#### Etapp 3 – Waypoints och ruttplanering

- [ ] Inför beständiga modeller för fristående waypoints och rutter, separat från djupmätningar.
- [ ] Bygg kartredigering för att lägga till, flytta, namnge och ta bort punkter samt ordna ruttpunkter och sammanfoga rutter.
- [ ] Stöd flera waypointfiler, sammanslagning och sökning som öppnar rätt karta och centrerar punkten.
- [ ] Konvertera ett sparat spår till en redigerbar rutt.

**Klart när:** användaren kan skapa två rutter, slå ihop dem, starta om appen och fortsätta redigera. En waypoint utan djup kan sparas, hittas och visas på rätt karta. Stora punktmängder provas utan konstgjorda antalsgränser.

#### Etapp 4 – Aktiv ruttnavigation och NMEA-utdata

- [ ] Implementera aktivering av rutt, byte av aktivt ben och ankomst till nästa waypoint.
- [ ] Beräkna bäring, avstånd, XTE, tid till nästa punkt och total återstående tid; hantera stillastående och saknad fart.
- [ ] Visa styrindikator och konfigurera XTE-larm.
- [ ] Implementera navigationsutdata och överföring av rutter/waypoints via NMEA till mottagare som stöder detta. Utgående överföring ska aktiveras uttryckligen i gränssnittet.

**Klart när:** en simulerad rutt ger kontrollerade beräkningsresultat, korrekt punktväxling och XTE-larm. Utdata verifieras med referensmeddelanden och minst en kompatibel fysisk mottagare.

#### Etapp 5 – Övriga instrument och loggbok

- [ ] Stöd flera instrumentkällor och inställningar per port; komplettera med vind och kompass samt korrekt åtskillnad mellan kompassriktning och GPS-kurs.
- [ ] Avkoda AIS, inklusive meddelanden i flera delar, och visa mål med tillgängliga identitets- och rörelsedata. Markera eller ta bort gamla mål.
- [ ] Lägg till automatisk och manuell loggbok i textfil.
- [ ] Lägg till GPS-distans, timräknare och beräknad bränsleförbrukning med dokumenterade antaganden och möjlighet till nollställning.

**Klart när:** inspelade GPS-, djup-, vind-, kompass- och AIS-strömmar kan köras tillsammans och ge rätt visning. Manuella och automatiska loggboksposter finns kvar efter omstart; distans, timmar och bränsle stämmer för ett känt provförlopp.

#### Etapp 6 – Filutbyte, nattläge och språk

- [ ] Implementera och verifiera G7T, Waypoint+ och arbetsflöden med G7ToWin för rutter, waypoints och spår. Bevara relevanta namn, koordinater, ordning och tidsuppgifter vid export och återimport.
- [ ] Lägg till högerklicksmenyer och döljbara paneler för större kartarbetsyta.
- [ ] Inför nattlägen för både reglage och kartbild.
- [ ] Flytta texter till språkfiler som kan redigeras utan specialverktyg; leverera minst svenska och engelska.

**Klart när:** provfiler kan utbytas med referensprogrammen, kartan kan användas i nattläge och hela gränssnittet växlar språk utan kodändring.

#### Etapp 7 – Verifiera likvärdighet i praktiken

- [ ] Upprätta en acceptanschecklista för varje rad i jämförelsetabellen och dokumentera kvarvarande begränsningar.
- [ ] Kör en sammanhängande provtur med kartbyte, rutt, waypoints, instrument, AIS, loggbok och export, först med inspelad data och därefter på båt.
- [ ] Prova långvarig loggning, stora kart-/spårsamlingar, USB-avbrott, saknat internet och omstart. Verifiera att sparade data kan återställas.
- [ ] Kör projektets tester och syntaxkontroller samt verifiera Windowsinstallation och uppdatering inför release.

**Klart när:** alla funktioner i underlaget har ett godkänt, dokumenterat acceptansprov och inga återstående luckor döljs bakom statusen ”delvis”.

### Avgränsningar och separata förbättringar

Funktionsmålet gäller SeaClear II enligt den lokala jämförelsefilen, inte stöd för dess historiska Windowsversioner. Nuvarande Electron-app har en annan plattformsbas. Samma utseende krävs inte för funktionslikvärdighet.

NMEA över nätverk, NMEA 2000, Signal K, WCI-import, avancerade AIS-kollisionslarm och fler sjöars vattenstånd kan vara värdefulla, men är inte uttryckliga krav i `seaclear2.txt`. De ska planeras separat. WCI nämns i de äldre anteckningarna och kan prioriteras om befintliga fältmanus kräver det.

För sjömätningen bör även båt, operatör, instrument, antenn-/givaravstånd och vattennivåreferens sparas som sessionsmetadata. Precisera också råloggsgarantin: i dag sparas mottagna textrader med normaliserade radslut och en tillagd metadataheader; byteexakt råinsamling kräver en separat ändring. Detta är kvalitetsförbättringar utöver SeaClear-jämförelsen.

### Simulerad båttur utan USB

Klicka på **Starta simulerad båttur på Roxen** i den egna kollapsbara panelen **Simulerad båttur**. Simulatorn öppnar en karta över Roxen och kör en fiktiv båt i en slinga med 5 knops fart och varierande djup. Välj 1×, 10× eller 60× före start; 10× är standard. En pil visar båtens position och riktning. Kartbakgrunden kräver internet.

Simulatorn genererar checksummekontrollerade NMEA 0183-meningar (RMC och DPT) varje sekund genom samma parser och loggning som USB-mätning. Tidsfaktorn accelererar både rörelsen och NMEA-klockan. Klicka **Stoppa och spara spåret** när du är klar. Spåret och mätmappen märks SIMULERAD; råloggen innehåller också `simulated: true`. Djupen är påhittade. Detta är en intern simulator och skapar ingen COM-port för andra program.


## Att göra – genomfört 2026-09-13

- [x] Visa inte filändelsen i kartan för fältmanus.
- [x] FÄLTVERKTYG längst upp kan tas bort. Titeln Sjömätning v0.2.20 · uppdaterades senast 2026-09-13, räcker. Ta med v0.2.20 - 2026-09-13 i titeln enbart.
- [x] Anpassa knappen är otydlig, byt namn på den.
- [x] När man klickar så att man ser färg på spår för att jämföra, ha en legend bredvid någonstans som visar vad som är vad. På kartan då.
- [x] De som heter "importerade spår" är svåröverskådlig. Dessutom har den duplicerad information, då samma info finns i "spår".  Lägg till en knapp visa/dölj spår bredvid "anpassa", där det också står hur många spår som är i bild. När man klickat på visa spår, då ska dessa spår dyka upp som "importerade körningar, i en losskopplad panel ner till höger.
- [x] I panelen importerade körningar. Ta bort namnet Importerade körningar.  Ta bort Vattenstånd 33.31 m · korrektion -0.31 m. Lägg till info i frågetecknet om att vattennivån kommer från tekniska verken, och att datumet gissas från filen.
- [x] När jag håller musen över en mätpunkt. Skriv inte ut knop om det är 0.0. Lägg in klockslag om det finns, bredvid datumet. Skriv ut filnamnet i förkortat form som en brurik på det. Skriv ut Long och lat.
- [x] Vid jämför synliga spår, visa inte spår som inte har matchande punkter. Sortera listan på antal matchande punkter.
- [x] I panelen mätningar, där ska det stå: visa spår synliga i kartan

Knappen **Visa hela kartan** återställer Roxenöversikten eller passar in det öppna PDF-manuset. **Visa/dölj spår** öppnar och stänger panelen nere till höger; antalet anger visade spår med punkter i kartutsnittet. Panelens kryssrutor styr spårens synlighet. **Visa spår synliga i kartan** i mätpanelen öppnar samma panel. Färglegenden visar synliga spår i utsnittet när **Färg: spår** är valt. Jämförelser sorteras med flest matchningar först. Version och byggdatum hämtas från det aktuella bygget.

UI-regressioner körs med `npm run test:map-ui` och `npm run test:library-ui`. De kör den riktiga Electron-renderaren med isolerade testdata och simulerade externa tjänster. Karttestets GeoPDF-prov kräver den lokala filen i `testdata/fältmanus-geodata/`.
