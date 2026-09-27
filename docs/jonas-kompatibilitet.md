# Jonas-kompatibilitet

Desktop och webb delar stödet nedan. Mobil-PWA och Android har inte fått motsvarande importgränssnitt. Originalmaterialet i `FrånJonas/` är fortsatt ignorerat av Git.

## Observationer (.obs)

Välj **Importera OBS** i observationsdagboken. `KodObservationFile`, version 1, stöds med noteringar, djupobservationer och tilläggningsplatser. Mätpassets båt, område och vattenstånd följer med. Tilläggningsplatser visas med flera positioner som kan redigeras i dagboken. Observationerna använder dagbokens vanliga lagring och synkning.

Gamla filer saknar klockslag per observation. Dessa visas med datum och **klockslag saknas**; bocka i **Klockslag är känt** för att ange en tid. Okända tilläggsfält bevaras vid OBS-export. Upprepad import av samma fil hoppas över, även om en tidigare importerad observation har raderats. En ändrad källfil räknas som en ny import.

**Exportera OBS** skriver ett valt mätpass och datum. Jonas-formatets referens är 33,00 m RH00; andra referenser avvisas för att undvika felaktiga djup. Kända klockslag skrivs som ett extra Sjömätning-fält. JSON-export behåller hela vår observationsmodell.

## Kartkalibrering och djupfyrkanter

PDF-bilagan `chart_metadata.json` med format `roxenkortet.chart`, version 1, läses automatiskt. Kalibreringen beräknas på samma sätt som i Jonas kod, separat för varje sida. Rotation och undantagsytor hanteras. **Öppna sida** öppnar dokumentet; sidvalet väljer vilken sida som visas och exporteras. Kartöversikten använder dokumentets första sida.

I **Exportera kart-PDF**, välj lagret **Djup i fyrkanter**. Röda fyrkanter hittas i originalets vektorgrafik och fylls från synliga spår och djupobservationer inom varje ruta:

- Stångmätning prioriteras; det grundaste värdet används.
- Tre andra värden används bara om spridningen är högst 0,10 m.
- Fyra eller fler värden medelvärdesbildas efter att minsta och största tagits bort.
- Otillräckligt underlag lämnar rutan tom. Exporten redovisar ifyllda och återstående rutor.

Beräkningen använder korrigerade djup enligt appens vattenstånds- och djupinställningar. För TRC följs dessutom Jonas rådatafilter: 0,2–50 m och borttagning av identiska efterföljande positioner/djup. Detta gäller rutberäkningen; importerade original ändras inte. Spårens visuella punktglesning påverkar inte rutunderlaget.

PDF-exporten skapar våra egna valbara lager. Reglage för original-PDF:ens befintliga lager, automatisk flersidig atlas och georefererad export återstår.

## Garmin och andra produkter

Genomsökning av Jonas kod och provmaterial gav inget Garmin-specifikt format eller någon Garmin-modell. Hans inläsare använder SeaClear TRC, OBS och NMEA. TRC-importen läser nu även hastighet och lagrade tidsstämplar samt hanterar en ofullständig slutpost med varning.

GPX 1.0/1.1 kan importeras som spårfiler i biblioteket och synkas till webben. Spår, rutter, waypoints och segmentgränser stöds. Garmin-djup läses från `GpxExtensions/v3` och `TrackPointExtension/v1` eller `v2`, i meter. Höjd (`ele`) används aldrig som djup. Saknade tider eller djup fylls inte med påhittade värden. Ett GPX-spår utan djup kan alltså visas men bidrar inte med djup till rutorna.

GPX är ett utbytesformat; direktimport av Garmin FIT, ADM och GDB ingår inte. Befintligt stöd för Lowrance SL2/SL3 och NMEA finns kvar. Kontroll mot en verklig Garmin-export återstår eftersom sådana provfiler saknas i Jonas material.

## Verifiering

Automatiska tester täcker OBS-returkonvertering, okända fält, datum utan tid, tilläggningsplatser, Garmin GPX-djup, segmentgränser, roterad PDF-kalibrering och rutregler. Gränssnittstest täcker OBS-filval, redigering och export samt PDF-export i desktop och webb. API-test omfattar GPX-uppladdning med personlig nyckel.

En lokal jämförelse mot Jonas Python-kod verifierade 158 kalibrerade sidor i 48 PDF-filer, 7 128 identifierade djupfyrkanter, 124 observationer och 56 TRC-filer. Referensmaterialet och det genererade jämförelseunderlaget ligger utanför Git. `scripts/check-jonas-reference.mjs` kan köra om jämförelsen när `tmp/jonas-reference.json` finns lokalt.
