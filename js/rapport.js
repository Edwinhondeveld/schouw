// PDF-rapport in EFC-huisstijl: voorblad, overzicht, tekeningen met punten, punten met foto's.
import { tekenOpCanvas, CATEGORIEEN } from './vorm.js';

const BLAUW = [0, 25, 157], ORANJE = [255, 89, 13], ZWART = [0, 0, 0], GRIJS = [88, 88, 88], LICHT = [177, 177, 177], KOPGRIJS = [217, 217, 217];
const STATUS_RGB = { open: ORANJE, opgelost: BLAUW };

export function rapportNaam(p) {
  const r = p.rapport || {};
  const oms = p.locatie || p.naam;
  return `${p.nummer}-${r.code || 'SCH'}-${r.nr || '01'} Schouwrapport ${oms} ${r.versie || 'v1.0'}`.replace(/[\\/:*?"<>|]/g, '-');
}

async function laadBytes(url) { return new Uint8Array(await (await fetch(url)).arrayBuffer()); }
function naarBase64(bytes) {
  let s = ''; const stap = 0x8000;
  for (let i = 0; i < bytes.length; i += stap) s += String.fromCharCode.apply(null, bytes.subarray(i, i + stap));
  return btoa(s);
}
function datumNL(iso) {
  if (!iso) return '';
  const d = new Date(iso.length === 10 ? iso + 'T12:00:00' : iso);
  return d.toLocaleDateString('nl-NL', { day: 'numeric', month: 'long', year: 'numeric' });
}
function tijdNL(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString('nl-NL', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ' ' + d.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' });
}
const wacht = () => new Promise(r => setTimeout(r, 0));

export async function maakRapport(project, { pdfDoc, bestand, voortgang }) {
  const { jsPDF } = window.jspdf;
  const basis = new URL('../', import.meta.url).href;
  voortgang('Huisstijl laden...');
  const [fReg, fBold, fIt, voorblad, vervolg, logo] = await Promise.all([
    laadBytes(basis + 'fonts/Ubuntu-Regular.ttf'), laadBytes(basis + 'fonts/Ubuntu-Bold.ttf'), laadBytes(basis + 'fonts/Ubuntu-Italic.ttf'),
    laadBytes(basis + 'assets/voorblad.jpg'), laadBytes(basis + 'assets/vervolgblad.jpg'), laadBytes(basis + 'assets/logo.png'),
  ]);
  try { await document.fonts.load('bold 20px Ubuntu'); } catch {}

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait', compress: true });
  doc.addFileToVFS('Ubuntu-Regular.ttf', naarBase64(fReg)); doc.addFont('Ubuntu-Regular.ttf', 'Ubuntu', 'normal');
  doc.addFileToVFS('Ubuntu-Bold.ttf', naarBase64(fBold)); doc.addFont('Ubuntu-Bold.ttf', 'Ubuntu', 'bold');
  doc.addFileToVFS('Ubuntu-Italic.ttf', naarBase64(fIt)); doc.addFont('Ubuntu-Italic.ttf', 'Ubuntu', 'italic');
  const naam = rapportNaam(project);
  doc.setProperties({ title: naam, subject: 'Schouwrapport', author: 'Edwize Fire Control', creator: 'Edwize Fire Control', keywords: `${project.nummer} schouw` });

  const r = project.rapport || {};
  const punten = [...project.punten].sort((a, b) => a.nr - b.nr);
  const tekNaam = (id, pag) => { const t = project.tekeningen.find(x => x.id === id); return t ? (t.paginas > 1 ? `${t.naam} (blad ${pag})` : t.naam) : ''; };

  // ---------- pagina-opmaak ----------
  let y = 0;
  const M = { l: 25, r: 20, t: 32, b: 22 };
  const pw = () => doc.internal.pageSize.getWidth();
  const ph = () => doc.internal.pageSize.getHeight();
  const breedte = () => pw() - M.l - M.r;
  function staand() {
    doc.addPage('a4', 'portrait');
    doc.addImage(vervolg, 'JPEG', 0, 0, 210, 297, 'vervolgblad', 'FAST');
    y = M.t;
  }
  function liggend() {
    doc.addPage('a4', 'landscape');
    doc.addImage(logo, 'PNG', 297 - 15 - 48, 9, 48, 48 * 57 / 390, 'logo', 'FAST');
    y = 16;
  }
  function kleur(c) { doc.setTextColor(c[0], c[1], c[2]); }
  function lettertype(stijl, grootte, c = ZWART) { doc.setFont('Ubuntu', stijl); doc.setFontSize(grootte); kleur(c); }
  const regel = pt => pt * 0.3528 * 1.25; // regelhoogte in mm
  function ruimte(mm) { if (y + mm > ph() - M.b) { staand(); return true; } return false; }
  function alinea(tekst, { stijl = 'normal', grootte = 11, c = ZWART, x = M.l, w = breedte(), na = 3 } = {}) {
    lettertype(stijl, grootte, c);
    const regels = doc.splitTextToSize(tekst, w);
    for (const rg of regels) { ruimte(regel(grootte)); doc.text(rg, x, y, { baseline: 'top' }); y += regel(grootte); }
    y += na;
  }
  function kop1(nr, tekst) { lettertype('bold', 18, BLAUW); doc.text(`${nr}   ${tekst}`, M.l - 10, y, { baseline: 'top' }); y += 12; }
  function kop2(tekst, x = M.l) { lettertype('bold', 14, BLAUW); doc.text(tekst, x, y, { baseline: 'top' }); y += 8; }

  function tabel(kolommen, rijen) {
    const pad = 1.8, gr = 9.5, lh = regel(gr);
    doc.setLineWidth(0.3); doc.setDrawColor(...ORANJE);
    const kopRij = () => {
      lettertype('bold', gr, BLAUW);
      const hoogte = lh + pad * 2;
      let x = M.l;
      for (const k of kolommen) {
        doc.setFillColor(...KOPGRIJS); doc.rect(x, y, k.b, hoogte, 'FD');
        doc.text(k.t, x + pad, y + pad, { baseline: 'top' }); x += k.b;
      }
      y += hoogte;
    };
    ruimte(lh * 3 + pad * 4); kopRij();
    for (const rij of rijen) {
      lettertype('normal', gr);
      const cellen = rij.map((v, i) => doc.splitTextToSize(String(v.tekst ?? v), kolommen[i].b - pad * 2));
      const hoogte = Math.max(...cellen.map(c => c.length)) * lh + pad * 2;
      if (y + hoogte > ph() - M.b) { staand(); kopRij(); }
      let x = M.l;
      rij.forEach((v, i) => {
        doc.setDrawColor(...ORANJE); doc.rect(x, y, kolommen[i].b, hoogte, 'S');
        if (v.kleur) { lettertype('bold', gr, v.kleur); } else lettertype('normal', gr);
        doc.text(cellen[i], x + pad, y + pad, { baseline: 'top', lineHeightFactor: 1.25 });
        x += kolommen[i].b;
      });
      y += hoogte;
    }
    y += 5;
  }

  function statusLabel(x, yy, status) {
    const tekst = status === 'opgelost' ? 'OPGELOST' : 'OPEN';
    lettertype('bold', 9, [255, 255, 255]);
    const w = doc.getTextWidth(tekst) + 6;
    doc.setFillColor(...STATUS_RGB[status]); doc.roundedRect(x - w, yy, w, 6, 1.5, 1.5, 'F');
    doc.text(tekst, x - w / 2, yy + 3.1, { align: 'center', baseline: 'middle' });
  }

  // ---------- voorblad ----------
  voortgang('Voorblad...');
  doc.addImage(voorblad, 'JPEG', 0, 0, 210, 297, 'voorblad', 'FAST');
  y = 62;
  lettertype('bold', 28, BLAUW); doc.text('SCHOUWRAPPORT', 20, y, { baseline: 'top' }); y += 14;
  lettertype('bold', 17); doc.text(doc.splitTextToSize(project.naam, 170), 20, y, { baseline: 'top' }); y += 9;
  if (project.locatie) { lettertype('normal', 13, GRIJS); doc.text(project.locatie, 20, y, { baseline: 'top' }); y += 8; }
  y += 10;
  const velden = [
    ['Projectnummer', project.nummer],
    ['Opdrachtgever', project.opdrachtgever],
    ['Datum bezoek', datumNL(project.datum)],
    ['Opgesteld door', project.opsteller],
    ['Document', naam],
    ['Status', r.status || 'CONCEPT'],
  ].filter(v => v[1]);
  for (const [k, v] of velden) {
    lettertype('bold', 11, BLAUW); doc.text(k, 20, y, { baseline: 'top' });
    lettertype('normal', 11); const rg = doc.splitTextToSize(String(v), 120); doc.text(rg, 62, y, { baseline: 'top' });
    y += Math.max(1, rg.length) * regel(11) + 2.2;
  }

  // ---------- 1 overzicht ----------
  staand();
  kop1(1, 'Overzicht');
  const open = punten.filter(p => p.status === 'open').length;
  alinea(`Op ${datumNL(project.datum) || 'de datum van het bezoek'} is een locatiebezoek gebracht${project.locatie ? ' aan ' + project.locatie : ''}. Tijdens de schouw zijn ${punten.length} punten vastgelegd, waarvan ${open} open en ${punten.length - open} opgelost. De punten staan op de tekeningen in hoofdstuk 2 en worden met foto's toegelicht in hoofdstuk 3.`, { na: 6 });
  if (punten.length) {
    kop2('Punten per categorie');
    const cats = [...CATEGORIEEN, ...new Set(punten.map(p => p.categorie).filter(c => !CATEGORIEEN.includes(c)))];
    const rijen = cats.map(c => { const l = punten.filter(p => p.categorie === c); return l.length ? [c, String(l.filter(p => p.status === 'open').length), String(l.filter(p => p.status === 'opgelost').length), String(l.length)] : null; }).filter(Boolean);
    rijen.push([{ tekst: 'Totaal', kleur: BLAUW }, { tekst: String(open), kleur: BLAUW }, { tekst: String(punten.length - open), kleur: BLAUW }, { tekst: String(punten.length), kleur: BLAUW }]);
    tabel([{ t: 'Categorie', b: 75 }, { t: 'Open', b: 30 }, { t: 'Opgelost', b: 30 }, { t: 'Totaal', b: 30 }], rijen);
    kop2('Alle punten');
    tabel(
      [{ t: 'Nr', b: 11 }, { t: 'Categorie', b: 30 }, { t: 'Omschrijving', b: 70 }, { t: 'Tekening', b: 34 }, { t: 'Status', b: 20 }],
      punten.map(p => [String(p.nr), p.categorie, p.titel || p.tekst || '-', tekNaam(p.tekeningId, p.pagina),
        { tekst: p.status === 'opgelost' ? 'Opgelost' : 'Open', kleur: STATUS_RGB[p.status] }]),
    );
  }

  // ---------- 2 tekeningen ----------
  const uitsneden = new Map();
  const bladen = [];
  for (const t of project.tekeningen) for (let pg = 1; pg <= t.paginas; pg++) {
    const pts = punten.filter(p => p.tekeningId === t.id && p.pagina === pg);
    const its = project.items.filter(i => i.tekeningId === t.id && i.pagina === pg);
    if (pts.length || its.length) bladen.push({ t, pg, pts, its });
  }
  let sub = 0;
  for (const b of bladen) {
    voortgang(`Tekening ${++sub} van ${bladen.length}...`);
    await wacht();
    const pdf = await pdfDoc(b.t.bestandId);
    const pag = await pdf.getPage(b.pg);
    const vp1 = pag.getViewport({ scale: 1 });
    let schaal = 3600 / Math.max(vp1.width, vp1.height);
    if (vp1.width * vp1.height * schaal * schaal > 12e6) schaal = Math.sqrt(12e6 / (vp1.width * vp1.height));
    const c = document.createElement('canvas');
    c.width = Math.round(vp1.width * schaal); c.height = Math.round(vp1.height * schaal);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await pag.render({ canvasContext: ctx, viewport: pag.getViewport({ scale: schaal }) }).promise;
    tekenOpCanvas(ctx, schaal, b.its, b.pts, { w: vp1.width, h: vp1.height });

    liggend();
    if (sub === 1) { lettertype('bold', 18, BLAUW); doc.text('2   Tekeningen', 15, y, { baseline: 'top' }); y += 10; }
    lettertype('bold', 13, BLAUW); doc.text(`2.${sub}   ${tekNaam(b.t.id, b.pg)}`, 15, y, { baseline: 'top' }); y += 8;
    const vak = { x: 15, y, w: 267, h: 210 - y - 24 };
    const f = Math.min(vak.w / c.width, vak.h / c.height);
    const iw = c.width * f, ih = c.height * f;
    const ix = vak.x + (vak.w - iw) / 2;
    doc.addImage(c.toDataURL('image/jpeg', 0.82), 'JPEG', ix, vak.y, iw, ih, undefined, 'FAST');
    doc.setDrawColor(...LICHT); doc.setLineWidth(0.2); doc.rect(ix, vak.y, iw, ih, 'S');
    // legenda
    const ly = vak.y + ih + 4;
    lettertype('normal', 9, GRIJS);
    doc.setFillColor(...ORANJE); doc.circle(ix + 2, ly + 1.6, 1.6, 'F'); doc.text('Open punt', ix + 5, ly, { baseline: 'top' });
    doc.setFillColor(...BLAUW); doc.circle(ix + 30, ly + 1.6, 1.6, 'F'); doc.text('Opgelost punt', ix + 33, ly, { baseline: 'top' });
    doc.text(`${b.pts.length} punt(en) op deze tekening`, ix + iw, ly, { baseline: 'top', align: 'right' });

    // uitsnede rond elk punt voor hoofdstuk 3
    for (const p of b.pts) {
      const cw = Math.max(vp1.width, vp1.height) * 0.16, chh = cw * 0.75;
      const x0 = Math.min(Math.max(0, p.x - cw / 2), Math.max(0, vp1.width - cw));
      const y0 = Math.min(Math.max(0, p.y - chh / 2), Math.max(0, vp1.height - chh));
      const u = document.createElement('canvas'); u.width = 1000; u.height = 750;
      const uc = u.getContext('2d'); uc.fillStyle = '#fff'; uc.fillRect(0, 0, 1000, 750);
      uc.drawImage(c, x0 * schaal, y0 * schaal, cw * schaal, chh * schaal, 0, 0, 1000, 750);
      uitsneden.set(p.id, u.toDataURL('image/jpeg', 0.85));
    }
    c.width = c.height = 1; // geheugen vrijgeven
  }

  // ---------- 3 punten ----------
  if (punten.length) {
    staand();
    kop1(3, 'Punten');
    const kol = (breedte() - 5) / 2;
    for (const p of punten) {
      voortgang(`Punt ${p.nr} van ${punten.length}...`);
      await wacht();
      if (y > M.t + 20) ruimte(70);
      // kop van het punt
      doc.setFillColor(...STATUS_RGB[p.status]); doc.circle(M.l + 3.5, y + 3.2, 3.5, 'F');
      lettertype('bold', 10, [255, 255, 255]); doc.text(String(p.nr), M.l + 3.5, y + 3.3, { align: 'center', baseline: 'middle' });
      lettertype('bold', 14, BLAUW); doc.text(`Punt ${p.nr}   ${p.categorie}`, M.l + 10, y, { baseline: 'top' });
      statusLabel(pw() - M.r, y, p.status);
      y += 8;
      alinea(`Tekening: ${tekNaam(p.tekeningId, p.pagina)}   ·   vastgelegd ${tijdNL(p.aangemaakt)}`, { grootte: 9, c: GRIJS, na: 2 });
      if (p.titel) alinea(p.titel, { stijl: 'bold', na: 1.5 });
      if (p.tekst) alinea(p.tekst, { na: 3 });
      if (!p.titel && !p.tekst) alinea('Geen omschrijving.', { stijl: 'italic', c: GRIJS });

      // afbeeldingen in twee kolommen: uitsnede tekening, daarna foto's
      const beelden = [];
      if (uitsneden.has(p.id)) beelden.push({ data: uitsneden.get(p.id), w: 1000, h: 750, bijschrift: 'Locatie op tekening' });
      for (const [i, f] of p.fotos.entries()) {
        const blob = await bestand(f.id); if (!blob) continue;
        beelden.push({ data: new Uint8Array(await blob.arrayBuffer()), w: f.w, h: f.h, bijschrift: `Foto ${p.nr}.${i + 1}`, alias: f.id });
      }
      for (let i = 0; i < beelden.length; i += 2) {
        const paar = beelden.slice(i, i + 2).map(bd => {
          let w = kol, h = kol * bd.h / bd.w;
          if (h > 85) { h = 85; w = h * bd.w / bd.h; }
          return { ...bd, dw: w, dh: h };
        });
        const rijH = Math.max(...paar.map(x => x.dh)) + 7;
        ruimte(rijH);
        paar.forEach((bd, k) => {
          const x = M.l + k * (kol + 5) + (kol - bd.dw) / 2;
          doc.addImage(bd.data, 'JPEG', x, y, bd.dw, bd.dh, bd.alias, 'FAST');
          doc.setDrawColor(...LICHT); doc.setLineWidth(0.2); doc.rect(x, y, bd.dw, bd.dh, 'S');
          lettertype('italic', 8.5, GRIJS); doc.text(bd.bijschrift, x, y + bd.dh + 1.5, { baseline: 'top' });
        });
        y += rijH + 2;
      }
      // scheidingslijn
      y += 2; doc.setDrawColor(...KOPGRIJS); doc.setLineWidth(0.3); doc.line(M.l, y, pw() - M.r, y); y += 7;
    }
  }

  // ---------- voetregels ----------
  const n = doc.getNumberOfPages();
  for (let i = 2; i <= n; i++) {
    doc.setPage(i);
    const w = doc.internal.pageSize.getWidth(), h = doc.internal.pageSize.getHeight();
    const links = w > h ? 15 : M.l;
    lettertype('normal', 8, LICHT);
    doc.text(`${naam}     Pagina ${i} van ${n}`, links, h - 9);
  }
  voortgang('Rapport opslaan...');
  return doc.output('blob');
}
