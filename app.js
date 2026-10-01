'use strict';
const $ = s => document.querySelector(s);
const TIPOS = ['Comité de obra','Visita técnica','Reunión con cliente','Reunión con copropiedad','Entrega de obra','Otra'];
const EXT = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm','video/3gpp':'3gp','audio/webm':'webm','audio/mp4':'m4a','audio/mpeg':'mp3','audio/ogg':'ogg','audio/aac':'aac','audio/wav':'wav','audio/amr':'amr','application/pdf':'pdf'};
const LABEL = {foto:'Foto', video:'Video', audio:'Audio', nota:'Nota', archivo:'Archivo', transcripcion:'Transcripción'};

/* ---------- utilidades ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fFecha = ms => new Date(ms).toLocaleString('es-CO',{weekday:'short',day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit'});
const fHora = ms => new Date(ms).toLocaleTimeString('es-CO',{hour:'2-digit',minute:'2-digit',hour12:false});
const fMB = b => b < 1048576 ? Math.max(1, Math.round(b/1024)) + ' KB' : (b/1048576).toFixed(1) + ' MB';
const fDur = s => { s = Math.round(s); const h = Math.floor(s/3600), m = Math.floor(s%3600/60), x = s%60; return (h ? h + ':' : '') + String(m).padStart(2,'0') + ':' + String(x).padStart(2,'0'); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const baseMime = m => (m || '').split(';')[0];
const kindOf = m => m.startsWith('image/') ? 'foto' : m.startsWith('video/') ? 'video' : m.startsWith('audio/') ? 'audio' : 'archivo';
const toLocalInput = ms => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0,16); };
const slug = s => (s || 'reunion').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40).toLowerCase();
function mimeOf(f){ if (f.type) return f.type; const e = (f.name.split('.').pop() || '').toLowerCase(); return Object.keys(EXT).find(k => EXT[k] === e) || (e === 'jpeg' ? 'image/jpeg' : e === 'opus' ? 'audio/ogg' : 'application/octet-stream'); }

let toastT;
function toast(msg){ let t = $('#toast'); if (!t){ t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; t.setAttribute('role','status'); document.body.append(t); } t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 4000); }

/* ---------- almacenamiento local (IndexedDB) ---------- */
const idb = (() => {
  let p;
  const open = () => p ||= new Promise((ok, bad) => {
    const r = indexedDB.open('captura-actas', 1);
    r.onupgradeneeded = () => { const d = r.result;
      d.createObjectStore('reuniones', {keyPath:'id'});
      d.createObjectStore('items', {keyPath:'id'}).createIndex('rid', 'rid');
      d.createObjectStore('trozos', {keyPath:['iid','n']}).createIndex('iid', 'iid'); };
    r.onsuccess = () => ok(r.result); r.onerror = () => bad(r.error);
  });
  async function run(store, mode, fn){ const d = await open(); return new Promise((ok, bad) => { const t = d.transaction(store, mode); const req = fn(t.objectStore(store)); t.oncomplete = () => ok(req ? req.result : undefined); t.onerror = () => bad(t.error); t.onabort = () => bad(t.error); }); }
  return {
    put: (s, v) => run(s, 'readwrite', st => st.put(v)),
    del: (s, k) => run(s, 'readwrite', st => st.delete(k)),
    get: (s, k) => run(s, 'readonly', st => st.get(k)),
    all: s => run(s, 'readonly', st => st.getAll()),
    by: (s, idx, v) => run(s, 'readonly', st => st.index(idx).getAll(v)),
    delBy: (s, idx, v) => run(s, 'readwrite', st => { const r = st.index(idx).openCursor(IDBKeyRange.only(v)); r.onsuccess = () => { const c = r.result; if (c){ c.delete(); c.continue(); } }; return null; }),
  };
})();

/* ---------- estado ---------- */
const S = { view:'home', reuniones:[], cur:null, items:[] };
const urls = new Map(); // id -> objectURL
function urlFor(it){ if (!it.blob) return ''; if (!urls.has(it.id)) urls.set(it.id, URL.createObjectURL(it.blob)); return urls.get(it.id); }
function freeUrls(){ for (const u of urls.values()) URL.revokeObjectURL(u); urls.clear(); }

async function loadReuniones(){ S.reuniones = (await idb.all('reuniones')).sort((a, b) => b.fecha - a.fecha); }
async function loadItems(){ S.items = (await idb.by('items', 'rid', S.cur.id)).sort((a, b) => a.creado - b.creado); }

/* ---------- vistas ---------- */
function render(){
  const home = S.view === 'home';
  $('#back').hidden = home; $('#btn-new').hidden = !home; $('#btn-edit').hidden = home;
  $('#capture').hidden = home;
  $('#top-title').textContent = home ? 'Captura de Actas' : S.cur.titulo;
  home ? renderHome() : renderMeeting();
}

async function renderHome(){
  const v = $('#view');
  const imp = `<div class="row" style="justify-content:flex-end;margin-bottom:10px"><button class="btn ghost" id="btn-import">Importar registro (.zip)</button></div>`;
  if (!S.reuniones.length){ v.innerHTML = installCard() + imp + `<div class="empty"><b>Aún no hay reuniones</b>Toca <strong>+ Nueva</strong> al llegar a la reunión. Luego captura fotos, videos, grabaciones y notas dictadas. Todo se guarda en este celular, aunque no haya señal.</div>`; $('#btn-import').onclick = pick('#in-import'); return; }
  v.innerHTML = installCard() + imp + `<p class="eyebrow">Reuniones</p><ul class="list">${S.reuniones.map(r => `<li class="card mtgbox"><button class="mtg" data-open="${r.id}">
    <span class="row"><b>${esc(r.titulo)}</b>${r.pendienteIA ? '<span class="chip warn">IA en cola</span>' : r.enviadaIA ? '<span class="chip ok">Enviada a IA</span>' : ''}</span>
    <span class="sub">${esc([r.tipo, r.proyecto].filter(Boolean).join(' · '))}</span>
    <span class="sub mono">${esc(fFecha(r.fecha))}${r.lugar ? ' · ' + esc(r.lugar) : ''}</span></button>
    <div class="mtg-acts"><button class="btn ghost" data-exp="${r.id}">Exportar</button><button class="btn ghost danger" data-delr="${r.id}">Eliminar</button></div></li>`).join('')}</ul><p class="meter" id="meter"></p>`;
  $('#btn-import').onclick = pick('#in-import');
  try { const e = await navigator.storage?.estimate?.(); if (e && $('#meter')) $('#meter').textContent = `Espacio usado en el celular: ${fMB(e.usage || 0)}`; } catch(_){}
}

function renderMeeting(){
  const r = S.cur, v = $('#view');
  const asis = (r.asistentes || '').split('\n').map(s => s.trim()).filter(Boolean);
  const n = S.items.length;
  const sinTitulo = S.items.filter(i => (i.tipo === 'foto' || i.tipo === 'video') && !i.titulo).length;
  v.innerHTML = `<section class="meta card">
    <h2>${esc(r.titulo)}</h2>
    <div class="sub">${esc([r.tipo, r.proyecto].filter(Boolean).join(' · '))}</div>
    <div class="sub mono">${esc(fFecha(r.fecha))}${r.lugar ? ' · ' + esc(r.lugar) : ''}</div>
    <div class="ubic">${r.ubicacion ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg><span>${esc(r.ubicacion.direccion || 'Dirección pendiente (se busca al tener internet)')}<br><a href="https://www.google.com/maps?q=${r.ubicacion.lat},${r.ubicacion.lon}" target="_blank" rel="noopener" class="mono">${r.ubicacion.lat}, ${r.ubicacion.lon}</a> <span class="small">±${r.ubicacion.precision} m</span></span>` : '<span class="small">Sin ubicación registrada.</span>'}<button class="btn ghost" id="btn-ubic">${r.ubicacion ? 'Actualizar' : 'Registrar ubicación'}</button></div>
    ${asis.length ? `<details><summary>${asis.length} asistente${asis.length > 1 ? 's' : ''}</summary><ul>${asis.map(a => `<li>${esc(a)}</li>`).join('')}</ul></details>` : `<div class="sub" style="margin-top:8px">Sin asistentes. Tip: toma foto a la lista de asistencia firmada.</div>`}
    <div class="actions"><button class="btn" id="btn-min" ${n ? '' : 'disabled'}>Organizar${r.minuta ? ' ✓' : ''}</button><button class="btn primary" id="btn-ia" ${n ? '' : 'disabled'}>Redactar acta con IA</button><button class="btn" id="btn-enviar" ${n ? '' : 'disabled'}>Exportar ZIP</button><span class="chip" style="align-self:center">${n} elemento${n === 1 ? '' : 's'}</span></div>
    ${sinTitulo ? `<p class="small warnline">${sinTitulo} foto${sinTitulo > 1 ? 's' : ''} sin título. Toca «Agregar título» en cada una.</p>` : ''}
    ${r.pendienteIA ? `<p class="small" style="margin:10px 0 0">En cola desde ${esc(fFecha(r.pendienteIA))}: se prepara para la IA cuando haya internet.</p>` : ''}
    ${r.enviadaIA && !r.pendienteIA ? `<p class="small" style="margin:10px 0 0">Preparada para IA el ${esc(fFecha(r.enviadaIA))}.</p>` : ''}
  </section>
  ${n ? `<ol class="timeline">${S.items.map(itemHTML).join('')}</ol>` : `<div class="empty"><b>Nada capturado todavía</b>Usa los botones de abajo. Todo queda en orden de captura.</div>`}`;
  $('#btn-enviar').onclick = () => exportar(S.cur, S.items);
  $('#btn-ia').onclick = redactarIA;
  $('#btn-ubic').onclick = () => tomarUbicacion(S.cur, false);
  $('#btn-min').onclick = () => abrirMinuta(false);
}

function itemHTML(it){
  let inner = '';
  const visual = it.tipo === 'foto' || it.tipo === 'video';
  if (visual) inner = it.titulo ? `<div class="ttl">${esc(it.titulo)}</div>` : `<button class="ttl none" data-act="titulo">Sin título · toca para agregar</button>`;
  if (it.tipo === 'transcripcion'){
    const segs = it.segmentos || [];
    inner = `<details class="trx"><summary>${segs.length} intervenciones · ${[...new Set(segs.map(x => x.h))].map(esc).join(', ')}</summary>${segs.map(x => `<p><b>${esc(x.h)}:</b> ${esc(x.texto)}</p>`).join('')}</details>`;
  }
  const comp = it.compromisos || [];
  if (it.tipo === 'nota') inner = `<div class="note">${esc(it.texto)}</div>`;
  else if (it.tipo !== 'transcripcion') {
    const u = urlFor(it);
    inner += it.tipo === 'foto' ? `<img src="${u}" alt="${esc(it.titulo || 'Foto')}" loading="lazy">`
      : it.tipo === 'video' ? `<video src="${u}" controls playsinline preload="metadata"></video>`
      : it.tipo === 'audio' ? `<audio src="${u}" controls preload="metadata"></audio>`
      : `<div class="note">${esc(it.nombre)}</div>`;
    if (it.texto) inner += `<div class="cap">${esc(it.texto)}</div>`;
  }
  if (comp.length) inner += `<div class="comp"><b>Compromisos detectados</b>${comp.map(c => `<div>• ${esc(c.actividad)}${c.responsable ? ` <span class="chip">${esc(c.responsable)}</span>` : ''}${c.fecha ? ` <span class="small">${esc(c.fecha)}</span>` : ''}</div>`).join('')}</div>`;
  const info = [it.notaVoz ? 'Nota de voz · por transcribir' : LABEL[it.tipo], it.dur ? fDur(it.dur) : '', it.blob ? fMB(it.blob.size) : ''].filter(Boolean).join(' · ');
  return `<li class="it" data-id="${it.id}"><div class="t mono">${fHora(it.creado)}</div><div class="body">${inner}
    <div class="foot"><span class="k">${info}</span><button data-act="${visual ? 'titulo' : 'comment'}">${visual ? (it.titulo ? 'Editar título' : 'Agregar título') : it.tipo === 'nota' ? 'Editar' : it.texto ? 'Editar comentario' : 'Comentar'}</button><button class="del" data-act="delete">Eliminar</button></div></div></li>`;
}

/* ---------- navegación ---------- */
/* ---------- ubicación de la reunión (GPS + dirección cuando hay internet) ---------- */
async function tomarUbicacion(r, auto){
  if (!navigator.geolocation) return auto || toast('Este celular no permite obtener la ubicación.');
  const b = $('#btn-ubic'); if (b){ b.disabled = true; b.textContent = 'Buscando GPS…'; }
  const pos = await new Promise(ok => navigator.geolocation.getCurrentPosition(ok, () => ok(null), {enableHighAccuracy: true, timeout: 20000, maximumAge: 30000}));
  if (!pos){ if (b){ b.disabled = false; b.textContent = r.ubicacion ? 'Actualizar' : 'Registrar ubicación'; } return toast('No se pudo obtener la ubicación. Activa el GPS y el permiso de ubicación para esta app.'); }
  r.ubicacion = {lat: +pos.coords.latitude.toFixed(6), lon: +pos.coords.longitude.toFixed(6), precision: Math.round(pos.coords.accuracy), tomada: Date.now()};
  await idb.put('reuniones', r); if (S.cur?.id === r.id) renderMeeting();
  toast(`Ubicación registrada (±${r.ubicacion.precision} m).`);
  await direccion(r);
}
async function direccion(r){
  if (!navigator.onLine || !r?.ubicacion || r.ubicacion.direccion) return;
  try {
    const j = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${r.ubicacion.lat}&lon=${r.ubicacion.lon}&zoom=18&accept-language=es`)).json();
    const a = j.address || {};
    const partes = [[a.road, a.house_number].filter(Boolean).join(' #'), a.neighbourhood || a.suburb, a.city || a.town || a.village || a.municipality, a.state].filter(Boolean);
    if (!partes.length && !j.display_name) return;
    r.ubicacion.direccion = partes.length ? partes.join(', ') : j.display_name.split(',').slice(0, 4).join(',');
    await idb.put('reuniones', r); if (S.cur?.id === r.id) renderMeeting();
  } catch(_){}
}

async function openMeeting(id){ S.cur = S.reuniones.find(r => r.id === id); if (!S.cur) return; freeUrls(); await recover(); await loadItems(); S.view = 'meeting'; render(); scrollTo(0, 0); }
async function goHome(){ if (rec) return toast('Detén la grabación antes de salir.'); freeUrls(); S.view = 'home'; S.cur = null; await loadReuniones(); render(); updateNet(); }
async function refresh(scrollEnd){ await loadItems(); renderMeeting(); if (scrollEnd) scrollTo(0, document.body.scrollHeight); }

/* ---------- archivos ---------- */
async function compressImage(file){
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 2048 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const out = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return out && out.size < file.size ? out : file;
  } catch(e){ return file; }
}
async function addFiles(list){
  const nuevos = [];
  for (const f of list){
    const mime = mimeOf(f); let blob = f;
    if (mime.startsWith('image/')) blob = await compressImage(f);
    const it = {id: uid(), rid: S.cur.id, tipo: kindOf(mime), creado: Date.now(), nombre: f.name, mime: blob.type || mime, blob, titulo: '', texto: ''};
    await idb.put('items', it); nuevos.push(it);
  }
  await refresh(true);
  colaTitulos = nuevos.filter(i => i.tipo === 'foto' || i.tipo === 'video');
  siguienteTitulo();
}

/* ---------- título de cada foto (qué muestra) ---------- */
let colaTitulos = [], fotoItem = null;
function siguienteTitulo(){ const it = colaTitulos.shift(); if (it) openFoto(it); }
function openFoto(it){
  fotoItem = it;
  $('#foto-h').textContent = it.tipo === 'video' ? '¿Qué muestra este video?' : '¿Qué muestra esta foto?';
  const pv = $('#foto-prev'); pv.hidden = it.tipo !== 'foto'; if (it.tipo === 'foto') pv.src = urlFor(it);
  $('#fo-titulo').value = it.titulo || ''; $('#fo-desc').value = it.texto || '';
  $('#foto-msg').hidden = true; $('#fo-skip').textContent = colaTitulos.length ? 'Después' : 'Después';
  $('#sh-foto').hidden = false; setTimeout(() => $('#fo-titulo').focus(), 80);
}
let fotoCampo = null;
['#fo-titulo', '#fo-desc'].forEach(id => $(id).addEventListener('focus', e => { fotoCampo = e.target; }));
$('#btn-dictar-foto').onclick = () => {
  if (dict) return stopDictado();
  startDictado({ta: fotoCampo || $('#fo-titulo'), btn: $('#btn-dictar-foto'), msg: $('#foto-msg'), soloTexto: true});
};
$('#f-foto').addEventListener('submit', async e => {
  e.preventDefault(); stopDictado();
  const titulo = $('#fo-titulo').value.trim();
  if (!titulo){ $('#foto-msg').textContent = 'Escribe o dicta un título corto: sirve para saber de qué trata la foto en el acta.'; $('#foto-msg').hidden = false; return $('#fo-titulo').focus(); }
  fotoItem.titulo = titulo; fotoItem.texto = $('#fo-desc').value.trim();
  await idb.put('items', fotoItem);
  $('#sh-foto').hidden = true; fotoItem = null; await refresh(); siguienteTitulo();
});
$('#fo-skip').onclick = async () => { stopDictado(); $('#sh-foto').hidden = true; fotoItem = null; await refresh(); siguienteTitulo(); };
const pick = id => () => { const i = $(id); i.value = ''; i.click(); };
$('#c-foto').onclick = pick('#in-foto'); $('#c-video').onclick = pick('#in-video'); $('#c-archivo').onclick = pick('#in-archivo');
['#in-foto','#in-video','#in-archivo'].forEach(id => $(id).addEventListener('change', e => { if (e.target.files.length) addFiles([...e.target.files]); }));

/* ---------- grabación de audio (se guarda por trozos: no se pierde si la app se cierra) ---------- */
let rec = null, wake = null;
async function startRec(){
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) return toast('Este navegador no permite grabar. Usa Chrome.');
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}}); }
  catch(e){ return toast('Sin permiso de micrófono. Actívalo en los permisos del sitio.'); }
  const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  const mr = new MediaRecorder(stream, type ? {mimeType: type, audioBitsPerSecond: 48000} : {});
  const item = {id: uid(), rid: S.cur.id, tipo: 'audio', creado: Date.now(), nombre: 'grabacion', mime: baseMime(mr.mimeType || type) || 'audio/webm', texto: '', grabando: true};
  await idb.put('items', item);
  rec = {mr, stream, item, n: 0, acc: 0, since: Date.now(), writes: Promise.resolve()};
  mr.ondataavailable = e => { if (e.data && e.data.size){ const n = rec.n++; rec.writes = rec.writes.then(() => idb.put('trozos', {iid: item.id, n, blob: e.data})); } };
  mr.onstop = finishRec;
  mr.start(5000);
  try { wake = await navigator.wakeLock?.request('screen'); } catch(_){}
  $('#recbar').hidden = false; $('#recbar').classList.remove('paused'); $('#rec-pause').textContent = 'Pausar';
  $('#c-audio').classList.add('on'); $('#c-audio-l').textContent = 'Grabando';
  tick(); toast('Grabando. Mantén la app abierta con la pantalla encendida.');
}
function elapsed(){ return rec ? rec.acc + (rec.mr.state === 'recording' ? (Date.now() - rec.since) / 1000 : 0) : 0; }
function tick(){ if (!rec) return; $('#rec-time').textContent = fDur(elapsed()); setTimeout(tick, 500); }
$('#rec-pause').onclick = () => {
  if (!rec) return;
  if (rec.mr.state === 'recording'){ rec.acc = elapsed(); rec.mr.pause(); $('#recbar').classList.add('paused'); $('#rec-pause').textContent = 'Seguir'; }
  else { rec.since = Date.now(); rec.mr.resume(); $('#recbar').classList.remove('paused'); $('#rec-pause').textContent = 'Pausar'; }
};
$('#rec-stop').onclick = () => { if (rec && rec.mr.state !== 'inactive'){ rec.dur = elapsed(); rec.mr.stop(); } };
async function finishRec(){
  const r = rec; rec = null;
  r.stream.getTracks().forEach(t => t.stop());
  try { await wake?.release(); } catch(_){} wake = null;
  $('#recbar').hidden = true; $('#c-audio').classList.remove('on'); $('#c-audio-l').textContent = 'Grabar';
  await r.writes;
  await assemble(r.item, r.dur);
  if (S.view === 'meeting') await refresh(true);
}
async function assemble(item, dur){
  const parts = (await idb.by('trozos', 'iid', item.id)).sort((a, b) => a.n - b.n).map(p => p.blob);
  if (!parts.length){ await idb.del('items', item.id); return; }
  item.blob = new Blob(parts, {type: item.mime}); item.dur = dur || item.dur || 0; delete item.grabando;
  await idb.put('items', item); await idb.delBy('trozos', 'iid', item.id);
}
async function recover(){ // grabaciones interrumpidas (app cerrada o celular apagado)
  const pend = (await idb.all('items')).filter(i => i.grabando && (!rec || rec.item.id !== i.id));
  for (const it of pend) await assemble(it);
  if (pend.length) toast('Se recuperó una grabación que quedó interrumpida.');
}
$('#c-audio').onclick = () => rec ? toast('Ya hay una grabación en curso. Usa Detener.') : startRec();

/* ---------- notas con dictado ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
let notaItem = null, dict = null;
function openNota(it){
  notaItem = it || null;
  const isNote = !it || it.tipo === 'nota';
  $('#nota-h').textContent = !it ? 'Nueva nota' : isNote ? 'Editar nota' : 'Comentario';
  $('#nota-lbl').textContent = isNote ? 'Toca Dictar y habla, o escribe' : 'Qué muestra (ej.: fisura en muro eje 3)';
  $('#n-texto').value = it ? (it.texto || '') : '';
  dCtx = ctxNota(); dMsg('');
  $('#sh-nota').hidden = false;
  if (!it && !rec){
    if (navigator.onLine) startDictado(ctxNota());
    else startNotaVoz();
  } else setTimeout(() => $('#n-texto').focus(), 60);
}

/* nota de voz: respaldo cuando no hay internet para dictar */
let vn = null;
async function startNotaVoz(){
  if (vn || rec || !navigator.mediaDevices?.getUserMedia || !window.MediaRecorder){ $('#n-texto').focus(); return; }
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true}}); }
  catch(e){ $('#n-texto').focus(); return; }
  const type = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find(t => MediaRecorder.isTypeSupported(t)) || '';
  const mr = new MediaRecorder(stream, type ? {mimeType: type} : {});
  const o = {mr, stream, parts: [], t0: Date.now(), mime: baseMime(mr.mimeType || type) || 'audio/webm', done: null};
  o.done = new Promise(ok => { mr.onstop = ok; });
  mr.ondataavailable = e => { if (e.data?.size) o.parts.push(e.data); };
  vn = o;
  mr.start(1000);
  $('#vn').hidden = false; $('#nota-lbl').textContent = 'Texto opcional (puedes dejarlo vacío)';
  const tk = () => { if (!vn) return; $('#vn-time').textContent = fDur((Date.now() - vn.t0) / 1000); setTimeout(tk, 500); }; tk();
}
async function stopNotaVoz(save){
  const v = vn; vn = null; $('#vn').hidden = true; if (!v) return null;
  if (v.mr.state !== 'inactive'){ v.mr.stop(); await v.done; }
  v.stream.getTracks().forEach(t => t.stop());
  if (!save || !v.parts.length) return null;
  return {blob: new Blob(v.parts, {type: v.mime}), mime: v.mime, dur: (Date.now() - v.t0) / 1000};
}
/* dictado: sesiones cortas que se reinician solas (más estable en Android). Si falla, pasa a nota de voz. */
const LANGS = ['es-CO', 'es-419', 'es-ES'];
const ERRTXT = {'not-allowed':'El celular no dio permiso de micrófono para dictar.', 'service-not-allowed':'El servicio de voz de Google está desactivado en este celular.', 'network':'No hay internet para dictar.', 'audio-capture':'El micrófono está ocupado.', 'language-not-supported':'El dictado en español no está disponible.'};
let dCtx = null;
const ctxNota = () => ({ta: $('#n-texto'), btn: $('#btn-dictar'), msg: $('#dictar-msg'), soloTexto: false});
function dMsg(t, warn){ const m = (dCtx || ctxNota()).msg; m.textContent = t; m.hidden = !t; m.style.color = warn ? 'var(--danger)' : ''; }
function startDictado(ctx){
  dCtx = ctx || ctxNota();
  const ta = dCtx.ta, solo = dCtx.soloTexto;
  const fallback = () => { if (!solo) startNotaVoz(); };
  const sufijo = solo ? ' Escríbelo con el teclado.' : null;
  if (!SR){ dMsg('Este navegador no tiene dictado (ábrela en Chrome).' + (sufijo || ' Se graba como nota de voz.'), true); if (!rec) fallback(); return; }
  const d = {base: ta.value ? ta.value.replace(/\s*$/, ' ') : '', on: true, li: 0, err: null, quick: 0, t0: 0};
  const run = () => {
    const r = new SR(); d.r = r; d.t0 = Date.now();
    r.lang = LANGS[d.li]; r.continuous = false; r.interimResults = true; r.maxAlternatives = 1;
    r.onstart = () => dMsg('Escuchando… habla ahora.');
    r.onresult = e => {
      let fin = '', inter = '';
      for (let i = e.resultIndex; i < e.results.length; i++){ const t = e.results[i][0].transcript; if (e.results[i].isFinal) fin += t; else inter += t; }
      if (fin.trim()){ d.base += fin.trim() + ' '; d.got = true; }
      ta.value = d.base + inter; ta.scrollTop = ta.scrollHeight; d.quick = 0;
    };
    r.onerror = e => { d.err = e.error; };
    r.onend = () => {
      if (dict !== d) return;
      const err = d.err; d.err = null;
      d.quick = Date.now() - d.t0 < 1500 ? d.quick + 1 : 0;
      if (err === 'language-not-supported' && d.li < LANGS.length - 1){ d.li++; return run(); }
      if ((!err || err === 'no-speech' || err === 'aborted') && d.on && d.quick < 5){ try { return run(); } catch(_){} }
      if (!err || err === 'no-speech' || err === 'aborted'){ if (d.quick >= 5 && !d.got){ stopDictado(); dMsg('El dictado no arrancó en este celular.' + (sufijo || ' Se graba como nota de voz.'), true); if (!rec) fallback(); } else stopDictado(); return; }
      stopDictado();
      dMsg((ERRTXT[err] || 'El dictado falló (' + err + ').') + (sufijo || (rec ? ' La grabación de la reunión ya está captando lo que se dice; escribe la nota.' : ' Se graba como nota de voz y la transcribo al hacer el acta.')), true);
      if (!rec) fallback();
    };
    r.start();
  };
  dict = d;
  try { run(); } catch(e){ dict = null; dMsg('El dictado no arrancó.' + (sufijo || ' Se graba como nota de voz.'), true); if (!rec) fallback(); return; }
  dCtx.btn.classList.add('on'); dCtx.btn.textContent = '■ Detener';
}
function stopDictado(){ const d = dict; dict = null; if (d){ d.on = false; try { d.r.stop(); } catch(_){} } const c = dCtx || ctxNota(); c.btn.classList.remove('on'); c.btn.textContent = '● Dictar'; if (d && !c.msg.style.color) dMsg(''); }
$('#btn-dictar').onclick = () => dict ? stopDictado() : vn ? toast('Ya se está grabando la nota de voz.') : startDictado(ctxNota());
$('#f-nota').addEventListener('submit', async e => {
  e.preventDefault(); stopDictado();
  const texto = $('#n-texto').value.trim();
  const voz = await stopNotaVoz(true);
  if (notaItem){ notaItem.texto = texto; if (notaItem.tipo === 'nota') notaItem.compromisos = detectarCompromisos([{h: '', texto}], nombresCortos()); await idb.put('items', notaItem); }
  else if (voz) await idb.put('items', {id: uid(), rid: S.cur.id, tipo: 'audio', notaVoz: true, creado: Date.now() - voz.dur * 1000, nombre: 'nota-de-voz', mime: voz.mime, blob: voz.blob, dur: voz.dur, texto});
  else if (texto) await idb.put('items', {id: uid(), rid: S.cur.id, tipo: 'nota', creado: Date.now(), texto, compromisos: detectarCompromisos([{h: '', texto}], nombresCortos())});
  closeSheets(); await refresh(!notaItem);
});
$('#c-nota').onclick = () => openNota(null);

/* ---------- compromisos: detección automática (funciona sin internet) ---------- */
const nombresCortos = () => asistList(S.cur || {}).map(a => a.split(/\s+[–-]\s+/)[0].trim()).filter(Boolean);
const VERBOS = '(?:se\\s+encarga(?:rá)?\\s+de|se\\s+compromete\\s+a|queda(?:rá)?\\s+encargad[oa]\\s+de|va\\s+a|debe|tiene\\s+que|enviará|entregará|revisará|hará|realizará|gestionará|coordinará|presentará|programará|verificará)';
const FECHA = /\b(?:para\s+(?:el\s+)?|antes\s+del?\s+|el\s+|a\s+más\s+tardar\s+el\s+)((?:próximo\s+)?(?:lunes|martes|miércoles|jueves|viernes|sábado|domingo)(?:\s+\d{1,2})?|mañana|pasado\s+mañana|la\s+(?:próxima|otra)\s+semana|fin\s+de\s+mes|\d{1,2}\s+de\s+[a-záéíóú]+|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/i;
function limpiaAct(t){ t = t.replace(FECHA, '').replace(/\s+/g, ' ').replace(/[\s.,;:]+$/, '').trim(); return t.charAt(0).toUpperCase() + t.slice(1); }
function detectarCompromisos(segs, nombres){
  const out = [], vistos = new Set();
  const nom = nombres.map(n => n.split(/\s+/)[0]).filter(n => n.length > 2);
  const reTercera = nom.length ? new RegExp(`\\b(${nom.map(n => n.normalize('NFC').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?:\\s+[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)?\\s+${VERBOS}\\s+(.{6,})`, 'i') : null;
  const reAreas = new RegExp(`\\b((?:la\\s+|el\\s+)?(?:interventoría|supervisión|contratista|administración|administrador(?:a)?|residente|HDZ|Grupo\\s+HDZ|el\\s+cliente|la\\s+copropiedad))\\s+${VERBOS}\\s+(.{6,})`, 'i');
  const rePrimera = /\b(?:yo\s+)?(?:me\s+encargo\s+de|me\s+comprometo\s+a|yo\s+(?:reviso|envío|hago|entrego|llamo|mando|programo|coordino)|nosotros\s+(?:nos\s+encargamos\s+de|enviamos|entregamos|revisamos)|nos\s+comprometemos\s+a)\s+(.{6,})/i;
  const rePend = /\bqueda(?:n)?\s+pendiente(?:s)?\s+(?:de\s+)?(.{6,})/i;
  for (const sg of segs){
    for (const fr of String(sg.texto || '').split(/(?<=[.;!?])\s+|\s+y\s+(?=(?:la|el|los|las)\s+[a-záéíóúñ]+\s+(?:se|debe|va|tiene|enviará|entregará|revisará)\b|[A-ZÁÉÍÓÚ][a-záéíóúñ]+\s+(?:se|debe|va|tiene)\b)/)){
      let m, resp = '', act = '';
      if (reTercera && (m = fr.match(reTercera))){ resp = nombres.find(n => n.toLowerCase().startsWith(m[1].toLowerCase())) || m[1]; act = m[2]; }
      else if ((m = fr.match(reAreas))){ resp = m[1].replace(/^(la|el)\s+/i, ''); resp = resp.charAt(0).toUpperCase() + resp.slice(1); act = m[2]; }
      else if ((m = fr.match(rePrimera))){ resp = sg.h || ''; act = m[1]; }
      else if ((m = fr.match(rePend))){ act = m[1]; }
      else continue;
      const f = fr.match(FECHA), a = limpiaAct(act);
      if (a.length < 5 || vistos.has(a.toLowerCase())) continue;
      vistos.add(a.toLowerCase()); out.push({actividad: a, responsable: resp, fecha: f ? f[1] : ''});
    }
  }
  return out;
}

/* ---------- preprocesador: ordena la reunión antes de la IA (sin internet, instantáneo) ---------- */
const TEMAS_KW = [
  ['Avance de obra', ['avance', 'porcentaje', 'por ciento', '%', 'programación', 'programacion', 'cronograma', 'atraso', 'atrasad', 'adelant', 'rendimiento', 'frente de obra', 'ejecutad', 'terminad', 'cuadrilla']],
  ['Calidad y ensayos', ['ensayo', 'calidad', 'especificaci', 'resistencia', 'adherencia', 'prueba', 'muestra', 'laboratorio', 'fisura', 'grieta', 'defecto', 'norma', 'nsr', 'filtraci', 'humedad', 'impermeabiliz', 'curado', 'espesor']],
  ['SST y ambiental', ['seguridad', 'sst', 'epp', 'arnés', 'arnes', 'altura', 'accidente', 'incidente', 'señaliz', 'senaliz', 'ambiental', 'residuo', 'escombro', 'andamio', 'casco', 'línea de vida', 'linea de vida']],
  ['Administrativo y financiero', ['pago', 'factura', 'acta de cobro', 'anticipo', 'presupuesto', 'precio', 'apu', 'adicional', 'mayores cantidades', 'contrato', 'póliza', 'poliza', 'otrosí', 'otrosi', 'cotizaci', 'millones', 'pesos', '$']],
  ['Afectaciones a residentes', ['residente', 'vecino', 'copropiet', 'afectaci', 'queja', 'horario', 'ruido', 'parqueadero', 'ascensor', 'administración del edificio']],
  ['Pendientes y entrega', ['pendiente', 'entrega', 'garantía', 'garantia', 'manual', 'recibo', 'inventario', 'reparaci', 'retoque']],
];
const RE_CORR = /^(?:no[,.]?\s+)?(?:(?:perdón|perdon|corrijo|me\s+equivoqu[ée]|rectifico|quise\s+decir|mejor\s+dicho|en\s+realidad|más\s+bien|mas\s+bien)[,:.]?\s*)+/i;
const RE_NOMEJOR = /^no[,.]?\s+(?:mejor|sino)\s+/i;
const RE_CANCEL = /\b(?:se\s+cancela|cancelamos|queda\s+sin\s+efecto|ya\s+no\s+(?:se\s+va\s+a|va\s+a|vamos\s+a|se\s+(?:hace|hará|va))|olvid(?:en|emos)\s+lo\s+de)\b/i;
const RE_DUDA = /\b(?:creo\s+que|me\s+parece|más\s+o\s+menos|mas\s+o\s+menos|aproximadamente|aprox\.?|no\s+estoy\s+seguro|habría\s+que\s+(?:confirmar|verificar|revisar)|hay\s+que\s+confirmar|por\s+confirmar|tal\s+vez|quizás|quizas|de\s+pronto)\b/i;
const RE_DATOS = [
  ['Porcentaje', /\b\d{1,3}(?:[.,]\d+)?\s?(?:%|por\s?ciento)/gi],
  ['Cantidad', /\b\d+(?:[.,]\d+)?\s?(?:m²|m2|m³|m3|ml|metros(?:\s+(?:cuadrados|cúbicos|cubicos|lineales))?|kg|kilos|toneladas|unidades|galones|bultos|rollos|kits?)\b/gi],
  ['Valor', /(?:\$\s?\d[\d.,]*(?:\s?(?:millones|mil))?|\b\d[\d.,]*\s?(?:millones|mil)\s?(?:de\s)?pesos)/gi],
  ['Ubicación', /\b(?:eje|ejes|nivel|piso|torre|bloque|apartamento|apto|cubierta|terraza|fachada|sótano|sotano|zona)\s+(?:[A-Z]?\d+[A-Z]?|norte|sur|oriental|occidental|principal|[A-Z])\b/gi],
];
const sinTilde = t => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function limpiar(t){
  return String(t || '')
    .replace(/(^|[\s,])(?:eh+|em+|mmm+|ajá|aja|o\s+sea|digamos)(?=[\s,.;]|$)[,]?/gi, '$1')
    .replace(/^(?:bueno|listo|este|entonces|pues)[,]\s*/i, '')
    .replace(/\b(\p{L}+)(?:\s+\1\b)+/giu, '$1')
    .replace(/\s+([,.;])/g, '$1').replace(/\s{2,}/g, ' ').trim();
}
function temaDe(t){ const x = sinTilde(t); let best = null, n = 0; for (const [tema, kws] of TEMAS_KW){ const c = kws.filter(k => x.includes(sinTilde(k))).length; if (c > n){ n = c; best = tema; } } return best; }
const palabras = t => new Set(sinTilde(t).split(/[^a-z0-9ñ]+/).filter(w => w.length > 3));
function parecido(a, b){ const A = palabras(a), B = palabras(b); if (!A.size || !B.size) return 0; let c = 0; A.forEach(w => { if (B.has(w)) c++; }); return c / Math.min(A.size, B.size); }

function preprocesar(r, items){
  const nombres = nombresCortos();
  const frases = [], correcciones = [], porConfirmar = [], datos = [], fotos = [], sinProcesar = [];
  const crudo = f => sinProcesar.push({hora: f.hora, h: f.h, texto: f.orig});
  // 1) fuentes → frases limpias, en orden de captura, con hablante y hora
  for (const it of items){
    const hora = fHora(it.creado);
    if (it.tipo === 'foto' || it.tipo === 'video'){ fotos.push({hora, titulo: it.titulo || 'Sin título', descripcion: it.texto || '', tema: temaDe((it.titulo || '') + ' ' + (it.texto || ''))}); continue; }
    const segs = it.tipo === 'transcripcion' ? (it.segmentos || []) : it.texto ? [{h: '', texto: it.texto}] : [];
    if (it.tipo === 'audio' && !it.texto){ porConfirmar.push({texto: `${it.notaVoz ? 'Nota de voz' : 'Grabación'} de las ${hora} sin transcribir`, motivo: 'Revisar el audio'}); continue; }
    for (const sg of segs) for (const raw of String(sg.texto).split(/(?<=[.;!?])\s+/)){
      const t = limpiar(raw); if (!raw.trim()) continue;
      frases.push({hora, h: sg.h || '', texto: t, orig: raw.trim(), fuente: it.tipo});
    }
  }
  // 2) correcciones y cancelaciones (la versión final reemplaza a la anterior del mismo hablante)
  const vivas = [];
  for (const f of frases){
    const corr = f.texto.match(RE_CORR) || f.texto.match(RE_NOMEJOR);
    if (corr && !vivas.length){ f.crudo = true; vivas.push(f); continue; }
    if (corr){
      const prev = [...vivas].reverse().find(p => p.h === f.h) || vivas[vivas.length - 1];
      const nuevo = f.texto.slice(corr[0].length); f.texto = nuevo.charAt(0).toUpperCase() + nuevo.slice(1);
      prev.superada = true; f.tema = prev.tema;
      const pc = detectarCompromisos([{h: prev.h, texto: prev.texto}], nombres);
      if (pc.length && !detectarCompromisos([{h: f.h, texto: f.texto}], nombres).length){
        const fe = f.texto.match(FECHA), quien = nombres.find(n => sinTilde(f.texto).includes(sinTilde(n.split(/\s+/)[0])));
        f.heredados = pc.map(c => ({...c, fecha: fe ? fe[1] : c.fecha, responsable: quien || c.responsable}));
      }
      correcciones.push({hora: f.hora, h: f.h, antes: prev.texto, despues: f.texto});
      // si la corrección es solo un dato suelto («el lunes», «Pedro»), se arma la frase final sobre la anterior
      if (f.texto.split(/\s+/).length <= 4){ const fe = f.texto.match(FECHA); f.texto = fe && prev.texto.match(FECHA) ? prev.texto.replace(prev.texto.match(FECHA)[1], fe[1]) : prev.texto + ' (corregido: ' + f.texto + ')'; }
    }
    f.tema = f.tema || temaDe(f.texto);
    vivas.push(f);
  }
  // lo que no se puede interpretar con seguridad va TAL CUAL (texto original, sin limpiar)
  const entiende = f => !f.crudo && (f.heredados || f.tema || RE_CANCEL.test(f.texto) || detectarCompromisos([{h: f.h, texto: f.texto}], nombres).length || RE_DATOS.some(([, re]) => new RegExp(re.source, 'i').test(f.texto)));
  const finales = [];
  for (const f of vivas){ if (f.superada) continue; if (entiende(f)) finales.push(f); else crudo(f); }
  for (const f of finales){
    if (RE_DUDA.test(f.texto) || /\?$/.test(f.texto)) porConfirmar.push({texto: f.texto, motivo: 'Se dijo con duda', hora: f.hora, h: f.h});
    for (const [tipo, re] of RE_DATOS) for (const m of f.texto.matchAll(re)) datos.push({tipo, valor: m[0].trim(), contexto: f.texto, hora: f.hora});
    const fe = f.texto.match(FECHA); if (fe && /\b(?:entrega|reuni|ensayo|visita|pago|cobro|comit|inicio|termin|env[ií]|program)/i.test(f.texto)) datos.push({tipo: 'Fecha', valor: fe[1], contexto: f.texto, hora: f.hora});
  }
  // 3) compromisos: se detectan sobre la versión final; los repetidos o cambiados quedan una sola vez (la última)
  let comp = [];
  for (const f of finales){
    if (RE_CANCEL.test(f.texto)){
      const c = comp.filter(x => !x.cancelado).map(x => [x, parecido(x.actividad, f.texto)]).sort((a, b) => b[1] - a[1])[0];
      if (c && c[1] >= .34){ c[0].cancelado = true; correcciones.push({hora: f.hora, h: f.h, antes: c[0].actividad, despues: 'Cancelado: ' + f.texto}); }
      else crudo(f);
      continue;
    }
    for (const c of [...detectarCompromisos([{h: f.h, texto: f.texto}], nombres), ...(f.heredados || [])]){
      const prev = comp.find(x => !x.cancelado && parecido(x.actividad, c.actividad) >= .6);
      if (prev){ const hist = `${prev.actividad} · ${prev.responsable || 'sin responsable'} · ${prev.fecha || 'sin fecha'}`; const nuevo = {actividad: c.actividad, responsable: c.responsable || prev.responsable, fecha: c.fecha || prev.fecha}; if (nuevo.responsable !== prev.responsable || nuevo.fecha !== prev.fecha) (prev.historial = prev.historial || []).push(hist); Object.assign(prev, nuevo, {hora: f.hora}); }
      else comp.push({...c, hora: f.hora, tema: f.tema});
    }
  }
  comp = comp.filter(c => !c.cancelado);
  comp.forEach(c => { if (!c.responsable) porConfirmar.push({texto: c.actividad, motivo: 'Compromiso sin responsable'}); if (!c.fecha) porConfirmar.push({texto: c.actividad, motivo: 'Compromiso sin fecha'}); });
  // 4) por tema, en el orden en que se trataron
  const temas = [];
  for (const f of finales){ if (RE_CANCEL.test(f.texto)) continue; const k = f.tema || 'Varios'; let t = temas.find(x => x.tema === k); if (!t) temas.push(t = {tema: k, entradas: []}); t.entradas.push({hora: f.hora, h: f.h, texto: f.texto}); }
  const vistos = new Set();
  return {generada: Date.now(), nItems: items.length, temas, compromisos: comp, correcciones, datos: datos.filter(d => { const k = d.tipo + d.valor; if (vistos.has(k)) return false; vistos.add(k); return true; }), por_confirmar: porConfirmar, sin_procesar: sinProcesar, fotos};
}

/* minuta: revisar y descartar antes de enviar */
let minR = null;
function abrirMinuta(regen){
  const r = S.cur;
  if (regen || !r.minuta || (r.minuta.nItems !== S.items.length && !r.minuta.editada)) r.minuta = preprocesar(r, S.items);
  minR = r; renderMinuta(); $('#sh-min').hidden = false;
}
function renderMinuta(){
  const m = minR.minuta, x = (k, i) => `<button class="x" data-mx="${k}" data-i="${i}" aria-label="Descartar">✕</button>`;
  const sec = (t, n, body) => `<details class="msec" open><summary>${t} <span class="chip">${n}</span></summary>${body}</details>`;
  $('#min-body').innerHTML =
    (m.nItems !== S.items.length ? `<p class="small warnline">Capturaste cosas nuevas después de organizar. Toca «Volver a organizar» para incluirlas.</p>` : '') +
    sec('Compromisos', m.compromisos.length, m.compromisos.map((c, i) => `<div class="mrow"><div class="mcomp"><input data-mc="${i}" data-f="actividad" value="${esc(c.actividad)}" aria-label="Actividad"><div class="row"><input data-mc="${i}" data-f="responsable" value="${esc(c.responsable)}" placeholder="Responsable" aria-label="Responsable"><input data-mc="${i}" data-f="fecha" value="${esc(c.fecha)}" placeholder="Fecha" aria-label="Fecha"></div>${c.historial ? `<span class="small">Cambió durante la reunión: ${c.historial.map(esc).join(' → ')}</span>` : ''}</div>${x('compromisos', i)}</div>`).join('') || '<p class="small">No se detectaron.</p>') +
    sec('Correcciones aplicadas', m.correcciones.length, m.correcciones.map((c, i) => `<div class="mrow"><div><span class="small">${esc(c.hora)}${c.h ? ' · ' + esc(c.h) : ''}</span>${c.antes ? `<div><s>${esc(c.antes)}</s></div>` : ''}<div>→ ${esc(c.despues)}</div></div>${x('correcciones', i)}</div>`).join('') || '<p class="small">Ninguna.</p>') +
    sec('Por confirmar', m.por_confirmar.length, m.por_confirmar.map((c, i) => `<div class="mrow"><div><b class="small">${esc(c.motivo)}</b><div>${esc(c.texto)}</div></div>${x('por_confirmar', i)}</div>`).join('') || '<p class="small">Nada.</p>') +
    sec('Datos clave', m.datos.length, m.datos.map((d, i) => `<div class="mrow"><div><span class="chip">${esc(d.tipo)}</span> <b>${esc(d.valor)}</b><div class="small">${esc(d.contexto)}</div></div>${x('datos', i)}</div>`).join('') || '<p class="small">Ninguno.</p>') +
    ((m.sin_procesar || []).length ? sec('Sin procesar · va tal cual a Claude', m.sin_procesar.length, '<p class="small">El celular no pudo interpretar estas frases con seguridad. No se cambian ni se descartan: Claude las recibe exactamente así.</p>' + m.sin_procesar.map(c => `<div class="mrow"><div><span class="small">${esc(c.hora)}${c.h ? ' · ' + esc(c.h) : ''}</span><div>«${esc(c.texto)}»</div></div></div>`).join('')) : '') +
    m.temas.map((t, ti) => sec(esc(t.tema), t.entradas.length, t.entradas.map((e, i) => `<div class="mrow"><div><span class="small">${esc(e.hora)}${e.h ? ' · ' + esc(e.h) : ''}</span><div>${esc(e.texto)}</div></div><button class="x" data-mt="${ti}" data-i="${i}" aria-label="Descartar">✕</button></div>`).join(''))).join('') +
    (m.fotos.length ? sec('Fotos por tema', m.fotos.length, m.fotos.map(f => `<div class="mrow"><div><b>${esc(f.titulo)}</b> <span class="chip">${esc(f.tema || 'Otros temas')}</span></div></div>`).join('')) : '');
}
$('#min-body').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; const m = minR.minuta;
  if (b.dataset.mx){ m[b.dataset.mx].splice(+b.dataset.i, 1); }
  else if (b.dataset.mt){ const t = m.temas[+b.dataset.mt]; t.entradas.splice(+b.dataset.i, 1); if (!t.entradas.length) m.temas.splice(+b.dataset.mt, 1); }
  else return;
  m.editada = true; renderMinuta();
});
$('#min-body').addEventListener('input', e => { const i = e.target.dataset.mc; if (i === undefined) return; minR.minuta.compromisos[+i][e.target.dataset.f] = e.target.value; minR.minuta.editada = true; });
$('#min-regen').onclick = () => { abrirMinuta(true); toast('Minuta organizada de nuevo desde lo capturado.'); };
$('#min-save').onclick = async () => { await idb.put('reuniones', minR); await loadReuniones(); S.cur = S.reuniones.find(x => x.id === minR.id); $('#sh-min').hidden = true; renderMeeting(); toast('Minuta guardada. Va con la reunión cuando redactes con IA.'); };

/* ---------- transcripción en vivo con hablantes ---------- */
let tr = null;
function abrirTranscripcion(){
  if (rec) return toast('Detén la grabación de audio primero: el micrófono está ocupado.');
  if (!SR) return toast('Este navegador no tiene reconocimiento de voz. Ábrela en Chrome, o usa Grabar.');
  if (!navigator.onLine) return toast('La transcripción en vivo necesita internet. Sin señal usa «Grabar»; la transcribo después.');
  const ns = nombresCortos();
  tr = {spk: ns[0] || 'Participante 1', extras: ns.length ? [] : ['Participante 1'], segs: [], t0: Date.now(), on: true, pausa: false, li: 0, err: null, quick: 0};
  $('#tr-list').innerHTML = ''; $('#tr-int').textContent = ''; $('#tr-msg').textContent = 'Toca el nombre de quien está hablando. Si una frase quedó mal asignada, tócala para pasarla al nombre seleccionado.'; $('#tr-msg').style.color = '';
  $('#tr-pause').textContent = 'Pausar'; renderSpk(); $('#sh-tr').hidden = false; trRun(); trTick();
  navigator.wakeLock?.request('screen').then(w => { if (tr) tr.wake = w; }).catch(() => {});
}
function trNames(){ return [...new Set([...nombresCortos(), ...tr.extras, ...tr.segs.map(x => x.h)])]; }
function renderSpk(){ $('#tr-spk').innerHTML = trNames().map(n => `<button class="chipbtn${n === tr.spk ? ' on' : ''}" data-spk="${esc(n)}">${esc(n)}</button>`).join('') + `<button class="chipbtn add" data-spk="+">+ Otro</button>`; }
function renderSegs(){ const l = $('#tr-list'); l.innerHTML = tr.segs.map((x, i) => `<p class="seg" data-seg="${i}"><b>${esc(x.h)}:</b> ${esc(x.texto)}</p>`).join(''); l.scrollTop = l.scrollHeight; }
function trTick(){ if (!tr) return; $('#tr-time').textContent = fDur((Date.now() - tr.t0) / 1000); setTimeout(trTick, 1000); }
function trRun(){
  if (!tr || !tr.on || tr.pausa) return;
  const r = new SR(); tr.r = r; const t0 = Date.now();
  r.lang = LANGS[tr.li]; r.continuous = false; r.interimResults = true;
  r.onresult = e => { let fin = '', inter = ''; for (let i = e.resultIndex; i < e.results.length; i++){ const t = e.results[i][0].transcript; if (e.results[i].isFinal) fin += t; else inter += t; }
    if (fin.trim()){ const last = tr.segs[tr.segs.length - 1]; if (last && last.h === tr.spk && Date.now() - last.t < 20000){ last.texto += ' ' + fin.trim(); last.t = Date.now(); } else tr.segs.push({h: tr.spk, texto: fin.trim(), t: Date.now()}); renderSegs(); tr.quick = 0; }
    $('#tr-int').textContent = inter ? tr.spk + ': ' + inter : ''; };
  r.onerror = e => { tr && (tr.err = e.error); };
  r.onend = () => {
    if (!tr || tr.r !== r) return;
    const err = tr.err; tr.err = null; tr.quick = Date.now() - t0 < 1500 ? tr.quick + 1 : 0;
    if (err === 'language-not-supported' && tr.li < LANGS.length - 1){ tr.li++; return trRun(); }
    if ((!err || err === 'no-speech' || err === 'aborted') && tr.quick < 8) return trRun();
    tr.pausa = true; $('#tr-pause').textContent = 'Reanudar';
    $('#tr-msg').textContent = (ERRTXT[err] || 'La transcripción se detuvo.') + ' Toca «Reanudar» o «Terminar y guardar».'; $('#tr-msg').style.color = 'var(--danger)';
  };
  try { r.start(); } catch(_){}
}
$('#tr-spk').addEventListener('click', e => {
  const b = e.target.closest('[data-spk]'); if (!b) return;
  if (b.dataset.spk === '+'){ const n = (prompt('Nombre de quien habla:', 'Participante ' + (trNames().length + 1)) || '').trim(); if (!n) return; tr.extras.push(n); tr.spk = n; }
  else tr.spk = b.dataset.spk;
  renderSpk();
});
$('#tr-list').addEventListener('click', e => { const p = e.target.closest('[data-seg]'); if (!p) return; tr.segs[+p.dataset.seg].h = tr.spk; renderSegs(); });
$('#tr-pause').onclick = () => { if (!tr) return; tr.pausa = !tr.pausa; $('#tr-pause').textContent = tr.pausa ? 'Reanudar' : 'Pausar'; $('#tr-msg').style.color = ''; if (tr.pausa){ try { tr.r?.abort(); } catch(_){} } else { tr.quick = 0; trRun(); } };
$('#tr-stop').onclick = async () => {
  const t = tr; if (!t) return; tr = null; try { t.r?.abort(); } catch(_){} try { t.wake?.release(); } catch(_){}
  $('#sh-tr').hidden = true;
  if (!t.segs.length) return toast('No se guardó nada: no hubo texto transcrito.');
  const segmentos = t.segs.map(({h, texto}) => ({h, texto}));
  const compromisos = detectarCompromisos(segmentos, nombresCortos());
  await idb.put('items', {id: uid(), rid: S.cur.id, tipo: 'transcripcion', creado: t.t0, dur: (Date.now() - t.t0) / 1000, segmentos, texto: segmentos.map(x => `${x.h}: ${x.texto}`).join('\n'), compromisos});
  await refresh(true);
  toast(compromisos.length ? `Transcripción guardada. ${compromisos.length} compromiso(s) detectado(s).` : 'Transcripción guardada.');
};
$('#c-hablar').onclick = abrirTranscripcion;

/* ---------- reuniones ---------- */
let editing = null;
$('#m-tipo').innerHTML = TIPOS.map(t => `<option>${t}</option>`).join('');
function openMtg(r){
  editing = r || null;
  $('#mtg-h').textContent = r ? 'Editar reunión' : 'Nueva reunión';
  $('#m-titulo').value = r?.titulo || ''; $('#m-tipo').value = r?.tipo || TIPOS[0];
  $('#m-fecha').value = toLocalInput(r?.fecha || Date.now());
  $('#m-proyecto').value = r?.proyecto || ''; $('#m-lugar').value = r?.lugar || ''; $('#m-asist').value = r?.asistentes || '';
  $('#sh-mtg').hidden = false;
}
$('#f-mtg').addEventListener('submit', async e => {
  e.preventDefault();
  const data = {titulo: $('#m-titulo').value.trim(), tipo: $('#m-tipo').value, fecha: new Date($('#m-fecha').value).getTime() || Date.now(),
    proyecto: $('#m-proyecto').value.trim(), lugar: $('#m-lugar').value.trim(), asistentes: $('#m-asist').value.trim()};
  if (!data.titulo) return;
  const r = editing ? {...editing, ...data} : {id: uid(), creada: Date.now(), ...data};
  await idb.put('reuniones', r); closeSheets(); await loadReuniones();
  if (editing){ S.cur = r; render(); } else { await openMeeting(r.id); tomarUbicacion(S.cur, true); }
});
$('#btn-new').onclick = () => openMtg(null);
$('#btn-edit').onclick = () => openMtg(S.cur);
$('#back').onclick = goHome;

/* ---------- hojas y confirmación ---------- */
let confirmFn = null;
function closeSheets(){ stopDictado(); stopNotaVoz(false);document.querySelectorAll('.sheet').forEach(s => s.hidden = true); }
document.querySelectorAll('.sheet').forEach(s => s.addEventListener('click', e => { if (e.target === s || e.target.closest('[data-close]')) closeSheets(); }));
function confirmar(h, p, ok, fn){ $('#cf-h').textContent = h; $('#cf-p').textContent = p; $('#cf-ok').textContent = ok; confirmFn = fn; $('#sh-confirm').hidden = false; }
$('#cf-ok').onclick = async () => { const fn = confirmFn; closeSheets(); if (fn) await fn(); };

$('#view').addEventListener('click', e => {
  const o = e.target.closest('[data-open]'); if (o) return openMeeting(o.dataset.open);
  const ex = e.target.closest('[data-exp]'); if (ex) return exportarId(ex.dataset.exp, ex);
  const dr = e.target.closest('[data-delr]');
  if (dr){ const r = S.reuniones.find(x => x.id === dr.dataset.delr); if (!r) return;
    return confirmar(`¿Eliminar «${r.titulo}»?`, 'Se borran la reunión y todo lo capturado (fotos, audios, notas) de este celular. Si quieres conservarla, primero toca «Exportar».', 'Eliminar', async () => {
      for (const it of await idb.by('items', 'rid', r.id)){ await idb.delBy('trozos', 'iid', it.id); await idb.del('items', it.id); }
      await idb.del('reuniones', r.id); await loadReuniones(); renderHome(); updateNet(); toast('Reunión eliminada.');
    }); }
  const a = e.target.closest('[data-act]'); if (!a) return;
  const it = S.items.find(x => x.id === a.closest('[data-id]').dataset.id); if (!it) return;
  if (a.dataset.act === 'comment') openNota(it);
  else if (a.dataset.act === 'titulo'){ colaTitulos = []; openFoto(it); }
  else confirmar('¿Eliminar este elemento?', 'Se borra del celular y no se puede recuperar.', 'Eliminar', async () => {
    await idb.del('items', it.id); if (urls.has(it.id)){ URL.revokeObjectURL(urls.get(it.id)); urls.delete(it.id); } await refresh();
  });
});

function descargar(file){ const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); }
const asistList = r => (r.asistentes || '').split('\n').map(s => s.trim()).filter(Boolean);
const nombreBase = r => `acta_${new Date(r.fecha).toISOString().slice(0, 10)}_${slug(r.titulo)}`;

/* ---------- exportar: ZIP completo (respaldo, pasar a otro celular o a Drive) ---------- */
async function exportarId(id, btn){
  const r = S.reuniones.find(x => x.id === id); if (!r) return;
  const items = (await idb.by('items', 'rid', id)).sort((a, b) => a.creado - b.creado);
  await exportar(r, items, btn);
}
async function exportar(r, items, btn){
  if (rec) return toast('Detén la grabación antes de exportar.');
  btn = btn || $('#btn-enviar'); const txt = btn.textContent; btn.disabled = true; btn.textContent = 'Preparando…';
  try {
    const zip = new JSZip(), carpeta = nombreBase(r);
    const f = zip.folder(carpeta), medios = f.folder('medios');
    const lineas = [], elementos = [];
    let k = 0;
    for (const it of items){
      k++;
      const hora = fHora(it.creado), hh = new Date(it.creado).toTimeString().slice(0, 8).replace(/:/g, '');
      let archivo = null;
      if (it.blob){ const ext = EXT[baseMime(it.mime)] || (it.nombre?.split('.').pop()) || 'bin'; archivo = `medios/${String(k).padStart(3, '0')}_${hh}_${it.tipo}.${ext}`; medios.file(archivo.slice(7), it.blob); }
      elementos.push({n: k, hora, momento: new Date(it.creado).toISOString(), segmentos: it.segmentos, compromisos: it.compromisos, tipo: it.notaVoz ? 'nota_de_voz' : it.tipo, transcribir: it.tipo === 'audio' || undefined, archivo, mime: it.mime, duracion_s: it.dur ? Math.round(it.dur) : undefined, titulo: it.titulo || undefined, texto: it.texto || ''});
      const tipoTxt = it.notaVoz ? 'Nota de voz (transcribir)' : it.tipo === 'audio' ? 'Grabación (transcribir)' : LABEL[it.tipo];
      lineas.push(`### ${k}. ${hora} — ${tipoTxt}${it.titulo ? ': ' + it.titulo : ''}${it.dur ? ' (' + fDur(it.dur) + ')' : ''}` + (archivo ? `\nArchivo: ${archivo}` : '') + (it.texto ? `\n\n${it.texto}` : '') + '\n');
    }
    const meta = {app: 'captura-actas', version: 3, ubicacion: r.ubicacion, minuta: r.minuta || preprocesar(r, items), titulo: r.titulo, tipo: r.tipo, proyecto: r.proyecto, lugar: r.lugar, fecha: new Date(r.fecha).toISOString(), fecha_local: fFecha(r.fecha),
      asistentes: asistList(r), elementos};
    f.file('reunion.json', JSON.stringify(meta, null, 2));
    f.file('contenido.md', `# ${r.titulo}\n\n- Tipo: ${r.tipo}\n- Proyecto: ${r.proyecto || '—'}\n- Lugar: ${r.lugar || '—'}${r.ubicacion ? `\n- Ubicación GPS: ${r.ubicacion.direccion ? r.ubicacion.direccion + ' · ' : ''}${r.ubicacion.lat}, ${r.ubicacion.lon} (±${r.ubicacion.precision} m) https://www.google.com/maps?q=${r.ubicacion.lat},${r.ubicacion.lon}` : ''}\n- Fecha: ${fFecha(r.fecha)}\n\n## Asistentes\n${meta.asistentes.map(a => '- ' + a).join('\n') || '—'}\n\n## Registro en orden de captura\n\n${lineas.join('\n')}`);
    const blob = await zip.generateAsync({type: 'blob', compression: 'STORE'});
    const file = new File([blob], carpeta + '.zip', {type: 'application/zip'});
    let shared = false;
    if (navigator.canShare && navigator.canShare({files: [file]})){
      try { await navigator.share({files: [file], title: r.titulo}); shared = true; }
      catch(e){ if (e.name === 'AbortError'){ btn.disabled = false; btn.textContent = txt; return; } }
    }
    if (!shared){ descargar(file); toast('Registro guardado en Descargas como ' + file.name); }
  } catch(e){ toast('No se pudo exportar: ' + (e.message || e)); }
  btn.disabled = false; btn.textContent = txt;
}

/* ---------- importar un ZIP exportado (otro celular, respaldo) ---------- */
$('#in-import').addEventListener('change', async e => {
  const file = e.target.files[0]; if (!file) return;
  try {
    const zip = await JSZip.loadAsync(file);
    const jf = Object.keys(zip.files).find(n => n.endsWith('reunion.json')); if (!jf) throw new Error('el archivo no tiene reunion.json');
    const base = jf.slice(0, -'reunion.json'.length), meta = JSON.parse(await zip.file(jf).async('string'));
    const r = {id: uid(), creada: Date.now(), titulo: meta.titulo || 'Reunión importada', tipo: meta.tipo || TIPOS[0], fecha: new Date(meta.fecha).getTime() || Date.now(),
      proyecto: meta.proyecto || '', lugar: meta.lugar || '', ubicacion: meta.ubicacion || undefined, asistentes: (meta.asistentes || []).join('\n'), importada: Date.now()};
    for (const el of meta.elementos || []){
      const it = {id: uid(), rid: r.id, segmentos: el.segmentos, compromisos: el.compromisos, tipo: el.tipo === 'nota_de_voz' ? 'audio' : el.tipo, notaVoz: el.tipo === 'nota_de_voz' || undefined, creado: new Date(el.momento).getTime() || Date.now(), titulo: el.titulo || '', texto: el.texto || '', dur: el.duracion_s || undefined};
      if (el.archivo && zip.file(base + el.archivo)){ const mime = el.mime || Object.keys(EXT).find(k => EXT[k] === el.archivo.split('.').pop()) || 'application/octet-stream'; it.blob = new Blob([await zip.file(base + el.archivo).async('arraybuffer')], {type: mime}); it.mime = mime; it.nombre = el.archivo.split('/').pop(); }
      await idb.put('items', it);
    }
    await idb.put('reuniones', r); await loadReuniones(); renderHome(); toast(`Importada: «${r.titulo}».`);
  } catch(err){ toast('No se pudo importar: ' + (err.message || err)); }
});

/* ---------- redactar con IA: paquete para el Redactor de Actas (Claude, plan Pro) ---------- */
const REDACTOR_URL = 'https://claude.ai/artifact/HrW6fwFG1AfQb4tK9Y1Kxr';
async function fotoIA(blob){
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, 1280 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.8).split(',')[1];
  } catch(_){ return null; }
}
async function videoFrame(blob){
  return new Promise(ok => {
    const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.preload = 'auto'; v.src = URL.createObjectURL(blob);
    const done = x => { URL.revokeObjectURL(v.src); ok(x); };
    v.onloadeddata = () => { v.currentTime = Math.min(1, (v.duration || 2) / 2); };
    v.onseeked = () => { try { const k = Math.min(1, 1280 / Math.max(v.videoWidth, v.videoHeight)); const c = document.createElement('canvas'); c.width = Math.round(v.videoWidth * k); c.height = Math.round(v.videoHeight * k); c.getContext('2d').drawImage(v, 0, 0, c.width, c.height); done(c.toDataURL('image/jpeg', 0.8).split(',')[1]); } catch(_){ done(null); } };
    v.onerror = () => done(null); setTimeout(() => done(null), 8000);
  });
}
async function redactarIA(){
  if (rec) return toast('Detén la grabación antes de redactar el acta.');
  const r = S.cur;
  const faltan = S.items.filter(i => (i.tipo === 'foto' || i.tipo === 'video') && !i.titulo);
  if (faltan.length){ colaTitulos = faltan.slice(1); openFoto(faltan[0]); return toast('Antes de redactar, ponle título a cada foto.'); }
  if (!navigator.onLine){
    r.pendienteIA = Date.now(); await idb.put('reuniones', r); await loadReuniones(); S.cur = S.reuniones.find(x => x.id === r.id); renderMeeting(); updateNet();
    return toast('Sin internet: queda en cola. Cuando vuelva la señal aparece «Redactar ahora».');
  }
  const btn = $('#btn-ia'); btn.disabled = true; btn.textContent = 'Preparando…';
  try {
    const elementos = []; let k = 0;
    for (const it of S.items){
      k++;
      const el = {n: k, hora: fHora(it.creado), tipo: it.notaVoz ? 'nota_de_voz' : it.tipo, titulo: it.titulo || undefined, segmentos: it.segmentos, compromisos_detectados: it.compromisos?.length ? it.compromisos : undefined, texto: it.texto || '', duracion_s: it.dur ? Math.round(it.dur) : undefined};
      if (it.tipo === 'foto' && it.blob) el.foto = await fotoIA(it.blob);
      if (it.tipo === 'video' && it.blob) el.foto = await videoFrame(it.blob);
      if (!el.foto) delete el.foto;
      elementos.push(el);
    }
    if (!r.minuta || (r.minuta.nItems !== S.items.length && !r.minuta.editada)){ r.minuta = preprocesar(r, S.items); await idb.put('reuniones', r); }
    const pkg = {app: 'captura-actas', version: 3, minuta: r.minuta, reunion: {titulo: r.titulo, tipo: r.tipo, proyecto: r.proyecto, lugar: r.lugar, ubicacion: r.ubicacion, fecha: new Date(r.fecha).toISOString(), asistentes: asistList(r)}, elementos};
    const file = new File([JSON.stringify(pkg)], nombreBase(r) + '.json', {type: 'application/json'});
    descargar(file);
    delete r.pendienteIA; r.enviadaIA = Date.now(); await idb.put('reuniones', r); await loadReuniones(); S.cur = S.reuniones.find(x => x.id === r.id); renderMeeting(); updateNet();
    $('#ia-file').textContent = file.name; $('#ia-audio').hidden = !S.items.some(i => i.tipo === 'audio');
    const android = /Android/i.test(navigator.userAgent);
    $('#ia-open').href = android ? `intent://${REDACTOR_URL.replace(/^https:\/\//, '')}#Intent;scheme=https;package=com.anthropic.claude;S.browser_fallback_url=${encodeURIComponent(REDACTOR_URL)};end` : REDACTOR_URL;
    $('#ia-web').href = REDACTOR_URL; $('#ia-web').hidden = !android; $('#sh-ia').hidden = false;
  } catch(e){ toast('No se pudo preparar: ' + (e.message || e)); }
  const b = $('#btn-ia'); if (b){ b.disabled = false; b.textContent = 'Redactar acta con IA'; }
}

/* ---------- conexión y cola ---------- */
function updateNet(){
  const on = navigator.onLine;
  $('#net').hidden = on;
  const cola = S.reuniones.filter(r => r.pendienteIA);
  $('#banner').hidden = !(on && cola.length);
  if (on && cola.length) $('#banner-txt').textContent = cola.length === 1 ? `Volvió la señal. «${cola[0].titulo}» está lista para redactar el acta.` : `Volvió la señal. Tienes ${cola.length} reuniones en cola para redactar.`;
}
$('#banner-btn').onclick = async () => {
  const r = S.reuniones.find(x => x.pendienteIA); if (!r) return;
  if (!S.cur || S.cur.id !== r.id) await openMeeting(r.id);
  redactarIA();
};
window.addEventListener('online', () => { updateNet(); S.reuniones.filter(r => r.ubicacion && !r.ubicacion.direccion).forEach(direccion); if (S.reuniones.some(r => r.pendienteIA)){ toast('Volvió la señal. Toca «Redactar ahora» para lo que quedó en cola.'); navigator.vibrate?.(200); } });
window.addEventListener('offline', () => { updateNet(); if (dict){ const c = dCtx; stopDictado(); if (!c || !c.soloTexto) startNotaVoz(); } });

/* ---------- instalar como app ---------- */
let bip = null;
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const inApp = /; wv\)|FBAN|FBAV|Instagram|WhatsApp|Line\//i.test(navigator.userAgent);
const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
function installCard(){
  if (standalone()) return '';
  const how = inApp ? 'Estás dentro de otra app. Toca <strong>⋮ → Abrir en Chrome</strong> (o copia el enlace en Chrome) para instalarla y dictar.'
    : isIOS ? 'En Safari toca <strong>Compartir</strong> y luego <strong>Agregar a inicio</strong>.'
    : bip ? 'Queda con su ícono en el celular, abre a pantalla completa y funciona sin señal.'
    : 'En Chrome toca <strong>⋮</strong> y luego <strong>Instalar app</strong> (o «Agregar a pantalla principal»).';
  return `<div class="card install"><b>Instala Actas como app</b><span class="sub">${how}</span>${bip && !inApp ? '<button class="btn primary" id="btn-install">Instalar app</button>' : ''}</div>`;
}
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); bip = e; if (S.view === 'home') renderHome(); });
window.addEventListener('appinstalled', () => { bip = null; toast('App instalada. Ábrela desde el ícono «Actas».'); if (S.view === 'home') renderHome(); });
document.addEventListener('click', async e => { if (e.target.id === 'btn-install' && bip){ bip.prompt(); try { await bip.userChoice; } catch(_){} bip = null; renderHome(); } });

/* ---------- arranque ---------- */
window.addEventListener('beforeunload', e => { if (rec){ e.preventDefault(); e.returnValue = ''; } });
(async () => {
  try { await navigator.storage?.persist?.(); } catch(_){}
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
  await recover(); await loadReuniones(); render(); updateNet();
})();
