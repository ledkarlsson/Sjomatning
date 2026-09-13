# Kartans regressionstest

Kör `npm test` för beräkningstester och `npm run test:map-ui` för Electron-testet.
Electron-testet öppnar ett dolt fönster med den riktiga renderaren, isolerade testdata
och syntetiska kartbilder. Det kontrollerar startläge, kartans storlek, musdrag som
hämtar nya områden, zoomknappar, Sverige-översikt, återgång till Roxen och ändrad
fönsterstorlek. JavaScript-fel gör testet rött. En skärmbild sparas i
`tmp/map-regression.png`. Testet behöver ingen internetanslutning.

Beräkningstesterna täcker dessutom panorering i fyra riktningar, zoomens position
under muspekaren och att kartbilderna täcker hela vyn även vid mellanliggande zoomnivåer.

Testet öppnar också ett genererat PDF-manus och kontrollerar upprepad panorering i båda axlarna, panorering efter zoom, centrering med Anpassa samt döljning av vänstermenyn med bibehållen PDF-zoom. Informationspanelen ska vara dold för webbkartan men synlig för PDF-manus.
