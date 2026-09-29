'use strict';
const $ = s => document.querySelector(s);
const TIPOS = ['Comité de obra','Visita técnica','Reunión con cliente','Reunión con copropiedad','Entrega de obra','Otra'];
const EXT = {'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/heic':'heic','video/mp4':'mp4','video/quicktime':'mov','video/webm':'webm','video/3gpp':'3gp','audio/webm':'webm','audio/mp4':'m4a','audio/mpeg':'mp3','audio/ogg':'ogg','audio/aac':'aac','audio/wav':'wav','audio/amr':'amr','application/pdf':'pdf'};
const LABEL = {foto:'Foto', video:'Video', audio:'Audio', nota:'Nota', archivo:'Archivo'};

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
  if (!S.reuniones.length){ v.innerHTML = installCard() + `<div class="empty"><b>Aún no hay reuniones</b>Toca <strong>+ Nueva</strong> al llegar a la reunión. Luego captura fotos, videos, grabaciones y notas dictadas. Todo se guarda en este celular, aunque no haya señal.</div>`; return; }
  v.innerHTML = installCard() + `<p class="eyebrow">Reuniones</p><ul class="list">${S.reuniones.map(r => `<li><button class="card mtg" data-open="${r.id}">
    <span class="row"><b>${esc(r.titulo)}</b>${r.pendienteEnvio ? '<span class="chip warn">En cola</span>' : r.enviada ? '<span class="chip ok">Enviada</span>' : ''}</span>
    <span class="sub">${esc([r.tipo, r.proyecto].filter(Boolean).join(' · '))}</span>
    <span class="sub mono">${esc(fFecha(r.fecha))}${r.lugar ? ' · ' + esc(r.lugar) : ''}</span></button></li>`).join('')}</ul><p class="meter" id="meter"></p>`;
  try { const e = await navigator.storage?.estimate?.(); if (e && $('#meter')) $('#meter').textContent = `Espacio usado en el celular: ${fMB(e.usage || 0)}`; } catch(_){}
}

function renderMeeting(){
  const r = S.cur, v = $('#view');
  const asis = (r.asistentes || '').split('\n').map(s => s.trim()).filter(Boolean);
  const n = S.items.length;
  v.innerHTML = `<section class="meta card">
    <h2>${esc(r.titulo)}</h2>
    <div class="sub">${esc([r.tipo, r.proyecto].filter(Boolean).join(' · '))}</div>
    <div class="sub mono">${esc(fFecha(r.fecha))}${r.lugar ? ' · ' + esc(r.lugar) : ''}</div>
    ${asis.length ? `<details><summary>${asis.length} asistente${asis.length > 1 ? 's' : ''}</summary><ul>${asis.map(a => `<li>${esc(a)}</li>`).join('')}</ul></details>` : `<div class="sub" style="margin-top:8px">Sin asistentes. Tip: toma foto a la lista de asistencia firmada.</div>`}
    <div class="actions"><button class="btn primary" id="btn-enviar" ${n ? '' : 'disabled'}>Enviar para acta</button><span class="chip" style="align-self:center">${n} elemento${n === 1 ? '' : 's'}</span></div>
    ${r.pendienteEnvio ? `<p class="small" style="margin:10px 0 0">En cola desde ${esc(fFecha(r.pendienteEnvio))}: se envía cuando haya internet.</p>` : ''}
    ${r.enviada && !r.pendienteEnvio ? `<p class="small" style="margin:10px 0 0">Enviada el ${esc(fFecha(r.enviada))}. En el PC pídele a Claude: «Haz el acta de ${esc(r.titulo)}».</p>` : ''}
  </section>
  ${n ? `<ol class="timeline">${S.items.map(itemHTML).join('')}</ol>` : `<div class="empty"><b>Nada capturado todavía</b>Usa los botones de abajo. Todo queda en orden de captura.</div>`}`;
  $('#btn-enviar').onclick = exportar;
}

function itemHTML(it){
  let inner = '';
  if (it.tipo === 'nota') inner = `<div class="note">${esc(it.texto)}</div>`;
  else {
    const u = urlFor(it);
    inner = it.tipo === 'foto' ? `<img src="${u}" alt="${esc(it.texto || 'Foto')}" loading="lazy">`
      : it.tipo === 'video' ? `<video src="${u}" controls playsinline preload="metadata"></video>`
      : it.tipo === 'audio' ? `<audio src="${u}" controls preload="metadata"></audio>`
      : `<div class="note">${esc(it.nombre)}</div>`;
    if (it.texto) inner += `<div class="cap">${esc(it.texto)}</div>`;
  }
  const info = [it.notaVoz ? 'Nota de voz · por transcribir' : LABEL[it.tipo], it.dur ? fDur(it.dur) : '', it.blob ? fMB(it.blob.size) : ''].filter(Boolean).join(' · ');
  return `<li class="it" data-id="${it.id}"><div class="t mono">${fHora(it.creado)}</div><div class="body">${inner}
    <div class="foot"><span class="k">${info}</span><button data-act="comment">${it.tipo === 'nota' ? 'Editar' : it.texto ? 'Editar comentario' : 'Comentar'}</button><button class="del" data-act="delete">Eliminar</button></div></div></li>`;
}

/* ---------- navegación ---------- */
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
  for (const f of list){
    const mime = mimeOf(f); let blob = f;
    if (mime.startsWith('image/')) blob = await compressImage(f);
    await idb.put('items', {id: uid(), rid: S.cur.id, tipo: kindOf(mime), creado: Date.now(), nombre: f.name, mime: blob.type || mime, blob, texto: ''});
  }
  await refresh(true);
}
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
  dMsg('');
  $('#sh-nota').hidden = false;
  if (!it && !rec){
    if (navigator.onLine) startDictado();
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
function dMsg(t, warn){ const m = $('#dictar-msg'); m.textContent = t; m.hidden = !t; m.style.color = warn ? 'var(--danger)' : ''; }
function startDictado(){
  const ta = $('#n-texto');
  if (!SR){ dMsg('Este navegador no tiene dictado (ábrela en Chrome). Se graba como nota de voz.', true); if (!rec) startNotaVoz(); return; }
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
      if (!err || err === 'no-speech' || err === 'aborted'){ if (d.quick >= 5 && !d.got){ stopDictado(); dMsg('El dictado no arrancó en este celular. Se graba como nota de voz.', true); if (!rec) startNotaVoz(); } else stopDictado(); return; }
      stopDictado();
      dMsg((ERRTXT[err] || 'El dictado falló (' + err + ').') + (rec ? ' La grabación de la reunión ya está captando lo que se dice; escribe la nota.' : ' Se graba como nota de voz y la transcribo al hacer el acta.'), true);
      if (!rec) startNotaVoz();
    };
    r.start();
  };
  dict = d;
  try { run(); } catch(e){ dict = null; dMsg('El dictado no arrancó. Se graba como nota de voz.', true); if (!rec) startNotaVoz(); return; }
  $('#btn-dictar').classList.add('on'); $('#btn-dictar').textContent = '■ Detener dictado';
}
function stopDictado(){ const d = dict; dict = null; if (d){ d.on = false; try { d.r.stop(); } catch(_){} } $('#btn-dictar').classList.remove('on'); $('#btn-dictar').textContent = '● Dictar'; if (d && !$('#dictar-msg').style.color) dMsg(''); }
$('#btn-dictar').onclick = () => dict ? stopDictado() : vn ? toast('Ya se está grabando la nota de voz.') : startDictado();
$('#f-nota').addEventListener('submit', async e => {
  e.preventDefault(); stopDictado();
  const texto = $('#n-texto').value.trim();
  const voz = await stopNotaVoz(true);
  if (notaItem){ notaItem.texto = texto; await idb.put('items', notaItem); }
  else if (voz) await idb.put('items', {id: uid(), rid: S.cur.id, tipo: 'audio', notaVoz: true, creado: Date.now() - voz.dur * 1000, nombre: 'nota-de-voz', mime: voz.mime, blob: voz.blob, dur: voz.dur, texto});
  else if (texto) await idb.put('items', {id: uid(), rid: S.cur.id, tipo: 'nota', creado: Date.now(), texto});
  closeSheets(); await refresh(!notaItem);
});
$('#c-nota').onclick = () => openNota(null);

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
  if (editing){ S.cur = r; render(); } else openMeeting(r.id);
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
  const a = e.target.closest('[data-act]'); if (!a) return;
  const it = S.items.find(x => x.id === a.closest('[data-id]').dataset.id); if (!it) return;
  if (a.dataset.act === 'comment') openNota(it);
  else confirmar('¿Eliminar este elemento?', 'Se borra del celular y no se puede recuperar.', 'Eliminar', async () => {
    await idb.del('items', it.id); if (urls.has(it.id)){ URL.revokeObjectURL(urls.get(it.id)); urls.delete(it.id); } await refresh();
  });
});

/* ---------- enviar: paquete ZIP para Claude ---------- */
async function exportar(){
  if (rec) return toast('Detén la grabación antes de enviar.');
  if (!navigator.onLine){
    S.cur.pendienteEnvio = Date.now(); await idb.put('reuniones', S.cur); await loadReuniones();
    renderMeeting(); updateNet();
    return toast('Sin internet: la reunión queda en cola. Cuando vuelva la señal te aparece el botón «Enviar ahora».');
  }
  const btn = $('#btn-enviar'); btn.disabled = true; btn.textContent = 'Preparando…';
  try {
    const r = S.cur, zip = new JSZip();
    const d = new Date(r.fecha), fecha = d.toISOString().slice(0, 10);
    const carpeta = `acta_${fecha}_${slug(r.titulo)}`;
    const f = zip.folder(carpeta), medios = f.folder('medios');
    const lineas = [], elementos = [];
    let k = 0;
    for (const it of S.items){
      k++;
      const hora = fHora(it.creado), hh = new Date(it.creado).toTimeString().slice(0, 8).replace(/:/g, '');
      let archivo = null;
      if (it.blob){ const ext = EXT[baseMime(it.mime)] || (it.nombre?.split('.').pop()) || 'bin'; archivo = `medios/${String(k).padStart(3, '0')}_${hh}_${it.tipo}.${ext}`; medios.file(archivo.slice(7), it.blob); }
      elementos.push({n: k, hora, momento: new Date(it.creado).toISOString(), tipo: it.notaVoz ? 'nota_de_voz' : it.tipo, transcribir: it.tipo === 'audio' || undefined, archivo, duracion_s: it.dur ? Math.round(it.dur) : undefined, texto: it.texto || ''});
      lineas.push(`### ${k}. ${hora} — ${it.notaVoz ? 'Nota de voz (transcribir)' : it.tipo === 'audio' ? 'Grabación (transcribir)' : LABEL[it.tipo]}${it.dur ? ' (' + fDur(it.dur) + ')' : ''}` + (archivo ? `\nArchivo: ${archivo}` : '') + (it.texto ? `\n\n${it.texto}` : '') + '\n');
    }
    const meta = {titulo: r.titulo, tipo: r.tipo, proyecto: r.proyecto, lugar: r.lugar, fecha: d.toISOString(), fecha_local: fFecha(r.fecha),
      asistentes: (r.asistentes || '').split('\n').map(s => s.trim()).filter(Boolean), elementos};
    f.file('reunion.json', JSON.stringify(meta, null, 2));
    f.file('contenido.md', `# ${r.titulo}\n\n- Tipo: ${r.tipo}\n- Proyecto: ${r.proyecto || '—'}\n- Lugar: ${r.lugar || '—'}\n- Fecha: ${fFecha(r.fecha)}\n\n## Asistentes\n${meta.asistentes.map(a => '- ' + a).join('\n') || '—'}\n\n## Registro en orden de captura\n\n${lineas.join('\n')}`);
    const blob = await zip.generateAsync({type: 'blob', compression: 'STORE'});
    const file = new File([blob], carpeta + '.zip', {type: 'application/zip'});
    let shared = false;
    if (navigator.canShare && navigator.canShare({files: [file]})){
      try { await navigator.share({files: [file], title: r.titulo}); shared = true; }
      catch(e){ if (e.name === 'AbortError'){ btn.disabled = false; btn.textContent = 'Enviar para acta'; return; } }
    }
    if (!shared){ const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); toast('Paquete descargado. Súbelo a tu carpeta de Drive «Actas».'); }
    r.enviada = Date.now(); delete r.pendienteEnvio; await idb.put('reuniones', r); await loadReuniones(); S.cur = r; renderMeeting(); updateNet();
  } catch(e){ toast('No se pudo preparar el paquete: ' + (e.message || e)); btn.disabled = false; btn.textContent = 'Enviar para acta'; }
}

/* ---------- conexión y cola ---------- */
function updateNet(){
  const on = navigator.onLine;
  $('#net').hidden = on;
  const cola = S.reuniones.filter(r => r.pendienteEnvio);
  $('#banner').hidden = !(on && cola.length);
  if (on && cola.length) $('#banner-txt').textContent = cola.length === 1 ? `Volvió la señal. «${cola[0].titulo}» está lista para enviar.` : `Volvió la señal. Tienes ${cola.length} reuniones en cola para enviar.`;
}
$('#banner-btn').onclick = async () => {
  const r = S.reuniones.find(x => x.pendienteEnvio); if (!r) return;
  if (!S.cur || S.cur.id !== r.id) await openMeeting(r.id);
  exportar();
};
window.addEventListener('online', () => { updateNet(); if (S.reuniones.some(r => r.pendienteEnvio)){ toast('Volvió la señal. Toca «Enviar ahora» para mandar lo que quedó en cola.'); navigator.vibrate?.(200); } });
window.addEventListener('offline', () => { updateNet(); if (dict){ stopDictado(); startNotaVoz(); } });

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
