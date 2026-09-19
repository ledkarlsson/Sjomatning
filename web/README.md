# Sjömätning på webben

Webben återanvänder appens kartmotor, filtolkning, spårjämförelse, punktredigering och PDF-export. Desktop-appen startar som tidigare med `npm start`.

## Användning

- Logga in med en personlig åtkomstnyckel. Sessionskakan är signerad, HttpOnly, Secure och SameSite=Strict och gäller i sju dagar.
- Administratören skapar och spärrar nycklar via **Åtkomstnycklar**. Nyckeln visas endast vid skapandet; databasen lagrar en SHA-256-hash. En spärr gäller även befintliga sessioner.
- **Hela biblioteket** får läsa och ändra alla filer. **Egna spår** får endast läsa, ladda upp, ändra och radera sina egna spår. Bara administratören administrerar nycklar.
- PDF, WCI och KAP kan visas som i appen. Ladda upp tillhörande KAP-filer tillsammans med BSB-index; webbläsaren kan inte leta efter filer som inte har valts. Indexet finns under Hämta original.
- TXT/CSV, SeaClear TRC och Lowrance SL2/SL3 använder samma parser och formatbegränsningar som appen.
- **Skapa spår**: klicka i kartan, ångra punkter eller klistra in `latitud;longitud;djup` (djup är valfritt). Spara online. Spåret kan därefter redigeras i spårpanelen och exporteras till CSV. Inga djup eller datum hittas på för planerade spår.
- **Hämta original** hämtar uppladdade original; arbetskopians redigeringar och kalibrering sparas separat. Kalibrering synkas vid nästa inloggning/omladdning.

## Drift

Cloudflare Worker `sjomatning-web`, D1 `sjomatning-library`, privat R2-bucket `sjomatning-library`. Alla fil-API:er kontrollerar behörighet på servern; ingen publik R2-adress används. Statiska programfiler är publika, biblioteksdata kräver inloggning.

```powershell
npm ci
npm run web:build
npx wrangler d1 migrations apply sjomatning-library --local --config web/wrangler.jsonc
# Lägg LIBRARY_PASSWORD=<lokal testnyckel> i web/.dev.vars
npm run web:dev
npm run test:web-api
```

Produktion:

```powershell
npx wrangler r2 bucket create sjomatning-library
npx wrangler d1 migrations apply sjomatning-library --remote --config web/wrangler.jsonc
npx wrangler secret put LIBRARY_PASSWORD --config web/wrangler.jsonc
npm run web:deploy
```

R2 måste först aktiveras på Cloudflare-kontot. Om en första publicering har gjorts med `wrangler.bootstrap.jsonc` saknar den R2-bindningen och visar en varning. Efter aktivering: skapa bucketen och kör `npm run web:deploy` med den ordinarie konfigurationen för att ansluta lagringen.

Administratörens slumpgenererade nyckel sparas lokalt i den git-ignorerade `web/admin-access.txt` och som Cloudflare-hemlighet. Byt den med `wrangler secret put LIBRARY_PASSWORD`; detta ogiltigförklarar alla sessioner men behåller användarnas nycklar. Lägg aldrig hemligheten i Git eller i frontend-kod.

Gränser: 95 MB per originalfil, cirka 1,5 MB per begäran med punktredigeringar. Biblioteket läser filerna vid start; mycket stora samlingar bör få sidindelning och behovsstyrd hämtning innan bred användning. Samtidiga ändringar i samma fil använder sist sparade version. Det finns ingen automatisk synk med desktop-appens lokala bibliotek; importera/exportera filer. USB-insamling och simulator visas endast i desktop-appen.

Verifierat: 50 befintliga tester, separat API-integrationstest med riktiga lokala D1/R2-bindningar (inklusive isolering mellan användare och spärrade sessioner), samt webbläsarprov av inloggning, manuell inmatning, ritning, sparning/omladdning och syntetiska PDF/WCI/KAP-kartor.
