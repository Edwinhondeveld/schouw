// Opslag op het apparaat (IndexedDB). Projecten en bestanden (tekeningen, foto's).
const DB_NAAM = 'schouw';
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAAM, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projecten')) db.createObjectStore('projecten', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('bestanden')) db.createObjectStore('bestanden', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Opslaan afgebroken'));
  });
}

export const db = {
  alleProjecten: () => tx('projecten', 'readonly', s => s.getAll()),
  project: id => tx('projecten', 'readonly', s => s.get(id)),
  bewaarProject: p => { p.gewijzigd = new Date().toISOString(); return tx('projecten', 'readwrite', s => s.put(p)); },
  verwijderProject: id => tx('projecten', 'readwrite', s => s.delete(id)),
  bestand: async id => { const r = await tx('bestanden', 'readonly', s => s.get(id)); return r ? r.blob : null; },
  bewaarBestand: (id, blob) => tx('bestanden', 'readwrite', s => s.put({ id, blob })),
  verwijderBestand: id => tx('bestanden', 'readwrite', s => s.delete(id)),
};

export function nieuwId(prefix = 'id') {
  return prefix + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}
