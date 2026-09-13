# Anteckningar i fältmanus

1. Välj **Anteckna** på ett fältmanus i biblioteket. PDF, WCI och KAP stöds. Manuset öppnas som en separat arbetsyta där texten placeras i själva bilden.
2. Skriv i **Text**, välj textstorlek och färg, tryck **Placera i manuset** och klicka på platsen. Siffror skrivs på samma sätt som annan text. Radbrytningar, å, ä och ö stöds.
3. Klicka på en befintlig text för att flytta den. Texten följer muspekaren; nästa klick sparar den nya positionen. **Avbryt placering** lämnar den gamla positionen kvar.
4. Dubbelklicka på texten eller välj den i listan för att ändra den. Ändringar sparas automatiskt efter en kort skrivpaus. Kryssknappen i listan tar bort anteckningen. **Ny anteckning** börjar en ny text.
5. Välj **Exportera ny PDF** och ange ett nytt filnamn.

Anteckningar sparas separat med biblioteksposten och finns kvar efter omstart. Originalfilen ändras inte. Meddelandet i panelen visar om en ändring har sparats eller om ett skrivfel uppstått. Export och byte av manus väntar på pågående textändringar. Placeringar nära kanten flyttas in så att texten ryms; för stor text måste förkortas eller minskas.

Anteckningsverktyget arbetar på första sidan. Vid export av ett PDF-manus bevaras samtliga ursprungliga sidor, deras rotation och beskärning samt ursprunglig PDF-grafik. Anteckningarna läggs till som text. WCI och KAP exporteras till en ensidig PDF med samtliga originalpixlar och en sidstorlek beräknad med 300 dpi. Detta är inte en garanti för kartans ursprungliga tryckskala; WCI-/KAP-exporten får inte automatiskt GeoPDF-kalibrering.

Anteckningarna syns även när manuset visas ovanpå översiktskartan. PDF-exporten innehåller själva manuset och dess sparade anteckningar, inte OSM-bakgrund, instrumentpaneler eller separata mätspår. Den exporterade kopian är för visning och utskrift; fortsätt redigera anteckningarna på originalets bibliotekspost. Standardtypsnittet i exporten stöder västeuropeiska bokstäver, siffror och vanliga symboler, men inte alla Unicode-tecken eller emoji. Tecken som inte kan exporteras ger ett tydligt fel i panelen.

## Verifiering

- `npm test`: validering, beständig lagring, ändring/borttagning, skydd av originalinnehåll, sidrotation och beskärning samt KAP-export.
- `npm run test:annotations-ui`: placering, enkelklick med flyttförhandsvisning, dubbelklick, automatisk lagring, omstart, skrivfel och export i den riktiga Electron-renderaren. Exporten öppnas i PDF.js och textens position jämförs med den sparade placeringen. Kräver Granholmens WCI-prov i `testdata/fältmanus-seaclear`.
- PDF-filer och renderade kontrollbilder skrivs till `tmp/pdfs/`. Kontrollbilderna används för visuell verifiering av text, kartbild och radbrytningar.
