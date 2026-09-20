# Mobil-PWA: Sjömätning GPS

Gemensam kod och samma funktioner för Android och iPhone/iPad. Adress: `/mobile/`. Ingen appbutik, IPA-signering eller Apple Developer-avgift behövs. Den äldre Android-appen finns kvar tills vidare; PWA:n är den aktuella gemensamma mobilappen.

## Installation

- **iPhone/iPad:** öppna `/mobile/` i Safari, välj **Dela → Lägg till på hemskärmen**, och öppna appikonen. Ange webbnyckeln i den installerade appen och synka en gång.
- **Android:** öppna samma adress och välj **Installera** eller **Installera app / Lägg till på startskärmen** i webbläsarmenyn.
- Tillåt exakt plats. GPS används medan appen är öppen. Vid skärmlås eller byte av app stoppas positionsbevakningen; återkomst begär nya positioner. Ingen bakgrundsloggning utlovas.

## Lagring och synkning

Punkter sparas i IndexedDB före bekräftelse. Sparandet kräver varken nyckel eller internet. Aktuell GPS-position måste vara högst 15 sekunder gammal och ha högst 30 meters rapporterad osäkerhet. Datum/tid sätts vid sparandet och exporteras i UTC. Redigering behåller tiden. Alla lokala punkter kan exporteras till CSV.

Personlig webbnyckel sparas i enhetens IndexedDB och skickas som Bearer-header över HTTPS. Den omfattas av samma serverbehörigheter och spärrkontroller som webbens sessionsinloggning. PWA:n använder inte sessionskakan, så ett annat webbfönsters inloggning kan inte byta konto mitt under en synkning. **Glöm sparad nyckel** tar bort nyckeln, inte mätpunkterna. Bibliotek och synkkvitton skiljs åt per konto. Endast betrodda skript från den egna webbplatsen körs (CSP).

Synkning körs vid start med sparad nyckel, när nätverket återkommer medan appen är öppen och vid återkomst till appen efter minst en minut. Den kan också startas manuellt. Web Locks hindrar samtidiga synkningar i flera fönster. Gränssnittet kan fortfarande spara och redigera punkter under nätverksanrop; IndexedDB-transaktioner och versionskontroller bevarar dessa ändringar till nästa synk.

Punktsynken är enkelriktad till webbbiblioteket, som i Android-appen. Varje version får ett stabilt SHA-256-synk-id och ett lokalt kvitto per konto. En avbruten överföring återupptas utan dubbla filer. Nya versioner laddas upp innan gamla webbkopior tas bort. Även försök utan mottaget kvitto sparas, så en senare borttagning kan hitta en uppladdning vars svar gick förlorat. Borttagningar behålls som lokala markeringar för återförsök med rätt konto. Bara egna, kvitterade webbkopior tas bort. Äldre Android-punkter och filer från andra enheter visas i den fullständiga webbkartan; de importeras inte automatiskt till PWA:ns lokala punktlista.

PDF-, WCI- och KAP-original sparas i IndexedDB. Samma fil-id på servern har oföränderligt innehåll och hämtas inte igen om den redan finns i rätt storlek. Filförteckning och PDF-kalibrering publiceras lokalt först när alla filer hämtats. Vid avbrott finns det gamla biblioteket kvar; nästa synk återanvänder redan hämtade filer. Borttagna original rensas efter lyckad synk. Manuellt kalibrerade PDF:er använder samma kalibreringsnycklar som webben. Kartor från OpenStreetMap/OpenSeaMap behöver normalt nätverk och lagras bara av webbläsarens normala HTTP-cache.

Service workern sparar bara det versionsmärkta appskalet och kartans programfiler. API-svar och nycklar läggs aldrig i denna cache. Uppdateringar aktiveras när tidigare appfönster stängts. `navigator.storage.persist()` efter användaråtgärd begär skydd mot automatisk rensning där webbläsaren medger det. Användaren kan fortfarande rensa webbplatsdata, och utrymmesbrist kan hindra nya skrivningar; synka eller exportera värdefulla mätningar.

## Bygg och verifiera

- `npm run web:build`: bygger webbplatsen och mobilappen med innehållshashad offlinecache.
- `npm test`: enhetstester och API-integration med lokala D1/R2-bindningar.
- `npm run test:mobile-ui`: lokal syntetisk webbläsarregression i Electron/Chromium, med verklig IndexedDB och service worker. Kräver att Electron får starta sina processer.
- `npm run web:deploy`: publicerar på den befintliga Cloudflare-webbplatsen.

Mobiltestet täcker GPS-validering, redigering, borttagning, lokal beständighet, uppstartssynk, återförsök utan dubbletter, förlorade uppladdningssvar, kontogränser, utebliven dubbelhämtning, avbruten manushämtning, rensning efter serverborttagning, offlineomstart och offlinevisning av PDF-, WCI- och KAP-manus samt redigering under pågående uppladdning. Fysisk GPS, installationsdialog och lagringsbeteende bör också provas på riktiga Android- och iOS-enheter.

Samma regressionssvit har även körts i Playwright WebKit (Safari-motorn). För att upprepa det: installera Playwright och dess WebKit-browser separat, sätt `MOBILE_BROWSER=webkit`, `MOBILE_PLAYWRIGHT_PATH` till Playwright-modulen och vid behov `PLAYWRIGHT_BROWSERS_PATH`, och kör `node scripts/mobile-ui-regression.cjs`. Funktionstesterna körs med appens ordinarie CSP. Skärmbilder tas bara i Chromium eftersom Playwrights WebKit-skärmbildshjälpare injicerar inline-CSS som appens CSP avvisar. Detta ersätter inte prov på fysiska telefoner.

Publicerad version verifierades också via HTTPS: manifest, ikoner, service worker, API-autentisering och Chromium-omstart med nätverket blockerat i en isolerad testprofil. WebKit-regressionens offlineprov stänger testserverns åtkomst; Playwrights `context.setOffline(true)` har ett känt fel för service-worker-navigation ([#42775](https://github.com/microsoft/playwright/issues/42775)).
