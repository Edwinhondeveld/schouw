import * as pdfjsLib from '../lib/pdf.min.mjs';
import { db, nieuwId } from './db.js';
import { maakZip, leesZip } from './zip.js';
import { wolkPad, pijlPaden, KLEUREN, STATUS_KLEUR, CATEGORIEEN } from './vorm.js';
import { maakRapport, rapportNaam } from './rapport.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../lib/pdf.worker.min.mjs', import.meta.url).href;
const PDF_OPTIES = {
  cMapUrl: new URL('../lib/cmaps/', import.meta.url).href,
  cMapPacked: true,
  standardFontDataUrl: new URL('../lib/standard_fonts/', import.meta.url).href,
};

const $ = id => document.getElementById(id);
const SVGNS = 'http://www.w3.org/2000/svg';

// ---------- Toestand ----------
const st = {
  project: null,
  tekeningId: null, pagina: 1,
  pdfCache: new Map(),       // bestandId -> pdf.js document
  paginaObj: null, w: 0, h: 0, basisSchaal: 1,
  view: { s: 1, tx: 0, ty: 0 },
  tool: 'hand', kleur: KLEUREN[0].waarde,
  geselecteerd: null,
  ongedaan: [],
  filter: 'alle',
  verplaatsPunt: null,
  laadTeller: 0,
};

// ---------- Hulpjes ----------
function melding(tekst, ms = 3500) {
  const m = $('melding'); m.textContent = tekst; m.hidden = false;
  clearTimeout(melding.t); melding.t = setTimeout(() => { m.hidden = true; }, ms);
}
function bezig(tekst) { $('bezigTekst').textContent = tekst || 'Bezig...'; $('bezig').hidden = false; }
function klaar() { $('bezig').hidden = true; }
function hint(tekst) { const h = $('hint'); if (tekst) { h.textContent = tekst; h.hidden = false; } else h.hidden = true; }
function vraag(tekst, ja = 'Ja') {
  return new Promise(res => {
    const d = $('dlgVraag'); $('vraagTekst').textContent = tekst; $('vraagJa').textContent = ja;
    d.returnValue = ''; d.showModal();
    d.addEventListener('close', () => res(d.returnValue === 'ja'), { once: true });
  });
}
function datumNL(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
}
function vandaag() { const d = new Date(); return d.toISOString().slice(0, 10); }
function el(tag, attrs = {}, ouder) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (ouder) ouder.appendChild(e);
  return e;
}
function esc(t) { return String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
async function bewaar() { if (st.project) await db.bewaarProject(st.project); }

// ---------- Opslag beschermen ----------
async function opslagInfo() {
  try {
    if (navigator.storage?.persist) await navigator.storage.persist();
    if (navigator.storage?.estimate) {
      const e = await navigator.storage.estimate();
      const mb = x => Math.round(x / 1048576);
      $('opslagInfo').textContent = `Alles wordt op dit apparaat bewaard en werkt zonder internet. In gebruik: ${mb(e.usage)} MB van ${mb(e.quota)} MB.`;
    }
  } catch { /* niet erg */ }
}

// ---------- Startscherm ----------
async function toonThuis() {
  $('werk').hidden = true; $('thuis').hidden = false;
  st.project = null;
  const lijst = (await db.alleProjecten()).sort((a, b) => (b.gewijzigd || '').localeCompare(a.gewijzigd || ''));
  const ul = $('projectLijst'); ul.innerHTML = '';
  if (!lijst.length) ul.innerHTML = '<li class="leegmelding">Nog geen projecten. Maak een nieuw project of open een projectbestand.</li>';
  for (const p of lijst) {
    const li = document.createElement('li');
    const open = p.punten.filter(x => x.status === 'open').length;
    li.innerHTML = `<div class="pinfo"><b>${esc(p.nummer)} ${esc(p.naam)}</b>
      <small>${esc(p.locatie || '')}${p.locatie ? ' · ' : ''}${p.tekeningen.length} tekening(en) · ${p.punten.length} punt(en), ${open} open · bijgewerkt ${datumNL(p.gewijzigd)}</small></div>
      <button class="ik" title="Verwijderen">&#128465;</button>`;
    li.querySelector('.pinfo').onclick = () => openProject(p.id);
    li.querySelector('button').onclick = async e => {
      e.stopPropagation();
      if (!await vraag(`Project ${p.nummer} ${p.naam} van dit apparaat verwijderen? Sla het eerst op als projectbestand als je het wilt bewaren.`, 'Verwijderen')) return;
      for (const t of p.tekeningen) await db.verwijderBestand(t.bestandId);
      for (const pt of p.punten) for (const f of pt.fotos) await db.verwijderBestand(f.id);
      await db.verwijderProject(p.id);
      toonThuis();
    };
    ul.appendChild(li);
  }
  opslagInfo();
}

function projectFormulier(p, titel) {
  return new Promise(res => {
    const d = $('dlgProject'); const f = d.querySelector('form');
    $('dlgProjectTitel').textContent = titel;
    const r = p.rapport || {};
    f.nummer.value = p.nummer || ''; f.naam.value = p.naam || ''; f.locatie.value = p.locatie || '';
    f.datum.value = p.datum || vandaag(); f.opsteller.value = p.opsteller || 'E.W.M. (Edwin) Hondeveld';
    f.opdrachtgever.value = p.opdrachtgever || '';
    f.rapCode.value = r.code || 'SCH'; f.rapNr.value = r.nr || '01'; f.rapVersie.value = r.versie || 'v1.0'; f.rapStatus.value = r.status || 'CONCEPT';
    d.returnValue = ''; d.showModal();
    d.addEventListener('close', () => {
      if (d.returnValue !== 'ok') return res(false);
      Object.assign(p, {
        nummer: f.nummer.value.trim(), naam: f.naam.value.trim(), locatie: f.locatie.value.trim(),
        datum: f.datum.value, opsteller: f.opsteller.value.trim(), opdrachtgever: f.opdrachtgever.value.trim(),
        rapport: { code: f.rapCode.value.trim() || 'SCH', nr: f.rapNr.value.trim() || '01', versie: f.rapVersie.value.trim() || 'v1.0', status: f.rapStatus.value },
      });
      res(true);
    }, { once: true });
  });
}

$('btnNieuwProject').onclick = async () => {
  const p = { id: nieuwId('proj'), nummer: '', naam: '', tekeningen: [], items: [], punten: [], aangemaakt: new Date().toISOString() };
  if (!await projectFormulier(p, 'Nieuw project')) return;
  await db.bewaarProject(p);
  openProject(p.id);
};

$('btnOpenProject').onclick = () => $('invProject').click();
$('invProject').onchange = async e => {
  const bestand = e.target.files[0]; e.target.value = '';
  if (!bestand) return;
  bezig('Projectbestand openen...');
  try {
    const delen = await leesZip(bestand);
    if (!delen['project.json']) throw new Error('In dit bestand staat geen SCHOUW-project.');
    const p = JSON.parse(new TextDecoder().decode(delen['project.json']));
    const bestaand = await db.project(p.id);
    klaar();
    if (bestaand && !await vraag(`Project ${p.nummer} ${p.naam} staat al op dit apparaat. Vervangen door de versie uit het bestand?`, 'Vervangen')) return;
    bezig('Projectbestand openen...');
    for (const t of p.tekeningen) {
      const data = delen[t.pad]; if (!data) throw new Error(`Tekening ${t.naam} ontbreekt in het bestand.`);
      await db.bewaarBestand(t.bestandId, new Blob([data], { type: 'application/pdf' }));
      delete t.pad;
    }
    for (const pt of p.punten) for (const f of pt.fotos) {
      const data = delen[f.pad]; if (!data) continue;
      await db.bewaarBestand(f.id, new Blob([data], { type: 'image/jpeg' }));
      delete f.pad;
    }
    await db.bewaarProject(p);
    klaar();
    openProject(p.id);
  } catch (err) { klaar(); melding('Openen mislukt: ' + err.message, 6000); }
};

// ---------- Project openen ----------
async function openProject(id) {
  st.project = await db.project(id);
  if (!st.project) return toonThuis();
  st.project.items ||= []; st.project.punten ||= [];
  st.ongedaan = []; st.geselecteerd = null;
  $('thuis').hidden = true; $('werk').hidden = false;
  kopTekst();
  vulTekeningKeuze();
  const laatste = st.project.laatsteWeergave;
  const t = st.project.tekeningen.find(x => x.id === laatste?.tekeningId) || st.project.tekeningen[0];
  if (t) await toonTekening(t.id, laatste?.tekeningId === t.id ? laatste.pagina : 1);
  else toonLeeg();
  vulPuntLijst();
}

function kopTekst() {
  const p = st.project;
  $('projTitel').textContent = `${p.nummer} ${p.naam}`;
  $('projSub').textContent = [p.locatie, p.datum ? 'bezoek ' + datumNL(p.datum) : ''].filter(Boolean).join(' · ');
  $('puntTeller').textContent = p.punten.filter(x => x.status === 'open').length + '/' + p.punten.length;
}

function tekeningLabel(t, pag) { return t.paginas > 1 ? `${t.naam} (blad ${pag})` : t.naam; }

function vulTekeningKeuze() {
  const s = $('selTekening'); s.innerHTML = '';
  for (const t of st.project.tekeningen) for (let i = 1; i <= t.paginas; i++) {
    const o = document.createElement('option'); o.value = t.id + '|' + i; o.textContent = tekeningLabel(t, i); s.appendChild(o);
  }
  s.hidden = !st.project.tekeningen.length;
  if (st.tekeningId) s.value = st.tekeningId + '|' + st.pagina;
}
$('selTekening').onchange = e => { const [id, p] = e.target.value.split('|'); toonTekening(id, +p); };

function toonLeeg() {
  st.tekeningId = null; st.paginaObj = null;
  $('wereld').hidden = true; $('leeg').hidden = false;
}

// ---------- Tekeningen ----------
async function pdfDoc(bestandId) {
  if (st.pdfCache.has(bestandId)) return st.pdfCache.get(bestandId);
  const blob = await db.bestand(bestandId);
  if (!blob) throw new Error('Tekening niet gevonden op dit apparaat.');
  const data = new Uint8Array(await blob.arrayBuffer());
  const doc = await pdfjsLib.getDocument({ data, ...PDF_OPTIES }).promise;
  st.pdfCache.set(bestandId, doc);
  return doc;
}

$('btnTekening').onclick = $('btnTekening2').onclick = () => $('invTekening').click();
$('invTekening').onchange = async e => {
  const bestanden = [...e.target.files]; e.target.value = '';
  if (!bestanden.length) return;
  let eerste = null;
  for (const b of bestanden) {
    bezig(`Tekening inladen: ${b.name}`);
    try {
      const bestandId = nieuwId('pdf');
      await db.bewaarBestand(bestandId, new Blob([b], { type: 'application/pdf' }));
      const doc = await pdfDoc(bestandId);
      const t = { id: nieuwId('tek'), naam: b.name.replace(/\.pdf$/i, ''), bestandId, paginas: doc.numPages };
      st.project.tekeningen.push(t);
      eerste ||= t;
    } catch (err) { melding(`${b.name} kon niet worden ingeladen: ${err.message}`, 6000); }
  }
  await bewaar(); klaar();
  vulTekeningKeuze();
  if (eerste) toonTekening(eerste.id, 1);
};

async function toonTekening(id, pagina = 1) {
  const t = st.project.tekeningen.find(x => x.id === id); if (!t) return;
  const mijnLaad = ++st.laadTeller;
  bezig('Tekening laden...');
  try {
    const doc = await pdfDoc(t.bestandId);
    const pag = await doc.getPage(pagina);
    if (mijnLaad !== st.laadTeller) return;
    st.tekeningId = id; st.pagina = pagina; st.paginaObj = pag;
    const vp = pag.getViewport({ scale: 1 });
    st.w = vp.width; st.h = vp.height;
    // basisbeeld: langste zijde max 4096 px en max ~14 miljoen pixels
    let schaal = Math.min(4096 / Math.max(st.w, st.h), 6);
    if (st.w * st.h * schaal * schaal > 14e6) schaal = Math.sqrt(14e6 / (st.w * st.h));
    st.basisSchaal = schaal;
    const c = $('basis');
    c.width = Math.round(st.w * schaal); c.height = Math.round(st.h * schaal);
    c.style.width = st.w + 'px'; c.style.height = st.h + 'px';
    const svg = $('laag');
    svg.setAttribute('viewBox', `0 0 ${st.w} ${st.h}`);
    svg.style.width = st.w + 'px'; svg.style.height = st.h + 'px';
    $('scherp').hidden = true;
    $('wereld').hidden = false; $('leeg').hidden = true;
    passend();
    tekenLaag();
    $('selTekening').value = id + '|' + pagina;
    st.project.laatsteWeergave = { tekeningId: id, pagina };
    bewaar();
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await pag.render({ canvasContext: ctx, viewport: pag.getViewport({ scale: schaal }) }).promise;
    klaar();
    planScherp();
  } catch (err) {
    klaar(); melding('Tekening kon niet worden getoond: ' + err.message, 6000);
  }
}

$('mnTekeningWeg').onclick = async () => {
  menuDicht();
  const t = st.project.tekeningen.find(x => x.id === st.tekeningId); if (!t) return;
  const n = st.project.punten.filter(p => p.tekeningId === t.id).length;
  if (!await vraag(`Tekening "${t.naam}" verwijderen?${n ? ` De ${n} punt(en) en aantekeningen op deze tekening gaan ook weg.` : ''}`, 'Verwijderen')) return;
  for (const p of st.project.punten.filter(p => p.tekeningId === t.id)) for (const f of p.fotos) await db.verwijderBestand(f.id);
  st.project.punten = st.project.punten.filter(p => p.tekeningId !== t.id);
  st.project.items = st.project.items.filter(i => i.tekeningId !== t.id);
  st.project.tekeningen = st.project.tekeningen.filter(x => x.id !== t.id);
  await db.verwijderBestand(t.bestandId);
  st.pdfCache.delete(t.bestandId);
  await bewaar();
  vulTekeningKeuze(); vulPuntLijst(); kopTekst();
  const volgende = st.project.tekeningen[0];
  if (volgende) toonTekening(volgende.id, 1); else toonLeeg();
};

// ---------- Weergave (zoomen en schuiven) ----------
function zetView() {
  const { s, tx, ty } = st.view;
  $('wereld').style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
  schaalMarkers();
}
function passend() {
  const r = $('stage').getBoundingClientRect();
  const s = Math.min((r.width - 24) / st.w, (r.height - 24) / st.h);
  st.view = { s, tx: (r.width - st.w * s) / 2, ty: (r.height - st.h * s) / 2 };
  zetView(); planScherp();
}
$('btnPassend').onclick = () => { if (st.paginaObj) passend(); };

function zoomRond(cx, cy, factor) {
  const v = st.view;
  const min = Math.min(0.5 * Math.min($('stage').clientWidth / st.w, $('stage').clientHeight / st.h), 0.05);
  const ns = Math.max(min, Math.min(v.s * factor, 40));
  const f = ns / v.s;
  st.view = { s: ns, tx: cx - (cx - v.tx) * f, ty: cy - (cy - v.ty) * f };
  zetView();
}

function naarPagina(clientX, clientY) {
  const r = $('stage').getBoundingClientRect();
  return { x: (clientX - r.left - st.view.tx) / st.view.s, y: (clientY - r.top - st.view.ty) / st.view.s };
}

// Scherp beeld van het zichtbare deel na het zoomen
let scherpTimer = null, scherpTaak = null;
function planScherp() { clearTimeout(scherpTimer); scherpTimer = setTimeout(renderScherp, 250); }
async function renderScherp() {
  const pag = st.paginaObj; if (!pag) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const s = st.view.s;
  const c = $('scherp');
  if (s * dpr <= st.basisSchaal * 1.15) { c.hidden = true; return; }
  const stage = $('stage');
  const sw = stage.clientWidth, sh = stage.clientHeight;
  // zichtbaar gebied in paginacoördinaten
  let x0 = Math.max(0, -st.view.tx / s), y0 = Math.max(0, -st.view.ty / s);
  let x1 = Math.min(st.w, (sw - st.view.tx) / s), y1 = Math.min(st.h, (sh - st.view.ty) / s);
  if (x1 <= x0 || y1 <= y0) { c.hidden = true; return; }
  const schaal = s * dpr;
  const pw = Math.ceil((x1 - x0) * schaal), ph = Math.ceil((y1 - y0) * schaal);
  if (scherpTaak) { try { scherpTaak.cancel(); } catch {} }
  const tmp = document.createElement('canvas'); tmp.width = pw; tmp.height = ph;
  const ctx = tmp.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, pw, ph);
  const vp = pag.getViewport({ scale: schaal, offsetX: -x0 * schaal, offsetY: -y0 * schaal });
  const viewBij = { ...st.view };
  scherpTaak = pag.render({ canvasContext: ctx, viewport: vp });
  try { await scherpTaak.promise; } catch { return; }
  scherpTaak = null;
  if (pag !== st.paginaObj || viewBij.s !== st.view.s) return;
  c.width = pw; c.height = ph;
  c.getContext('2d').drawImage(tmp, 0, 0);
  Object.assign(c.style, { left: x0 + 'px', top: y0 + 'px', width: (x1 - x0) + 'px', height: (y1 - y0) + 'px' });
  c.hidden = false;
}
window.addEventListener('resize', () => { if (st.paginaObj) planScherp(); });

// ---------- Laag met aantekeningen en punten ----------
function huidigeItems() { return st.project.items.filter(i => i.tekeningId === st.tekeningId && i.pagina === st.pagina); }
function huidigePunten() { return st.project.punten.filter(p => p.tekeningId === st.tekeningId && p.pagina === st.pagina); }

function tekenItem(it, ouder) {
  const g = el('g', { 'data-item': it.id }, ouder);
  if (st.geselecteerd === it.id) g.classList.add('geselecteerd');
  if (it.type === 'wolk') {
    el('path', { d: wolkPad(it.x1, it.y1, it.x2, it.y2, it.dikte * 4), fill: 'none', stroke: it.kleur, 'stroke-width': it.dikte, 'stroke-linejoin': 'round' }, g);
    // onzichtbaar vlak zodat de wolk makkelijk te kiezen is
    el('rect', { x: Math.min(it.x1, it.x2), y: Math.min(it.y1, it.y2), width: Math.abs(it.x2 - it.x1), height: Math.abs(it.y2 - it.y1), fill: 'transparent', stroke: 'transparent', 'stroke-width': it.dikte * 6, 'pointer-events': st.tool === 'kies' ? 'stroke' : 'none' }, g);
  } else if (it.type === 'pijl') {
    const p = pijlPaden(it.x1, it.y1, it.x2, it.y2, it.dikte);
    el('path', { d: p.lijn, stroke: it.kleur, 'stroke-width': it.dikte, 'stroke-linecap': 'round', fill: 'none' }, g);
    el('path', { d: p.punt, fill: it.kleur }, g);
    el('path', { d: `M${it.x1} ${it.y1} L${it.x2} ${it.y2}`, stroke: 'transparent', 'stroke-width': it.dikte * 8, fill: 'none', 'pointer-events': st.tool === 'kies' ? 'stroke' : 'none' }, g);
  } else if (it.type === 'tekst') {
    const t = el('text', { x: it.x, y: it.y, 'font-size': it.grootte, 'font-weight': 700, fill: it.kleur, 'font-family': 'Ubuntu, Arial, sans-serif', 'dominant-baseline': 'hanging', 'paint-order': 'stroke', stroke: 'rgba(255,255,255,0.9)', 'stroke-width': it.grootte / 5, 'pointer-events': st.tool === 'kies' ? 'all' : 'none' }, g);
    it.tekst.split('\n').forEach((r, i) => { const ts = el('tspan', { x: it.x, dy: i ? it.grootte * 1.2 : 0 }, t); ts.textContent = r; });
  }
  return g;
}

function tekenMarker(p, ouder) {
  const g = el('g', { 'data-punt': p.id }, ouder);
  el('circle', { r: 15, fill: STATUS_KLEUR[p.status] || STATUS_KLEUR.open, stroke: '#fff', 'stroke-width': 3 }, g);
  const t = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', fill: '#fff', 'font-size': p.nr > 99 ? 12 : 15, 'font-weight': 700, 'font-family': 'Ubuntu, Arial, sans-serif', 'pointer-events': 'none' }, g);
  t.textContent = p.nr;
  if (st.verplaatsPunt === p.id) g.setAttribute('opacity', '0.4');
  return g;
}

function tekenLaag() {
  const svg = $('laag'); svg.innerHTML = '';
  const items = el('g', { id: 'gItems' }, svg);
  for (const it of huidigeItems()) tekenItem(it, items);
  el('g', { id: 'gVoorbeeld' }, svg);
  const markers = el('g', { id: 'gPunten' }, svg);
  for (const p of huidigePunten()) tekenMarker(p, markers);
  schaalMarkers();
}

function schaalMarkers() {
  const k = Math.min(1 / st.view.s, Math.max(st.w, st.h) / 60 / 15);
  for (const g of document.querySelectorAll('#gPunten [data-punt]')) {
    const p = st.project.punten.find(x => x.id === g.dataset.punt); if (!p) continue;
    g.setAttribute('transform', `translate(${p.x} ${p.y}) scale(${k})`);
  }
}

// ---------- Gereedschap ----------
function kiesTool(t) {
  st.tool = t; st.geselecteerd = null;
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('actief', b.dataset.tool === t));
  const hints = { punt: 'Tik op de tekening om een punt te zetten', wolk: 'Sleep om een wolk te tekenen', pijl: 'Sleep van begin naar punt van de pijl', tekst: 'Tik waar de tekst moet komen', kies: 'Tik op een aantekening om hem te wissen' };
  hint(st.verplaatsPunt ? null : hints[t]);
  clearTimeout(kiesTool.t); kiesTool.t = setTimeout(() => hint(null), 2500);
  if (st.paginaObj) tekenLaag();
}
document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => kiesTool(b.dataset.tool));

for (const k of KLEUREN) {
  const b = document.createElement('button');
  b.className = 'kleur' + (k.waarde === st.kleur ? ' actief' : ''); b.style.background = k.waarde; b.title = k.naam;
  b.onclick = () => { st.kleur = k.waarde; document.querySelectorAll('.kleur').forEach(x => x.classList.toggle('actief', x === b)); };
  $('kleuren').appendChild(b);
}

$('btnOngedaan').onclick = async () => {
  const actie = st.ongedaan.pop();
  if (!actie) return melding('Er is niets om terug te zetten.');
  if (actie.type === 'nieuw') st.project.items = st.project.items.filter(i => i.id !== actie.id);
  else if (actie.type === 'weg') st.project.items.push(actie.item);
  await bewaar(); tekenLaag();
};

function nieuwItem(it) {
  it.id = nieuwId('it'); it.tekeningId = st.tekeningId; it.pagina = st.pagina;
  st.project.items.push(it);
  st.ongedaan.push({ type: 'nieuw', id: it.id });
  bewaar(); tekenLaag();
}

// ---------- Aanraken ----------
const aanraking = new Map();
let gebaar = null;

const stage = $('stage');
stage.addEventListener('pointerdown', e => {
  if (!st.paginaObj) return;
  stage.setPointerCapture(e.pointerId);
  aanraking.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (aanraking.size === 2) {
    // twee vingers: altijd zoomen en schuiven, lopende tekening afbreken
    if (gebaar?.voorbeeld) gebaar.voorbeeld.remove();
    const [a, b] = [...aanraking.values()];
    gebaar = { type: 'knijp', afstand: Math.hypot(a.x - b.x, a.y - b.y), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2 };
    return;
  }
  if (aanraking.size > 2) return;
  const doel = e.target.closest?.('[data-punt],[data-item]');
  const p = naarPagina(e.clientX, e.clientY);
  gebaar = { type: 'wacht', sx: e.clientX, sy: e.clientY, start: p, tijd: Date.now(), doel, tx: st.view.tx, ty: st.view.ty, muis: e.pointerType === 'mouse' };
});

stage.addEventListener('pointermove', e => {
  if (!aanraking.has(e.pointerId) || !gebaar) return;
  aanraking.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (gebaar.type === 'knijp' && aanraking.size >= 2) {
    const [a, b] = [...aanraking.values()];
    const afstand = Math.hypot(a.x - b.x, a.y - b.y);
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const r = stage.getBoundingClientRect();
    st.view.tx += mx - gebaar.mx; st.view.ty += my - gebaar.my;
    zoomRond(mx - r.left, my - r.top, afstand / gebaar.afstand);
    gebaar.afstand = afstand; gebaar.mx = mx; gebaar.my = my;
    return;
  }
  const dx = e.clientX - gebaar.sx, dy = e.clientY - gebaar.sy;
  const bewogen = Math.hypot(dx, dy) > 8;
  if (gebaar.type === 'wacht' && bewogen) {
    const tekenTool = (st.tool === 'wolk' || st.tool === 'pijl') && !st.verplaatsPunt;
    gebaar.type = tekenTool ? 'teken' : 'schuif';
    if (tekenTool) gebaar.voorbeeld = el('g', {}, $('gVoorbeeld'));
  }
  if (gebaar.type === 'schuif') {
    st.view.tx = gebaar.tx + dx; st.view.ty = gebaar.ty + dy; zetView();
  } else if (gebaar.type === 'teken') {
    const p = naarPagina(e.clientX, e.clientY);
    gebaar.eind = p;
    const dikte = 2.5 / st.view.s;
    gebaar.voorbeeld.innerHTML = '';
    tekenItem({ type: st.tool, x1: gebaar.start.x, y1: gebaar.start.y, x2: p.x, y2: p.y, kleur: st.kleur, dikte }, gebaar.voorbeeld);
  }
});

function loslaten(e) {
  if (!aanraking.has(e.pointerId)) return;
  aanraking.delete(e.pointerId);
  if (!gebaar) return;
  if (gebaar.type === 'knijp') {
    if (aanraking.size === 0) { gebaar = null; planScherp(); }
    else {
      // één vinger blijft liggen: verder als schuiven
      const [a] = [...aanraking.values()];
      gebaar = { type: 'schuif', sx: a.x, sy: a.y, tx: st.view.tx, ty: st.view.ty };
    }
    return;
  }
  const g = gebaar; gebaar = null;
  if (g.type === 'schuif') { planScherp(); return; }
  if (g.type === 'teken') {
    g.voorbeeld?.remove();
    if (!g.eind) return;
    const min = 12 / st.view.s;
    if (Math.hypot(g.eind.x - g.start.x, g.eind.y - g.start.y) < min) return;
    nieuwItem({ type: st.tool, x1: g.start.x, y1: g.start.y, x2: g.eind.x, y2: g.eind.y, kleur: st.kleur, dikte: 2.5 / st.view.s });
    return;
  }
  if (g.type === 'wacht' && e.type === 'pointerup') tik(g);
}
stage.addEventListener('pointerup', loslaten);
stage.addEventListener('pointercancel', loslaten);

stage.addEventListener('wheel', e => {
  if (!st.paginaObj) return;
  e.preventDefault();
  const r = stage.getBoundingClientRect();
  zoomRond(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0015));
  planScherp();
}, { passive: false });

async function tik(g) {
  const p = g.start;
  if (st.verplaatsPunt) {
    const pt = st.project.punten.find(x => x.id === st.verplaatsPunt);
    st.verplaatsPunt = null; hint(null);
    if (pt) { pt.x = p.x; pt.y = p.y; pt.tekeningId = st.tekeningId; pt.pagina = st.pagina; await bewaar(); tekenLaag(); vulPuntLijst(); melding(`Punt ${pt.nr} is verplaatst.`); }
    return;
  }
  const puntDoel = g.doel?.closest('[data-punt]');
  if (puntDoel) return openPunt(puntDoel.dataset.punt);
  if (st.tool === 'kies') {
    const itemDoel = g.doel?.closest('[data-item]');
    if (!itemDoel) { st.geselecteerd = null; tekenLaag(); return; }
    const id = itemDoel.dataset.item;
    st.geselecteerd = id; tekenLaag();
    if (await vraag('Deze aantekening wissen?', 'Wissen')) {
      const item = st.project.items.find(i => i.id === id);
      st.project.items = st.project.items.filter(i => i.id !== id);
      st.ongedaan.push({ type: 'weg', item });
      await bewaar();
    }
    st.geselecteerd = null; tekenLaag();
    return;
  }
  if (st.tool === 'punt') return nieuwPunt(p);
  if (st.tool === 'tekst') {
    const d = $('dlgTekst'); const f = d.querySelector('form'); f.tekst.value = '';
    d.returnValue = ''; d.showModal(); f.tekst.focus();
    d.addEventListener('close', () => {
      const tekst = f.tekst.value.trim();
      if (d.returnValue === 'ok' && tekst) nieuwItem({ type: 'tekst', x: p.x, y: p.y, tekst, kleur: st.kleur, grootte: 16 / st.view.s });
    }, { once: true });
  }
}

// ---------- Punten ----------
function volgendNr() { return st.project.punten.reduce((m, p) => Math.max(m, p.nr), 0) + 1; }

async function nieuwPunt(p) {
  const pt = { id: nieuwId('pt'), nr: volgendNr(), tekeningId: st.tekeningId, pagina: st.pagina, x: p.x, y: p.y,
    categorie: st.laatsteCategorie || 'Sprinkler', status: 'open', titel: '', tekst: '', fotos: [], aangemaakt: new Date().toISOString() };
  st.project.punten.push(pt);
  await bewaar(); tekenLaag(); vulPuntLijst(); kopTekst();
  openPunt(pt.id, true);
}

let actiefPunt = null;
function openPunt(id, nieuw = false) {
  const pt = st.project.punten.find(x => x.id === id); if (!pt) return;
  actiefPunt = pt;
  $('puntNr').textContent = pt.nr;
  $('puntNr').className = 'nr-bol' + (pt.status === 'opgelost' ? ' opgelost' : '');
  document.querySelectorAll('#dlgPunt [data-status]').forEach(b => b.classList.toggle('actief', b.dataset.status === pt.status));
  const cats = $('catKnoppen'); cats.innerHTML = '';
  for (const c of CATEGORIEEN) {
    const b = document.createElement('button'); b.textContent = c;
    b.classList.toggle('actief', c === pt.categorie);
    b.onclick = () => { pt.categorie = c; st.laatsteCategorie = c; cats.querySelectorAll('button').forEach(x => x.classList.toggle('actief', x === b)); };
    cats.appendChild(b);
  }
  $('puntTitel').value = pt.titel; $('puntTekst').value = pt.tekst;
  toonFotos();
  $('dlgPunt').showModal();
  if (!nieuw) $('btnPuntKlaar').focus();
}

document.querySelectorAll('#dlgPunt [data-status]').forEach(b => b.onclick = () => {
  actiefPunt.status = b.dataset.status;
  document.querySelectorAll('#dlgPunt [data-status]').forEach(x => x.classList.toggle('actief', x === b));
  $('puntNr').className = 'nr-bol' + (actiefPunt.status === 'opgelost' ? ' opgelost' : '');
});

async function toonFotos() {
  const rij = $('fotoRij'); rij.innerHTML = '';
  for (const f of actiefPunt.fotos) {
    const blob = await db.bestand(f.id); if (!blob) continue;
    const url = URL.createObjectURL(blob);
    const div = document.createElement('div'); div.className = 'foto';
    div.innerHTML = `<img src="${url}" alt=""><button class="weg" title="Foto verwijderen">&#10005;</button>`;
    div.querySelector('img').onclick = () => { $('fotoGroot').src = url; $('dlgFoto').showModal(); };
    div.querySelector('.weg').onclick = async () => {
      if (!await vraag('Deze foto verwijderen?', 'Verwijderen')) return;
      actiefPunt.fotos = actiefPunt.fotos.filter(x => x.id !== f.id);
      await db.verwijderBestand(f.id); await bewaar(); toonFotos();
    };
    rij.appendChild(div);
  }
}
$('btnFotoDicht').onclick = () => $('dlgFoto').close();

async function verkleinFoto(bestand) {
  const bmp = await createImageBitmap(bestand, { imageOrientation: 'from-image' });
  const max = 1800;
  const f = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * f), h = Math.round(bmp.height * f);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  c.getContext('2d').drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
  return { blob, w, h };
}

async function fotosToevoegen(bestanden) {
  if (!bestanden.length) return;
  bezig('Foto opslaan...');
  try {
    for (const b of bestanden) {
      const { blob, w, h } = await verkleinFoto(b);
      const id = nieuwId('foto');
      await db.bewaarBestand(id, blob);
      actiefPunt.fotos.push({ id, w, h, tijd: new Date().toISOString() });
    }
    await bewaar();
  } catch (err) { melding('Foto kon niet worden opgeslagen: ' + err.message, 6000); }
  klaar(); toonFotos();
}
$('btnCamera').onclick = () => $('invCamera').click();
$('btnGalerij').onclick = () => $('invGalerij').click();
$('invCamera').onchange = e => { const f = [...e.target.files]; e.target.value = ''; fotosToevoegen(f); };
$('invGalerij').onchange = e => { const f = [...e.target.files]; e.target.value = ''; fotosToevoegen(f); };

async function puntDicht() {
  if (!actiefPunt) return;
  actiefPunt.titel = $('puntTitel').value.trim();
  actiefPunt.tekst = $('puntTekst').value.trim();
  await bewaar(); tekenLaag(); vulPuntLijst(); kopTekst();
}
$('btnPuntKlaar').onclick = () => $('dlgPunt').close();
$('dlgPunt').addEventListener('close', puntDicht);
$('btnPuntWeg').onclick = async () => {
  const pt = actiefPunt;
  if (!await vraag(`Punt ${pt.nr} met ${pt.fotos.length} foto('s) verwijderen?`, 'Verwijderen')) return;
  for (const f of pt.fotos) await db.verwijderBestand(f.id);
  st.project.punten = st.project.punten.filter(x => x.id !== pt.id);
  actiefPunt = null;
  $('dlgPunt').close();
  await bewaar(); tekenLaag(); vulPuntLijst(); kopTekst();
};
$('btnPuntVerplaats').onclick = () => {
  st.verplaatsPunt = actiefPunt.id;
  $('dlgPunt').close();
  hint(`Tik op de nieuwe plek voor punt ${actiefPunt.nr}`);
};

// ---------- Puntenlijst ----------
$('btnPunten').onclick = () => { $('lijst').hidden = !$('lijst').hidden; setTimeout(() => st.paginaObj && planScherp(), 50); };
$('btnLijstDicht').onclick = () => { $('lijst').hidden = true; };
document.querySelectorAll('[data-filter]').forEach(b => b.onclick = () => {
  st.filter = b.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(x => x.classList.toggle('actief', x === b));
  vulPuntLijst();
});

function vulPuntLijst() {
  const ul = $('puntLijst'); ul.innerHTML = '';
  const lijst = st.project.punten.filter(p => st.filter === 'alle' || p.status === st.filter).sort((a, b) => a.nr - b.nr);
  if (!lijst.length) { ul.innerHTML = '<li class="leegmelding">Geen punten.</li>'; return; }
  for (const p of lijst) {
    const t = st.project.tekeningen.find(x => x.id === p.tekeningId);
    const li = document.createElement('li');
    li.innerHTML = `<span class="nr-bol ${p.status === 'opgelost' ? 'opgelost' : ''}">${p.nr}</span>
      <div class="pl-tekst"><b>${esc(p.titel || p.tekst.split('\n')[0] || '(nog geen omschrijving)')}</b>
      <span class="cat-tag">${esc(p.categorie)}</span><small>${t ? esc(tekeningLabel(t, p.pagina)) : ''} · ${p.fotos.length} foto('s)</small></div>`;
    li.onclick = async () => {
      if (p.tekeningId !== st.tekeningId || p.pagina !== st.pagina) await toonTekening(p.tekeningId, p.pagina);
      const r = stage.getBoundingClientRect();
      const s = Math.max(st.view.s, Math.min(r.width / st.w, r.height / st.h) * 4);
      st.view = { s, tx: r.width / 2 - p.x * s, ty: r.height / 2 - p.y * s };
      zetView(); planScherp();
      if (window.innerWidth <= 760) $('lijst').hidden = true;
      openPunt(p.id);
    };
    ul.appendChild(li);
  }
}

// ---------- Menu ----------
function menuDicht() { $('menu').hidden = true; }
$('btnMenu').onclick = e => { e.stopPropagation(); $('menu').hidden = !$('menu').hidden; };
document.addEventListener('pointerdown', e => { if (!$('menu').hidden && !e.target.closest('#menu,#btnMenu')) menuDicht(); });
$('btnTerug').onclick = () => { st.pdfCache.clear(); st.paginaObj = null; toonThuis(); };
$('mnGegevens').onclick = async () => {
  menuDicht();
  if (await projectFormulier(st.project, 'Projectgegevens')) { await bewaar(); kopTekst(); }
};

// Bestand naar buiten: op de laptop direct in een map, op de tablet via delen (OneDrive) of downloaden.
async function bestandNaarBuiten(blob, naam, type, omschrijving) {
  if (window.showSaveFilePicker) {
    try {
      const ext = naam.slice(naam.lastIndexOf('.'));
      const h = await showSaveFilePicker({ suggestedName: naam, types: [{ description: omschrijving, accept: { [type]: [ext] } }] });
      const w = await h.createWritable(); await w.write(blob); await w.close();
      melding(`Opgeslagen: ${naam}`);
      return;
    } catch (err) { if (err.name === 'AbortError') return; }
  }
  const bestand = new File([blob], naam, { type });
  if (navigator.canShare && navigator.canShare({ files: [bestand] })) {
    try { await navigator.share({ files: [bestand], title: naam }); return; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = naam;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  melding(`${naam} staat in Downloads. Zet het met de OneDrive-app in de projectmap.`, 7000);
}

$('mnOpslaan').onclick = async () => {
  menuDicht();
  bezig('Projectbestand maken...');
  try {
    const p = structuredClone(st.project);
    const delen = [];
    for (const t of p.tekeningen) {
      t.pad = `tekeningen/${veiligeNaam(t.naam)}-${t.id.slice(-6)}.pdf`;
      delen.push({ naam: t.pad, data: new Uint8Array(await (await db.bestand(t.bestandId)).arrayBuffer()) });
    }
    for (const pt of p.punten) pt.fotos.forEach((f, i) => { f.pad = `fotos/punt-${String(pt.nr).padStart(3, '0')}-${i + 1}-${f.id.slice(-6)}.jpg`; });
    for (const pt of p.punten) for (const f of pt.fotos) {
      const b = await db.bestand(f.id); if (b) delen.push({ naam: f.pad, data: new Uint8Array(await b.arrayBuffer()) });
    }
    delen.unshift({ naam: 'project.json', data: new TextEncoder().encode(JSON.stringify(p, null, 1)) });
    const zip = maakZip(delen);
    klaar();
    await bestandNaarBuiten(zip, `${p.nummer} SCHOUW ${veiligeNaam(p.naam)}.zip`, 'application/zip', 'SCHOUW-projectbestand');
  } catch (err) { klaar(); melding('Opslaan mislukt: ' + err.message, 6000); }
};
function veiligeNaam(t) { return String(t).replace(/[\\/:*?"<>|]/g, '-').trim(); }

$('mnRapport').onclick = async () => {
  menuDicht();
  if (!st.project.punten.length && !st.project.items.length) return melding('Er staan nog geen punten of aantekeningen in dit project.');
  bezig('Rapport maken...');
  try {
    const blob = await maakRapport(st.project, { pdfDoc, bestand: db.bestand, voortgang: t => { $('bezigTekst').textContent = t; } });
    klaar();
    await bestandNaarBuiten(blob, rapportNaam(st.project) + '.pdf', 'application/pdf', 'PDF-rapport');
  } catch (err) { klaar(); console.error(err); melding('Rapport maken mislukt: ' + err.message, 8000); }
};

// ---------- Start ----------
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
window.SCHOUW = { st, db, toonTekening }; // voor testen
toonThuis();
