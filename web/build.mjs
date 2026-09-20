import { mkdir, readFile, writeFile, copyFile, cp } from 'node:fs/promises';
const root = new URL('../', import.meta.url), output = new URL('./dist/', import.meta.url);
await mkdir(new URL('src/', output), { recursive: true });
const modules = ['styles.css', 'renderer.js', 'raster-chart.mjs', 'track-view.mjs', 'track-parser.mjs', 'web-map.mjs', 'track-processing.mjs', 'nmea-simulator.mjs', 'nmea-parser.mjs'];
for (const file of modules) await copyFile(new URL('src/' + file, root), new URL('src/' + file, output));
let renderer = await readFile(new URL('src/renderer.js', output), 'utf8');
renderer += '\nexport { state, addLibraryFiles, loadRoxenMap, canvasPoint, pixelToGeo, geoToPixel, drawOverlay, renderFolder, renderLogs, toast };\n';
renderer = renderer.replace("$('folderName').textContent = 'Filer'", "$('folderName').textContent = 'Molnbibliotek'");
await writeFile(new URL('src/renderer.js', output), renderer);
let html = await readFile(new URL('src/index.html', root), 'utf8');
html = html.replace('href="styles.css"', 'href="/src/styles.css"><link rel="stylesheet" href="/web.css"');
html = html.replace('<script type="module" src="renderer.js"></script>', '<script type="module" src="/client.mjs"></script>');
html = html.replace('<span id="buildInfo"', '<span id="buildInfo"');
await writeFile(new URL('index.html', output), html);
await mkdir(new URL('android/', output), {recursive:true});
await copyFile(new URL('android.html',import.meta.url),new URL('android/index.html',output));
try { await cp(new URL('downloads/',import.meta.url),new URL('downloads/',output),{recursive:true}); }
catch(error) { if(error.code !== 'ENOENT') throw error; }
for (const file of ['client.mjs', 'web.css']) await copyFile(new URL(file, import.meta.url), new URL(file, output));
await cp(new URL('node_modules/pdfjs-dist/legacy/build/', root), new URL('node_modules/pdfjs-dist/legacy/build/', output), { recursive: true });
await cp(new URL('node_modules/pdf-lib/dist/pdf-lib.esm.min.js', root), new URL('pdf-lib.mjs', output));
let annotations = await readFile(new URL('src/manuscript-annotations.js', root), 'utf8');
annotations = annotations.replace("const { PDFDocument, StandardFonts, rgb, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } = require('pdf-lib')", "import { PDFDocument, StandardFonts, rgb, degrees, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } from '../pdf-lib.mjs'");
annotations = annotations.replace('module.exports = { validateAnnotations, displayPosition, exportAnnotatedManuscript }', 'export { validateAnnotations, displayPosition, exportAnnotatedManuscript }');
await writeFile(new URL('src/manuscript-annotations.mjs', output), annotations);
console.log('Webbplats byggd i web/dist');

await import('../scripts/build-mobile.mjs');
