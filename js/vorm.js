// Vormen als SVG-padtekst. Wordt gebruikt in de app (SVG) en in het rapport (Path2D).

export function wolkPad(x1, y1, x2, y2, boog) {
  const xa = Math.min(x1, x2), xb = Math.max(x1, x2);
  const ya = Math.min(y1, y2), yb = Math.max(y1, y2);
  const hoeken = [[xa, ya], [xb, ya], [xb, yb], [xa, yb], [xa, ya]];
  let d = `M${r(xa)} ${r(ya)}`;
  for (let i = 0; i < 4; i++) {
    const [sx, sy] = hoeken[i], [ex, ey] = hoeken[i + 1];
    const len = Math.hypot(ex - sx, ey - sy);
    const n = Math.max(1, Math.round(len / (boog * 2)));
    const straal = (len / n) * 0.6;
    for (let k = 1; k <= n; k++) {
      const px = sx + (ex - sx) * k / n, py = sy + (ey - sy) * k / n;
      d += ` A${r(straal)} ${r(straal)} 0 0 1 ${r(px)} ${r(py)}`;
    }
  }
  return d + ' Z';
}

export function pijlPaden(x1, y1, x2, y2, dikte) {
  const hoek = Math.atan2(y2 - y1, x2 - x1);
  const kop = dikte * 6;
  const bx = x2 - Math.cos(hoek) * kop * 0.8, by = y2 - Math.sin(hoek) * kop * 0.8;
  const a1 = hoek + Math.PI - 0.42, a2 = hoek + Math.PI + 0.42;
  const lijn = `M${r(x1)} ${r(y1)} L${r(bx)} ${r(by)}`;
  const punt = `M${r(x2)} ${r(y2)} L${r(x2 + Math.cos(a1) * kop)} ${r(y2 + Math.sin(a1) * kop)} L${r(x2 + Math.cos(a2) * kop)} ${r(y2 + Math.sin(a2) * kop)} Z`;
  return { lijn, punt };
}

function r(v) { return Math.round(v * 100) / 100; }

export const KLEUREN = [
  { naam: 'Rood', waarde: '#E30613' },
  { naam: 'Oranje', waarde: '#FF590D' },
  { naam: 'Blauw', waarde: '#00199D' },
  { naam: 'Groen', waarde: '#0A8A3A' },
];

export const STATUS_KLEUR = { open: '#FF590D', opgelost: '#00199D' };

export const CATEGORIEEN = [
  'Sprinkler', 'BMI/OAI', 'Compartimentering', 'Vluchtwegen', 'Noodverlichting',
  'RWA', 'Blusmiddelen', 'Watervoorziening', 'Bouwkundig', 'Overig',
];

// Teken alle aantekeningen en punten van één pagina op een canvas (voor het rapport).
// schaal: pixels per PDF-punt.
export function tekenOpCanvas(ctx, schaal, items, punten, paginaGrootte) {
  ctx.save();
  ctx.scale(schaal, schaal);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const it of items) {
    ctx.strokeStyle = it.kleur; ctx.fillStyle = it.kleur; ctx.lineWidth = it.dikte;
    if (it.type === 'wolk') {
      ctx.stroke(new Path2D(wolkPad(it.x1, it.y1, it.x2, it.y2, it.dikte * 4)));
    } else if (it.type === 'pijl') {
      const p = pijlPaden(it.x1, it.y1, it.x2, it.y2, it.dikte);
      ctx.stroke(new Path2D(p.lijn)); ctx.fill(new Path2D(p.punt));
    } else if (it.type === 'tekst') {
      ctx.font = `bold ${it.grootte}px Ubuntu, Arial, sans-serif`;
      ctx.textBaseline = 'top';
      const regels = it.tekst.split('\n');
      regels.forEach((t, i) => {
        ctx.lineWidth = it.grootte / 5; ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.strokeText(t, it.x, it.y + i * it.grootte * 1.2);
        ctx.fillText(t, it.x, it.y + i * it.grootte * 1.2);
      });
    }
  }
  const R = Math.max(paginaGrootte.w, paginaGrootte.h) / 85;
  for (const p of punten) {
    ctx.beginPath(); ctx.arc(p.x, p.y, R, 0, Math.PI * 2);
    ctx.fillStyle = STATUS_KLEUR[p.status] || STATUS_KLEUR.open; ctx.fill();
    ctx.lineWidth = R / 6; ctx.strokeStyle = '#fff'; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = `bold ${R * (p.nr > 99 ? 0.85 : 1.1)}px Ubuntu, Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(p.nr), p.x, p.y + R * 0.05);
    ctx.textAlign = 'left';
  }
  ctx.restore();
}
