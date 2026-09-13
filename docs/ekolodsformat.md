# Ekolodsformat – kontroll 2026-09-13

`testdata/format` innehåller fyra SL2-filer, en SL3-fil och Pythonunderlaget för Roxens djupkorrigering. Utöver TXT/CSV/TRC stöder appen nu Lowrance SL2/SL3 för mätspår.

Läsaren följer [opensounders formatbeskrivning](https://github.com/opensounder/sounder-log-formats/blob/master/lowrance/sl-format.md), med separata [SL2](https://github.com/opensounder/sounder-log-formats/blob/master/lowrance/format-2.md)- och [SL3](https://github.com/opensounder/sounder-log-formats/blob/master/lowrance/format-3.md)-layouter. Dokumentationen är en communitybeskrivning, inte en garanti från instrumenttillverkaren.

## Resultat med lokala provfiler

| Fil | Format/version | Importerade punkter | Importvarningar |
| --- | --- | ---: | ---: |
| bigger.sl2 | 2 / 1 | 1 217 | 0 |
| input.sl2 | 2 / 1 | 13 | 1 |
| small.sl2 | 2 / 0 | 4 016 | 1 |
| version-1.sl2 | 2 / 1 | 1 | 1 |
| input.sl3 | 3 / 1 | 2 793 | 0 |

Varningarna gäller ofullständiga slutposter eller restbytes. Alla kompletta, giltiga föregående poster läses. Originalfilen bevaras. Antalet importvarningar visas i biblioteket.

## Omfattning och begränsningar

- Headerformat 2 och 3, version 0 och 1 accepteras; provfilerna täcker kombinationerna i tabellen.
- Endast primär och sekundär traditionell ekolodskanal med giltighetsflagga för position importeras. DownScan, SideScan och kanal 9 ger inte extra mätspårspunkter.
- Djup i fot omvandlas till meter. GPS-fart läses i knop när giltighetsflaggan är satt; saknad eller ogiltig fart representeras som 0 i den befintliga spårmodellen.
- Position konverteras från Lowrances Mercatorrepresentation. Numerisk omvandling och kanalselektion provas med syntetiska referensposter i automatiska tester; provfilerna är även genomlästa i sin helhet.
- Relativt tidsfält bevaras som `elapsedMs` i punktmodellen. Okänd absolut tid lämnas tom; datum kan läsas ur ett datumformat filnamn. CSV-exportens befintliga kolumner innehåller inte det relativa tidsfältet.
- Akustiska ekolodsbilder, bottenklassificering och instrumentets egna kartbilder importeras inte. Filer med okända versioner eller ogiltiga postlängder avvisas.
- Fysisk instrumentjämförelse av djup, tidsfält och koordinater återstår; stöd för alla Lowrance/Simrad/B&G-varianter hävdas inte.

SLG, Garmin och Humminbird kan undersökas separat när representativa provfiler finns. Inga sådana filer finns i den kontrollerade formatmappen.
