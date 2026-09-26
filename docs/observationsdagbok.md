# Observationsdagbok

Dagboken finns i desktopappen och i det fullständiga webbgränssnittet under **Observationsdagbok → Öppna dagboken**. Den fristående mobil-PWA:n är inte utbyggd med dagbok i denna version.

## Skriva och redigera

1. Välj **Ny händelse**. Datum och klockslag fylls i från datorn när utkastet öppnas.
2. Skriv händelsen. Ändra datum/tid om du registrerar något i efterhand.
3. Djup är frivilligt och anges i meter (0–12 000). Värdet sparas som angivet, utan automatisk vattenståndskorrigering. Ett tomt fält betyder att djup saknas.
4. Position är frivillig: ange både latitud och longitud i decimalgrader eller välj **Använd aktuell GPS-position**. Desktop använder aktuell instrumentposition om den är färsk, annars försöker webbläsarens platsfunktion hämta position. Det går alltid att spara utan position.
5. Välj **Spara händelse**. Klicka på en sparad händelses datum i listan för att ändra den och spara igen.
6. **Ta bort händelse** kräver bekräftelse. En borttagningsmarkering behålls för att också ta bort händelsen på andra enheter vid nästa synkning.

Välj **Välj position i kartan** för att lägga till eller ändra koordinaten genom ett kartklick, även i efterhand. Formuläret döljs medan du väljer; du kan panorera och zooma. Efter klicket kommer samma utkast tillbaka med ifyllda koordinater. Välj **Spara händelse** för att behålla ändringen. **Avbryt** eller Escape lämnar koordinaten oförändrad.

Sparade händelser med koordinater visas automatiskt som lila **H**-markeringar på kartan och kalibrerade fältmanus. Angivet djup visas bredvid markeringen. Klicka på en markering för att öppna händelsen i dagboken. Händelser utan koordinat finns i listan; borttagna händelser visas inte i kartan. Synka eller läs in dagboken igen för att uppdatera markeringar efter ändringar från andra enheter.

Datum/tid visas och redigeras i enhetens lokala tidszon. Lagring och export använder UTC, vilket också står i CSV/PDF. Tidpunkten ändras inte automatiskt när texten redigeras. Osparad text varnas för när man lämnar formuläret. En explicit sparknapp bekräftar när skrivningen lyckats.

## Spara och synka

Desktop sparar till `observations/journal.json` i appens datamapp, med serialiserade ändringar och temporär fil före ersättning. Det fungerar utan internet. **Synka med webben** i dagboken skickar lokala ändringar och hämtar webbändringar; detta är separat från bibliotekets befintliga enkelriktade filsynkning. Samma krypterade webbnyckel används och kan anges vid första synkningen.

Webbgränssnittet sparar direkt på servern och kräver internet. **Läs in igen** hämtar ändringar från andra enheter. Varje nyckel har en egen dagbok, även för behörigheten Hela biblioteket och admin. Ersätt nyckel bevarar ägar-id och därmed dagboken. Desktopdagboken knyts till kontot vid första lyckade API-kontakten; byte till ett annat konto nekas för att undvika att händelser laddas upp till fel person.

Varje serverändring kontrollerar föregående revision. Vid samtidiga ändringar behåller desktop den egna versionen och visar webbversionen som en konflikt. Välj **Behåll min ändring** och synka igen, eller **Använd webbversion**. I webben ger en gammal revision ett fel och lämnar formulärets text kvar; kopiera vid behov ditt utkast innan du väljer **Läs in igen**. Avbrutna desktopöverföringar kan återförsökas utan dubbletter. Ändringar under pågående desktopsynk serialiseras med synkningen.

## Exportera

Exporten omfattar alla sparade, ej borttagna händelser i den aktuella dagboken, i tidsordning. Spara utkast före export. Synka först om webbens senaste ändringar ska ingå.

- **JSON:** komplett händelsedata med stabila id:n, UTC-tid, text, valfritt djup och position. Format `SjomatningObservationJournal`, version 1. Detta är inte Jonas `.obs`-format; import är ännu inte implementerad.
- **CSV:** semikolonseparerad UTF-8 med kolumnrubriker, korrekt citering och skydd mot formler i textceller. JSON bevarar texten exakt om CSV behöver ett skyddande apostroftecken.
- **PDF:** fristående A4-dokument med datum/tid i UTC, position, angivet djup, händelsetext, sidbrytningar och sidnummer. Detta är en dagboksrapport, inte export av mätspår ovanpå sjökort. Å, ä och ö stöds; tecken utanför PDF-standardtypsnittets teckenuppsättning ger ett tydligt fel. JSON bevarar även sådana tecken.

## Driftsättning och kontroll

Serverdelen behöver D1-migrationen `web/migrations/0003_journal.sql` innan den nya versionen används. Kör projektets D1-migrationer mot rätt lokal eller produktionsdatabas och bygg sedan webben enligt `web/README.md`. Ingen befintlig fil- eller nyckeltabell ändras.

- `npm run test:web-api` provar verklig lokal D1: kontoavskiljning, synkning åt båda håll, redigerad tid, borttagning, samtidiga ändringar och återförsök efter förlorat svar.
- `node --test test/journal.test.mjs` provar validering, export och flersidig PDF.
- `npm run test:journal-ui` provar dagboksflödet i dolda Electron-fönster för desktop och det byggda webbgränssnittet, inklusive lagring efter omladdning, redigering, borttagning samt JSON- och PDF-export. Kör `npm run web:build` först. Kontrollbilder och PDF hamnar under `tmp/`.
