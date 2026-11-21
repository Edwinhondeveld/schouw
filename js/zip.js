// Eenvoudige ZIP (zonder compressie), zodat het projectbestand op elke pc te openen is.
const crcTabel = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = crcTabel[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function dosTijd(d) {
  const tijd = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const datum = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { tijd, datum };
}

// bestanden: [{ naam, data: Uint8Array }]
export function maakZip(bestanden) {
  const enc = new TextEncoder();
  const delen = [];
  const centraal = [];
  let offset = 0;
  const { tijd, datum } = dosTijd(new Date());
  for (const b of bestanden) {
    const naam = enc.encode(b.naam);
    const crc = crc32(b.data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, tijd, true); lh.setUint16(12, datum, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, b.data.length, true); lh.setUint32(22, b.data.length, true);
    lh.setUint16(26, naam.length, true); lh.setUint16(28, 0, true);
    delen.push(new Uint8Array(lh.buffer), naam, b.data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, tijd, true); ch.setUint16(14, datum, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, b.data.length, true); ch.setUint32(24, b.data.length, true);
    ch.setUint16(28, naam.length, true); ch.setUint32(42, offset, true);
    centraal.push(new Uint8Array(ch.buffer), naam);
    offset += 30 + naam.length + b.data.length;
  }
  const cdGrootte = centraal.reduce((a, x) => a + x.length, 0);
  const eind = new DataView(new ArrayBuffer(22));
  eind.setUint32(0, 0x06054b50, true);
  eind.setUint16(8, bestanden.length, true); eind.setUint16(10, bestanden.length, true);
  eind.setUint32(12, cdGrootte, true); eind.setUint32(16, offset, true);
  return new Blob([...delen, ...centraal, new Uint8Array(eind.buffer)], { type: 'application/zip' });
}

// Leest een ZIP die door SCHOUW is gemaakt (zonder compressie).
export async function leesZip(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const dv = new DataView(buf.buffer);
  let e = buf.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Dit is geen SCHOUW-projectbestand.');
  const aantal = dv.getUint16(e + 10, true);
  let p = dv.getUint32(e + 16, true);
  const dec = new TextDecoder();
  const uit = {};
  for (let i = 0; i < aantal; i++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('Projectbestand is beschadigd.');
    const methode = dv.getUint16(p + 10, true);
    const grootte = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const naam = dec.decode(buf.subarray(p + 46, p + 46 + nl));
    if (methode !== 0) throw new Error('Projectbestand is ingepakt met een ander programma. Open het originele bestand van SCHOUW.');
    const lnl = dv.getUint16(lho + 26, true), lxl = dv.getUint16(lho + 28, true);
    const start = lho + 30 + lnl + lxl;
    uit[naam] = buf.slice(start, start + grootte);
    p += 46 + nl + xl + cl;
  }
  return uit;
}
