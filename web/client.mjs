let status;
const api = async (path, options = {}) => {
  const response = await fetch('/api/' + path, options);
  if (!response.ok) { const result = await response.json().catch(() => ({})); throw new Error(result.error || 'Nätverksfel. Försök igen.'); }
  return response.json();
};
const jsonOptions = (method, data) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
function download(content, name, type = 'text/plain') {
  const url = URL.createObjectURL(new Blob([content], { type })), link = document.createElement('a');
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 60000); return name;
}
const login = document.createElement('dialog'); login.className = 'login';
login.innerHTML = '<form><p class="label">SJÖMÄTNING · MOLNBIBLIOTEK</p><h2>Dina kartor. Samlade.</h2><p>Logga in med din personliga nyckel för att öppna biblioteket.</p><label>Åtkomstnyckel<input type="password" name="password" autocomplete="current-password" required></label><p role="alert"></p><button class="button">Logga in</button></form>';
document.body.append(login);
async function authenticate() {
  try { await api('session'); return; } catch {}
  login.showModal(); login.addEventListener('cancel', event => event.preventDefault());
  await new Promise(resolve => { login.querySelector('form').onsubmit = async event => {
    event.preventDefault(); const button = login.querySelector('button'); button.disabled = true;
    try { await api('login', jsonOptions('POST', { password: login.querySelector('input').value })); login.close(); login.querySelector('input').value = ''; resolve(); }
    catch (error) { login.querySelector('[role=alert]').textContent = error.message; }
    finally { button.disabled = false; }
  }; });
}
await authenticate();
const currentUser = await api('session');
login.querySelector('label').firstChild.textContent = 'Åtkomstnyckel';
const header = document.createElement('div'); header.className = 'cloud-actions';
header.innerHTML = '<span class="cloud-status" role="status">Ansluten till molnbiblioteket</span><button id="downloadOriginals">Hämta original</button><button id="logoutCloud">Logga ut</button>';
document.querySelector('.app-header').append(header); status = header.querySelector('span');
const androidLink=document.createElement('a');androidLink.href='/mobile/';androidLink.textContent='Mobil GPS · Android & iPhone';header.prepend(androidLink);
status.textContent = currentUser.name + ' · ' + (currentUser.role === 'all' ? 'Hela biblioteket' : 'Mina spår');
document.querySelector('#logoutCloud').onclick = async () => { await api('logout', { method:'POST' }); location.reload(); };
const settings = await api('settings');
for (const key of Object.keys(localStorage)) if (key.startsWith('calibration:')) localStorage.removeItem(key);
for (const [key, value] of Object.entries(settings)) localStorage.setItem(key, JSON.stringify(value));
async function upload(files) {
  const result = [];
  try {
    for (const file of files) {
      status.textContent = 'Laddar upp ' + file.name + '…';
      const record = await api('files?name=' + encodeURIComponent(file.name), { method:'POST', body:file });
      result.push({ ...record, bytes:new Uint8Array(await file.arrayBuffer()) });
    }
    status.textContent = 'Sparat i molnbiblioteket'; return result;
  } catch (error) { status.textContent = error.message; if (result.length && app) await app.addLibraryFiles(result); throw error; }
}
async function choose(folder = false) {
  const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.accept = '.pdf,.kap,.wci,.bsb,.csv,.txt,.trc,.sl2,.sl3';
  if (folder) input.setAttribute('webkitdirectory', '');
  const files = await new Promise(resolve => { input.onchange = () => resolve([...input.files]); input.oncancel = () => resolve([]); input.click(); });
  return upload(files.filter(file => /\.(pdf|kap|wci|bsb|csv|txt|trc|sl2|sl3)$/i.test(file.name)));
}
let records = [], app;
window.sjomatning = {
  openLibrary: () => choose(), openPdf: async () => (await choose())[0], openLogs: () => choose(),
  openFolder: async () => ({ name:'Molnbibliotek', path:'cloud', files:await choose(true) }),
  scanDroppedEntries: async files => ({ files:await upload(files), folders:[] }),
  listLibrary: async () => {
    records = await api('files'); const result = [];
    for (const record of records) {
      const response = await fetch('/api/files/' + record.id + '/content');
      if (!response.ok) throw new Error('Kunde inte läsa ' + record.name);
      result.push({ ...record, bytes:new Uint8Array(await response.arrayBuffer()) });
    }
    return result;
  },
  removeLibraryFile: id => api('files/' + id, { method:'DELETE' }),
  updateLibraryFile: (id, changes) => api('files/' + id, jsonOptions('PATCH', changes)),
  saveCalibration: (key, value) => api('settings', jsonOptions('PUT', { key, value })),
  launchPdf: async () => null, getRoxenWaterLevel: date => api('level' + (date ? '?date=' + encodeURIComponent(date) : '')),
  getAppInfo: async () => ({ version:'Webb', buildDate:'2026-09-19' }), onUpdaterStatus: () => {},
  exportTracks: async ({ content, suggestedName }) => download(content, suggestedName),
  exportManuscriptPdf: async id => {
    const { exportAnnotatedManuscript } = await import('./src/manuscript-annotations.mjs');
    const files = await api('files'), file = files.find(f => f.id === id);
    const response = await fetch('/api/files/' + id + '/content');
    if (!response.ok) throw new Error('Kunde inte läsa originalfilen.');
    return download(await exportAnnotatedManuscript({ ...file, bytes:new Uint8Array(await response.arrayBuffer()) }), file.name.replace(/\.[^.]+$/,'-anteckningar.pdf'), 'application/pdf');
  }
};
app = await import('./src/renderer.js');
await app.loadRoxenMap();
document.querySelector('#folderName').textContent = currentUser.role === 'all' ? 'Molnbibliotek' : 'Mina spår';
if (currentUser.id === 'admin') {
  const manage = document.createElement('button'); manage.textContent = 'Åtkomstnycklar'; header.prepend(manage);
  manage.onclick = async () => {
    const dialog = document.createElement('dialog'); dialog.className = 'login';
    dialog.innerHTML = '<h2>Alla åtkomstnycklar</h2><p>Här visas även administratörens nyckel och spärrade nycklar. Namnet kan ändras utan att nyckeln byts. </p><p>Full åtkomst: se och ändra hela biblioteket. Egna spår: se, ändra och ladda upp egna spår.</p><form><label>Namn<input name="name" maxlength="100" required></label><label>Behörighet<select name="role"><option value="own">Endast egna spår</option><option value="all">Hela biblioteket</option></select></label><button class="button">Skapa nyckel</button></form><p role="status"></p><div class="cloud-downloads"></div><button data-close>Stäng</button>';
    document.body.append(dialog); dialog.showModal(); dialog.querySelector('[data-close]').onclick = () => dialog.close(); dialog.onclose = () => dialog.remove();
    async function listUsers() {
      const users = await api('users');
      const list = dialog.querySelector('.cloud-downloads'); list.replaceChildren();
      for (const user of users) {
        const row = document.createElement('form');
        const label = document.createElement('label'); label.textContent = 'Namn';
        const input = document.createElement('input'); input.value = user.name; input.required = true; input.maxLength = 100;
        input.setAttribute('aria-label', 'Namn för ' + user.name); label.append(input);
        const details = document.createElement('p');
        details.textContent = (user.id === 'admin' ? 'Administratör' : user.role === 'all' ? 'Hela biblioteket' : 'Egna spår') + ' · ' + (user.active ? 'Aktiv' : 'Spärrad') + (user.id === currentUser.id ? ' · Din nyckel' : '');
        const save = document.createElement('button'); save.textContent = 'Spara namn'; save.type = 'submit';
        row.append(label,details,save);
        row.onsubmit = async event => {
          event.preventDefault(); save.disabled = true;
          try {
            await api('users/' + user.id, jsonOptions('PATCH',{name:input.value}));
            dialog.querySelector('[role=status]').textContent = 'Namnet har sparats.';
            input.value = input.value.trim(); input.setAttribute('aria-label','Namn för ' + input.value);
          } catch(error) { dialog.querySelector('[role=status]').textContent = error.message; }
          finally { save.disabled = false; }
        };
        if (user.id !== 'admin') {
          const replace = document.createElement('button'); replace.type = 'button'; replace.textContent = 'Ersätt nyckel';
          replace.onclick = async () => {
            if (!confirm('Ersätt nyckeln för ' + input.value + '? Den gamla nyckeln och dess sessioner slutar fungera. Den nya nyckeln blir aktiv och visas bara en gång. Namn, behörighet och filer behålls.')) return;
            replace.disabled = true;
            try {
              const replacement = await api('users/' + user.id + '/replace',{method:'POST'});
              dialog.querySelector('[role=status]').textContent = 'Spara den nya nyckeln nu, den visas bara en gång: ' + replacement.token;
              try { await listUsers(); } catch(error) { dialog.querySelector('[role=status]').textContent += ' Listan kunde inte uppdateras: ' + error.message; }
            } catch(error) { dialog.querySelector('[role=status]').textContent = error.message; replace.disabled = false; }
          };
          row.append(replace);
        }
        if (user.active && user.id !== 'admin') {
          const revoke = document.createElement('button'); revoke.type = 'button'; revoke.textContent = 'Spärra';
          revoke.onclick = async () => {
            revoke.disabled = true;
            try { await api('users/' + user.id, {method:'DELETE'}); await listUsers(); }
            catch(error) { dialog.querySelector('[role=status]').textContent = error.message; revoke.disabled = false; }
          };
          row.append(revoke);
        }
        list.append(row);
      }
    }
    dialog.querySelector('form').onsubmit = async event => {
      event.preventDefault(); const button = event.target.querySelector('button'); button.disabled = true;
      try { const data = new FormData(event.target), user = await api('users', jsonOptions('POST', Object.fromEntries(data)));
        dialog.querySelector('[role=status]').textContent = 'Spara nyckeln nu, den visas bara en gång: ' + user.token;
        await listUsers();
      } catch (error) { dialog.querySelector('[role=status]').textContent = error.message; } finally { button.disabled = false; }
    };
    try { await listUsers(); } catch(error) { dialog.querySelector('[role=status]').textContent = error.message; }
  };
}
document.querySelector('#downloadOriginals').onclick = async () => {
  const dialog = document.createElement('dialog'); dialog.className = 'login';
  const title = document.createElement('h2'); title.textContent = 'Hämta originalfiler'; dialog.append(title);
  const list = document.createElement('div'); list.className = 'cloud-downloads'; dialog.append(list);
  for (const file of await api('files')) { const link = document.createElement('a'); link.textContent = file.name; link.href = '/api/files/' + file.id + '/content'; link.download = file.name; list.append(link); }
  if (!list.children.length) list.textContent = 'Biblioteket är tomt. Lägg till kartor eller spår.';
  const close = document.createElement('button'); close.textContent = 'Stäng'; close.onclick = () => dialog.close(); dialog.append(close); dialog.onclose = () => dialog.remove(); document.body.append(dialog); dialog.showModal();
};
const panel = document.createElement('section'); panel.className = 'panel manual-panel';
panel.innerHTML = '<p class="label">PLANERA MÄTNING</p><h2>Skapa spår</h2><label>Spårnamn<input id="manualName" maxlength="180" value="Planerat mätspår"></label><button class="button" id="drawTrack">Rita på kartan</button><button class="small-button" id="undoPoint">Ångra punkt</button><p id="manualStatus" role="status">Klicka på kartan för att lägga till punkter.</p><details><summary>Lägg in koordinater</summary><label>En punkt per rad: latitud; longitud; djup (valfritt)<textarea id="manualCoordinates" placeholder="58.52;15.70&#10;58.53;15.71"></textarea></label><button class="small-button" id="addCoordinates">Lägg till punkter</button></details><button class="button" id="saveManual">Spara spåret online</button><button class="small-button" id="cancelManual">Rensa</button>';
document.querySelector('#folderPanel').after(panel);
if (!currentUser.storageReady) {
  const notice = document.createElement('section'); notice.className = 'panel storage-notice'; notice.setAttribute('role','status');
  notice.textContent = 'Filuppladdning väntar på aktivering av Cloudflare R2. Kartan och spårplaneringen går att prova, men nya filer och spår kan ännu inte sparas online.';
  document.querySelector('#sidebar').prepend(notice);
  document.querySelector('#saveManual').disabled = true;
  document.querySelector('#addLibrary').disabled = true;
}
let drawing = false, points = [], preview;
function refresh() {
  if (preview) app.state.logs = app.state.logs.filter(log => log !== preview);
  preview = { name:'Planerat spår · utkast', points:[...points], visible:true, color:'#d35d18', correction:0, depthAdjustment:0, pruneDistance:0 };
  if (points.length) app.state.logs.push(preview);
  document.querySelector('#manualStatus').textContent = points.length ? points.length + ' punkter · ' + (drawing ? 'Klicka för att lägga till. Dra för att panorera.' : 'Utkast, ännu inte sparat.') : 'Klicka på kartan eller lägg in koordinater för ett nytt spår.';
  document.querySelector('#drawTrack').textContent = drawing ? 'Avsluta ritning' : 'Rita på kartan'; app.drawOverlay();
}
document.querySelector('#drawTrack').onclick = () => { drawing = !drawing; refresh(); };
document.querySelector('#undoPoint').onclick = () => { points.pop(); refresh(); };
document.querySelector('#cancelManual').onclick = () => { points = []; drawing = false; refresh(); };
const canvas = document.querySelector('#overlayCanvas');
canvas.addEventListener('click', event => {
  if (!drawing) return;
  event.stopImmediatePropagation(); const pixel = app.canvasPoint(event), geo = app.pixelToGeo(pixel.x, pixel.y);
  if (!geo || !Number.isFinite(geo.lat) || Math.abs(geo.lat) > 90 || Math.abs(geo.lon) > 180) return app.toast('Välj en kalibrerad karta.');
  points.push({ ...geo, depth:null, speed:null, date:'', time:'' }); refresh();
}, true);
document.querySelector('#addCoordinates').onclick = () => {
  try {
    const added = document.querySelector('#manualCoordinates').value.trim().split(/\r?\n/).map((line, i) => {
      const cells = line.split(';').map(x => x.trim().replace(',', '.'));
      const [lat, lon] = cells.map(Number), depth = cells[2] ? Number(cells[2]) : null;
      if (cells.length < 2 || cells.length > 3 || !cells[0] || !cells[1] || !Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat)>90 || Math.abs(lon)>180 || (depth !== null && (!Number.isFinite(depth) || depth<0))) throw new Error('Ogiltig koordinat på rad ' + (i+1));
      return { lat, lon, depth, speed:null, date:'', time:'' };
    }); points.push(...added); refresh(); document.querySelector('#manualCoordinates').value = '';
  } catch (error) { app.toast(error.message); }
};
document.querySelector('#saveManual').onclick = async event => {
  if (points.length < 2) return app.toast('Lägg till minst två punkter.');
  const name = document.querySelector('#manualName').value.trim();
  if (!name || /[\\/:*?"<>|]/.test(name)) return app.toast('Ange ett giltigt spårnamn.');
  event.target.disabled = true;
  try {
    const content = 'Datum,Tid,Latitud,Longitud,Fart,Djup\n' + points.map(p => ['', '', p.lat.toFixed(7), p.lon.toFixed(7), '', p.depth ?? ''].join(',')).join('\n');
    const saved = await upload([new File([content], name + '.csv', { type:'text/csv' })]);
    points = []; drawing = false; refresh(); await app.addLibraryFiles(saved);
    const log = app.state.logs.find(log => log.sourceId === saved[0].id); if (log) log.visible = true;
    app.renderFolder(); app.renderLogs(); app.drawOverlay(); app.toast('Spåret är sparat i molnbiblioteket.');
  } catch (error) { app.toast(error.message); } finally { event.target.disabled = false; }
};
window.addEventListener('beforeunload', event => { if (points.length) { event.preventDefault(); event.returnValue = ''; } });
