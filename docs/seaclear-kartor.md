# SeaClear-kartor och översiktsvisning

## Import

Lägg till WCI, KAP eller BSB via bibliotekets filväljare, mappval eller drag-and-drop. De visas under **Fältmanus**. **Gå till plats** centrerar kartans inbäddade gräns och aktiverar fältmanuslagret. Originalfiler lagras i det beständiga biblioteket; namnändring, borttagning och återstart fungerar som för PDF.

En BSB-fil är ett index, inte en bild. Importen läser dess `FN=`-referenser och hämtar KAP-filer från samma mapp (skiftlägesokänsligt). Saknade KAP-filer ger ett fel med filnamnet. Indexet får inte peka utanför mappen. KAP-bilderna dedupliceras; indexet blir inte en extra kartpost.

## Verifierat 2026-09-13

Alla åtta WCI-filer och båda KAP-filerna i `testdata/fältmanus-seaclear` har avkodats i full ursprunglig storlek, inklusive varje bildrad. WCI-proven innehåller enfärgade rader, RLE och zlib-komprimerade rader. Bild och färgpalett har granskats för Granholmen och B08 Roxen.

- WCI: version 1, sexbitars färgindex, upp till 64 palettfärger, WGS84, `PR=2`, ingen koordinatförskjutning. Kalibrering använder fyra kontrollpunkter och bilinjär interpolation.
- BSB/KAP: version 1–3, 1–7 bitars RLE-palett, WGS84 och Mercator/Transverse Mercator med minst fyra referenspunkter och ingen datumförskjutning. De två verkliga proven är version 1.1. Syntetiska tester verifierar noll- och ettbaserade radnummer.
- KAP-provens 3×3 referensnät anpassas med ett andragradspolynom. Största residual mot de inbäddade kontrollpunkterna är under 0,000000563 grader (under cirka sju centimeter). WCI-kontrollpunkterna återges inom numerisk avrundning. Detta är kontroll mot filens egna data, inte oberoende fältverifiering eller generellt projektions-/datumstöd.
- `B1…` respektive `PLY/` används för kartgräns, klippning och centrering. Därmed täcker inte WCI-manusens stora vita marginaler andra kartor.

Övriga WCI-varianter, färgdjup, datum och projektioner avvisas med feltext. Stöd för alla SeaClear-kartor hävdas inte. Kartbilden begränsas till 3 000 pixlar på längsta sidan i visningen, medan originalfil och geografisk kalibrering behålls. Lokala kartbilder ritas även utan internet; OSM-bakgrunden kräver fortfarande nätverk.

BSB-bildkodningen bygger på [libbsbs formatbeskrivning](https://libbsb.sourceforge.net/bsb_file_format.html). WCI-radformatet har analyserats från de lokala provfilerna och kontrollerats med hela bildrader; ingen extern WCI-avkodare ingår.

## Stora spår

Vid första användning byggs ett rumsligt index för spårets punkter. Zoomning, panorering, punkträkning och träfftest använder indexet i stället för att upprepat kopiera och gå igenom alla punkter. Endast punkter i kartutsnittet hämtas för visning. Små kluster visas med grundaste rådjupet som representant; närmare zoom ger fler detaljer. Indexet förnyas efter redigering, gallring eller nya livepunkter. Djupjustering tillämpas på visningsvärdena.

Importen läser fortfarande hela originalspåret en gång. Urvalet är enbart för skärmvisning: sparande, punktredigering och export använder hela spåret med användarens eventuella uttryckliga gallring. Testfallet med 200 000 tätt samlade punkter ritas som en punkt i Sverigeöversikten.

## Regressioner

`npm test` inkluderar syntetiska tester för bildrader, komprimering, kalibrering, BSB-index och punkturval. `npm run test:seaclear-ui` kräver den lokala provmappen och provar tio kartposter, WCI-/KAP-visning utan nätverk och 200 000 punkter i den riktiga Electron-renderaren. Kör också de befintliga kart- och biblioteksregressionerna.
