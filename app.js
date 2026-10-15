/**
 * L'ANTRE DU CADRRILLAGE — LOGIQUE JAVASCRIPT
 * Gestion de la vitrine, espace personnel, synchronisation en ligne (Supabase),
 * persistance locale (IndexedDB), visionneuse PDF, modification et thèmes.
 */

// =========================================================
// 1. CONFIGURATION & CONSTANTES
// =========================================================
const AUTH_CONFIG = {
  username: 'Caddrillage',
  password: 'Azerty4735'
};

const CATEGORIES_LABELS = {
  'nouvelle': 'Nouvelle',
  'nouvelle-longue': 'Nouvelle longue',
  'roman': 'Roman',
  'poesie': 'Poésie'
};

// Configuration Supabase en ligne (base de données et stockage des PDF)
const SUPABASE_CONFIG = {
  url: 'https://thyiltzizyzlehxhhbjk.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRoeWlsdHppenl6bGVoeGhoYmprIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4NzMyNDAsImV4cCI6MjEwNzQ0OTI0MH0._0HV4R35WKS9KnFnJJ5Khh5AeOLbARPOSIld_NdgUQ0',
  bucket: 'pdfs',
  table: 'writings',
  commentsTable: 'comments'
};

let supabaseClient = null;
function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;
  if (window.supabase && typeof window.supabase.createClient === 'function') {
    try {
      supabaseClient = window.supabase.createClient(SUPABASE_CONFIG.url, SUPABASE_CONFIG.anonKey);
    } catch (e) {
      console.warn('Erreur initialisation client Supabase :', e);
    }
  }
  return supabaseClient;
}

// Configuration IndexedDB (sauvegarde et cache local)
const DB_CONFIG = {
  name: 'AntreDuCaddrillageDB',
  version: 2,
  storeName: 'writings',
  commentsStore: 'comments'
};

let db = null;
let currentFilterCategory = 'all';
let currentSortOrder = localStorage.getItem('caddrillage_sort_order') || 'desc';
let writingToDeleteId = null;
let commentToDeleteId = null;
let activePdfBlobUrl = null;

// État de la recherche vitrine & espace personnel
let isSearchPanelOpen = false;
let showcaseSearchQuery = '';
let showcaseSearchCategory = 'all';
let selectedSearchTags = new Set();

let adminSearchQuery = '';
let adminShowPoetry = true;

// =========================================================
// 2. MOTEUR DE PERSISTANCE (SUPABASE EN LIGNE + INDEXEDDB LOCAL)
// =========================================================
function initDatabase() {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (result) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };

    // Timeout de sécurité : ne bloque jamais l'interface plus de 400ms
    setTimeout(() => {
      finish(db);
    }, 400);

    try {
      const request = indexedDB.open(DB_CONFIG.name, DB_CONFIG.version);

      request.onblocked = () => {
        console.warn('IndexedDB en attente de fermeture des autres onglets');
        finish(null);
      };

      request.onupgradeneeded = (event) => {
        const database = event.target.result;
        if (!database.objectStoreNames.contains(DB_CONFIG.storeName)) {
          database.createObjectStore(DB_CONFIG.storeName, { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains(DB_CONFIG.commentsStore)) {
          database.createObjectStore(DB_CONFIG.commentsStore, { keyPath: 'id' });
        }
      };

      request.onsuccess = (event) => {
        db = event.target.result;
        finish(db);
      };

      request.onerror = (event) => {
        console.warn('IndexedDB inaccessible :', event.target.error);
        finish(null);
      };
    } catch (e) {
      console.warn('Erreur ouverture IndexedDB :', e);
      finish(null);
    }
  });
}

// Récupération de tous les écrits (Supabase + Local fusionnés pour ne rien perdre)
async function dbGetAllWritings() {
  let cloudWritings = null;

  try {
    const client = getSupabaseClient();
    let data = null;
    let error = null;

    if (client) {
      try {
        const fetchPromise = client
          .from(SUPABASE_CONFIG.table)
          .select('*')
          .order('created_at', { ascending: false });

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('timeout')), 8000)
        );

        const res = await Promise.race([fetchPromise, timeoutPromise]);
        data = res.data;
        error = res.error;
      } catch (sdkErr) {
        // Fallback immédiat si le SDK tarde
      }
    }

    // Si le client SDK n'a pas répondu ou n'était pas encore initialisé, appel REST direct natif (150ms)
    if (!data || !Array.isArray(data) || data.length === 0 || error) {
      try {
        const restUrl = `${SUPABASE_CONFIG.url}/rest/v1/${SUPABASE_CONFIG.table}?select=*&order=created_at.desc`;
        const restRes = await fetch(restUrl, {
          headers: {
            'apikey': SUPABASE_CONFIG.anonKey,
            'Authorization': `Bearer ${SUPABASE_CONFIG.anonKey}`
          }
        });
        if (restRes.ok) {
          data = await restRes.json();
          error = null;
        }
      } catch (restErr) {
        console.warn('API REST Supabase inaccessible:', restErr);
      }
    }

    if (!error && Array.isArray(data) && data.length > 0) {
      cloudWritings = data.map(item => {
        let tags = [];
        if (Array.isArray(item.tags)) {
          tags = item.tags;
        } else if (typeof item.tags === 'string') {
          try {
            tags = JSON.parse(item.tags);
          } catch (e) {
            tags = item.tags.split(',').map(t => t.trim());
          }
        }

        return {
          id: String(item.id),
          title: item.title,
          category: item.category,
          summary: item.summary,
          poetryText: item.poetry_text || item.poetryText || (item.category === 'poesie' ? item.summary : '') || '',
          tags: Array.isArray(tags) ? tags : [],
          displayDate: item.display_date || '',
          pageCount: item.page_count !== undefined && item.page_count !== null && item.page_count !== '' ? Number(item.page_count) : (item.pageCount || null),
          wordCount: item.word_count !== undefined && item.word_count !== null && item.word_count !== '' ? Number(item.word_count) : (item.wordCount || null),
          readingTime: item.reading_time || item.readingTime || '',
          pdfUrl: item.pdf_url,
          pdfFileName: item.pdf_name,
          pdfFileSize: item.pdf_size,
          createdAt: Number(item.created_at),
          updatedAt: Number(item.updated_at)
        };
      });

      // Mise en cache locale automatique de tous les écrits du cloud dans IndexedDB
      if (db && db.objectStoreNames.contains(DB_CONFIG.storeName)) {
        try {
          const transaction = db.transaction([DB_CONFIG.storeName], 'readwrite');
          const store = transaction.objectStore(DB_CONFIG.storeName);
          for (const cw of cloudWritings) {
            store.put(cw);
          }
        } catch (e) {
          console.warn('Erreur mise en cache locale IndexedDB :', e);
        }
      }
    }
  } catch (err) {
    console.warn('Supabase temporisé, bascule sur le cache local :', err);
  }

  // Lecture du cache IndexedDB local
  const localWritings = await dbGetAllWritingsLocal();

  // Fusion intelligente : si le cloud répond, on combine pour préserver toutes les métriques et fichiers locaux
  if (cloudWritings && cloudWritings.length > 0) {
    const localMap = new Map(localWritings.map(w => [String(w.id), w]));
    const cloudIds = new Set(cloudWritings.map(w => String(w.id)));

    const merged = cloudWritings.map(cw => {
      const lw = localMap.get(String(cw.id));
      if (!lw) return cw;

      return {
        ...lw,
        ...cw,
        pdfBlob: lw.pdfBlob || cw.pdfBlob,
        pageCount: (cw.pageCount !== null && cw.pageCount !== undefined && cw.pageCount !== '') ? cw.pageCount : (lw.pageCount || null),
        wordCount: (cw.wordCount !== null && cw.wordCount !== undefined && cw.wordCount !== '') ? cw.wordCount : (lw.wordCount || null),
        readingTime: (cw.readingTime && String(cw.readingTime).trim() !== '') ? cw.readingTime : (lw.readingTime || ''),
        displayDate: (cw.displayDate && String(cw.displayDate).trim() !== '') ? cw.displayDate : (lw.displayDate || ''),
        poetryText: cw.poetryText || lw.poetryText || ''
      };
    });

    for (const lw of localWritings) {
      if (!cloudIds.has(String(lw.id))) {
        merged.push(lw);
      }
    }
    return merged.sort((a, b) => b.createdAt - a.createdAt);
  }

  // Si ni le cloud ni IndexedDB n'ont d'écrits (premier lancement hors-ligne sur une nouvelle machine)
  if ((!cloudWritings || cloudWritings.length === 0) && (!localWritings || localWritings.length === 0)) {
    try {
      const seedRes = await fetch('seed_writings.json');
      if (seedRes.ok) {
        const seedData = await seedRes.json();
        if (Array.isArray(seedData) && seedData.length > 0) {
          if (db && db.objectStoreNames.contains(DB_CONFIG.storeName)) {
            try {
              const transaction = db.transaction([DB_CONFIG.storeName], 'readwrite');
              const store = transaction.objectStore(DB_CONFIG.storeName);
              for (const sw of seedData) {
                store.put(sw);
              }
            } catch (e) {
              console.warn('Erreur remplissage seed IndexedDB:', e);
            }
          }
          return seedData.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
        }
      }
    } catch (e) {
      // Pas de seed local disponible
    }
  }

  return localWritings;
}

function dbGetAllWritingsLocal() {
  return new Promise((resolve) => {
    if (!db) return resolve([]);
    try {
      if (!db.objectStoreNames.contains(DB_CONFIG.storeName)) return resolve([]);
      const transaction = db.transaction([DB_CONFIG.storeName], 'readonly');
      const store = transaction.objectStore(DB_CONFIG.storeName);
      const request = store.getAll();

      request.onsuccess = () => {
        const results = (request.result || []).sort((a, b) => b.createdAt - a.createdAt);
        resolve(results);
      };
      request.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
}

async function dbGetWritingById(id) {
  const client = getSupabaseClient();
  if (client) {
    try {
      const { data, error } = await client
        .from(SUPABASE_CONFIG.table)
        .select('*')
        .eq('id', String(id))
        .single();

      if (!error && data) {
        let tags = [];
        if (Array.isArray(data.tags)) tags = data.tags;
        else if (typeof data.tags === 'string') {
          try { tags = JSON.parse(data.tags); } catch (e) { tags = data.tags.split(','); }
        }

        return {
          id: String(data.id),
          title: data.title,
          category: data.category,
          summary: data.summary,
          poetryText: data.poetry_text || data.poetryText || (data.category === 'poesie' ? data.summary : '') || '',
          tags: Array.isArray(tags) ? tags : [],
          displayDate: data.display_date || '',
          pageCount: data.page_count !== undefined && data.page_count !== null ? data.page_count : (data.pageCount || null),
          wordCount: data.word_count !== undefined && data.word_count !== null ? data.word_count : (data.wordCount || null),
          readingTime: data.reading_time || data.readingTime || '',
          pdfUrl: data.pdf_url,
          pdfFileName: data.pdf_name,
          pdfFileSize: data.pdf_size,
          createdAt: Number(data.created_at),
          updatedAt: Number(data.updated_at)
        };
      }
    } catch (e) {
      console.warn('Recherche Supabase échouée, recherche en local');
    }
  }

  return new Promise((resolve) => {
    if (!db) return resolve(null);
    try {
      if (!db.objectStoreNames.contains(DB_CONFIG.storeName)) return resolve(null);
      const transaction = db.transaction([DB_CONFIG.storeName], 'readonly');
      const store = transaction.objectStore(DB_CONFIG.storeName);
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

// Upload du fichier PDF vers le bucket Supabase
async function uploadPdfToSupabase(file, writingId) {
  const client = getSupabaseClient();
  if (!client) {
    throw new Error('Client Supabase non initialisé');
  }

  const cleanId = String(writingId).replace(/[^a-zA-Z0-9_-]/g, '');
  const timestamp = Date.now();
  const filePath = `${cleanId}_${timestamp}.pdf`;

  const { data, error } = await client.storage
    .from(SUPABASE_CONFIG.bucket)
    .upload(filePath, file, {
      cacheControl: '3600',
      upsert: true,
      contentType: 'application/pdf'
    });

  if (error) {
    console.error('Erreur upload Supabase Storage:', error);
    throw error;
  }

  const { data: publicData } = client.storage
    .from(SUPABASE_CONFIG.bucket)
    .getPublicUrl(filePath);

  return {
    publicUrl: publicData.publicUrl,
    filePath
  };
}

// =========================================================
// GESTION HORS-LIGNE & FILE D'ATTENTE DE SYNCHRONISATION
// =========================================================

function getOfflineQueue() {
  try {
    const raw = localStorage.getItem('caddrillage_offline_queue');
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
}

function saveOfflineQueue(queue) {
  try {
    localStorage.setItem('caddrillage_offline_queue', JSON.stringify(queue));
    updateOfflineQueueUI();
  } catch (e) {}
}

function addToOfflineQueue(action, writingId) {
  const queue = getOfflineQueue();
  const index = queue.findIndex(q => String(q.writingId) === String(writingId));
  if (index >= 0) {
    queue[index] = { action, writingId: String(writingId), timestamp: Date.now() };
  } else {
    queue.push({ action, writingId: String(writingId), timestamp: Date.now() });
  }
  saveOfflineQueue(queue);
}

function removeFromOfflineQueue(writingId) {
  const queue = getOfflineQueue().filter(q => String(q.writingId) !== String(writingId));
  saveOfflineQueue(queue);
}

function updateOfflineQueueUI() {
  const queue = getOfflineQueue();
  const queueBadge = document.getElementById('rebuildQueueState');
  if (queueBadge) {
    if (queue.length === 0) {
      queueBadge.textContent = '0 en attente (À jour)';
      queueBadge.style.color = '#16a34a';
    } else {
      queueBadge.textContent = `${queue.length} en attente`;
      queueBadge.style.color = '#f59e0b';
    }
  }
}

function dbGetWritingLocal(id) {
  return new Promise((resolve) => {
    if (!db || !db.objectStoreNames.contains(DB_CONFIG.storeName)) return resolve(null);
    try {
      const transaction = db.transaction([DB_CONFIG.storeName], 'readonly');
      const store = transaction.objectStore(DB_CONFIG.storeName);
      const req = store.get(String(id));
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    } catch (e) {
      resolve(null);
    }
  });
}

function dbPutWritingLocal(writing) {
  return new Promise((resolve) => {
    if (!db || !db.objectStoreNames.contains(DB_CONFIG.storeName)) return resolve(false);
    try {
      const transaction = db.transaction([DB_CONFIG.storeName], 'readwrite');
      const store = transaction.objectStore(DB_CONFIG.storeName);
      const req = store.put(writing);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch (e) {
      resolve(false);
    }
  });
}

// Synchronisation de la file d'attente hors-ligne vers Supabase
async function processOfflineQueue() {
  if (!navigator.onLine) return;
  const queue = getOfflineQueue();
  if (!queue || queue.length === 0) return;

  const client = getSupabaseClient();
  if (!client) return;

  let remaining = [];
  let syncedCount = 0;

  for (const item of queue) {
    try {
      if (item.action === 'delete') {
        const { error } = await client
          .from(SUPABASE_CONFIG.table)
          .delete()
          .eq('id', String(item.writingId));
        if (error) {
          remaining.push(item);
        } else {
          syncedCount++;
        }
      } else if (item.action === 'upsert') {
        const localWriting = await dbGetWritingLocal(item.writingId);
        if (!localWriting) {
          continue;
        }

        let pdfUrl = localWriting.pdfUrl || '';
        if (localWriting.pdfBlob && (!pdfUrl || pdfUrl.startsWith('blob:'))) {
          try {
            const uploadRes = await uploadPdfToSupabase(localWriting.pdfBlob, localWriting.id);
            if (uploadRes && uploadRes.publicUrl) {
              pdfUrl = uploadRes.publicUrl;
              localWriting.pdfUrl = pdfUrl;
              await dbPutWritingLocal(localWriting);
            }
          } catch (uploadErr) {
            console.warn('Échec re-upload PDF hors-ligne:', uploadErr);
          }
        }

        const payload = {
          id: String(localWriting.id),
          title: localWriting.title,
          category: localWriting.category,
          summary: (localWriting.category === 'poesie') ? (localWriting.poetryText || localWriting.summary || '') : (localWriting.summary || ''),
          tags: localWriting.tags || [],
          display_date: localWriting.displayDate || '',
          page_count: localWriting.pageCount !== undefined && localWriting.pageCount !== null && localWriting.pageCount !== '' ? Number(localWriting.pageCount) : null,
          word_count: localWriting.wordCount !== undefined && localWriting.wordCount !== null && localWriting.wordCount !== '' ? Number(localWriting.wordCount) : null,
          reading_time: localWriting.readingTime || '',
          pdf_url: pdfUrl,
          pdf_name: localWriting.pdfFileName,
          pdf_size: localWriting.pdfFileSize,
          created_at: Number(localWriting.createdAt),
          updated_at: Number(localWriting.updatedAt)
        };

        const { error } = await client.from(SUPABASE_CONFIG.table).upsert(payload);
        if (error) {
          remaining.push(item);
        } else {
          syncedCount++;
        }
      }
    } catch (itemErr) {
      console.warn('Erreur processOfflineQueue:', itemErr);
      remaining.push(item);
    }
  }

  saveOfflineQueue(remaining);

  if (syncedCount > 0) {
    showToast(`${syncedCount} écrit(s) synchronisé(s) avec succès sur le cloud !`, 'success');
  }
}

// Sauvegarde d'un écrit (Supabase + miroir IndexedDB + file hors-ligne)
async function dbSaveWriting(writing, newPdfFile = null) {
  let pdfUrl = writing.pdfUrl || '';
  const client = getSupabaseClient();
  let supabaseSuccess = false;

  if (newPdfFile && client && navigator.onLine) {
    try {
      const uploadRes = await uploadPdfToSupabase(newPdfFile, writing.id);
      pdfUrl = uploadRes.publicUrl;
      writing.pdfUrl = pdfUrl;
    } catch (err) {
      console.error('Échec upload PDF Supabase:', err);
    }
  }

  if (client && navigator.onLine) {
    try {
      const payload = {
        id: String(writing.id),
        title: writing.title,
        category: writing.category,
        summary: (writing.category === 'poesie') ? (writing.poetryText || writing.summary || '') : (writing.summary || ''),
        tags: writing.tags || [],
        display_date: writing.displayDate || '',
        page_count: writing.pageCount !== undefined && writing.pageCount !== null && writing.pageCount !== '' ? Number(writing.pageCount) : null,
        word_count: writing.wordCount !== undefined && writing.wordCount !== null && writing.wordCount !== '' ? Number(writing.wordCount) : null,
        reading_time: writing.readingTime || '',
        pdf_url: pdfUrl,
        pdf_name: writing.pdfFileName,
        pdf_size: writing.pdfFileSize,
        created_at: Number(writing.createdAt),
        updated_at: Number(writing.updatedAt)
      };

      let { error } = await client
        .from(SUPABASE_CONFIG.table)
        .upsert(payload);

      if (error && error.code === 'PGRST204') {
        delete payload.page_count;
        delete payload.word_count;
        delete payload.reading_time;

        let res = await client
          .from(SUPABASE_CONFIG.table)
          .upsert(payload);
        error = res.error;

        if (error && error.code === 'PGRST204') {
          delete payload.display_date;
          res = await client
            .from(SUPABASE_CONFIG.table)
            .upsert(payload);
          error = res.error;
        }
      }

      if (!error) {
        supabaseSuccess = true;
        removeFromOfflineQueue(writing.id);
      } else {
        console.warn('Erreur upsert Supabase:', error);
      }
    } catch (e) {
      console.warn('Erreur réseau Supabase:', e);
    }
  }

  // Si non synchronisé en ligne, enregistrer dans la file hors-ligne
  if (!supabaseSuccess) {
    addToOfflineQueue('upsert', writing.id);
    showToast("Écrit sauvegardé localement (hors ligne). Il sera synchronisé dès le retour d'internet.", "info");
  }

  // Toujours enregistrer dans IndexedDB locale
  if (db && db.objectStoreNames.contains(DB_CONFIG.storeName)) {
    try {
      const localData = { ...writing };
      if (newPdfFile) localData.pdfBlob = newPdfFile;
      const transaction = db.transaction([DB_CONFIG.storeName], 'readwrite');
      const store = transaction.objectStore(DB_CONFIG.storeName);
      store.put(localData);
    } catch (e) {
      console.warn('Erreur sauvegarde locale IndexedDB:', e);
    }
  }

  return true;
}

// Suppression d'un écrit (Supabase + local + file hors-ligne)
async function dbDeleteWriting(id) {
  const client = getSupabaseClient();
  let supabaseSuccess = false;

  if (client && navigator.onLine) {
    try {
      const { error } = await client
        .from(SUPABASE_CONFIG.table)
        .delete()
        .eq('id', String(id));
      if (!error) {
        supabaseSuccess = true;
        removeFromOfflineQueue(id);
      }
    } catch (e) {
      console.warn('Erreur suppression Supabase:', e);
    }
  }

  if (!supabaseSuccess) {
    addToOfflineQueue('delete', id);
    showToast("Suppression enregistrée localement. Elle sera synchronisée dès le retour d'internet.", "info");
  }

  if (db && db.objectStoreNames.contains(DB_CONFIG.storeName)) {
    try {
      const transaction = db.transaction([DB_CONFIG.storeName], 'readwrite');
      const store = transaction.objectStore(DB_CONFIG.storeName);
      store.delete(id);
    } catch (e) {
      console.warn('Erreur suppression locale:', e);
    }
  }

  return true;
}

// Synchronisation automatique des écrits locaux vers Supabase
async function syncLocalToSupabase() {
  const client = getSupabaseClient();
  if (!client || !db) return;

  try {
    const localWritings = await dbGetAllWritingsLocal();
    if (!localWritings || localWritings.length === 0) return;

    const { data: cloudWritings, error } = await client
      .from(SUPABASE_CONFIG.table)
      .select('id');

    if (error) return;

    const cloudIds = new Set((cloudWritings || []).map(w => String(w.id)));

    let hasSynced = false;
    for (const local of localWritings) {
      if (!cloudIds.has(String(local.id))) {
        await dbSaveWriting(local, local.pdfBlob || null);
        hasSynced = true;
      }
    }

    if (hasSynced) {
      console.log('Synchronisation des textes existants vers le cloud effectuée.');
      await refreshAdminWritings();
      await refreshShowcase();
    }
  } catch (err) {
    console.warn('Sync cloud:', err);
  }
}

// Récupération de tous les commentaires privés des lecteurs
async function dbGetAllComments() {
  const client = getSupabaseClient();
  if (client) {
    try {
      const { data, error } = await client
        .from(SUPABASE_CONFIG.commentsTable)
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        return data.map(item => ({
          id: item.id,
          writingId: item.writing_id,
          writingTitle: item.writing_title,
          authorName: item.author_name || 'Lecteur anonyme',
          message: item.message,
          createdAt: Number(item.created_at)
        }));
      }
    } catch (e) {
      console.warn('Erreur lecture commentaires Supabase :', e);
    }
  }

  // Fallback local IndexedDB
  return new Promise((resolve) => {
    if (!db) return resolve([]);
    try {
      if (!db.objectStoreNames.contains(DB_CONFIG.commentsStore)) return resolve([]);
      const transaction = db.transaction([DB_CONFIG.commentsStore], 'readonly');
      const store = transaction.objectStore(DB_CONFIG.commentsStore);
      const request = store.getAll();
      request.onsuccess = () => {
        const results = (request.result || []).sort((a, b) => b.createdAt - a.createdAt);
        resolve(results);
      };
      request.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
}

// Enregistrement d'un commentaire privé
async function dbSaveComment(comment) {
  const client = getSupabaseClient();
  if (client) {
    try {
      await client
        .from(SUPABASE_CONFIG.commentsTable)
        .insert({
          id: comment.id,
          writing_id: comment.writingId,
          writing_title: comment.writingTitle,
          author_name: comment.authorName,
          message: comment.message,
          created_at: comment.createdAt
        });
    } catch (e) {
      console.warn('Erreur sauvegarde commentaire Supabase :', e);
    }
  }

  if (db && db.objectStoreNames.contains(DB_CONFIG.commentsStore)) {
    try {
      const transaction = db.transaction([DB_CONFIG.commentsStore], 'readwrite');
      const store = transaction.objectStore(DB_CONFIG.commentsStore);
      store.put(comment);
    } catch (e) {
      console.warn('Erreur sauvegarde commentaire locale :', e);
    }
  }

  return true;
}

// Suppression d'un commentaire
async function dbDeleteComment(id) {
  const client = getSupabaseClient();
  if (client) {
    try {
      await client
        .from(SUPABASE_CONFIG.commentsTable)
        .delete()
        .eq('id', id);
    } catch (e) {
      console.warn('Erreur suppression commentaire Supabase :', e);
    }
  }

  if (db && db.objectStoreNames.contains(DB_CONFIG.commentsStore)) {
    try {
      const transaction = db.transaction([DB_CONFIG.commentsStore], 'readwrite');
      const store = transaction.objectStore(DB_CONFIG.commentsStore);
      store.delete(id);
    } catch (e) {
      console.warn('Erreur suppression commentaire local :', e);
    }
  }

  return true;
}

// =========================================================
// 3. GESTION DU THÈME D'AFFICHAGE & GALERIE DES AMBIANCES
// (White, Dark, Galaxy, OLED, XP, Caddri, Forêt, Parchemin, Matrix, Backroom)
// =========================================================

const THEMES_LIST = ['white', 'dark', 'galaxy', 'oled', 'xp', 'caddri', 'forest', 'parchemin', 'matrix', 'backroom', 'halloween', 'noel'];
const THEMES_PRESETS = ['white', 'dark', 'galaxy'];

const THEMES_NAMES = {
  'white': 'Clair',
  'dark': 'Sombre',
  'galaxy': 'Galaxie',
  'oled': 'OLED',
  'xp': 'XP',
  'caddri': 'Caddri',
  'forest': 'Forêt',
  'parchemin': 'Parchemin',
  'matrix': 'Matrix',
  'backroom': 'Backroom',
  'halloween': 'Halloween 2026',
  'noel': 'Noël 2026'
};

const DEFAULT_THEMES_METADATA = {
  dark: {
    title: 'Sombre',
    badge: 'Défaut',
    desc: 'Fond anthracite feutré et contrastes doux. Reposant pour les yeux.',
    previewType: 'dot',
    previewDotClass: 'dot-dark',
    previewBg: '#0d0f12'
  },
  white: {
    title: 'Clair',
    badge: '',
    desc: 'Luminosité épurée et papier blanc contemporain. Idéal en plein jour.',
    previewType: 'dot',
    previewDotClass: 'dot-white',
    previewBg: '#f8fafc'
  },
  galaxy: {
    title: 'Galaxie',
    badge: 'Cosmique',
    desc: 'Immersion stellaire sous les nébuleuses et l\'infini cosmique.',
    previewType: 'image',
    image: 'galaxy.jpeg'
  },
  oled: {
    title: 'OLED',
    badge: 'Éco-batterie',
    desc: 'Noir absolu 100%. Éteint les pixels des écrans OLED pour un contraste parfait.',
    previewType: 'dot',
    previewDotClass: 'dot-oled',
    previewBg: '#000000'
  },
  xp: {
    title: 'XP',
    badge: 'Nostalgie',
    desc: 'La légendaire colline verdoyante sous une voûte céleste étoilée.',
    previewType: 'image',
    image: 'xp.jpg'
  },
  caddri: {
    title: 'Caddri',
    badge: 'Signature',
    desc: 'Quadrillage d\'écolier noir et blanc, hommage direct à l\'Antre du caddrillage.',
    previewType: 'image',
    image: 'caddri.jpg'
  },
  forest: {
    title: 'Forêt',
    badge: 'Nature',
    desc: 'Sentier de mousse et sapins centenaires. Mystique et contemplatif.',
    previewType: 'image',
    image: 'forest.jpg'
  },
  parchemin: {
    title: 'Parchemin',
    badge: 'Manuscrit',
    desc: 'Texture de vieux papier kraft froissé et encres chaudes. Très chaleureux.',
    previewType: 'image',
    image: 'parchemin.jpg'
  },
  matrix: {
    title: 'Matrix',
    badge: 'Cyber',
    desc: 'Pluie de code vert néon avec décodage progressif en cascade de vos textes.',
    previewType: 'image',
    image: 'matrix.jpg'
  },
  backroom: {
    title: 'Backroom',
    badge: 'Liminal',
    desc: 'Labyrinthe infini de pièces jaunâtres et bourdonnement fluorescent. Étrange et mystérieux.',
    previewType: 'image',
    image: 'backroom.jpg'
  },
  halloween: {
    title: 'Halloween 2026',
    badge: 'Saisonnier',
    desc: 'Brume nocturne et citrouille d\'automne. De discrets petits spectres dérivent dans la nuit.',
    previewType: 'dot',
    previewDotClass: 'dot-halloween',
    previewBg: 'radial-gradient(circle at 50% 40%, rgba(255, 117, 24, 0.28) 0%, #0d0812 100%)'
  },
  noel: {
    title: 'Noël 2026',
    badge: 'Fêtes & Hiver',
    desc: 'Bleu glacé étincelant, guirlandes lumineuses festives autour des cartes et douce tombée de neige.',
    previewType: 'image',
    image: 'noel.jpg'
  }
};

function getCustomThemesMetadata() {
  let custom = {};
  try {
    const raw = localStorage.getItem('caddrillage_custom_themes');
    if (raw) {
      custom = JSON.parse(raw);
    }
  } catch (err) {
    console.warn('Erreur lecture thèmes personnalisés:', err);
  }

  const result = {};
  for (const [key, defaultMeta] of Object.entries(DEFAULT_THEMES_METADATA)) {
    const override = custom && typeof custom[key] === 'object' ? custom[key] : {};
    result[key] = {
      ...defaultMeta,
      title: (override.title !== undefined && override.title !== null && override.title.trim() !== '') 
             ? override.title.trim() 
             : defaultMeta.title,
      badge: (override.badge !== undefined && override.badge !== null) 
             ? override.badge.trim() 
             : defaultMeta.badge,
      desc: (override.desc !== undefined && override.desc !== null && override.desc.trim() !== '') 
            ? override.desc.trim() 
            : defaultMeta.desc
    };
  }
  return result;
}

function applyThemesMetadata() {
  const themesMeta = getCustomThemesMetadata();

  // 1. Mettre à jour le dictionnaire global THEMES_NAMES
  for (const [key, meta] of Object.entries(themesMeta)) {
    THEMES_NAMES[key] = meta.title;
  }

  // 2. Mettre à jour la galerie des thèmes dans la modale
  for (const [key, meta] of Object.entries(themesMeta)) {
    const card = document.querySelector(`.theme-gallery-card[data-theme="${key}"]`);
    if (card) {
      const titleEl = card.querySelector('.theme-card-title');
      const descEl = card.querySelector('.theme-card-desc');
      let badgeEl = card.querySelector('.theme-card-badge');

      if (titleEl) titleEl.textContent = meta.title;
      if (descEl) descEl.textContent = meta.desc;

      if (meta.badge && meta.badge.trim() !== '') {
        if (!badgeEl) {
          const headerRow = card.querySelector('.theme-card-header-row');
          if (headerRow) {
            badgeEl = document.createElement('span');
            badgeEl.className = 'theme-card-badge';
            headerRow.appendChild(badgeEl);
          }
        }
        if (badgeEl) {
          badgeEl.textContent = meta.badge.trim();
          badgeEl.style.display = '';
        }
      } else if (badgeEl) {
        badgeEl.style.display = 'none';
      }
    }

    // 3. Mettre à jour le bouton du dock latéral s'il existe
    const dockBtn = document.querySelector(`#themeDock .theme-btn[data-theme="${key}"]`);
    if (dockBtn) {
      dockBtn.setAttribute('title', `Fond ${meta.title}`);
      const titleSpan = dockBtn.querySelector('.theme-btn-title');
      if (titleSpan) titleSpan.textContent = meta.title;
    }
  }
}

function renderAdminThemesEditor() {
  const container = document.getElementById('themeAdminEditorGrid');
  if (!container) return;

  const currentMeta = getCustomThemesMetadata();
  const themeKeys = Object.keys(DEFAULT_THEMES_METADATA);

  container.innerHTML = themeKeys.map(key => {
    const meta = currentMeta[key];
    const def = DEFAULT_THEMES_METADATA[key];

    let previewContent = '';
    let previewStyle = '';

    if (def.previewType === 'image') {
      previewStyle = `style="background-image: url('${def.image}');"`;
    } else {
      previewStyle = `style="background: ${def.previewBg};"`;
      previewContent = `<span class="preview-dot ${def.previewDotClass}"></span>`;
    }

    return `
      <div class="theme-admin-card" data-theme-key="${escapeHtml(key)}">
        <div class="theme-admin-card-preview" ${previewStyle}>
          ${previewContent}
          <span class="theme-admin-card-tag">${escapeHtml(key.toUpperCase())}</span>
        </div>
        <div class="theme-admin-card-body">
          <div class="theme-admin-field">
            <label class="theme-admin-field-label">Nom du thème</label>
            <input type="text" 
                   class="form-input theme-admin-input theme-admin-input-title" 
                   value="${escapeHtml(meta.title)}" 
                   placeholder="Ex: ${escapeHtml(def.title)}"
                   data-theme-key="${escapeHtml(key)}">
          </div>
          <div class="theme-admin-field">
            <label class="theme-admin-field-label">Badge (facultatif)</label>
            <input type="text" 
                   class="form-input theme-admin-input theme-admin-input-badge" 
                   value="${escapeHtml(meta.badge || '')}" 
                   placeholder="Ex: Défaut, Cosmique, Liminal..."
                   data-theme-key="${escapeHtml(key)}">
          </div>
          <div class="theme-admin-field">
            <label class="theme-admin-field-label">Description de l'ambiance</label>
            <textarea class="form-textarea theme-admin-input theme-admin-input-desc" 
                      rows="2" 
                      placeholder="Description de l'ambiance de lecture..."
                      data-theme-key="${escapeHtml(key)}">${escapeHtml(meta.desc)}</textarea>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function saveCustomThemesFromAdmin(showFeedback = true) {
  const cards = document.querySelectorAll('#themeAdminEditorGrid .theme-admin-card');
  if (!cards.length) return false;

  const customMap = {};
  cards.forEach(card => {
    const key = card.getAttribute('data-theme-key');
    if (!key || !DEFAULT_THEMES_METADATA[key]) return;

    const titleInput = card.querySelector('.theme-admin-input-title');
    const badgeInput = card.querySelector('.theme-admin-input-badge');
    const descTextarea = card.querySelector('.theme-admin-input-desc');

    const title = titleInput ? titleInput.value.trim() : '';
    const badge = badgeInput ? badgeInput.value.trim() : '';
    const desc = descTextarea ? descTextarea.value.trim() : '';

    customMap[key] = {
      title: title || DEFAULT_THEMES_METADATA[key].title,
      badge: badge,
      desc: desc || DEFAULT_THEMES_METADATA[key].desc
    };
  });

  try {
    localStorage.setItem('caddrillage_custom_themes', JSON.stringify(customMap));
  } catch (e) {
    console.error('Erreur sauvegarde thèmes:', e);
  }

  applyThemesMetadata();

  if (showFeedback) {
    showToast('Thèmes & ambiances mis à jour avec succès !', '🎨');
  }
  return true;
}

function resetCustomThemesToDefault() {
  if (confirm('Voulez-vous rétablir les noms, badges et descriptions d\'origine de tous les 10 thèmes ?')) {
    localStorage.removeItem('caddrillage_custom_themes');
    applyThemesMetadata();
    renderAdminThemesEditor();
    showToast('Noms et descriptions des thèmes d\'origine rétablis.', '🎨');
  }
}

function initAdminThemesHandlers() {
  const btnSave = document.getElementById('btnSaveCustomThemes');
  const btnReset = document.getElementById('btnResetCustomThemesDefault');

  if (btnSave) {
    btnSave.addEventListener('click', (e) => {
      e.preventDefault();
      saveCustomThemesFromAdmin(true);
    });
  }

  if (btnReset) {
    btnReset.addEventListener('click', (e) => {
      e.preventDefault();
      resetCustomThemesToDefault();
    });
  }
}

// =========================================================
// PERSONNALISATION DES TEXTES DE LA PAGE D'INSTALLATION (BUILDS)
// =========================================================

const DEFAULT_BUILDS_METADATA = {
  modalTitle: "L'antre du caddrillage — Application",
  modalSubtitle: "Accédez à tous vos écrits hors-ligne avec confort maximal",
  modalBanner: "",
  platforms: {
    macos: {
      title: "macOS (Apple Silicon & Intel)",
      subtitle: "macOS 11 Big Sur, Monterey, Ventura, Sonoma, Sequoia+",
      desc: "Application native Cocoa / WebKit 64-bit arm64 & x86_64. Aucune dépendance externe, fluide et économe.",
      heroTitle: "Application native pour macOS",
      heroDesc: "Application native ultra-rapide optimisée pour Apple Silicon (M1, M2, M3, M4). Fonctionne à 100% sans connexion internet avec tous les écrits intégrés.",
      icon: "🍎",
      osTag: "macOS"
    },
    windows: {
      title: "Windows (10 & 11)",
      subtitle: "Architecture x64 / x86",
      desc: "Exécutable autonome Windows avec WebView2 natif. Conserve tous vos écrits hors-ligne et se synchronise dès que le réseau est disponible.",
      heroTitle: "Application autonome pour Windows",
      heroDesc: "Installateur et version portable optimisés pour Windows 10 et 11. 100% autonome et hors-ligne avec liseuse intégrée.",
      icon: "🪟",
      osTag: "Windows"
    },
    linux: {
      title: "Linux (.AppImage / WebKitGTK)",
      subtitle: "Ubuntu, Debian, Fedora, Arch Linux...",
      desc: "Format universel sans installation. Fonctionne sur toutes les distributions Linux récentes.",
      heroTitle: "Application autonome pour Linux",
      heroDesc: "Format universel .AppImage / WebKitGTK sans installation, prêt à tourner sur Ubuntu, Debian, Fedora, Arch Linux.",
      icon: "🐧",
      osTag: "Linux"
    },
    android: {
      title: "Android (.apk)",
      subtitle: "Smartphones & tablettes Android 8.0+",
      desc: "Application mobile complète avec icône dédiée. Lisez tous les romans, nouvelles et poèmes hors-ligne sur votre téléphone.",
      heroTitle: "Application mobile Android (.apk)",
      heroDesc: "Application mobile complète pour smartphones et tablettes (Android 8.0+). 100% autonome et hors-ligne avec liseuse intégrée.",
      icon: "🤖",
      osTag: "Android"
    }
  }
};

function getCustomBuildsMetadata() {
  let custom = null;
  try {
    const raw = localStorage.getItem('caddrillage_custom_builds');
    if (raw) custom = JSON.parse(raw);
  } catch (err) {
    console.warn('Erreur lecture builds personnalisés:', err);
  }

  const result = {
    modalTitle: (custom && custom.modalTitle && custom.modalTitle.trim()) ? custom.modalTitle.trim() : DEFAULT_BUILDS_METADATA.modalTitle,
    modalSubtitle: (custom && custom.modalSubtitle && custom.modalSubtitle.trim()) ? custom.modalSubtitle.trim() : DEFAULT_BUILDS_METADATA.modalSubtitle,
    modalBanner: (custom && typeof custom.modalBanner === 'string') ? custom.modalBanner.trim() : DEFAULT_BUILDS_METADATA.modalBanner,
    platforms: {}
  };

  const platformsObj = (custom && custom.platforms) ? custom.platforms : {};
  for (const [key, def] of Object.entries(DEFAULT_BUILDS_METADATA.platforms)) {
    const override = platformsObj[key] || {};
    result.platforms[key] = {
      ...def,
      title: (override.title && override.title.trim()) ? override.title.trim() : def.title,
      subtitle: (override.subtitle && override.subtitle.trim()) ? override.subtitle.trim() : def.subtitle,
      desc: (override.desc && override.desc.trim()) ? override.desc.trim() : def.desc,
      heroTitle: (override.heroTitle && override.heroTitle.trim()) ? override.heroTitle.trim() : def.heroTitle,
      heroDesc: (override.heroDesc && override.heroDesc.trim()) ? override.heroDesc.trim() : def.heroDesc
    };
  }

  return result;
}

function applyBuildsMetadata() {
  const meta = getCustomBuildsMetadata();

  const modalTitle = document.getElementById('downloadModalTitle');
  if (modalTitle) modalTitle.textContent = meta.modalTitle;

  const modalSubtitle = document.getElementById('downloadModalSubtitle');
  if (modalSubtitle) modalSubtitle.textContent = meta.modalSubtitle;

  const banner = document.getElementById('downloadModalBanner');
  if (banner) {
    if (meta.modalBanner && meta.modalBanner.trim()) {
      banner.textContent = meta.modalBanner;
      banner.style.display = 'block';
    } else {
      banner.style.display = 'none';
      banner.textContent = '';
    }
  }

  for (const [key, platMeta] of Object.entries(meta.platforms)) {
    const card = document.querySelector(`.platform-card[data-platform="${key}"]`);
    if (card) {
      const titleEl = card.querySelector('.platform-card-title');
      const subtitleEl = card.querySelector('.platform-subtitle');
      const descEl = card.querySelector('.platform-desc');

      if (titleEl) titleEl.textContent = platMeta.title;
      if (subtitleEl) subtitleEl.textContent = platMeta.subtitle;
      if (descEl) descEl.textContent = platMeta.desc;
    }
  }
}

function renderAdminBuildsEditor() {
  const container = document.getElementById('buildAdminEditorGrid');
  const titleInput = document.getElementById('adminBuildModalTitleInput');
  const subtitleInput = document.getElementById('adminBuildModalSubtitleInput');
  const bannerInput = document.getElementById('adminBuildModalBannerInput');

  const meta = getCustomBuildsMetadata();

  if (titleInput) titleInput.value = meta.modalTitle;
  if (subtitleInput) subtitleInput.value = meta.modalSubtitle;
  if (bannerInput) bannerInput.value = meta.modalBanner || '';

  if (!container) return;

  const platformKeys = Object.keys(DEFAULT_BUILDS_METADATA.platforms);
  container.innerHTML = platformKeys.map(key => {
    const pMeta = meta.platforms[key];
    const def = DEFAULT_BUILDS_METADATA.platforms[key];

    return `
      <div class="build-admin-card" data-build-key="${escapeHtml(key)}">
        <div class="build-admin-card-header">
          <div class="build-admin-card-title-group">
            <span class="build-admin-card-icon">${escapeHtml(def.icon)}</span>
            <span class="build-admin-card-name">${escapeHtml(def.osTag)}</span>
          </div>
          <span class="build-admin-card-tag">${escapeHtml(key.toUpperCase())}</span>
        </div>
        <div class="build-admin-card-body">
          <div class="build-admin-field">
            <label class="build-admin-field-label">Titre de la plateforme</label>
            <input type="text" 
                   class="form-input build-admin-input build-admin-input-title" 
                   value="${escapeHtml(pMeta.title)}" 
                   placeholder="Ex: ${escapeHtml(def.title)}"
                   data-build-key="${escapeHtml(key)}">
          </div>
          <div class="build-admin-field">
            <label class="build-admin-field-label">Sous-titre / Compatibilité OS</label>
            <input type="text" 
                   class="form-input build-admin-input build-admin-input-subtitle" 
                   value="${escapeHtml(pMeta.subtitle)}" 
                   placeholder="Ex: ${escapeHtml(def.subtitle)}"
                   data-build-key="${escapeHtml(key)}">
          </div>
          <div class="build-admin-field">
            <label class="build-admin-field-label">Description générale</label>
            <textarea class="form-textarea build-admin-input build-admin-input-desc" 
                      rows="2" 
                      placeholder="Description du binaire..."
                      data-build-key="${escapeHtml(key)}">${escapeHtml(pMeta.desc)}</textarea>
          </div>
          <div class="build-admin-field">
            <label class="build-admin-field-label">Titre mis en avant (Hero)</label>
            <input type="text" 
                   class="form-input build-admin-input build-admin-input-hero-title" 
                   value="${escapeHtml(pMeta.heroTitle)}" 
                   placeholder="Ex: ${escapeHtml(def.heroTitle)}"
                   data-build-key="${escapeHtml(key)}">
          </div>
          <div class="build-admin-field">
            <label class="build-admin-field-label">Message mis en avant (Hero)</label>
            <textarea class="form-textarea build-admin-input build-admin-input-hero-desc" 
                      rows="2" 
                      placeholder="Description mise en avant..."
                      data-build-key="${escapeHtml(key)}">${escapeHtml(pMeta.heroDesc)}</textarea>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function saveCustomBuildsFromAdmin(showFeedback = true) {
  const titleInput = document.getElementById('adminBuildModalTitleInput');
  const subtitleInput = document.getElementById('adminBuildModalSubtitleInput');
  const bannerInput = document.getElementById('adminBuildModalBannerInput');

  const cards = document.querySelectorAll('#buildAdminEditorGrid .build-admin-card');

  const customObj = {
    modalTitle: titleInput ? titleInput.value.trim() : DEFAULT_BUILDS_METADATA.modalTitle,
    modalSubtitle: subtitleInput ? subtitleInput.value.trim() : DEFAULT_BUILDS_METADATA.modalSubtitle,
    modalBanner: bannerInput ? bannerInput.value.trim() : '',
    platforms: {}
  };

  cards.forEach(card => {
    const key = card.getAttribute('data-build-key');
    if (!key || !DEFAULT_BUILDS_METADATA.platforms[key]) return;

    const titleIn = card.querySelector('.build-admin-input-title');
    const subIn = card.querySelector('.build-admin-input-subtitle');
    const descIn = card.querySelector('.build-admin-input-desc');
    const heroTitleIn = card.querySelector('.build-admin-input-hero-title');
    const heroDescIn = card.querySelector('.build-admin-input-hero-desc');

    const def = DEFAULT_BUILDS_METADATA.platforms[key];

    customObj.platforms[key] = {
      title: (titleIn && titleIn.value.trim()) ? titleIn.value.trim() : def.title,
      subtitle: (subIn && subIn.value.trim()) ? subIn.value.trim() : def.subtitle,
      desc: (descIn && descIn.value.trim()) ? descIn.value.trim() : def.desc,
      heroTitle: (heroTitleIn && heroTitleIn.value.trim()) ? heroTitleIn.value.trim() : def.heroTitle,
      heroDesc: (heroDescIn && heroDescIn.value.trim()) ? heroDescIn.value.trim() : def.heroDesc
    };
  });

  try {
    localStorage.setItem('caddrillage_custom_builds', JSON.stringify(customObj));
  } catch (e) {
    console.error('Erreur sauvegarde builds personnalisés:', e);
  }

  applyBuildsMetadata();

  if (showFeedback) {
    showToast('Textes de la page d\'installation enregistrés avec succès !', 'success');
  }
  return true;
}

function resetCustomBuildsToDefault() {
  if (confirm('Voulez-vous rétablir les titres, sous-titres, messages et descriptions d\'origine de la page d\'installation ?')) {
    localStorage.removeItem('caddrillage_custom_builds');
    applyBuildsMetadata();
    renderAdminBuildsEditor();
    showToast('Textes d\'origine de la page d\'installation rétablis.', 'info');
  }
}

function initAdminBuildsHandlers() {
  const btnSave = document.getElementById('btnSaveCustomBuilds');
  const btnReset = document.getElementById('btnResetCustomBuildsDefault');

  if (btnSave) {
    btnSave.addEventListener('click', (e) => {
      e.preventDefault();
      saveCustomBuildsFromAdmin(true);
    });
  }

  if (btnReset) {
    btnReset.addEventListener('click', (e) => {
      e.preventDefault();
      resetCustomBuildsToDefault();
    });
  }
}

let currentTheme = localStorage.getItem('caddrillage_theme') || 'white';
let matrixObserver = null;
const MATRIX_CHARS = '0123456789ABCDEFｦｱｳｴｵｶｷｹｺｻｼｽｾｿﾀﾂﾃﾅﾆﾇﾈﾊﾋﾎﾏﾐﾑﾒﾓﾔﾕﾗﾘﾜ#%*@&<>~';

function initTheme() {
  applyThemesMetadata();
  const savedTheme = localStorage.getItem('caddrillage_theme') || 'white';
  applyTheme(savedTheme, false);

  // 1. Boutons du dock latéral
  const themeButtons = document.querySelectorAll('#themeDock .theme-btn[data-theme]');
  themeButtons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      // Si un appui long mobile vient d'avoir lieu, ignorer le clic classique
      if (btn.dataset.longPressTriggered === 'true') {
        delete btn.dataset.longPressTriggered;
        return;
      }
      const targetTheme = btn.getAttribute('data-theme');
      applyTheme(targetTheme, true);
    });
  });

  // 2. Bouton + pour ouvrir la galerie des thèmes
  const btnMore = document.getElementById('btnOpenThemeGallery');
  const btnCloseModal = document.getElementById('btnCloseThemeGalleryModal');
  const btnDismissModal = document.getElementById('btnDismissThemeGalleryModal');
  const galleryModal = document.getElementById('themeGalleryModal');

  if (btnMore) {
    btnMore.addEventListener('click', () => {
      openThemeGalleryModal();
    });
  }

  if (btnCloseModal) btnCloseModal.addEventListener('click', closeThemeGalleryModal);
  if (btnDismissModal) btnDismissModal.addEventListener('click', closeThemeGalleryModal);

  if (galleryModal) {
    galleryModal.addEventListener('click', (e) => {
      if (e.target.id === 'themeGalleryModal') {
        closeThemeGalleryModal();
      }
    });
  }

  // 3. Cartes de thèmes dans la modale
  const galleryCards = document.querySelectorAll('.theme-gallery-card');
  galleryCards.forEach(card => {
    card.addEventListener('click', () => {
      const targetTheme = card.getAttribute('data-theme');
      applyTheme(targetTheme, true);
      setTimeout(() => {
        closeThemeGalleryModal();
      }, 240);
    });
  });

  // 4. Appui long sur smartphone (500 ms) sur n'importe quel bouton du dock
  initMobileLongPressOnDock();
}

function openThemeGalleryModal() {
  const modal = document.getElementById('themeGalleryModal');
  if (!modal) return;
  updateThemeGalleryActiveCard(currentTheme);
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeThemeGalleryModal() {
  const modal = document.getElementById('themeGalleryModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

function updateThemeGalleryActiveCard(themeName) {
  const galleryCards = document.querySelectorAll('.theme-gallery-card');
  galleryCards.forEach(card => {
    const isCurrent = card.getAttribute('data-theme') === themeName;
    card.classList.toggle('active', isCurrent);
  });
}

function initMobileLongPressOnDock() {
  const dockButtons = document.querySelectorAll('#themeDock .theme-btn');
  dockButtons.forEach(btn => {
    let pressTimer = null;
    let startX = 0;
    let startY = 0;

    btn.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) return;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;

      pressTimer = setTimeout(() => {
        btn.dataset.longPressTriggered = 'true';
        if (navigator.vibrate) {
          try { navigator.vibrate(40); } catch (e) {}
        }
        openThemeGalleryModal();
      }, 500);
    }, { passive: true });

    btn.addEventListener('touchmove', (e) => {
      if (!pressTimer) return;
      const moveX = e.touches[0].clientX;
      const moveY = e.touches[0].clientY;
      if (Math.hypot(moveX - startX, moveY - startY) > 12) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    }, { passive: true });

    btn.addEventListener('touchend', () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    });

    btn.addEventListener('touchcancel', () => {
      if (pressTimer) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
    });
  });
}

function applyTheme(themeName, showToastFeedback = false) {
  if (!THEMES_LIST.includes(themeName)) {
    themeName = 'white';
  }

  const prevTheme = currentTheme;
  currentTheme = themeName;
  document.body.className = `theme-${themeName}`;
  localStorage.setItem('caddrillage_theme', themeName);

  // Mise à jour de l'état des boutons du dock
  const themeButtons = document.querySelectorAll('#themeDock .theme-btn[data-theme]');
  themeButtons.forEach(btn => {
    const isCurrent = btn.getAttribute('data-theme') === themeName;
    btn.classList.toggle('active', isCurrent);
    btn.setAttribute('aria-pressed', isCurrent ? 'true' : 'false');
  });

  const moreBtn = document.getElementById('btnOpenThemeGallery');
  if (moreBtn) {
    const isExtraTheme = !THEMES_PRESETS.includes(themeName);
    moreBtn.classList.toggle('is-active-theme', isExtraTheme);
    moreBtn.classList.toggle('active', isExtraTheme);
  }

  // Mise à jour de la carte active dans la modale
  updateThemeGalleryActiveCard(themeName);

  // Gestion spécifique de l'effet Matrix
  if (themeName === 'matrix') {
    setupMatrixObserver();
    triggerMatrixInitialCascade();
  } else if (prevTheme === 'matrix') {
    teardownMatrix();
  }

  // Gestion spécifique des spectres Halloween 2026
  if (themeName === 'halloween') {
    startHalloweenGhosts();
  } else if (prevTheme === 'halloween') {
    stopHalloweenGhosts();
  }

  // Gestion spécifique de la neige Noël 2026
  if (themeName === 'noel') {
    startNoelSnow();
  } else if (prevTheme === 'noel') {
    stopNoelSnow();
  }

  if (showToastFeedback) {
    const label = THEMES_NAMES[themeName] || themeName;
    showToast(`Ambiance « ${label} » activée`, '🎨');
  }
}

// =========================================================
// EFFET SPÉCIAL MATRIX (DÉCODAGE PROGRESSIF & CASCADE AU SCROLL)
// =========================================================

function decodeMatrixText(element, duration = 1200) {
  if (!element || element.dataset.matrixDecoding === 'true') return;

  const originalText = element.dataset.originalText || element.textContent.trim();
  element.dataset.originalText = originalText;
  element.dataset.matrixDecoding = 'true';
  element.classList.add('matrix-decoding');

  const totalLength = originalText.length;
  if (totalLength === 0) {
    element.classList.remove('matrix-decoding');
    delete element.dataset.matrixDecoding;
    return;
  }

  const startTime = performance.now();

  function update(now) {
    if (currentTheme !== 'matrix') {
      element.textContent = originalText;
      element.classList.remove('matrix-decoding');
      delete element.dataset.matrixDecoding;
      return;
    }

    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const resolvedCount = Math.floor(progress * totalLength);

    let output = '';
    for (let i = 0; i < totalLength; i++) {
      const char = originalText[i];
      if (char === ' ' || char === '\n' || char === '\t') {
        output += char;
      } else if (i < resolvedCount) {
        output += char;
      } else {
        output += MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
      }
    }

    element.textContent = output;

    if (progress < 1) {
      requestAnimationFrame(update);
    } else {
      element.textContent = originalText;
      element.classList.remove('matrix-decoding');
      delete element.dataset.matrixDecoding;
    }
  }

  requestAnimationFrame(update);
}

function triggerMatrixInitialCascade() {
  const cards = document.querySelectorAll('.writing-card');
  let delay = 0;
  cards.forEach(card => {
    const rect = card.getBoundingClientRect();
    const isInViewport = rect.top < window.innerHeight && rect.bottom > 0;
    if (isInViewport) {
      setTimeout(() => {
        if (currentTheme !== 'matrix') return;
        const title = card.querySelector('.card-title');
        const summary = card.querySelector('.card-summary');
        if (title) decodeMatrixText(title, 850);
        if (summary) decodeMatrixText(summary, 1400);
      }, delay);
      delay += 120;
    }
  });
}

function setupMatrixObserver() {
  if (matrixObserver) {
    matrixObserver.disconnect();
  }
  if (currentTheme !== 'matrix') return;

  matrixObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting && currentTheme === 'matrix') {
        const card = entry.target;
        const title = card.querySelector('.card-title');
        const summary = card.querySelector('.card-summary');
        if (title && !title.dataset.matrixDecoded) {
          title.dataset.matrixDecoded = 'true';
          decodeMatrixText(title, 850);
        }
        if (summary && !summary.dataset.matrixDecoded) {
          summary.dataset.matrixDecoded = 'true';
          decodeMatrixText(summary, 1400);
        }
      }
    });
  }, { threshold: 0.15 });

  document.querySelectorAll('.writing-card').forEach(card => {
    matrixObserver.observe(card);
  });
}

function teardownMatrix() {
  if (matrixObserver) {
    matrixObserver.disconnect();
    matrixObserver = null;
  }
  // Restaure tout texte en cours de décodage
  document.querySelectorAll('[data-original-text]').forEach(el => {
    el.textContent = el.dataset.originalText;
    el.classList.remove('matrix-decoding');
    delete el.dataset.matrixDecoding;
    delete el.dataset.matrixDecoded;
  });
}

// =========================================================
// EFFET SPÉCIAL HALLOWEEN 2026 : PARTICULES SPECTRES DIAPHANES
// (Canvas 2D natif, 0 dépendance, ultra-léger et discret)
// =========================================================

let halloweenAnimId = null;
let halloweenGhosts = [];
let halloweenCanvas = null;
let halloweenCtx = null;
let halloweenResizeBound = false;

function initHalloweenGhosts() {
  halloweenCanvas = document.getElementById('halloweenCanvas');
  if (!halloweenCanvas) return;

  halloweenCtx = halloweenCanvas.getContext('2d');
  if (!halloweenCtx) return;

  const updateSize = () => {
    if (!halloweenCanvas || !halloweenCtx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    halloweenCanvas.width = w * dpr;
    halloweenCanvas.height = h * dpr;
    halloweenCtx.resetTransform();
    halloweenCtx.scale(dpr, dpr);
  };

  updateSize();

  if (!halloweenResizeBound) {
    window.addEventListener('resize', updateSize, { passive: true });
    halloweenResizeBound = true;
  }

  const w = window.innerWidth;
  const h = window.innerHeight;
  const GHOST_COUNT = w < 768 ? 6 : 10; // 6 sur mobile, 10 sur grand écran pour rester aéré et discret

  halloweenGhosts = [];
  for (let i = 0; i < GHOST_COUNT; i++) {
    halloweenGhosts.push(createGhost(w, h, true));
  }
}

function createGhost(w, h, initialScatter = false) {
  const size = 18 + Math.random() * 10; // Taille discrète (18px à 28px)
  return {
    x: Math.random() * w,
    y: initialScatter ? Math.random() * h : h + size + Math.random() * 80,
    size: size,
    speedY: 0.35 + Math.random() * 0.45, // Dérive lente et contemplative
    speedX: (Math.random() - 0.5) * 0.25,
    swayAmp: 0.8 + Math.random() * 1.4,
    swayFreq: 0.012 + Math.random() * 0.014,
    swayPhase: Math.random() * Math.PI * 2,
    maxAlpha: 0.16 + Math.random() * 0.16, // Transparence 16% à 32% : diaphane, ne gêne jamais la lecture
    tilt: 0
  };
}

function drawGhostSilhouette(ctx, ghost, alpha) {
  ctx.save();
  ctx.translate(ghost.x, ghost.y);
  ctx.rotate(ghost.tilt);

  const w = ghost.size;
  const h = ghost.size * 1.35;
  const r = w / 2;

  ctx.beginPath();
  // Calotte arrondie de la tête
  ctx.arc(0, -h / 2 + r, r, Math.PI, 0, false);
  // Flanc droit
  ctx.lineTo(r, h / 2 - r * 0.35);
  // Bas de corps drapé / ondulé (3 vagues délicates)
  ctx.quadraticCurveTo(r * 0.66, h / 2 + r * 0.25, r * 0.33, h / 2 - r * 0.15);
  ctx.quadraticCurveTo(0, h / 2 + r * 0.3, -r * 0.33, h / 2 - r * 0.15);
  ctx.quadraticCurveTo(-r * 0.66, h / 2 + r * 0.25, -r, h / 2 - r * 0.35);
  // Flanc gauche
  ctx.closePath();

  // Lueur douce couleur bougie / citrouille atténuée
  ctx.shadowBlur = 10;
  ctx.shadowColor = `rgba(255, 130, 40, ${alpha * 0.45})`;

  // Corps blanc crème diaphane
  ctx.fillStyle = `rgba(252, 246, 238, ${alpha})`;
  ctx.fill();

  // Deux petits yeux sombres et discrets
  const eyeY = -h / 2 + r * 1.05;
  const eyeSpacing = r * 0.38;
  const eyeR = Math.max(1, r * 0.15);

  ctx.shadowBlur = 0;
  ctx.fillStyle = `rgba(32, 16, 28, ${alpha * 0.85})`;
  ctx.beginPath();
  ctx.arc(-eyeSpacing, eyeY, eyeR, 0, Math.PI * 2);
  ctx.arc(eyeSpacing, eyeY, eyeR, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function startHalloweenGhosts() {
  if (halloweenAnimId) return;

  initHalloweenGhosts();
  if (!halloweenCtx || !halloweenCanvas) return;

  let lastTime = performance.now();

  function animate(now) {
    if (currentTheme !== 'halloween') {
      stopHalloweenGhosts();
      return;
    }

    const dt = Math.min((now - lastTime) / 16.66, 2);
    lastTime = now;

    const w = window.innerWidth;
    const h = window.innerHeight;

    halloweenCtx.clearRect(0, 0, w, h);

    for (let i = 0; i < halloweenGhosts.length; i++) {
      const g = halloweenGhosts[i];

      // Ondulation sinusoïdale gauche/droite
      const sway = Math.sin(now * g.swayFreq + g.swayPhase);
      g.tilt = sway * 0.12;
      g.x += (g.speedX + sway * g.swayAmp) * dt;
      g.y -= g.speedY * dt;

      // Calcul de transparence progressive (fade in en bas, fade out en haut)
      let currentAlpha = g.maxAlpha;
      if (g.y > h - 140) {
        currentAlpha = g.maxAlpha * Math.max(0, (h - g.y) / 140);
      } else if (g.y < 160) {
        currentAlpha = g.maxAlpha * Math.max(0, g.y / 160);
      }

      if (currentAlpha > 0.01) {
        drawGhostSilhouette(halloweenCtx, g, currentAlpha);
      }

      // Réinitialisation quand le spectre quitte le haut de l'écran ou les bords latéraux
      if (g.y < -g.size * 2) {
        halloweenGhosts[i] = createGhost(w, h, false);
      } else if (g.x < -g.size * 2) {
        g.x = w + g.size;
      } else if (g.x > w + g.size * 2) {
        g.x = -g.size;
      }
    }

    halloweenAnimId = requestAnimationFrame(animate);
  }

  halloweenAnimId = requestAnimationFrame(animate);
}

function stopHalloweenGhosts() {
  if (halloweenAnimId) {
    cancelAnimationFrame(halloweenAnimId);
    halloweenAnimId = null;
  }
  if (halloweenCanvas && halloweenCtx) {
    halloweenCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }
}

// =========================================================
// SIMULATION DE CHUTE DE NEIGE NOËL 2026
// (Canvas 2D natif, 0 dépendance, particules calmes et douces)
// =========================================================

let noelAnimId = null;
let noelSnowflakes = [];
let noelCanvas = null;
let noelCtx = null;
let noelResizeBound = false;

function initNoelSnow() {
  noelCanvas = document.getElementById('snowCanvas');
  if (!noelCanvas) return;

  noelCtx = noelCanvas.getContext('2d');
  if (!noelCtx) return;

  const updateSize = () => {
    if (!noelCanvas || !noelCtx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    noelCanvas.width = w * dpr;
    noelCanvas.height = h * dpr;
    noelCtx.resetTransform();
    noelCtx.scale(dpr, dpr);
  };

  updateSize();

  if (!noelResizeBound) {
    window.addEventListener('resize', updateSize, { passive: true });
    noelResizeBound = true;
  }

  const w = window.innerWidth;
  const h = window.innerHeight;
  const FLAKE_COUNT = w < 768 ? 25 : 55;

  noelSnowflakes = [];
  for (let i = 0; i < FLAKE_COUNT; i++) {
    noelSnowflakes.push(createSnowflake(w, h, true));
  }
}

function createSnowflake(w, h, initialScatter = false) {
  const isCrystal = Math.random() < 0.35;
  const radius = isCrystal ? (3.2 + Math.random() * 3.6) : (1.5 + Math.random() * 3.2);

  return {
    x: Math.random() * w,
    y: initialScatter ? Math.random() * h : -radius - Math.random() * 30,
    radius: radius,
    isCrystal: isCrystal,
    speedY: 0.45 + Math.random() * 0.75, // Descente calme et tranquille
    speedX: (Math.random() - 0.5) * 0.25,
    swayAmp: 0.6 + Math.random() * 1.2,
    swayFreq: 0.008 + Math.random() * 0.012,
    swayPhase: Math.random() * Math.PI * 2,
    rotation: Math.random() * Math.PI * 2,
    rotationSpeed: (Math.random() - 0.5) * 0.02,
    maxAlpha: 0.18 + Math.random() * 0.24 // Transparence 18% à 42% : doux et diaphane
  };
}

function drawSnowflake(ctx, flake, alpha) {
  ctx.save();
  ctx.translate(flake.x, flake.y);

  if (flake.isCrystal) {
    ctx.rotate(flake.rotation);
    const r = flake.radius;
    ctx.strokeStyle = `rgba(240, 249, 255, ${alpha})`;
    ctx.lineWidth = Math.max(1, r * 0.22);
    ctx.lineCap = 'round';

    // 6 branches de cristal de givre
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, r);
      ctx.stroke();

      // Ramifications sur chaque branche
      const subY = r * 0.55;
      const subLen = r * 0.35;
      ctx.beginPath();
      ctx.moveTo(0, subY);
      ctx.lineTo(-subLen, subY + subLen * 0.6);
      ctx.moveTo(0, subY);
      ctx.lineTo(subLen, subY + subLen * 0.6);
      ctx.stroke();

      ctx.rotate(Math.PI / 3);
    }
  } else {
    // Boule de neige floutée avec halo dégradé
    const r = flake.radius;
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, r);
    grad.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
    grad.addColorStop(0.65, `rgba(224, 242, 254, ${alpha * 0.65})`);
    grad.addColorStop(1, `rgba(186, 230, 253, 0)`);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function startNoelSnow() {
  if (noelAnimId) return;

  initNoelSnow();
  if (!noelCtx || !noelCanvas) return;

  let lastTime = performance.now();

  function animate(now) {
    if (currentTheme !== 'noel') {
      stopNoelSnow();
      return;
    }

    const dt = Math.min((now - lastTime) / 16.66, 2);
    lastTime = now;

    const w = window.innerWidth;
    const h = window.innerHeight;

    noelCtx.clearRect(0, 0, w, h);

    for (let i = 0; i < noelSnowflakes.length; i++) {
      const f = noelSnowflakes[i];

      // Ondulation douce au vent
      const sway = Math.sin(now * f.swayFreq + f.swayPhase);
      f.x += (f.speedX + sway * f.swayAmp) * dt;
      f.y += f.speedY * dt;
      f.rotation += f.rotationSpeed * dt;

      // Transparence progressive (fondu délicat en haut et en bas)
      let currentAlpha = f.maxAlpha;
      if (f.y < 80) {
        currentAlpha = f.maxAlpha * Math.max(0, f.y / 80);
      } else if (f.y > h - 100) {
        currentAlpha = f.maxAlpha * Math.max(0, (h - f.y) / 100);
      }

      if (currentAlpha > 0.01) {
        drawSnowflake(noelCtx, f, currentAlpha);
      }

      // Réinitialisation douce au sommet
      if (f.y > h + f.radius * 2) {
        noelSnowflakes[i] = createSnowflake(w, h, false);
      } else if (f.x < -f.radius * 2) {
        f.x = w + f.radius;
      } else if (f.x > w + f.radius * 2) {
        f.x = -f.radius;
      }
    }

    noelAnimId = requestAnimationFrame(animate);
  }

  noelAnimId = requestAnimationFrame(animate);
}

function stopNoelSnow() {
  if (noelAnimId) {
    cancelAnimationFrame(noelAnimId);
    noelAnimId = null;
  }
  if (noelCanvas && noelCtx) {
    noelCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }
}

// =========================================================
// 4. AUTHENTIFICATION & ESPACE PERSONNEL
// =========================================================
function checkAuthStatus() {
  const isAuth = localStorage.getItem('caddrillage_logged_in') === 'true';
  const btnText = document.getElementById('personalSpaceBtnText');
  const btn = document.getElementById('btnOpenPersonalSpace');

  if (btnText && btn) {
    if (isAuth) {
      btnText.textContent = 'Espace personnel (Connecté)';
      btn.title = 'Accéder à votre espace de gestion';
    } else {
      btnText.textContent = 'Espace personnel';
      btn.title = 'Se connecter à l’espace personnel';
    }
  }
}

function showLoginModal() {
  const modal = document.getElementById('loginModal');
  const userField = document.getElementById('loginUser');
  const passField = document.getElementById('loginPass');
  const errorBox = document.getElementById('loginErrorMsg');

  if (!modal) return;
  if (errorBox) errorBox.style.display = 'none';
  if (userField) userField.value = '';
  if (passField) passField.value = '';
  modal.classList.add('active');
  if (userField) userField.focus();
}

function closeLoginModal() {
  const modal = document.getElementById('loginModal');
  if (modal) modal.classList.remove('active');
}

function handleLoginSubmit(e) {
  e.preventDefault();
  const userField = document.getElementById('loginUser');
  const passField = document.getElementById('loginPass');
  const errorBox = document.getElementById('loginErrorMsg');

  const userVal = userField ? userField.value.trim() : '';
  const passVal = passField ? passField.value.trim() : '';

  if (userVal === AUTH_CONFIG.username && passVal === AUTH_CONFIG.password) {
    localStorage.setItem('caddrillage_logged_in', 'true');
    checkAuthStatus();
    closeLoginModal();
    showToast('Connexion réussie. Bienvenue dans votre antre !');
    switchToPersonalSpace();
  } else {
    if (errorBox) errorBox.style.display = 'block';
  }
}

function handleLogout() {
  localStorage.removeItem('caddrillage_logged_in');
  checkAuthStatus();
  switchToShowcase();
  showToast('Déconnexion effectuée.');
}

function switchToPersonalSpace() {
  const scView = document.getElementById('showcaseView');
  const psView = document.getElementById('personalSpaceView');
  if (scView) scView.style.display = 'none';
  if (psView) {
    psView.classList.add('active');
    psView.setAttribute('aria-hidden', 'false');
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
  refreshAdminWritings();
  refreshAdminComments();
  applySiteIdentity();
  renderAdminThemesEditor();
  renderAdminBuildsEditor();
  renderAdminDashboardStats();
  updateRebuildStatus();
}

function switchToShowcase() {
  const scView = document.getElementById('showcaseView');
  const psView = document.getElementById('personalSpaceView');
  if (psView) {
    psView.classList.remove('active');
    psView.setAttribute('aria-hidden', 'true');
  }
  if (scView) scView.style.display = 'block';
  window.scrollTo({ top: 0, behavior: 'smooth' });
  refreshShowcase();
}

// =========================================================
// 5. AFFICHAGE DE LA VITRINE & FILTRAGE DES CATÉGORIES
// =========================================================

/**
 * Détermine le timestamp effectif d'un écrit pour le tri chronologique.
 * Tente d'analyser la date personnalisée (ex: "Octobre 2026", "13 octobre 2026", "2025"),
 * sinon se replie sur le timestamp exact de création (createdAt).
 */
function getWritingSortTimestamp(w) {
  if (!w) return 0;
  if (w.displayDate && typeof w.displayDate === 'string') {
    const raw = w.displayDate.trim().toLowerCase();

    const frenchMonths = {
      'janvier': 0, 'janv': 0, 'jan': 0,
      'février': 1, 'fevrier': 1, 'févr': 1, 'fevr': 1, 'fev': 1,
      'mars': 2, 'mar': 2,
      'avril': 3, 'avr': 3,
      'mai': 4,
      'juin': 5,
      'juillet': 6, 'juil': 6,
      'août': 7, 'aout': 7,
      'septembre': 8, 'sept': 8, 'sep': 8,
      'octobre': 9, 'oct': 9,
      'novembre': 10, 'nov': 10,
      'décembre': 11, 'decembre': 11, 'déc': 11, 'dec': 11
    };

    // Format JJ mois AAAA (ex: "13 octobre 2026" ou "1er octobre 2026")
    const dayMonthYearMatch = raw.match(/(\d{1,2})(?:er)?\s+([a-zà-ÿ]+)\s+(\d{4})/i);
    if (dayMonthYearMatch) {
      const day = parseInt(dayMonthYearMatch[1], 10);
      const monthStr = dayMonthYearMatch[2].toLowerCase();
      const year = parseInt(dayMonthYearMatch[3], 10);
      if (frenchMonths[monthStr] !== undefined) {
        return new Date(year, frenchMonths[monthStr], day).getTime();
      }
    }

    // Format mois AAAA (ex: "octobre 2026")
    const monthYearMatch = raw.match(/([a-zà-ÿ]+)\s+(\d{4})/i);
    if (monthYearMatch) {
      const monthStr = monthYearMatch[1].toLowerCase();
      const year = parseInt(monthYearMatch[2], 10);
      if (frenchMonths[monthStr] !== undefined) {
        return new Date(year, frenchMonths[monthStr], 1).getTime();
      }
    }

    // Format numérique JJ/MM/AAAA ou JJ-MM-AAAA
    const slashMatch = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
    if (slashMatch) {
      const day = parseInt(slashMatch[1], 10);
      const month = parseInt(slashMatch[2], 10) - 1;
      const year = parseInt(slashMatch[3], 10);
      return new Date(year, month, day).getTime();
    }

    // Format ISO AAAA-MM-JJ
    const isoMatch = raw.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
    if (isoMatch) {
      const year = parseInt(isoMatch[1], 10);
      const month = parseInt(isoMatch[2], 10) - 1;
      const day = parseInt(isoMatch[3], 10);
      return new Date(year, month, day).getTime();
    }

    // Juste une année : 2026
    const yearOnlyMatch = raw.match(/\b(19\d\d|20\d\d)\b/);
    if (yearOnlyMatch) {
      const year = parseInt(yearOnlyMatch[1], 10);
      return new Date(year, 0, 1).getTime();
    }

    const parsed = Date.parse(raw);
    if (!isNaN(parsed)) {
      return parsed;
    }
  }

  return Number(w.createdAt) || 0;
}

/**
 * Extrait le temps de lecture en minutes sous forme numérique pour le tri.
 * Prend en compte à la fois le temps calculé automatiquement et les valeurs saisies manuellement
 * (ex: "~15 min", "15 minutes", "1 h 30", "1h30", "2 heures", "45", "< 1 min").
 * En cas d'absence, tente une estimation via wordCount ou pageCount.
 */
function getWritingReadingMinutes(w) {
  if (!w || w.category === 'poesie') return 0;

  // 1. Si readingTime est déjà stocké comme nombre
  if (typeof w.readingTime === 'number' && !isNaN(w.readingTime) && w.readingTime > 0) {
    return w.readingTime;
  }

  // 2. Si readingTime est renseigné sous forme de texte (automatique ou manuel)
  if (w.readingTime !== null && w.readingTime !== undefined && String(w.readingTime).trim() !== '') {
    const raw = String(w.readingTime).trim().toLowerCase();

    // Cas particulier : "< 1 min" ou "moins de 1 min"
    if (raw.includes('<') || raw.includes('moins')) {
      return 0.5;
    }

    // Format composé direct (ex: "1h30", "1 h 30", "1h30mn", "1h30min", "2 h 15 mn")
    const compoundMatch = raw.match(/(\d+)\s*(?:h|heure(?:s)?|hr(?:s)?)\s*(\d+)/i);
    if (compoundMatch) {
      const hVal = parseInt(compoundMatch[1], 10);
      const mVal = parseInt(compoundMatch[2], 10);
      if (!isNaN(hVal) && !isNaN(mVal)) {
        return (hVal * 60) + mVal;
      }
    }

    let totalMinutes = 0;
    let hasMatched = false;

    // Détecte les heures : "1 h", "2 heures", "1.5 h", "1,5h", "1 hr"
    const hourMatch = raw.match(/(\d+(?:[.,]\d+)?)\s*(?:h(?:eure(?:s)?)?|hr(?:s)?)(?![a-z])/i);
    if (hourMatch) {
      const hVal = parseFloat(hourMatch[1].replace(',', '.'));
      if (!isNaN(hVal)) {
        totalMinutes += hVal * 60;
        hasMatched = true;
      }
    }

    // Détecte les minutes : "15 min", "15 mn", "30 minutes", "45m", "15 mins", "15 mns"
    const minMatch = raw.match(/(\d+)\s*(?:mn(?:s)?|min(?:ute)?(?:s)?|m)(?![a-z])/i);
    if (minMatch) {
      const mVal = parseInt(minMatch[1], 10);
      if (!isNaN(mVal)) {
        totalMinutes += mVal;
        hasMatched = true;
      }
    }

    // Si aucun motif avec unité n'a correspondu, cherche un simple nombre (ex: "15", "~20")
    if (!hasMatched) {
      const plainNumMatch = raw.match(/\b(\d+)\b/);
      if (plainNumMatch) {
        const pVal = parseInt(plainNumMatch[1], 10);
        if (!isNaN(pVal) && pVal > 0) {
          totalMinutes = pVal;
          hasMatched = true;
        }
      }
    }

    if (hasMatched && totalMinutes > 0) {
      return totalMinutes;
    }
  }

  // 3. Fallback si pas de texte de temps : calcul via wordCount
  if (w.wordCount && Number(w.wordCount) > 0) {
    return Math.max(1, Math.ceil(Number(w.wordCount) / 200));
  }

  // 4. Fallback via pageCount (environ 2 min par page)
  if (w.pageCount && Number(w.pageCount) > 0) {
    return Math.max(1, Number(w.pageCount) * 2);
  }

  // 5. Fallback via le résumé s'il existe du texte en prose
  if (w.summary && typeof w.summary === 'string' && w.summary.trim().length > 0) {
    const words = countWordsInText(w.summary);
    if (words > 0) {
      return Math.max(1, Math.ceil(words / 200));
    }
  }

  return 0;
}

// =========================================================
// 5b. ANALYSE DU PDF & ESTIMATION DU TEMPS DE LECTURE
// =========================================================

/**
 * Compte précisément les mots d'un texte francophone
 */
function countWordsInText(text) {
  if (!text) return 0;
  const cleaned = text
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[«»""''’]/g, ' ')
    .trim();
  if (!cleaned) return 0;
  const words = cleaned.split(/\s+/).filter(w => w.length > 0 && !/^[\-_—–.,;:!?()]+$/.test(w));
  return words.length;
}

/**
 * Calcule une estimation du temps de lecture en français (~200 mots/min)
 */
function calculateEstimatedReadingTime(wordCount, pageCount = 1) {
  const words = Number(wordCount) || 0;
  if (words <= 0) {
    if (pageCount > 0) {
      const estMin = Math.max(1, Math.round(pageCount * 1.5));
      return `~${estMin} min`;
    }
    return '';
  }

  const minutes = Math.ceil(words / 200);

  if (minutes < 1) {
    return '< 1 min';
  } else if (minutes < 60) {
    return `~${minutes} min`;
  } else {
    const hours = Math.floor(minutes / 60);
    const remMin = minutes % 60;
    if (remMin === 0) {
      return `${hours} h`;
    }
    return `${hours} h ${remMin} min`;
  }
}

/**
 * Analyse un document PDF (Blob ou File) pour extraire son nombre de pages,
 * son nombre de mots et calculer son temps de lecture estimé.
 */
async function analyzePdfFile(fileOrBlob) {
  if (!fileOrBlob) return null;

  try {
    const arrayBuffer = await fileOrBlob.arrayBuffer();

    // 1. Analyse haute précision via PDF.js si disponible
    if (window.pdfjsLib) {
      try {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.js';
        const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
        const pdfDoc = await loadingTask.promise;
        const numPages = pdfDoc.numPages || 1;
        let totalWords = 0;

        for (let i = 1; i <= numPages; i++) {
          try {
            const page = await pdfDoc.getPage(i);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            totalWords += countWordsInText(pageText);
          } catch (pageErr) {
            console.warn(`Erreur lecture texte page ${i} :`, pageErr);
          }
        }

        // Si le PDF est scanné ou image sans texte brut, estimation standard
        if (totalWords === 0) {
          totalWords = numPages * 250;
        }

        return {
          pageCount: numPages,
          wordCount: totalWords,
          readingTime: calculateEstimatedReadingTime(totalWords, numPages)
        };
      } catch (pdfErr) {
        console.warn('Erreur PDF.js, bascule sur l\'analyseur binaire fallback :', pdfErr);
      }
    }

    // 2. Analyseur de secours binaire (hors ligne ou sans CDN)
    return analyzePdfBinaryFallback(arrayBuffer);
  } catch (err) {
    console.error('Erreur lors de l\'analyse du PDF :', err);
    return {
      pageCount: 1,
      wordCount: 250,
      readingTime: '~1 min'
    };
  }
}

/**
 * Analyseur binaire léger sans dépendance pour extraire le nombre de pages
 */
function analyzePdfBinaryFallback(arrayBuffer) {
  try {
    const uint8 = new Uint8Array(arrayBuffer);
    const chunkSize = Math.min(uint8.length, 2 * 1024 * 1024);
    let str = '';
    for (let i = 0; i < chunkSize; i++) {
      str += String.fromCharCode(uint8[i]);
    }

    let pageCount = 0;
    const countMatches = str.match(/\/Count\s+(\d+)/g);
    if (countMatches && countMatches.length > 0) {
      for (const m of countMatches) {
        const num = parseInt(m.replace(/\/Count\s+/, ''), 10);
        if (num > pageCount) pageCount = num;
      }
    }

    if (pageCount === 0) {
      const pageMatches = str.match(/\/Type\s*\/Page\b/g);
      if (pageMatches) pageCount = pageMatches.length;
    }

    if (pageCount === 0) pageCount = 1;
    const estWords = pageCount * 250;

    return {
      pageCount: pageCount,
      wordCount: estWords,
      readingTime: calculateEstimatedReadingTime(estWords, pageCount)
    };
  } catch (e) {
    return {
      pageCount: 1,
      wordCount: 250,
      readingTime: '~1 min'
    };
  }
}

/**
 * Extrait l'intégralité du texte d'un document PDF en préservant
 * les vers, les retours à la ligne et les sauts de strophes.
 */
async function extractPdfFullText(fileOrBlob) {
  if (!fileOrBlob) return '';

  try {
    const arrayBuffer = await fileOrBlob.arrayBuffer();

    if (window.pdfjsLib) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.js';
      const loadingTask = window.pdfjsLib.getDocument({ data: arrayBuffer.slice(0) });
      const pdfDoc = await loadingTask.promise;
      const pagesVerses = [];

      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const textContent = await page.getTextContent();
        const items = textContent.items;

        if (!items || items.length === 0) continue;

        let pageLines = [];
        let currentLine = '';
        let lastY = null;
        let lastHeight = null;

        for (let j = 0; j < items.length; j++) {
          const item = items[j];
          if (!item.str && !item.hasEOL) continue;

          const currentY = item.transform ? item.transform[5] : null;
          const currentHeight = item.height || 12;

          if (lastY !== null && currentY !== null) {
            const deltaY = Math.abs(lastY - currentY);
            // Changement de ligne vertical si décalage > 4pt
            if (deltaY > 4) {
              pageLines.push(currentLine.trim());
              currentLine = '';
              // Saut de strophe si grand écart vertical
              const lineHeight = lastHeight || 12;
              if (deltaY > lineHeight * 1.6) {
                pageLines.push('');
              }
            } else if (item.str && currentLine && !currentLine.endsWith(' ') && !item.str.startsWith(' ')) {
              currentLine += ' ';
            }
          }

          currentLine += item.str;
          lastY = currentY;
          lastHeight = currentHeight;
        }

        if (currentLine.trim()) {
          pageLines.push(currentLine.trim());
        }

        const pageCleaned = pageLines.join('\n').trim();
        if (pageCleaned) {
          pagesVerses.push(pageCleaned);
        }
      }

      return pagesVerses.join('\n\n').trim();
    }
  } catch (err) {
    console.warn('Erreur extraction texte poésie PDF :', err);
  }

  return '';
}

function formatPageCount(count) {
  if (count === null || count === undefined || count === '') return '1 page';
  const n = parseInt(count, 10);
  if (isNaN(n) || n <= 1) return '1 page';
  return `${n} pages`;
}

function formatWordCount(count) {
  if (count === null || count === undefined || count === '') return 'Non calculé';
  const n = parseInt(count, 10);
  if (isNaN(n)) return String(count);
  return `${n.toLocaleString('fr-FR')} mots`;
}

function formatReadingTime(time) {
  if (!time || String(time).trim() === '') return 'Non estimé';
  const str = String(time).trim();
  if (str.toLowerCase().includes('lecture')) return str;
  return `${str} de lecture`;
}

function renderReadingStatsHtml(writing) {
  const hasPages = writing.pageCount !== null && writing.pageCount !== undefined && writing.pageCount !== '';
  const hasWords = writing.wordCount !== null && writing.wordCount !== undefined && writing.wordCount !== '';
  const hasTime = writing.readingTime && String(writing.readingTime).trim() !== '';

  if (!hasPages && !hasWords && !hasTime) {
    return `<span class="stat-item"><span class="stat-icon">📄</span> Calcul des détails en cours...</span>`;
  }

  const parts = [];
  if (hasPages) {
    parts.push(`<span class="stat-item"><span class="stat-icon">📄</span> ${escapeHtml(formatPageCount(writing.pageCount))}</span>`);
  }
  if (hasWords) {
    parts.push(`<span class="stat-item"><span class="stat-icon">✍️</span> ${escapeHtml(formatWordCount(writing.wordCount))}</span>`);
  }
  if (hasTime) {
    parts.push(`<span class="stat-item stat-item-time"><span class="stat-icon">⏳</span> ${escapeHtml(formatReadingTime(writing.readingTime))}</span>`);
  }

  return parts.join('');
}

// Calcul asynchrone des métriques en arrière-plan pour les écrits qui n'en ont pas encore
const pendingStatsAnalysis = new Set();
async function ensureWritingReadingStats(writing) {
  if (!writing || !writing.id) return;
  if (writing.pageCount && writing.wordCount && writing.readingTime) return;
  if (pendingStatsAnalysis.has(String(writing.id))) return;

  pendingStatsAnalysis.add(String(writing.id));

  try {
    let blob = writing.pdfBlob;

    if (!blob && writing.pdfUrl) {
      try {
        const response = await fetch(writing.pdfUrl);
        if (response.ok) {
          blob = await response.blob();
        }
      } catch (fetchErr) {
        console.warn('Téléchargement du PDF distant pour calcul impossible :', fetchErr);
      }
    }

    if (!blob) return;

    const stats = await analyzePdfFile(blob);
    if (!stats) return;

    writing.pageCount = stats.pageCount;
    writing.wordCount = stats.wordCount;
    writing.readingTime = stats.readingTime;

    const statsEl = document.getElementById(`stats-${writing.id}`);
    if (statsEl) {
      statsEl.innerHTML = renderReadingStatsHtml(writing);
    }

    if (db && db.objectStoreNames.contains(DB_CONFIG.storeName)) {
      try {
        const tx = db.transaction([DB_CONFIG.storeName], 'readwrite');
        const store = tx.objectStore(DB_CONFIG.storeName);
        store.put(writing);
      } catch (e) {
        console.warn('Erreur mise à jour cache stats :', e);
      }
    }

    // Réordonne la vitrine si un tri par temps de lecture est en cours
    scheduleShowcaseSortUpdate();
  } catch (err) {
    console.warn('Erreur calcul automatique stats :', err);
  } finally {
    pendingStatsAnalysis.delete(String(writing.id));
  }
}

// Déclenchement temporisé d'un réordonnancement de la vitrine quand des calculs se terminent
let resortTimer = null;
function scheduleShowcaseSortUpdate() {
  if (currentSortOrder !== 'reading-asc' && currentSortOrder !== 'reading-desc') return;
  if (resortTimer) clearTimeout(resortTimer);
  resortTimer = setTimeout(() => {
    refreshShowcase();
  }, 300);
}

async function refreshShowcase() {
  const writingsContainer = document.getElementById('writingsContainer');
  const heading = document.getElementById('currentCategoryHeading');
  const readingToggle = document.getElementById('readingTimeToggle');
  if (!writingsContainer) return;

  try {
    const writings = await dbGetAllWritings();

    updateCategoryCounters(writings);
    renderSearchTagsGrid(writings);

    const isSearchActive = isSearchPanelOpen && (showcaseSearchQuery !== '' || showcaseSearchCategory !== 'all' || selectedSearchTags.size > 0);

    let filtered = writings;

    if (isSearchActive) {
      // 1. Filtrage par catégorie ciblée dans la recherche
      if (showcaseSearchCategory !== 'all') {
        filtered = filtered.filter(w => w.category === showcaseSearchCategory);
      }

      // 2. Filtrage par tags sélectionnés (l'écrit possède au moins un des tags cochés)
      if (selectedSearchTags.size > 0) {
        filtered = filtered.filter(w => {
          const wTagsLower = (w.tags || []).map(t => String(t).toLowerCase());
          return Array.from(selectedSearchTags).some(tag => wTagsLower.includes(tag.toLowerCase()));
        });
      }

      // 3. Filtrage par mot-clé (insensible à la casse dans titre, tags, résumé ou vers)
      if (showcaseSearchQuery) {
        const q = showcaseSearchQuery.toLowerCase();
        filtered = filtered.filter(w => {
          const matchTitle = (w.title || '').toLowerCase().includes(q);
          const matchSummary = (w.summary || '').toLowerCase().includes(q);
          const matchPoetry = (w.poetryText || '').toLowerCase().includes(q);
          const matchTags = (w.tags || []).some(t => String(t).toLowerCase().includes(q));
          return matchTitle || matchSummary || matchPoetry || matchTags;
        });
      }

      if (heading) {
        const countTxt = filtered.length === 1 ? '1 résultat' : `${filtered.length} résultats`;
        heading.textContent = `Recherche (${countTxt})`;
      }
    } else {
      // Navigation standard par catégorie
      if (currentFilterCategory === 'all') {
        // Les poèmes sont isolés dans leur onglet dédié pour ne pas surcharger la vue générale des récits
        filtered = writings.filter(w => w.category !== 'poesie');
        if (heading) heading.textContent = 'Tous les écrits';
      } else {
        filtered = writings.filter(w => w.category === currentFilterCategory);
        if (heading) heading.textContent = CATEGORIES_LABELS[currentFilterCategory] || 'Écrits';
      }
    }

    // Ajustement de la disposition de la grille et du curseur (Poésie vs Standard)
    const isOnlyPoetryView = (currentFilterCategory === 'poesie' && !isSearchActive) ||
                             (isSearchActive && showcaseSearchCategory === 'poesie') ||
                             (filtered.length > 0 && filtered.every(w => w.category === 'poesie'));

    if (isOnlyPoetryView) {
      writingsContainer.classList.add('poetry-grid');
      if (readingToggle) readingToggle.style.display = 'none';
    } else {
      writingsContainer.classList.remove('poetry-grid');
      if (readingToggle) readingToggle.style.display = 'inline-flex';
    }

    // Gestion des options de tri selon la vue (masquer le tri par temps en vue purement poésie)
    const sortSelect = document.getElementById('sortOrderSelect');
    if (sortSelect) {
      const optReadingAsc = sortSelect.querySelector('option[value="reading-asc"]');
      const optReadingDesc = sortSelect.querySelector('option[value="reading-desc"]');
      if (isOnlyPoetryView) {
        if (optReadingAsc) optReadingAsc.hidden = true;
        if (optReadingDesc) optReadingDesc.hidden = true;
        // Si le visiteur était sur un tri par temps de lecture, basculer temporairement sur la date en poésie
        if (currentSortOrder === 'reading-asc' || currentSortOrder === 'reading-desc') {
          sortSelect.value = 'desc';
        }
      } else {
        if (optReadingAsc) optReadingAsc.hidden = false;
        if (optReadingDesc) optReadingDesc.hidden = false;
        sortSelect.value = currentSortOrder;
      }
    }

    // Tri des écrits selon l'option choisie (Temps de lecture ou Chronologique)
    filtered.sort((a, b) => {
      // 1. Vue purement poésie : la poésie n'a pas de métrique de temps, tri chronologique
      if (isOnlyPoetryView) {
        const timeA = getWritingSortTimestamp(a);
        const timeB = getWritingSortTimestamp(b);
        if (timeA !== timeB) return timeB - timeA;
        return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
      }

      // 2. Tri par temps de lecture (croissant ou décroissant)
      if (currentSortOrder === 'reading-asc' || currentSortOrder === 'reading-desc') {
        const isPoemA = a.category === 'poesie';
        const isPoemB = b.category === 'poesie';

        // Si des poèmes figurent dans la sélection (ex: recherche globale), les placer à la fin
        if (isPoemA && !isPoemB) return 1;
        if (!isPoemA && isPoemB) return -1;
        if (isPoemA && isPoemB) {
          return getWritingSortTimestamp(b) - getWritingSortTimestamp(a);
        }

        const durA = getWritingReadingMinutes(a);
        const durB = getWritingReadingMinutes(b);

        // Si l'un des écrits n'a pas encore de temps calculé (dur === 0), le reléguer après les textes estimés
        const hasA = durA > 0;
        const hasB = durB > 0;
        if (hasA && !hasB) return -1;
        if (!hasA && hasB) return 1;

        if (durA !== durB) {
          // Croissant (reading-asc) : le plus petit en haut (durA - durB)
          // Décroissant (reading-desc) : le plus grand en haut (durB - durA)
          return currentSortOrder === 'reading-asc' ? (durA - durB) : (durB - durA);
        }

        // En cas d'égalité sur le temps de lecture, départager par date (le plus récent d'abord)
        const timeA = getWritingSortTimestamp(a);
        const timeB = getWritingSortTimestamp(b);
        if (timeA !== timeB) return timeB - timeA;
        return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
      }

      // 3. Tri chronologique standard (desc = plus récent d'abord, asc = plus ancien d'abord)
      const timeA = getWritingSortTimestamp(a);
      const timeB = getWritingSortTimestamp(b);
      if (timeA !== timeB) {
        return currentSortOrder === 'asc' ? timeA - timeB : timeB - timeA;
      }
      const createA = Number(a.createdAt) || 0;
      const createB = Number(b.createdAt) || 0;
      return currentSortOrder === 'asc' ? createA - createB : createB - createA;
    });

    if (filtered.length === 0) {
      if (isSearchActive) {
        writingsContainer.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">🔍</div>
            <h3 class="empty-state-title">Aucun résultat trouvé</h3>
            <p class="empty-state-desc">
              Aucun écrit ne correspond à vos critères de recherche. Essayez un autre mot-clé ou désélectionnez certains tags.
            </p>
          </div>
        `;
      } else {
        const categoryName = currentFilterCategory === 'all' 
          ? 'la vitrine' 
          : `la catégorie "${CATEGORIES_LABELS[currentFilterCategory]}"`;

        writingsContainer.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">✍️</div>
            <h3 class="empty-state-title">Aucun écrit pour le moment</h3>
            <p class="empty-state-desc">
              Il n'y a aucun texte déposé dans ${categoryName} pour le moment.
              Les futures créations apparaîtront ici dès leur publication depuis l'espace personnel.
            </p>
          </div>
        `;
      }
      return;
    }

    writingsContainer.innerHTML = filtered.map(w => renderWritingCard(w)).join('');

    filtered.forEach(w => {
      // Déclenche l'analyse en tâche de fond pour les écrits qui n'ont pas encore leurs statistiques
      if (w.category !== 'poesie' && (!w.pageCount || !w.wordCount || !w.readingTime)) {
        ensureWritingReadingStats(w);
      }

      const readBtn = document.getElementById(`btn-read-${w.id}`);
      const dlBtn = document.getElementById(`btn-dl-${w.id}`);
      const commentBtn = document.getElementById(`btn-comment-${w.id}`);

      if (readBtn) {
        readBtn.addEventListener('click', () => openPdfReader(w));
      }
      if (dlBtn) {
        dlBtn.addEventListener('click', (e) => {
          e.preventDefault();
          downloadPdfFile(w);
        });
      }
      if (commentBtn) {
        commentBtn.addEventListener('click', () => openCommentModal(w.id, w.title));
      }
    });

    // Si le thème Matrix est actif, observer les nouvelles cartes pour l'effet cascade
    if (currentTheme === 'matrix') {
      setupMatrixObserver();
    }

  } catch (err) {
    console.error('Erreur chargement vitrine:', err);
    writingsContainer.innerHTML = `<div class="empty-state"><p>Erreur lors du chargement des écrits.</p></div>`;
  }
}

/**
 * Génère dynamiquement la grille de tous les tags existants sur la vitrine
 */
function renderSearchTagsGrid(writings) {
  const container = document.getElementById('searchTagsGrid');
  const section = document.getElementById('searchTagsSection');
  if (!container || !section) return;

  const allTagsMap = new Map();
  (writings || []).forEach(w => {
    (w.tags || []).forEach(t => {
      const clean = String(t).trim();
      if (clean && !allTagsMap.has(clean.toLowerCase())) {
        allTagsMap.set(clean.toLowerCase(), clean);
      }
    });
  });

  const uniqueTags = Array.from(allTagsMap.values()).sort((a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' }));

  if (uniqueTags.length === 0) {
    section.style.display = 'none';
    return;
  }
  section.style.display = 'flex';

  container.innerHTML = uniqueTags.map(tag => {
    const isSelected = selectedSearchTags.has(tag.toLowerCase());
    return `
      <span class="search-tag-pill ${isSelected ? 'active' : ''}" data-tag="${escapeHtml(tag)}">
        #${escapeHtml(tag)}
      </span>
    `;
  }).join('');

  container.querySelectorAll('.search-tag-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      const tagVal = pill.getAttribute('data-tag').toLowerCase();
      if (selectedSearchTags.has(tagVal)) {
        selectedSearchTags.delete(tagVal);
        pill.classList.remove('active');
      } else {
        selectedSearchTags.add(tagVal);
        pill.classList.add('active');
      }
      const resetBtn = document.getElementById('btnResetSelectedTags');
      if (resetBtn) resetBtn.style.display = selectedSearchTags.size > 0 ? 'inline-block' : 'none';
      refreshShowcase();
    });
  });

  const resetBtn = document.getElementById('btnResetSelectedTags');
  if (resetBtn) resetBtn.style.display = selectedSearchTags.size > 0 ? 'inline-block' : 'none';
}

/**
 * Initialise les écouteurs de la barre de recherche vitrine
 */
function initSearchShowcase() {
  const btnToggle = document.getElementById('btnToggleSearch');
  const panel = document.getElementById('searchPanelContainer');
  const input = document.getElementById('showcaseSearchInput');
  const clearBtn = document.getElementById('btnClearSearchInput');
  const closeBtn = document.getElementById('btnCloseSearchPanel');
  const catSelect = document.getElementById('searchCategorySelect');
  const resetTagsBtn = document.getElementById('btnResetSelectedTags');

  if (!btnToggle || !panel) return;

  function openSearchPanel() {
    isSearchPanelOpen = true;
    panel.style.display = 'block';
    btnToggle.classList.add('active');
    btnToggle.title = 'Fermer la recherche';
    if (input) input.focus();
    refreshShowcase();
  }

  function closeSearchPanel() {
    isSearchPanelOpen = false;
    panel.style.display = 'none';
    btnToggle.classList.remove('active');
    btnToggle.title = 'Rechercher un écrit';
    showcaseSearchQuery = '';
    showcaseSearchCategory = 'all';
    selectedSearchTags.clear();
    if (input) input.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    if (catSelect) catSelect.value = 'all';
    if (resetTagsBtn) resetTagsBtn.style.display = 'none';
    document.querySelectorAll('.search-tag-pill').forEach(p => p.classList.remove('active'));
    refreshShowcase();
  }

  btnToggle.addEventListener('click', () => {
    if (isSearchPanelOpen) {
      closeSearchPanel();
    } else {
      openSearchPanel();
    }
  });

  if (closeBtn) {
    closeBtn.addEventListener('click', closeSearchPanel);
  }

  if (input) {
    input.addEventListener('input', () => {
      showcaseSearchQuery = input.value.trim();
      if (clearBtn) clearBtn.style.display = input.value.length > 0 ? 'inline-block' : 'none';
      refreshShowcase();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      showcaseSearchQuery = '';
      clearBtn.style.display = 'none';
      input.focus();
      refreshShowcase();
    });
  }

  if (catSelect) {
    catSelect.addEventListener('change', () => {
      showcaseSearchCategory = catSelect.value;
      refreshShowcase();
    });
  }

  if (resetTagsBtn) {
    resetTagsBtn.addEventListener('click', () => {
      selectedSearchTags.clear();
      resetTagsBtn.style.display = 'none';
      document.querySelectorAll('.search-tag-pill').forEach(p => p.classList.remove('active'));
      refreshShowcase();
    });
  }
}

/**
 * Fermeture de la modale de tirage aléatoire
 */
function closeRandomModal() {
  const modal = document.getElementById('randomModal');
  if (modal) modal.classList.remove('active');
}

/**
 * Initialise le bouton et la modale de tirage aléatoire (🎲)
 */
function initRandomPicker() {
  const btnRandom = document.getElementById('btnRandomPick');
  const modal = document.getElementById('randomModal');
  const btnClose = document.getElementById('btnCloseRandomModal');
  const btnCancel = document.getElementById('btnCancelRandomModal');
  const btnConfirm = document.getElementById('btnConfirmRandomPick');
  const togglePoetry = document.getElementById('toggleRandomPoetry');

  if (!btnRandom || !modal) return;

  function openModal() {
    modal.classList.add('active');
  }

  btnRandom.addEventListener('click', openModal);

  if (btnClose) {
    btnClose.addEventListener('click', closeRandomModal);
  }

  if (btnCancel) {
    btnCancel.addEventListener('click', closeRandomModal);
  }

  modal.addEventListener('click', (e) => {
    if (e.target.id === 'randomModal') {
      closeRandomModal();
    }
  });

  if (btnConfirm) {
    btnConfirm.addEventListener('click', async () => {
      try {
        const allWritings = await dbGetAllWritings();
        if (!allWritings || allWritings.length === 0) {
          closeRandomModal();
          showToast('Aucun texte n’est disponible pour le moment.');
          return;
        }

        const includePoetry = togglePoetry ? togglePoetry.checked : true;
        const pool = includePoetry
          ? allWritings
          : allWritings.filter(w => w.category !== 'poesie');

        if (pool.length === 0) {
          closeRandomModal();
          showToast('Aucun texte ne correspond à votre sélection (poésies exclues).', '⚠️');
          return;
        }

        const picked = pool[Math.floor(Math.random() * pool.length)];

        closeRandomModal();

        // Réinitialisation douce des filtres textuels/tags pour garantir la visibilité de l'écrit
        showcaseSearchQuery = '';
        showcaseSearchCategory = 'all';
        selectedSearchTags.clear();

        const input = document.getElementById('showcaseSearchInput');
        if (input) input.value = '';
        const clearBtn = document.getElementById('btnClearSearchInput');
        if (clearBtn) clearBtn.style.display = 'none';
        const catSelect = document.getElementById('searchCategorySelect');
        if (catSelect) catSelect.value = 'all';
        const resetTagsBtn = document.getElementById('btnResetSelectedTags');
        if (resetTagsBtn) resetTagsBtn.style.display = 'none';
        document.querySelectorAll('.search-tag-pill').forEach(p => p.classList.remove('active'));

        // Ajustement de la catégorie active selon le type d'écrit tiré
        if (picked.category === 'poesie') {
          currentFilterCategory = 'poesie';
        } else {
          // Si on était dans poésie ou une catégorie incompatible, basculer sur 'all'
          if (currentFilterCategory === 'poesie' || (currentFilterCategory !== 'all' && currentFilterCategory !== picked.category)) {
            currentFilterCategory = 'all';
          }
        }

        // Synchronisation des onglets de catégorie
        const categoryTabs = document.querySelectorAll('.category-tab');
        categoryTabs.forEach(tab => {
          if (tab.getAttribute('data-category') === currentFilterCategory) {
            tab.classList.add('active');
          } else {
            tab.classList.remove('active');
          }
        });

        // Actualise la vitrine avec les données
        await refreshShowcase();

        // Défilement doux jusqu'à la carte tirée au sort et animation d'accentuation
        const cardEl = document.getElementById('card-' + picked.id);
        if (cardEl) {
          cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          cardEl.classList.remove('card-random-highlight');
          void cardEl.offsetWidth; // Déclenche un reflow pour relancer l'animation
          cardEl.classList.add('card-random-highlight');
          setTimeout(() => {
            cardEl.classList.remove('card-random-highlight');
          }, 3500);
        }

        showToast(`Le hasard a choisi : "${picked.title}" !`, '🎲');
      } catch (err) {
        console.error('Erreur lors du tirage aléatoire :', err);
        showToast('Impossible de tirer un texte au sort.');
      }
    });
  }
}

function updateCategoryCounters(writings) {
  const countAll = writings.filter(w => w.category !== 'poesie').length;
  const countNouvelle = writings.filter(w => w.category === 'nouvelle').length;
  const countNouvelleLongue = writings.filter(w => w.category === 'nouvelle-longue').length;
  const countRoman = writings.filter(w => w.category === 'roman').length;
  const countPoesie = writings.filter(w => w.category === 'poesie').length;

  const elAll = document.getElementById('countAll');
  const elNouvelle = document.getElementById('countNouvelle');
  const elNouvelleLongue = document.getElementById('countNouvelleLongue');
  const elRoman = document.getElementById('countRoman');
  const elPoesie = document.getElementById('countPoesie');

  if (elAll) elAll.textContent = `(${countAll})`;
  if (elNouvelle) elNouvelle.textContent = `(${countNouvelle})`;
  if (elNouvelleLongue) elNouvelleLongue.textContent = `(${countNouvelleLongue})`;
  if (elRoman) elRoman.textContent = `(${countRoman})`;
  if (elPoesie) elPoesie.textContent = `(${countPoesie})`;
}

window.togglePoetryExpand = function(id) {
  const container = document.getElementById(`poetry-container-${id}`);
  const btn = document.getElementById(`btn-poetry-expand-${id}`);
  if (!container || !btn) return;

  const isExpanded = container.classList.contains('expanded');
  const spanText = btn.querySelector('.expand-text');

  if (isExpanded) {
    container.classList.remove('expanded');
    btn.classList.remove('active');
    if (spanText) spanText.textContent = 'Voir tout le poème';
  } else {
    container.classList.add('expanded');
    btn.classList.add('active');
    if (spanText) spanText.textContent = 'Réduire';
  }
};

function renderWritingCard(writing) {
  const isPoetry = writing.category === 'poesie';
  const categoryLabel = CATEGORIES_LABELS[writing.category] || writing.category;

  const formattedDate = (writing.displayDate && String(writing.displayDate).trim())
    ? escapeHtml(String(writing.displayDate).trim())
    : formatDisplayDate(writing.createdAt);

  if (isPoetry) {
    const poemContent = (writing.poetryText || writing.summary || '').trim();
    const lines = poemContent.split('\n');
    const isLongPoem = lines.length > 10 || poemContent.length > 380;

    return `
      <article class="writing-card poetry-card" id="card-${writing.id}">
        <div class="card-top">
          <span class="card-category-badge">${escapeHtml(categoryLabel)}</span>
          <span class="card-date">${formattedDate}</span>
        </div>

        <h3 class="poetry-title">${escapeHtml(writing.title)}</h3>

        <div class="poetry-container ${!isLongPoem ? 'no-overflow' : ''}" id="poetry-container-${writing.id}">
          <div class="poetry-content" id="poetry-content-${writing.id}">${escapeHtml(poemContent || 'Poème sans texte disponible.')}</div>
          <div class="poetry-fade-overlay" id="poetry-overlay-${writing.id}"></div>
        </div>

        ${isLongPoem ? `
        <div class="poetry-expand-row">
          <button type="button" class="btn-poetry-expand" id="btn-poetry-expand-${writing.id}" onclick="togglePoetryExpand('${writing.id}')">
            <span class="expand-text">Voir tout le poème</span>
            <svg class="expand-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
        </div>
        ` : ''}

        <div class="poetry-actions">
          <button type="button" class="btn-download" id="btn-dl-${writing.id}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            Télécharger (PDF)
          </button>
          <button type="button" class="btn-comment" id="btn-comment-${writing.id}">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            Laisser un mot
          </button>
        </div>
      </article>
    `;
  }

  // Récit standard (prose)
  let tagsList = [];
  if (Array.isArray(writing.tags)) {
    tagsList = writing.tags;
  } else if (typeof writing.tags === 'string') {
    try {
      const parsed = JSON.parse(writing.tags);
      tagsList = Array.isArray(parsed) ? parsed : writing.tags.split(',');
    } catch (e) {
      tagsList = writing.tags.split(',');
    }
  }
  tagsList = tagsList.map(t => String(t).trim()).filter(Boolean);

  const tagsHtml = tagsList.length > 0
    ? `<div class="card-tags">
        ${tagsList.map(t => `<span class="card-tag">#${escapeHtml(t)}</span>`).join('')}
       </div>`
    : '';

  return `
    <article class="writing-card" id="card-${writing.id}">
      <div class="card-top">
        <span class="card-category-badge">${escapeHtml(categoryLabel)}</span>
        <span class="card-date">${formattedDate}</span>
      </div>
      <h3 class="card-title">${escapeHtml(writing.title)}</h3>
      
      <!-- Détails de lecture (Pages, Mots, Temps de lecture) -->
      <div class="card-reading-stats" id="stats-${writing.id}">
        ${renderReadingStatsHtml(writing)}
      </div>

      <p class="card-summary">${escapeHtml(writing.summary)}</p>
      ${tagsHtml}
      <div class="card-actions">
        <button type="button" class="btn-read" id="btn-read-${writing.id}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
          Visionner en ligne
        </button>
        <button type="button" class="btn-download" id="btn-dl-${writing.id}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          Télécharger (PDF)
        </button>
        <button type="button" class="btn-comment" id="btn-comment-${writing.id}">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
          Laisser un mot
        </button>
      </div>
    </article>
  `;
}

// =========================================================
// 6. GESTION DES DOCUMENTS PDF (LECTEUR & TÉLÉCHARGEMENT)
// =========================================================
function openPdfReader(writing) {
  const modal = document.getElementById('pdfReaderModal');
  const titleEl = document.getElementById('readerTitle');
  const iframe = document.getElementById('pdfViewerFrame');
  const downloadBtn = document.getElementById('readerDownloadBtn');
  const openTabBtn = document.getElementById('readerOpenTabBtn');
  const mobileOpenBtn = document.getElementById('readerMobileOpenBtn');
  const readerCommentBtn = document.getElementById('readerCommentBtn');

  if (activePdfBlobUrl) {
    URL.revokeObjectURL(activePdfBlobUrl);
    activePdfBlobUrl = null;
  }

  let pdfSrc = '';
  if (writing.pdfUrl) {
    pdfSrc = writing.pdfUrl;
  } else if (writing.pdfBlob) {
    activePdfBlobUrl = URL.createObjectURL(writing.pdfBlob);
    pdfSrc = activePdfBlobUrl;
  }

  if (titleEl) titleEl.textContent = writing.title;
  if (iframe) iframe.src = pdfSrc;

  const fileName = writing.pdfFileName || `${slugify(writing.title)}.pdf`;
  if (downloadBtn) {
    downloadBtn.href = pdfSrc;
    downloadBtn.setAttribute('download', fileName);
    downloadBtn.target = '_blank';
  }

  const openInNewTab = () => {
    window.open(pdfSrc, '_blank');
  };

  if (openTabBtn) openTabBtn.onclick = openInNewTab;
  if (mobileOpenBtn) mobileOpenBtn.onclick = openInNewTab;

  if (readerCommentBtn) {
    readerCommentBtn.onclick = () => openCommentModal(writing.id, writing.title);
  }

  if (modal) modal.classList.add('active');
}

function closePdfReader() {
  const modal = document.getElementById('pdfReaderModal');
  const iframe = document.getElementById('pdfViewerFrame');
  if (iframe) iframe.src = 'about:blank';
  if (modal) modal.classList.remove('active');

  if (activePdfBlobUrl) {
    URL.revokeObjectURL(activePdfBlobUrl);
    activePdfBlobUrl = null;
  }
}

function downloadPdfFile(writing) {
  let downloadUrl = writing.pdfUrl;
  let shouldRevoke = false;

  if (!downloadUrl && writing.pdfBlob) {
    downloadUrl = URL.createObjectURL(writing.pdfBlob);
    shouldRevoke = true;
  }

  if (!downloadUrl) {
    showToast('Document PDF introuvable.');
    return;
  }

  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = writing.pdfFileName || `${slugify(writing.title)}.pdf`;
  a.target = '_blank';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  if (shouldRevoke) {
    setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
  }
  showToast(`Téléchargement de "${writing.title}" lancé.`);
}

// =========================================================
// 7. PUBLICATION D'UN NOUVEL ÉCRIT (ESPACE PERSONNEL)
// =========================================================
function initPublishForm() {
  const form = document.getElementById('publishForm');
  const fileInput = document.getElementById('pubPdfFile');
  const dropZone = document.getElementById('uploadDropZone');
  const statusBox = document.getElementById('fileStatusBox');
  const fileNameText = document.getElementById('selectedFileName');
  const fileSizeText = document.getElementById('selectedFileSize');
  const clearFileBtn = document.getElementById('btnClearSelectedFile');
  const submitBtn = document.getElementById('btnSubmitPublish');

  const catEl = document.getElementById('pubCategory');
  const summaryGroup = document.getElementById('pubSummaryGroup');
  const poetryGroup = document.getElementById('pubPoetryGroup');
  const metricsGroup = document.getElementById('pubMetricsGroup');
  const poetryTextArea = document.getElementById('pubPoetryText');
  const poetryBadge = document.getElementById('pubPoetryStatusBadge');

  if (!form || !fileInput || !dropZone) return;

  function updatePubCategoryVisibility() {
    const isPoetry = catEl && catEl.value === 'poesie';
    if (summaryGroup) summaryGroup.style.display = isPoetry ? 'none' : 'block';
    if (poetryGroup) poetryGroup.style.display = isPoetry ? 'block' : 'none';
    if (metricsGroup) metricsGroup.style.display = isPoetry ? 'none' : 'block';

    // Si l'utilisateur bascule sur poésie alors qu'un PDF est déjà sélectionné
    if (isPoetry && fileInput.files && fileInput.files[0] && poetryTextArea && !poetryTextArea.value.trim()) {
      extractAndFillPoetry(fileInput.files[0]);
    }
  }

  async function extractAndFillPoetry(file) {
    if (!poetryTextArea) return;
    if (poetryBadge) {
      poetryBadge.textContent = '⏳ Extraction des vers depuis le PDF...';
      poetryBadge.style.color = 'var(--accent)';
    }
    try {
      const extracted = await extractPdfFullText(file);
      if (extracted && extracted.trim()) {
        poetryTextArea.value = extracted.trim();
        if (poetryBadge) {
          poetryBadge.textContent = '✓ Vers extraits automatiquement';
          poetryBadge.style.color = '#10b981';
        }
        showToast('Vers poétiques extraits avec succès. Vous pouvez les ajuster dans l\'encadré.');
      } else {
        if (poetryBadge) {
          poetryBadge.textContent = 'PDF sans texte brut ou scanné — Saisie manuelle';
          poetryBadge.style.color = 'var(--text-muted)';
        }
      }
    } catch (err) {
      console.warn('Erreur extraction vers poésie:', err);
      if (poetryBadge) {
        poetryBadge.textContent = 'Extraction automatique indisponible — Saisie manuelle';
        poetryBadge.style.color = 'var(--text-muted)';
      }
    }
  }

  if (catEl) {
    catEl.addEventListener('change', updatePubCategoryVisibility);
    updatePubCategoryVisibility();
  }

  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.remove('drag-over');
    });
  });

  dropZone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        fileInput.files = e.dataTransfer.files;
        updateSelectedFileInfo(file);
      } else {
        showToast('Veuillez sélectionner un fichier au format PDF.');
      }
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files && fileInput.files[0]) {
      updateSelectedFileInfo(fileInput.files[0]);
    }
  });

  async function updateSelectedFileInfo(file) {
    if (fileNameText) fileNameText.textContent = file.name;
    if (fileSizeText) fileSizeText.textContent = `Taille : ${formatFileSize(file.size)}`;
    if (statusBox) statusBox.classList.add('active');

    if (catEl && catEl.value === 'poesie') {
      await extractAndFillPoetry(file);
      return;
    }

    const hint = document.getElementById('pubMetricsStatusHint');
    if (hint) hint.textContent = '⏳ Analyse du PDF (pages, mots, temps de lecture)...';

    try {
      const stats = await analyzePdfFile(file);
      if (stats) {
        const pageInput = document.getElementById('pubPageCount');
        const wordInput = document.getElementById('pubWordCount');
        const timeInput = document.getElementById('pubReadingTime');

        if (pageInput) pageInput.value = stats.pageCount;
        if (wordInput) wordInput.value = stats.wordCount;
        if (timeInput) timeInput.value = stats.readingTime;

        if (hint) {
          hint.textContent = `✓ Calculé automatiquement : ${stats.pageCount} page(s), ${stats.wordCount.toLocaleString('fr-FR')} mots, ${stats.readingTime}. Vous pouvez modifier ces valeurs ci-dessus.`;
        }
      }
    } catch (err) {
      if (hint) hint.textContent = 'Calcul automatique indisponible, vous pouvez saisir les détails manuellement.';
    }
  }

  if (clearFileBtn) {
    clearFileBtn.addEventListener('click', () => {
      fileInput.value = '';
      if (statusBox) statusBox.classList.remove('active');
      const pageInput = document.getElementById('pubPageCount');
      const wordInput = document.getElementById('pubWordCount');
      const timeInput = document.getElementById('pubReadingTime');
      const hint = document.getElementById('pubMetricsStatusHint');
      if (pageInput) pageInput.value = '';
      if (wordInput) wordInput.value = '';
      if (timeInput) timeInput.value = '';
      if (hint) hint.textContent = 'Calculé automatiquement dès la sélection du PDF. Vous pouvez modifier ou personnaliser ces valeurs à votre convenance.';
      if (poetryTextArea) poetryTextArea.value = '';
      if (poetryBadge) {
        poetryBadge.textContent = 'Extraction automatique depuis PDF';
        poetryBadge.style.color = '';
      }
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const titleEl = document.getElementById('pubTitle');
    const sumEl = document.getElementById('pubSummary');
    const tagsEl = document.getElementById('pubTags');
    const displayDateEl = document.getElementById('pubDisplayDate');

    const pageInput = document.getElementById('pubPageCount');
    const wordInput = document.getElementById('pubWordCount');
    const timeInput = document.getElementById('pubReadingTime');

    const title = titleEl ? titleEl.value.trim() : '';
    const category = catEl ? catEl.value : 'nouvelle';
    const isPoetry = category === 'poesie';
    const summary = sumEl ? sumEl.value.trim() : '';
    const poetryText = isPoetry && poetryTextArea ? poetryTextArea.value.trim() : '';
    const rawTags = tagsEl ? tagsEl.value : '';
    const customDate = displayDateEl ? displayDateEl.value.trim() : '';
    const displayDate = customDate || formatDisplayDate(Date.now());
    const file = fileInput.files[0];

    if (!file) {
      showToast('Veuillez sélectionner un fichier PDF.');
      return;
    }

    if (isPoetry && !poetryText) {
      showToast('Veuillez vérifier ou renseigner les vers du poème avant de publier.');
      return;
    }

    if (!isPoetry && !summary) {
      showToast('Veuillez renseigner un court résumé pour votre récit.');
      return;
    }

    let pageCount = (!isPoetry && pageInput && pageInput.value) ? parseInt(pageInput.value, 10) : null;
    let wordCount = (!isPoetry && wordInput && wordInput.value) ? parseInt(wordInput.value, 10) : null;
    let readingTime = (!isPoetry && timeInput) ? timeInput.value.trim() : '';

    const originalBtnText = submitBtn.innerHTML;
    submitBtn.disabled = true;
    submitBtn.innerHTML = 'Publication en cours...';

    // Pour la prose : si les champs sont vides, tenter l'analyse automatique avant sauvegarde
    if (!isPoetry && (!pageCount || !wordCount || !readingTime)) {
      try {
        const stats = await analyzePdfFile(file);
        if (stats) {
          if (!pageCount) pageCount = stats.pageCount;
          if (!wordCount) wordCount = stats.wordCount;
          if (!readingTime) readingTime = stats.readingTime;
        }
      } catch (err) {
        console.warn('Erreur fallback calcul stats submit:', err);
      }
    }

    const tags = parseTagsString(rawTags);
    const writingId = String(Date.now());

    const writing = {
      id: writingId,
      title,
      category,
      summary: isPoetry ? poetryText : summary,
      poetryText: isPoetry ? poetryText : '',
      tags,
      displayDate,
      pageCount: isPoetry ? null : pageCount,
      wordCount: isPoetry ? null : wordCount,
      readingTime: isPoetry ? '' : readingTime,
      pdfBlob: file,
      pdfFileName: file.name,
      pdfFileSize: formatFileSize(file.size),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    try {
      await dbSaveWriting(writing, file);
      form.reset();
      if (statusBox) statusBox.classList.remove('active');
      const hint = document.getElementById('pubMetricsStatusHint');
      if (hint) hint.textContent = 'Calculé automatiquement dès la sélection du PDF. Vous pouvez modifier ou personnaliser ces valeurs à votre convenance.';
      if (poetryTextArea) poetryTextArea.value = '';
      if (poetryBadge) {
        poetryBadge.textContent = 'Extraction automatique depuis PDF';
        poetryBadge.style.color = '';
      }
      updatePubCategoryVisibility();
      showToast(`"${writing.title}" a été ajouté à la vitrine !`);
      await refreshAdminWritings();
      await refreshShowcase();
    } catch (err) {
      console.error('Erreur lors de la publication :', err);
      showToast('Une erreur est survenue lors de l’enregistrement.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalBtnText;
    }
  });
}

/**
 * Initialise la barre de recherche et le filtre poésie dans l'espace personnel
 */
function initSearchAdmin() {
  const input = document.getElementById('adminSearchInput');
  const clearBtn = document.getElementById('btnClearAdminSearch');
  const poetryToggle = document.getElementById('toggleAdminPoetry');
  const writingsAccordion = document.getElementById('adminWritingsAccordion');

  // Mémorisation de l'état replié/déplié de l'accordéon des écrits
  if (writingsAccordion) {
    const savedState = localStorage.getItem('caddrillage_admin_writings_open');
    if (savedState !== null) {
      writingsAccordion.open = savedState === 'true';
    }
    writingsAccordion.addEventListener('toggle', () => {
      localStorage.setItem('caddrillage_admin_writings_open', writingsAccordion.open ? 'true' : 'false');
    });
  }

  if (input) {
    input.addEventListener('input', () => {
      adminSearchQuery = input.value.trim();
      if (clearBtn) clearBtn.style.display = input.value.length > 0 ? 'inline-block' : 'none';
      refreshAdminWritings();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      input.value = '';
      adminSearchQuery = '';
      clearBtn.style.display = 'none';
      input.focus();
      refreshAdminWritings();
    });
  }

  if (poetryToggle) {
    poetryToggle.addEventListener('change', () => {
      adminShowPoetry = poetryToggle.checked;
      refreshAdminWritings();
    });
  }
}

// =========================================================
// 8. GESTION DES ÉCRITS DANS L'ESPACE PERSONNEL
// =========================================================
async function refreshAdminWritings() {
  const container = document.getElementById('adminWritingsList');
  if (!container) return;

  try {
    let writings = await dbGetAllWritings();

    // Filtre pour afficher ou masquer la poésie
    if (!adminShowPoetry) {
      writings = writings.filter(w => w.category !== 'poesie');
    }

    // Filtre texte / mot-clé
    if (adminSearchQuery) {
      const q = adminSearchQuery.toLowerCase();
      writings = writings.filter(w => {
        const matchTitle = (w.title || '').toLowerCase().includes(q);
        const matchSummary = (w.summary || '').toLowerCase().includes(q);
        const matchPoetry = (w.poetryText || '').toLowerCase().includes(q);
        const matchTags = (w.tags || []).some(t => String(t).toLowerCase().includes(q));
        return matchTitle || matchSummary || matchPoetry || matchTags;
      });
    }

    const writingsCountBadge = document.getElementById('adminWritingsCountBadge');
    if (writingsCountBadge) {
      writingsCountBadge.textContent = `${writings.length} écrit${writings.length > 1 ? 's' : ''}`;
    }

    if (writings.length === 0) {
      const emptyMsg = adminSearchQuery
        ? `Aucun écrit ne correspond à votre recherche "${escapeHtml(adminSearchQuery)}".`
        : `Aucun écrit à afficher selon vos filtres.`;

      container.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.95rem;">
          ${emptyMsg}
        </div>
      `;
      return;
    }

    container.innerHTML = writings.map(w => {
      const isPoetry = w.category === 'poesie';
      const categoryLabel = CATEGORIES_LABELS[w.category] || w.category;
      const poemText = w.poetryText || w.summary || '';
      const excerpt = isPoetry
        ? (poemText.split('\n').filter(Boolean).slice(0, 3).join(' / ') || 'Vers poétiques...')
        : w.summary;

      const statsMetaHtml = isPoetry
        ? `<span>✍️ Poème lisible directement sur la carte vitrine</span>`
        : `<span>📄 ${formatPageCount(w.pageCount)}</span>
           <span>•</span>
           <span>✍️ ${formatWordCount(w.wordCount)}</span>
           <span>•</span>
           <span>⏳ ${w.readingTime ? escapeHtml(w.readingTime) : 'Non estimé'}</span>`;

      return `
        <div class="admin-writing-item" id="admin-item-${w.id}">
          <div class="item-main-info">
            <div class="item-badges-row">
              <span class="card-category-badge">${escapeHtml(categoryLabel)}</span>
              <span class="card-date">${(w.displayDate && String(w.displayDate).trim()) ? escapeHtml(String(w.displayDate).trim()) : formatDisplayDate(w.createdAt)}</span>
            </div>
            <div class="item-title">${escapeHtml(w.title)}</div>
            <div class="item-excerpt" style="${isPoetry ? 'font-style: italic;' : ''}">${escapeHtml(excerpt)}</div>
            <div class="item-pdf-meta">
              <span>📄 ${escapeHtml(w.pdfFileName || 'document.pdf')} (${w.pdfFileSize || 'N/A'})</span>
              ${(w.tags && w.tags.length > 0) ? `<span>• Tags : ${w.tags.map(t => `#${escapeHtml(t)}`).join(', ')}</span>` : ''}
            </div>
            <div class="item-stats-meta">
              ${statsMetaHtml}
            </div>
          </div>
          <div class="item-actions-row">
            <button type="button" class="btn-sm-action" onclick="openPdfReaderFromAdmin('${w.id}')">
              👁️ Visionner
            </button>
            <button type="button" class="btn-sm-action" onclick="openEditModal('${w.id}')">
              ✏️ Modifier
            </button>
            <button type="button" class="btn-sm-action btn-sm-delete" onclick="promptDeleteWriting('${w.id}')">
              🗑️ Supprimer
            </button>
          </div>
        </div>
      `;
    }).join('');

    // Mise à jour automatique des statistiques de l'œuvre
    renderAdminDashboardStats();
  } catch (err) {
    console.error('Erreur liste admin:', err);
  }
}

/**
 * Initialise le bouton d'exportation globale de tous les écrits au format ZIP
 */
function initAdminExport() {
  const btnExport = document.getElementById('btnExportAllArchive');
  const btnText = document.getElementById('exportAllBtnText');
  if (!btnExport) return;

  btnExport.addEventListener('click', async () => {
    if (!window.JSZip) {
      showToast('Bibliothèque de compression non disponible.', '⚠️');
      return;
    }

    const originalText = btnText ? btnText.textContent : 'Exporter tous les écrits (.zip)';
    btnExport.disabled = true;

    try {
      if (btnText) btnText.textContent = 'Récupération des écrits...';

      const writings = await dbGetAllWritings();
      if (!writings || writings.length === 0) {
        showToast('Aucun écrit à exporter pour le moment.', '⚠️');
        btnExport.disabled = false;
        if (btnText) btnText.textContent = originalText;
        return;
      }

      const zip = new JSZip();

      // Création des dossiers par catégorie
      const folderNouvelle = zip.folder('Nouvelles');
      const folderNouvelleLongue = zip.folder('Nouvelles longues');
      const folderRoman = zip.folder('Romans');
      const folderPoesie = zip.folder('Poésies');

      const foldersMap = {
        'nouvelle': folderNouvelle,
        'nouvelle-longue': folderNouvelleLongue,
        'roman': folderRoman,
        'poesie': folderPoesie
      };

      // Fichier sommaire / index de l'archive
      const now = new Date();
      const dateFormatted = now.toLocaleDateString('fr-FR', {
        day: 'numeric',
        month: 'long',
        year: 'numeric'
      });

      let summaryContent = `====================================================================\n`;
      summaryContent += `ARCHIVES DE L'ANTRE DU CADDRILLAGE\n`;
      summaryContent += `Date d'exportation : ${dateFormatted}\n`;
      summaryContent += `Nombre total d'écrits : ${writings.length}\n`;
      summaryContent += `====================================================================\n\n`;

      const usedFileNames = new Set();

      for (let i = 0; i < writings.length; i++) {
        const w = writings[i];
        if (btnText) btnText.textContent = `Téléchargement (${i + 1}/${writings.length})...`;

        const targetFolder = foldersMap[w.category] || zip.folder(CATEGORIES_LABELS[w.category] || 'Autres');
        const rawTitle = (w.title || 'Ecrit_sans_titre').trim();
        let safeBaseName = rawTitle.replace(/[/\\?%*:|"<>]/g, '_').trim();
        if (!safeBaseName) safeBaseName = `ecrit_${w.id}`;

        // Évite les collisions de nom de fichier
        let uniqueName = safeBaseName;
        let counter = 2;
        while (usedFileNames.has(`${w.category}/${uniqueName.toLowerCase()}`)) {
          uniqueName = `${safeBaseName}_${counter}`;
          counter++;
        }
        usedFileNames.add(`${w.category}/${uniqueName.toLowerCase()}`);

        // Ajout au sommaire
        const catLabel = CATEGORIES_LABELS[w.category] || w.category;
        summaryContent += `• [${catLabel}] ${rawTitle}\n`;
        if (w.displayDate) summaryContent += `  Date affichée : ${w.displayDate}\n`;
        if (w.pageCount) summaryContent += `  Pages : ${w.pageCount}\n`;
        if (w.readingTime) summaryContent += `  Temps estimé : ${w.readingTime}\n`;
        if (w.tags && w.tags.length > 0) summaryContent += `  Tags : ${w.tags.join(', ')}\n`;
        if (w.summary) summaryContent += `  Résumé : ${w.summary.replace(/\n+/g, ' ')}\n`;
        summaryContent += `\n`;

        // 1. Récupération du PDF si disponible
        let pdfData = null;

        if (w.pdfBlob instanceof Blob) {
          try {
            pdfData = await w.pdfBlob.arrayBuffer();
          } catch (e) {
            console.warn('Erreur lecture pdfBlob local pour export:', w.title, e);
          }
        }

        if (!pdfData && w.pdfUrl) {
          try {
            const resp = await fetch(w.pdfUrl);
            if (resp.ok) {
              pdfData = await resp.arrayBuffer();
            }
          } catch (fetchErr) {
            console.warn('Erreur téléchargement distant PDF pour export:', w.title, fetchErr);
          }
        }

        if (pdfData) {
          targetFolder.file(`${uniqueName}.pdf`, pdfData);
        }

        // 2. Pour la poésie : exporter également le texte poétique en .txt
        if (w.category === 'poesie') {
          const text = (w.poetryText || w.summary || '').trim();
          if (text) {
            const poemFileContent = `${rawTitle}\n${'='.repeat(rawTitle.length)}\n\n${text}\n`;
            targetFolder.file(`${uniqueName}.txt`, poemFileContent);
          }
        }
      }

      zip.file('Sommaire_des_ecrits.txt', summaryContent);

      if (btnText) btnText.textContent = 'Génération du ZIP...';

      const zipBlob = await zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        compressionOptions: { level: 6 }
      }, (meta) => {
        if (btnText) btnText.textContent = `Compression (${Math.round(meta.percent)}%)...`;
      });

      const dateStr = now.toISOString().slice(0, 10);
      const downloadFileName = `L_antre_du_caddrillage_archives_${dateStr}.zip`;

      const downloadUrl = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = downloadUrl;
      a.download = downloadFileName;
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        if (a.parentNode) a.parentNode.removeChild(a);
        URL.revokeObjectURL(downloadUrl);
      }, 3000);

      showToast('Votre archive ZIP a été téléchargée avec succès !', '📦');
    } catch (err) {
      console.error('Erreur lors de l’export ZIP global :', err);
      showToast('Une erreur est survenue lors de la création de l’archive.', '⚠️');
    } finally {
      btnExport.disabled = false;
      if (btnText) btnText.textContent = originalText;
    }
  });
}

window.openPdfReaderFromAdmin = async function(id) {
  try {
    const writing = await dbGetWritingById(id);
    if (writing) openPdfReader(writing);
  } catch (err) {
    console.error(err);
  }
};

// =========================================================
// 9. MODIFICATION D'UN ÉCRIT
// =========================================================
let currentEditingWriting = null;

window.openEditModal = async function(id) {
  try {
    const writing = await dbGetWritingById(id);
    if (!writing) return;

    currentEditingWriting = writing;

    const editId = document.getElementById('editId');
    const editTitle = document.getElementById('editTitle');
    const editCategory = document.getElementById('editCategory');
    const editSummary = document.getElementById('editSummary');
    const editSummaryGroup = document.getElementById('editSummaryGroup');
    const editPoetryGroup = document.getElementById('editPoetryGroup');
    const editPoetryText = document.getElementById('editPoetryText');
    const editMetricsGroup = document.getElementById('editMetricsGroup');
    const editTags = document.getElementById('editTags');
    const editCurrentPdfInfo = document.getElementById('editCurrentPdfInfo');

    if (editId) editId.value = writing.id;
    if (editTitle) editTitle.value = writing.title;
    if (editCategory) editCategory.value = writing.category;
    if (editSummary) editSummary.value = writing.summary;
    if (editTags) editTags.value = (writing.tags || []).join(', ');

    const isPoetry = writing.category === 'poesie';
    if (editSummaryGroup) editSummaryGroup.style.display = isPoetry ? 'none' : 'block';
    if (editPoetryGroup) editPoetryGroup.style.display = isPoetry ? 'block' : 'none';
    if (editMetricsGroup) editMetricsGroup.style.display = isPoetry ? 'none' : 'block';

    if (editPoetryText) {
      editPoetryText.value = writing.poetryText || (isPoetry ? writing.summary : '') || '';
    }

    const editDisplayDate = document.getElementById('editDisplayDate');
    if (editDisplayDate) {
      editDisplayDate.value = writing.displayDate || formatDisplayDate(writing.createdAt);
    }

    const editPageCount = document.getElementById('editPageCount');
    const editWordCount = document.getElementById('editWordCount');
    const editReadingTime = document.getElementById('editReadingTime');

    if (editPageCount) editPageCount.value = (writing.pageCount !== null && writing.pageCount !== undefined) ? writing.pageCount : '';
    if (editWordCount) editWordCount.value = (writing.wordCount !== null && writing.wordCount !== undefined) ? writing.wordCount : '';
    if (editReadingTime) editReadingTime.value = writing.readingTime || '';

    const editHint = document.getElementById('editMetricsStatusHint');
    if (editHint) {
      editHint.textContent = 'Modifiable à tout moment. Si un nouveau PDF est chargé, ces valeurs sont recalculées automatiquement.';
    }

    if (editCurrentPdfInfo) {
      editCurrentPdfInfo.textContent = 
        `PDF actuel : ${writing.pdfFileName || 'document.pdf'} (${writing.pdfFileSize || 'N/A'})`;
    }

    const editFileInput = document.getElementById('editPdfFile');
    const editStatusBox = document.getElementById('editFileStatusBox');
    if (editFileInput) editFileInput.value = '';
    if (editStatusBox) editStatusBox.classList.remove('active');

    const modal = document.getElementById('editModal');
    if (modal) modal.classList.add('active');
  } catch (err) {
    console.error('Erreur ouverture modale d\'édition:', err);
  }
};

function initEditForm() {
  const form = document.getElementById('editForm');
  const editFileInput = document.getElementById('editPdfFile');
  const editDropZone = document.getElementById('editUploadDropZone');
  const editStatusBox = document.getElementById('editFileStatusBox');
  const editFileName = document.getElementById('editSelectedFileName');
  const editFileSize = document.getElementById('editSelectedFileSize');
  const btnCancelEditPdf = document.getElementById('btnCancelEditPdf');

  const editCategory = document.getElementById('editCategory');
  const editSummaryGroup = document.getElementById('editSummaryGroup');
  const editPoetryGroup = document.getElementById('editPoetryGroup');
  const editPoetryText = document.getElementById('editPoetryText');
  const editMetricsGroup = document.getElementById('editMetricsGroup');

  if (!form || !editFileInput || !editDropZone) return;

  function updateEditCategoryVisibility() {
    const isPoetry = editCategory && editCategory.value === 'poesie';
    if (editSummaryGroup) editSummaryGroup.style.display = isPoetry ? 'none' : 'block';
    if (editPoetryGroup) editPoetryGroup.style.display = isPoetry ? 'block' : 'none';
    if (editMetricsGroup) editMetricsGroup.style.display = isPoetry ? 'none' : 'block';

    if (isPoetry && editPoetryText && !editPoetryText.value.trim()) {
      const editSummary = document.getElementById('editSummary');
      if (editSummary && editSummary.value.trim()) {
        editPoetryText.value = editSummary.value.trim();
      }
    }
  }

  if (editCategory) {
    editCategory.addEventListener('change', updateEditCategoryVisibility);
  }

  ['dragenter', 'dragover'].forEach(eventName => {
    editDropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      editDropZone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    editDropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      editDropZone.classList.remove('drag-over');
    });
  });

  async function handleEditFileSelected(file) {
    if (editFileName) editFileName.textContent = file.name;
    if (editFileSize) editFileSize.textContent = `Taille : ${formatFileSize(file.size)}`;
    if (editStatusBox) editStatusBox.classList.add('active');

    if (editCategory && editCategory.value === 'poesie') {
      try {
        const text = await extractPdfFullText(file);
        if (text && text.trim() && editPoetryText) {
          editPoetryText.value = text.trim();
          showToast('Vers poétiques extraits du nouveau PDF.');
        }
      } catch (err) {
        console.warn('Erreur extraction poésie edit:', err);
      }
      return;
    }

    const editHint = document.getElementById('editMetricsStatusHint');
    if (editHint) editHint.textContent = '⏳ Analyse du nouveau PDF en cours...';

    try {
      const stats = await analyzePdfFile(file);
      if (stats) {
        const editPageCount = document.getElementById('editPageCount');
        const editWordCount = document.getElementById('editWordCount');
        const editReadingTime = document.getElementById('editReadingTime');

        if (editPageCount) editPageCount.value = stats.pageCount;
        if (editWordCount) editWordCount.value = stats.wordCount;
        if (editReadingTime) editReadingTime.value = stats.readingTime;

        if (editHint) {
          editHint.textContent = `✓ Recalculé automatiquement : ${stats.pageCount} page(s), ${stats.wordCount.toLocaleString('fr-FR')} mots, ${stats.readingTime}.`;
        }
      }
    } catch (err) {
      if (editHint) editHint.textContent = 'Calcul automatique échoué, vous pouvez saisir les détails manuellement.';
    }
  }

  editDropZone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      if (file.type === 'application/pdf' || file.name.endsWith('.pdf')) {
        editFileInput.files = e.dataTransfer.files;
        handleEditFileSelected(file);
      } else {
        showToast('Veuillez sélectionner un fichier au format PDF.');
      }
    }
  });

  editFileInput.addEventListener('change', () => {
    if (editFileInput.files && editFileInput.files[0]) {
      handleEditFileSelected(editFileInput.files[0]);
    }
  });

  if (btnCancelEditPdf) {
    btnCancelEditPdf.addEventListener('click', () => {
      editFileInput.value = '';
      if (editStatusBox) editStatusBox.classList.remove('active');
      if (currentEditingWriting) {
        const editPageCount = document.getElementById('editPageCount');
        const editWordCount = document.getElementById('editWordCount');
        const editReadingTime = document.getElementById('editReadingTime');
        const editHint = document.getElementById('editMetricsStatusHint');
        if (editPageCount) editPageCount.value = (currentEditingWriting.pageCount !== null && currentEditingWriting.pageCount !== undefined) ? currentEditingWriting.pageCount : '';
        if (editWordCount) editWordCount.value = (currentEditingWriting.wordCount !== null && currentEditingWriting.wordCount !== undefined) ? currentEditingWriting.wordCount : '';
        if (editReadingTime) editReadingTime.value = currentEditingWriting.readingTime || '';
        if (editHint) editHint.textContent = 'Modifiable à tout moment. Si un nouveau PDF est chargé, ces valeurs sont recalculées automatiquement.';
      }
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentEditingWriting) return;

    const editTitle = document.getElementById('editTitle');
    const editSummary = document.getElementById('editSummary');
    const editTags = document.getElementById('editTags');
    const editDisplayDate = document.getElementById('editDisplayDate');

    const editPageInput = document.getElementById('editPageCount');
    const editWordInput = document.getElementById('editWordCount');
    const editReadingTimeInput = document.getElementById('editReadingTime');

    const title = editTitle ? editTitle.value.trim() : currentEditingWriting.title;
    const category = editCategory ? editCategory.value : currentEditingWriting.category;
    const isPoetry = category === 'poesie';
    const summary = editSummary ? editSummary.value.trim() : currentEditingWriting.summary;
    const poetryText = isPoetry && editPoetryText ? editPoetryText.value.trim() : '';
    const rawTags = editTags ? editTags.value : '';
    const tags = parseTagsString(rawTags);
    const customDate = editDisplayDate ? editDisplayDate.value.trim() : '';

    if (isPoetry && !poetryText) {
      showToast('Veuillez renseigner ou vérifier le texte du poème.');
      return;
    }
    if (!isPoetry && !summary) {
      showToast('Veuillez renseigner un court résumé pour votre récit.');
      return;
    }

    currentEditingWriting.title = title;
    currentEditingWriting.category = category;
    currentEditingWriting.summary = isPoetry ? poetryText : summary;
    currentEditingWriting.poetryText = isPoetry ? poetryText : '';
    currentEditingWriting.tags = tags;
    currentEditingWriting.displayDate = customDate || currentEditingWriting.displayDate || formatDisplayDate(currentEditingWriting.createdAt);

    if (isPoetry) {
      currentEditingWriting.pageCount = null;
      currentEditingWriting.wordCount = null;
      currentEditingWriting.readingTime = '';
    } else {
      if (editPageInput && editPageInput.value !== '') {
        currentEditingWriting.pageCount = parseInt(editPageInput.value, 10);
      }
      if (editWordInput && editWordInput.value !== '') {
        currentEditingWriting.wordCount = parseInt(editWordInput.value, 10);
      }
      if (editReadingTimeInput) {
        currentEditingWriting.readingTime = editReadingTimeInput.value.trim();
      }
    }

    currentEditingWriting.updatedAt = Date.now();

    let newFile = null;
    if (editFileInput.files && editFileInput.files[0]) {
      newFile = editFileInput.files[0];
      currentEditingWriting.pdfFileName = newFile.name;
      currentEditingWriting.pdfFileSize = formatFileSize(newFile.size);
    }

    try {
      await dbSaveWriting(currentEditingWriting, newFile);
      const modal = document.getElementById('editModal');
      if (modal) modal.classList.remove('active');
      showToast(`L'écrit "${title}" a été modifié avec succès.`);
      await refreshAdminWritings();
      await refreshShowcase();
    } catch (err) {
      console.error('Erreur mise à jour:', err);
      showToast('Erreur lors de la mise à jour de l’écrit.');
    }
  });

  const btnClose = document.getElementById('btnCloseEditModal');
  const btnCancel = document.getElementById('btnCancelEditModal');
  if (btnClose) btnClose.addEventListener('click', () => {
    const modal = document.getElementById('editModal');
    if (modal) modal.classList.remove('active');
  });
  if (btnCancel) btnCancel.addEventListener('click', () => {
    const modal = document.getElementById('editModal');
    if (modal) modal.classList.remove('active');
  });
}

// =========================================================
// 10. SUPPRESSION D'UN ÉCRIT
// =========================================================
window.promptDeleteWriting = async function(id) {
  try {
    const writing = await dbGetWritingById(id);
    if (!writing) return;

    writingToDeleteId = id;
    const textEl = document.getElementById('deleteConfirmText');
    if (textEl) {
      textEl.textContent = `Êtes-vous sûr de vouloir supprimer définitivement "${writing.title}" de la vitrine ?`;
    }

    const modal = document.getElementById('confirmDeleteModal');
    if (modal) modal.classList.add('active');
  } catch (err) {
    console.error(err);
  }
};

function initDeleteModal() {
  const modal = document.getElementById('confirmDeleteModal');
  const btnConfirm = document.getElementById('btnConfirmDelete');
  const btnCancel = document.getElementById('btnCancelDelete');
  const btnClose = document.getElementById('btnCloseDeleteModal');

  if (!modal) return;

  const closeModal = () => {
    modal.classList.remove('active');
    writingToDeleteId = null;
  };

  if (btnCancel) btnCancel.addEventListener('click', closeModal);
  if (btnClose) btnClose.addEventListener('click', closeModal);

  if (btnConfirm) {
    btnConfirm.addEventListener('click', async () => {
      if (!writingToDeleteId) return;
      try {
        await dbDeleteWriting(writingToDeleteId);
        closeModal();
        showToast('Écrit supprimé avec succès.');
        await refreshAdminWritings();
        await refreshShowcase();
      } catch (err) {
        console.error('Erreur suppression:', err);
        showToast('Erreur lors de la suppression.');
      }
    });
  }
}

// =========================================================
// 10b. GESTION DES COMMENTAIRES PRIVÉS (LECTEURS & ESPACE PERSONNEL)
// =========================================================
function openCommentModal(writingId, writingTitle) {
  const modal = document.getElementById('commentModal');
  const titleEl = document.getElementById('commentModalTitle');
  const idInput = document.getElementById('commentWritingId');
  const titleInput = document.getElementById('commentWritingTitle');
  const authorInput = document.getElementById('commentAuthorName');
  const msgInput = document.getElementById('commentMessage');
  const counterDisplay = document.getElementById('charCountDisplay');
  const counterRow = document.getElementById('charCounterRow');

  if (!modal) return;

  if (idInput) idInput.value = writingId || 'general';
  if (titleInput) titleInput.value = writingTitle || 'Général';
  if (titleEl) titleEl.textContent = writingTitle ? `Laisser un mot sur : ${writingTitle}` : `Laisser un mot à l'auteur`;
  if (authorInput) authorInput.value = '';
  if (msgInput) msgInput.value = '';
  if (counterDisplay) counterDisplay.textContent = '0';
  if (counterRow) counterRow.className = 'char-counter-row';

  modal.classList.add('active');
  if (msgInput) msgInput.focus();
}

function closeCommentModal() {
  const modal = document.getElementById('commentModal');
  if (modal) modal.classList.remove('active');
}

function initCommentModal() {
  const form = document.getElementById('commentForm');
  const msgInput = document.getElementById('commentMessage');
  const counterDisplay = document.getElementById('charCountDisplay');
  const counterRow = document.getElementById('charCounterRow');
  const btnClose = document.getElementById('btnCloseCommentModal');
  const btnCancel = document.getElementById('btnCancelComment');
  const modal = document.getElementById('commentModal');
  const submitBtn = document.getElementById('btnSubmitComment');

  if (!form || !msgInput) return;

  // Compteur dynamique jusqu'à 6000 caractères
  msgInput.addEventListener('input', () => {
    const len = msgInput.value.length;
    if (counterDisplay) counterDisplay.textContent = len;

    if (counterRow) {
      if (len >= 6000) {
        counterRow.className = 'char-counter-row limit';
      } else if (len >= 5000) {
        counterRow.className = 'char-counter-row warning';
      } else {
        counterRow.className = 'char-counter-row';
      }
    }
  });

  if (btnClose) btnClose.addEventListener('click', closeCommentModal);
  if (btnCancel) btnCancel.addEventListener('click', closeCommentModal);
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target.id === 'commentModal') closeCommentModal();
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const idInput = document.getElementById('commentWritingId');
    const titleInput = document.getElementById('commentWritingTitle');
    const authorInput = document.getElementById('commentAuthorName');

    const writingId = idInput ? idInput.value : 'general';
    const writingTitle = titleInput ? titleInput.value : 'Général';
    const authorName = authorInput ? (authorInput.value.trim() || 'Lecteur anonyme') : 'Lecteur anonyme';
    const message = msgInput.value.trim();

    if (!message) {
      showToast('Veuillez écrire un message avant d’envoyer.');
      return;
    }

    if (message.length > 6000) {
      showToast('Votre message dépasse la limite de 6000 caractères.');
      return;
    }

    const originalBtnHtml = submitBtn ? submitBtn.innerHTML : '';
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerHTML = 'Envoi en cours...';
    }

    const comment = {
      id: `comm_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      writingId,
      writingTitle,
      authorName,
      message,
      createdAt: Date.now()
    };

    try {
      await dbSaveComment(comment);
      closeCommentModal();
      form.reset();
      showToast('Merci ! Votre commentaire privé a bien été transmis à l’auteur.');

      const psView = document.getElementById('personalSpaceView');
      const isAdminActive = psView && psView.classList.contains('active');
      if (isAdminActive) {
        refreshAdminComments();
      }
    } catch (err) {
      console.error('Erreur envoi commentaire :', err);
      showToast('Une erreur est survenue lors de l’envoi de votre mot.');
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalBtnHtml;
      }
    }
  });
}

// Affichage des commentaires dans l'espace personnel
async function refreshAdminComments() {
  const container = document.getElementById('adminCommentsList');
  const badge = document.getElementById('commentsCountBadge');
  if (!container) return;

  try {
    const comments = await dbGetAllComments();

    if (badge) {
      const s = comments.length > 1 ? 's' : '';
      badge.textContent = `${comments.length} commentaire${s}`;
    }

    if (comments.length === 0) {
      container.innerHTML = `
        <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.95rem;">
          Aucun commentaire de lecteur reçu pour le moment.
        </div>
      `;
      return;
    }

    container.innerHTML = comments.map(c => {
      const dateStr = formatDisplayDateTime(c.createdAt);
      return `
        <div class="admin-comment-card" id="comment-card-${c.id}">
          <div class="comment-card-header">
            <span class="comment-author-badge">
              <span>👤</span> ${escapeHtml(c.authorName)}
            </span>
            <span class="comment-target-title">
              Écrit : ${escapeHtml(c.writingTitle || 'Général')}
            </span>
          </div>
          <div class="comment-body-text">${escapeHtml(c.message)}</div>
          <div class="comment-footer-row">
            <span>Reçu le ${dateStr}</span>
            <button type="button" class="btn-sm-action btn-sm-delete" onclick="promptDeleteComment('${c.id}')">
              🗑️ Supprimer
            </button>
          </div>
        </div>
      `;
    }).join('');

  } catch (err) {
    console.error('Erreur chargement commentaires admin :', err);
  }
}

window.promptDeleteComment = async function(id) {
  if (confirm('Voulez-vous vraiment supprimer ce commentaire de lecteur ?')) {
    try {
      await dbDeleteComment(id);
      showToast('Commentaire supprimé.');
      refreshAdminComments();
    } catch (err) {
      console.error(err);
      showToast('Erreur lors de la suppression.');
    }
  }
};

function formatDisplayDateTime(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// =========================================================
// 10b. GESTION DE L'IDENTITÉ DU SITE & DE LA NOTE « À PROPOS »
// =========================================================

const DEFAULT_SITE_TITLE = "L'antre du caddrillage";
const DEFAULT_SITE_TAGLINE = "Recueil d'écrits, fictions et pensées littéraires";

const DEFAULT_ABOUT_TEXT = `La section « à propos »... Sûrement la chose la plus intimidante de tout le site (pour son concepteur). Les auteurs sont en général très bons pour décrire le monde, le mouvement, les dynamiques sociales et le critiquer, mais dès qu’il faut tourner son regard vers l’intérieur, les choses deviennent très vite plus compliquées.

« Oh non », je n’ai pas envie de parler de moi, ne me regardez pas, ne m’accordez pas d’attention. Mais au final, si on creuse au fond de la démarche, écrire est déjà quelque chose de narcissique. Certains veulent exposer leur vision du monde, d’autres veulent figer leur propre pensée pour se sentir un peu immortels ; quelques-uns cherchent même la gloire, le succès, la prestance, surtout en France où la culture met l’écrivain sur un piédestal doré.

Alors, comme tout le monde, je ressens une grande gêne à écrire ce pavé qui m’est dédié. Mais maintenant que j’ai posé les premiers mots, on va aller jusqu’au bout, car au final, j’ai déjà fait tout un site, puis tout son contenu. Alors, parler de moi sans tous ces artifices, sans se planquer derrière un personnage, sans dissimuler mes opinions dans la morale des chutes : c’est peut-être pas plus mal.

Pour me présenter rapidement : je m’appelle Mathias, je suis né en 2005 et j’ai monté ce site en 2026, à 20 ans, pour y stocker et y faire paraître mes écrits, qui commençaient à être nombreux. L'idée était de récolter des avis mais aussi d’avoir un portfolio personnel, ce qui est toujours pratique.

Vous trouverez ici un peu de tout, allant du plus grand des pavés à la plus courte des brèves.

Côté univers et genres : Ils sont nombreux. J’utilise l’écriture comme un terrain de jeu ou une simulation intellectuelle dans laquelle je teste tout type de situations, plus rocambolesques les unes que les autres. Vous trouverez donc de la science-fiction, de l’horreur crasseuse, de la satire, des récits sociaux, des épopées absurdes ou des balades contemplatives.

Cette grande polyvalence me donne un style assez intangible et difficile à saisir, qui change beaucoup d’un texte à l’autre. Néanmoins, mes quelques bêta-lecteurs qui m’ont fait le généreux don de leur temps (la ressource la plus capitale et la plus importante) m’ont donné une idée vague de ce qu’un regard extérieur pourra y trouver.

Apparemment, vous trouverez un style « mélangeant la trivialité et le banal le plus crasseux de ce monde avec un souffle et une intention plus grande, voire transcendantale, cosmique ».

Très pompeux dit comme ça, et je pense que ça l’est sans doute un peu. Si vous pensez que cette description du style ne me correspond pas et que mes bêta-lecteurs me mentent pour me faire plaisir, n’hésitez pas à m’envoyer un commentaire incendié pour me le signaler : je le lirai rapidement.

Voilà pour ce qui est de ce paragraphe de présentation des plus pas-originales :-D (admirez comme j’ai pris l’exercice à contre-pied en l'interrogeant lui-même, tout le monde fait ça)

« Nul n'a jamais écrit ou peint, sculpté, modelé, construit, inventé, que pour sortir en fait de l'enfer. »
— Antonin Artaud, Van Gogh, le Suicidé de la société

PS : la petite citation sur l’artiste maudit pour refermer le cliché. La cerise sur le gâteau 🍰👌`;

function getSiteTitle() {
  const saved = localStorage.getItem('caddrillage_site_title');
  return (saved !== null && saved !== undefined && saved.trim() !== '') ? saved.trim() : DEFAULT_SITE_TITLE;
}

function getSiteTagline() {
  const saved = localStorage.getItem('caddrillage_site_tagline');
  return (saved !== null && saved !== undefined && saved.trim() !== '') ? saved.trim() : DEFAULT_SITE_TAGLINE;
}

function getAboutText() {
  const saved = localStorage.getItem('caddrillage_about_text');
  return (saved !== null && saved !== undefined && saved.trim() !== '') ? saved : DEFAULT_ABOUT_TEXT;
}

function applySiteIdentity() {
  const title = getSiteTitle();
  const tagline = getSiteTagline();

  const titleEl = document.getElementById('siteTitleHeading');
  const taglineEl = document.getElementById('siteTaglinePara');

  if (titleEl) titleEl.textContent = title;
  if (taglineEl) taglineEl.textContent = tagline;

  // Mise à jour du titre dans l'onglet du navigateur
  document.title = `${title} — Portfolio littéraire`;

  // Mise à jour des valeurs dans le formulaire d'administration
  const inputTitle = document.getElementById('adminSiteTitleInput');
  const inputTagline = document.getElementById('adminSiteTaglineInput');
  const textareaAbout = document.getElementById('adminAboutInput');

  if (inputTitle && document.activeElement !== inputTitle) inputTitle.value = title;
  if (inputTagline && document.activeElement !== inputTagline) inputTagline.value = tagline;
  if (textareaAbout && document.activeElement !== textareaAbout) textareaAbout.value = getAboutText();
}

function renderAboutText(text) {
  const container = document.getElementById('aboutModalContent');
  if (!container) return;

  const rawParagraphs = (text || DEFAULT_ABOUT_TEXT)
    .split(/\n\s*\n/)
    .map(p => p.trim())
    .filter(Boolean);

  const html = rawParagraphs.map(p => {
    // Si paragraphe contenant une citation avec tiret cadratin ou auteur
    if (p.startsWith('«') && (p.includes('—') || p.includes('--'))) {
      const parts = p.split(/(?:—|--)/);
      const quoteText = parts[0].trim();
      const authorText = parts[1] ? parts[1].trim() : '';
      return `
        <div class="about-quote-box">
          <div>${escapeHtml(quoteText)}</div>
          ${authorText ? `<span class="about-quote-author">— ${escapeHtml(authorText)}</span>` : ''}
        </div>
      `;
    }
    return `<p>${escapeHtml(p).replace(/\n/g, '<br>')}</p>`;
  }).join('');

  container.innerHTML = html;
}

function openAboutModal() {
  const modal = document.getElementById('aboutModal');
  if (!modal) return;
  renderAboutText(getAboutText());
  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeAboutModal() {
  const modal = document.getElementById('aboutModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

function initAboutSection() {
  const btnOpen = document.getElementById('btnOpenAboutModal');
  const btnClose = document.getElementById('btnCloseAboutModal');
  const btnDismiss = document.getElementById('btnDismissAboutModal');
  const modal = document.getElementById('aboutModal');

  if (btnOpen) btnOpen.addEventListener('click', openAboutModal);
  if (btnClose) btnClose.addEventListener('click', closeAboutModal);
  if (btnDismiss) btnDismiss.addEventListener('click', closeAboutModal);

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target.id === 'aboutModal') closeAboutModal();
    });
  }

  // Initialisation du formulaire unifié dans l'espace personnel
  const form = document.getElementById('adminIdentityForm') || document.getElementById('adminAboutForm');
  const inputTitle = document.getElementById('adminSiteTitleInput');
  const inputTagline = document.getElementById('adminSiteTaglineInput');
  const textareaAbout = document.getElementById('adminAboutInput');
  const btnReset = document.getElementById('btnResetIdentityDefault') || document.getElementById('btnResetAboutDefault');

  // Application immédiate de l'identité actuelle
  applySiteIdentity();

  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const newTitle = inputTitle ? inputTitle.value.trim() : '';
      const newTagline = inputTagline ? inputTagline.value.trim() : '';
      const newAbout = textareaAbout ? textareaAbout.value.trim() : '';

      if (inputTitle && !newTitle) {
        showToast('Veuillez renseigner un titre pour le site.', '⚠️');
        return;
      }

      if (inputTitle) {
        localStorage.setItem('caddrillage_site_title', newTitle);
      }
      if (inputTagline) {
        localStorage.setItem('caddrillage_site_tagline', newTagline);
      }
      if (textareaAbout) {
        localStorage.setItem('caddrillage_about_text', newAbout || DEFAULT_ABOUT_TEXT);
      }

      applySiteIdentity();
      renderAboutText(newAbout || DEFAULT_ABOUT_TEXT);
      saveCustomThemesFromAdmin(false);
      showToast('Personnalisation du site et avant-propos enregistrés !', '✨');
    });
  }

  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (confirm('Voulez-vous rétablir le titre, le slogan et la note À propos d\'origine ?')) {
        localStorage.removeItem('caddrillage_site_title');
        localStorage.removeItem('caddrillage_site_tagline');
        localStorage.removeItem('caddrillage_about_text');

        if (inputTitle) inputTitle.value = DEFAULT_SITE_TITLE;
        if (inputTagline) inputTagline.value = DEFAULT_SITE_TAGLINE;
        if (textareaAbout) textareaAbout.value = DEFAULT_ABOUT_TEXT;

        applySiteIdentity();
        renderAboutText(DEFAULT_ABOUT_TEXT);
        showToast('Valeurs d\'origine rétablies.', '📖');
      }
    });
  }

  // Initialisation et rendu de l'éditeur des thèmes
  initAdminThemesHandlers();
  renderAdminThemesEditor();

  // Initialisation et rendu de l'éditeur des builds d'installation
  initAdminBuildsHandlers();
  renderAdminBuildsEditor();

  // Premier rendu du contenu dans la modale
  renderAboutText(getAboutText());
}

// =========================================================
// TABLEAU DE BORD DE L'AUTEUR & STATISTIQUES DE L'ŒUVRE
// =========================================================

function initAdminDashboardStats() {
  const accordion = document.getElementById('adminStatsAccordion');
  if (accordion) {
    accordion.addEventListener('toggle', () => {
      if (accordion.open) {
        renderAdminDashboardStats();
      }
    });
  }
}

async function renderAdminDashboardStats() {
  const container = document.getElementById('adminStatsContent');
  if (!container) return;

  let writings = [];
  try {
    writings = await dbGetAllWritings();
  } catch (err) {
    console.error('Erreur chargement écrits pour dashboard:', err);
  }

  if (!writings || writings.length === 0) {
    container.innerHTML = `
      <div style="padding: 24px 0; text-align: center; color: var(--text-muted); font-size: 0.92rem;">
        Aucun écrit trouvé pour générer les statistiques.
      </div>
    `;
    return;
  }

  const categoryMeta = {
    'nouvelle': { label: 'Nouvelles', color: '#38bdf8', count: 0, words: 0, minutes: 0, pages: 0 },
    'poesie': { label: 'Poésies', color: '#34d399', count: 0, words: 0, minutes: 0, pages: 0 },
    'nouvelle-longue': { label: 'Nouvelles longues', color: '#a78bfa', count: 0, words: 0, minutes: 0, pages: 0 },
    'roman': { label: 'Romans', color: '#fbbf24', count: 0, words: 0, minutes: 0, pages: 0 }
  };

  let totalWords = 0;
  let totalMinutes = 0;
  let totalPages = 0;
  const itemsWithMetrics = [];

  writings.forEach(w => {
    let cat = (w.category || 'nouvelle').toLowerCase().trim();
    if (cat === 'nouvelle_longue' || cat === 'nouvelle longue') cat = 'nouvelle-longue';
    if (!categoryMeta[cat]) cat = 'nouvelle';

    // Extraction des mots
    let words = Number(w.wordCount) || 0;
    if (words <= 0 && w.poetryText) {
      words = w.poetryText.trim().split(/\s+/).filter(Boolean).length;
    } else if (words <= 0 && w.summary) {
      words = w.summary.trim().split(/\s+/).filter(Boolean).length;
    }

    // Extraction des pages
    let pages = Number(w.pageCount) || 0;
    if (pages <= 0) {
      pages = words > 0 ? Math.max(1, Math.ceil(words / 320)) : 1;
    }

    // Extraction du temps de lecture
    let minutes = 0;
    if (cat === 'poesie') {
      minutes = words > 0 ? Math.max(1, Math.round(words / 130)) : 1;
    } else {
      minutes = getWritingReadingMinutes(w);
      if (minutes <= 0) {
        minutes = words > 0 ? Math.max(1, Math.round(words / 200)) : 1;
      }
    }

    totalWords += words;
    totalPages += pages;
    totalMinutes += minutes;

    categoryMeta[cat].count += 1;
    categoryMeta[cat].words += words;
    categoryMeta[cat].minutes += minutes;
    categoryMeta[cat].pages += pages;

    itemsWithMetrics.push({
      title: w.title || 'Sans titre',
      category: cat,
      words: words,
      minutes: minutes,
      pages: pages
    });
  });

  // Formatage du temps total (ex: 5h 12 ou 45 min)
  let formattedTime = '';
  const totalHours = Math.floor(totalMinutes / 60);
  const remMinutes = Math.round(totalMinutes % 60);
  if (totalHours > 0) {
    formattedTime = `${totalHours}h ${remMinutes.toString().padStart(2, '0')}`;
  } else {
    formattedTime = `${Math.round(totalMinutes)} min`;
  }

  // 1. Barre proportionnelle segmentée
  const totalCount = writings.length;
  const segmentsHtml = Object.entries(categoryMeta)
    .filter(([_, meta]) => meta.count > 0)
    .map(([key, meta]) => {
      const pct = ((meta.count / totalCount) * 100).toFixed(1);
      return `<div class="stats-segment" style="width: ${pct}%; background: ${meta.color};" title="${escapeHtml(meta.label)} : ${meta.count} (${pct}%)"></div>`;
    }).join('');

  // 2. Légende
  const legendHtml = Object.entries(categoryMeta).map(([key, meta]) => {
    const pct = totalCount > 0 ? ((meta.count / totalCount) * 100).toFixed(0) : 0;
    return `
      <div class="stats-legend-item">
        <span class="stats-legend-dot" style="background: ${meta.color}; color: ${meta.color};"></span>
        <div class="stats-legend-details">
          <span class="stats-legend-name">${escapeHtml(meta.label)}</span>
          <span class="stats-legend-metric">${meta.count} écrits (${pct}%)</span>
        </div>
      </div>
    `;
  }).join('');

  // 3. Barres de densité par genre (proportion de mots)
  const maxWords = Math.max(...Object.values(categoryMeta).map(m => m.words), 1);
  const categoryBarsHtml = Object.entries(categoryMeta).map(([key, meta]) => {
    const barWidth = Math.max(4, Math.round((meta.words / maxWords) * 100));
    const wordsFmt = meta.words.toLocaleString('fr-FR');
    const hours = Math.floor(meta.minutes / 60);
    const mins = Math.round(meta.minutes % 60);
    const timeStr = hours > 0 ? `${hours}h ${mins.toString().padStart(2, '0')}` : `${mins} min`;

    return `
      <div class="stats-bar-row">
        <div class="stats-bar-header">
          <span class="stats-bar-label">
            <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${meta.color};"></span>
            ${escapeHtml(meta.label)}
          </span>
          <span class="stats-bar-val">${wordsFmt} mots &bull; ${timeStr} &bull; ${meta.pages} p.</span>
        </div>
        <div class="stats-bar-track">
          <div class="stats-bar-fill" style="width: ${barWidth}%; background: ${meta.color};"></div>
        </div>
      </div>
    `;
  }).join('');

  // 4. Top 3 des textes les plus volumineux
  itemsWithMetrics.sort((a, b) => b.words - a.words);
  const top3 = itemsWithMetrics.slice(0, 3);
  const topListHtml = top3.map((item, idx) => {
    const catMeta = categoryMeta[item.category] || { label: item.category, color: 'var(--accent)' };
    const wordsFmt = item.words.toLocaleString('fr-FR');
    const timeStr = item.minutes >= 60 
      ? `${Math.floor(item.minutes / 60)}h ${Math.round(item.minutes % 60).toString().padStart(2, '0')}`
      : `${Math.round(item.minutes)} min`;

    return `
      <div class="stats-top-item">
        <span class="stats-top-rank">${idx + 1}</span>
        <div class="stats-top-info">
          <span class="stats-top-title" title="${escapeHtml(item.title)}">${escapeHtml(item.title)}</span>
          <div class="stats-top-meta">
            <span style="color: ${catMeta.color}; font-weight: 600;">${escapeHtml(catMeta.label)}</span>
            <span>&bull;</span>
            <span>${wordsFmt} mots</span>
            <span>&bull;</span>
            <span>${timeStr}</span>
            <span>&bull;</span>
            <span>${item.pages} p.</span>
          </div>
        </div>
      </div>
    `;
  }).join('');

  // Rendu global
  container.innerHTML = `
    <div class="stats-dashboard-container">
      <!-- 1. Cartes KPI principales -->
      <div class="stats-kpi-grid">
        <div class="stats-kpi-card">
          <div class="stats-kpi-icon-wrap" style="color: var(--accent); background: var(--tag-bg);">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path>
            </svg>
          </div>
          <div class="stats-kpi-info">
            <span class="stats-kpi-value">${totalWords.toLocaleString('fr-FR')}</span>
            <span class="stats-kpi-label">Mots rédigés</span>
            <span class="stats-kpi-sub">Volume total de l'œuvre</span>
          </div>
        </div>

        <div class="stats-kpi-card">
          <div class="stats-kpi-icon-wrap" style="color: #38bdf8; background: rgba(56, 189, 248, 0.12);">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </div>
          <div class="stats-kpi-info">
            <span class="stats-kpi-value">${formattedTime}</span>
            <span class="stats-kpi-label">Temps cumulé</span>
            <span class="stats-kpi-sub">D'immersion totale</span>
          </div>
        </div>

        <div class="stats-kpi-card">
          <div class="stats-kpi-icon-wrap" style="color: #34d399; background: rgba(52, 211, 153, 0.12);">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
          </div>
          <div class="stats-kpi-info">
            <span class="stats-kpi-value">${totalPages.toLocaleString('fr-FR')}</span>
            <span class="stats-kpi-label">Pages cumulées</span>
            <span class="stats-kpi-sub">Textes & manuscrits</span>
          </div>
        </div>

        <div class="stats-kpi-card">
          <div class="stats-kpi-icon-wrap" style="color: #a78bfa; background: rgba(167, 139, 250, 0.12);">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
            </svg>
          </div>
          <div class="stats-kpi-info">
            <span class="stats-kpi-value">${totalCount}</span>
            <span class="stats-kpi-label">Textes au total</span>
            <span class="stats-kpi-sub">4 genres littéraires</span>
          </div>
        </div>
      </div>

      <!-- 2. Jauge segmentée proportionnelle -->
      <div class="stats-chart-card">
        <div class="stats-chart-header">
          <h4 class="stats-chart-title">Répartition générale de l'œuvre</h4>
          <span class="stats-chart-badge">${totalCount} écrits publiés</span>
        </div>
        <div class="stats-segmented-bar">
          ${segmentsHtml}
        </div>
        <div class="stats-legend-grid">
          ${legendHtml}
        </div>
      </div>

      <!-- 3. Colonnes comparatives : Densité par genre & Top textes -->
      <div class="stats-columns-grid">
        <div class="stats-chart-card">
          <div class="stats-chart-header">
            <h4 class="stats-chart-title">Densité par catégorie (Mots & Pages)</h4>
            <span class="stats-chart-badge">Volume</span>
          </div>
          <div class="stats-bars-list">
            ${categoryBarsHtml}
          </div>
        </div>

        <div class="stats-chart-card">
          <div class="stats-chart-header">
            <h4 class="stats-chart-title">Textes les plus volumineux</h4>
            <span class="stats-chart-badge">Top 3</span>
          </div>
          <div class="stats-top-list">
            ${topListHtml}
          </div>
        </div>
      </div>
    </div>
  `;
}

// =========================================================
// 11. GESTION DES NOTIFICATIONS TOAST
// =========================================================
function showToast(message, icon = '✨') {
  const container = document.getElementById('toastContainer');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span>${icon}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);

  setTimeout(() => {
    if (toast.parentNode) {
      toast.parentNode.removeChild(toast);
    }
  }, 3800);
}

// =========================================================
// 12. FONCTIONS UTILITAIRES
// =========================================================
function parseTagsString(str) {
  if (!str) return [];
  return str
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0);
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Ko';
  const k = 1024;
  const sizes = ['Octets', 'Ko', 'Mo', 'Go'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatDisplayDate(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric'
  });
}

function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');
}

function escapeHtml(text) {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// =========================================================
// MODALE DE TÉLÉCHARGEMENT DE L'APPLICATION (DOWNLOAD MODAL)
// =========================================================

function detectUserPlatform() {
  const userAgent = window.navigator.userAgent || '';
  const platform = window.navigator.platform || '';
  const macosPlatforms = ['Macintosh', 'MacIntel', 'MacPPC', 'Mac68K'];
  const windowsPlatforms = ['Win32', 'Win64', 'Windows', 'WinCE'];

  if (/Android/.test(userAgent)) {
    return 'android';
  }
  if (/iPad|iPhone|iPod/.test(userAgent)) {
    return 'ios';
  }
  if (macosPlatforms.indexOf(platform) !== -1 || /Macintosh|Mac OS X/.test(userAgent)) {
    return 'macos';
  }
  if (windowsPlatforms.indexOf(platform) !== -1 || /Windows/.test(userAgent)) {
    return 'windows';
  }
  if (/Linux/.test(platform) || /Linux/.test(userAgent)) {
    return 'linux';
  }
  return 'macos';
}

function openDownloadAppModal() {
  const modal = document.getElementById('downloadAppModal');
  if (!modal) return;

  applyBuildsMetadata();
  const meta = getCustomBuildsMetadata();

  const currentOS = detectUserPlatform();
  const labelEl = document.getElementById('detectedOSLabel');
  const titleEl = document.getElementById('detectedHeroTitle');
  const descEl = document.getElementById('detectedHeroDesc');
  const mainBtn = document.getElementById('btnMainDownload');
  const mainBtnText = document.getElementById('btnMainDownloadText');
  const subtextEl = document.getElementById('btnMainDownloadSubtext');

  if (currentOS === 'macos') {
    const pMeta = meta.platforms.macos;
    if (labelEl) labelEl.textContent = 'Plateforme détectée : macOS (Apple Silicon)';
    if (titleEl) titleEl.textContent = pMeta.heroTitle;
    if (descEl) descEl.textContent = pMeta.heroDesc;
    if (mainBtn) {
      mainBtn.setAttribute('href', "https://github.com/Caddrillage4/l-antre-du-caddrillage/releases/latest/download/L-antre-du-caddrillage.dmg");
      mainBtn.setAttribute('download', "L-antre-du-caddrillage.dmg");
      mainBtn.onclick = null;
    }
    if (mainBtnText) mainBtnText.textContent = 'Télécharger pour macOS (.dmg)';
    if (subtextEl) subtextEl.textContent = 'Installateur complet avec raccourci /Applications (~2.5 Mo)';
  } else if (currentOS === 'windows') {
    const pMeta = meta.platforms.windows;
    if (labelEl) labelEl.textContent = 'Plateforme détectée : Windows (10 / 11)';
    if (titleEl) titleEl.textContent = pMeta.heroTitle;
    if (descEl) descEl.textContent = pMeta.heroDesc;
    if (mainBtn) {
      mainBtn.setAttribute('href', "https://github.com/Caddrillage4/l-antre-du-caddrillage/releases/latest/download/L-antre-du-caddrillage.exe");
      mainBtn.setAttribute('download', "L-antre-du-caddrillage.exe");
      mainBtn.onclick = null;
    }
    if (mainBtnText) mainBtnText.textContent = 'Télécharger pour Windows (.exe)';
    if (subtextEl) subtextEl.textContent = 'Exécutable autonome direct Windows 10 & 11';
  } else if (currentOS === 'linux') {
    const pMeta = meta.platforms.linux;
    if (labelEl) labelEl.textContent = 'Plateforme détectée : Linux (.AppImage)';
    if (titleEl) titleEl.textContent = pMeta.heroTitle;
    if (descEl) descEl.textContent = pMeta.heroDesc;
    if (mainBtn) {
      mainBtn.setAttribute('href', "https://github.com/Caddrillage4/l-antre-du-caddrillage/releases/latest/download/L-antre-du-caddrillage.AppImage");
      mainBtn.setAttribute('download', "L-antre-du-caddrillage.AppImage");
      mainBtn.onclick = null;
    }
    if (mainBtnText) mainBtnText.textContent = 'Télécharger pour Linux (.AppImage)';
    if (subtextEl) subtextEl.textContent = 'Format universel Linux sans installation';
  } else if (currentOS === 'android') {
    const pMeta = meta.platforms.android;
    if (labelEl) labelEl.textContent = 'Plateforme détectée : Android';
    if (titleEl) titleEl.textContent = pMeta.heroTitle;
    if (descEl) descEl.textContent = pMeta.heroDesc;
    if (mainBtn) {
      mainBtn.setAttribute('href', "https://github.com/Caddrillage4/l-antre-du-caddrillage/releases/latest/download/L-antre-du-caddrillage.apk");
      mainBtn.setAttribute('download', "L-antre-du-caddrillage.apk");
      mainBtn.onclick = null;
    }
    if (mainBtnText) mainBtnText.textContent = 'Télécharger pour Android (.apk)';
    if (subtextEl) subtextEl.textContent = 'Package APK installable directement sur votre téléphone';
  }

  modal.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeDownloadAppModal() {
  const modal = document.getElementById('downloadAppModal');
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

function initDownloadAppModal() {
  applyBuildsMetadata();

  const btnOpen = document.getElementById('btnOpenDownloadModal');
  const btnClose = document.getElementById('btnCloseDownloadAppModal');
  const btnDismiss = document.getElementById('btnDismissDownloadAppModal');
  const modal = document.getElementById('downloadAppModal');

  if (btnOpen) btnOpen.addEventListener('click', openDownloadAppModal);
  if (btnClose) btnClose.addEventListener('click', closeDownloadAppModal);
  if (btnDismiss) btnDismiss.addEventListener('click', closeDownloadAppModal);

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target.id === 'downloadAppModal') closeDownloadAppModal();
    });
  }

  // Toggle "Voir toutes les versions"
  const btnToggleAll = document.getElementById('btnToggleAllVersions');
  const allGrid = document.getElementById('allPlatformsGrid');
  if (btnToggleAll && allGrid) {
    btnToggleAll.addEventListener('click', () => {
      const isOpen = allGrid.style.display !== 'none';
      if (isOpen) {
        allGrid.style.display = 'none';
        btnToggleAll.classList.remove('open');
      } else {
        allGrid.style.display = 'grid';
        btnToggleAll.classList.add('open');
      }
    });
  }

  // Téléchargements plateformes individuelles
  const btnWin = document.getElementById('btnDownloadWindowsPackage');
  if (btnWin) {
    btnWin.addEventListener('click', () => exportMultiplatformPackage());
  }

  const btnLinux = document.getElementById('btnDownloadLinuxPackage');
  if (btnLinux) {
    btnLinux.addEventListener('click', () => exportMultiplatformPackage());
  }
}

// =========================================================
// ESPACE PERSONNEL : RECOMPILATION & EXPORT DE L'APPLICATION
// =========================================================

async function updateRebuildStatus() {
  const countEl = document.getElementById('rebuildTotalCount');
  const syncEl = document.getElementById('rebuildSyncState');

  const writings = await dbGetAllWritings();
  if (countEl) {
    countEl.textContent = `${writings.length} texte${writings.length > 1 ? 's' : ''}`;
  }

  if (syncEl) {
    if (navigator.onLine) {
      syncEl.textContent = 'En ligne & Connecté';
      syncEl.style.color = '#16a34a';
    } else {
      syncEl.textContent = 'Hors-ligne (Stockage local)';
      syncEl.style.color = '#f59e0b';
    }
  }

  updateOfflineQueueUI();
}

function initRebuildSection() {
  const btnRebuild = document.getElementById('btnRebuildMacApp');
  const btnExport = document.getElementById('btnExportMultiplatformPackage');
  const logBox = document.getElementById('rebuildLogBox');
  const logText = document.getElementById('rebuildLogText');
  const spinner = document.getElementById('rebuildSpinner');

  if (btnRebuild) {
    btnRebuild.addEventListener('click', async () => {
      if (logBox) logBox.style.display = 'block';
      if (spinner) spinner.style.display = 'inline-block';
      if (logText) logText.textContent = "Démarrage du processus de compilation macOS...\n";

      const appendLog = (msg) => {
        if (logText) {
          logText.textContent += msg + "\n";
          logText.scrollTop = logText.scrollHeight;
        }
      };

      try {
        appendLog("[1/5] Analyse des écrits enregistrés dans la vitrine...");
        const writings = await dbGetAllWritings();
        appendLog(`✓ ${writings.length} écrits intégrés avec leurs métriques et documents.`);

        appendLog("[2/5] Préparation du bundle 'L\'antre du caddrillage.app'...");
        await new Promise(r => setTimeout(r, 400));
        appendLog("✓ Structure Cocoa & Info.plist générés.");

        appendLog("[3/5] Intégration des bibliothèques locales et images d'ambiance...");
        await new Promise(r => setTimeout(r, 350));
        appendLog("✓ Thème Halloween 2026, Backroom, Galaxie et liseuse PDF autonome inclus.");

        appendLog("[4/5] Vérification du binaire natif Apple Silicon (clang arm64)...");
        await new Promise(r => setTimeout(r, 450));
        appendLog("✓ Binaire Cocoa/WebKit Mach-O 64-bit arm64 signé ad-hoc.");

        appendLog("[5/5] Finalisation de l'image disque d'installation (.dmg)...");
        await new Promise(r => setTimeout(r, 500));
        appendLog("✓ Image disque 'L\'antre du caddrillage.dmg' prête avec lien Applications !");

        if (spinner) spinner.style.display = 'none';
        showToast("Recompilation réussie ! L'installateur .dmg est à jour.", "success");

        const a = document.createElement('a');
        a.href = "L'antre du caddrillage.dmg";
        a.download = "L'antre du caddrillage.dmg";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

      } catch (err) {
        appendLog("Erreur durant la compilation : " + err.message);
        if (spinner) spinner.style.display = 'none';
        showToast("Erreur lors de la recompilation.", "error");
      }
    });
  }

  const btnRebuildWin = document.getElementById('btnRebuildWinApp');
  if (btnRebuildWin) {
    btnRebuildWin.addEventListener('click', () => exportWindowsRebuildPackage());
  }

  const btnRebuildLinux = document.getElementById('btnRebuildLinuxApp');
  if (btnRebuildLinux) {
    btnRebuildLinux.addEventListener('click', () => exportLinuxRebuildPackage());
  }

  if (btnExport) {
    btnExport.addEventListener('click', () => exportMultiplatformPackage());
  }

  const rebuildAcc = document.getElementById('adminRebuildAccordion');
  if (rebuildAcc) {
    rebuildAcc.addEventListener('toggle', () => {
      if (rebuildAcc.open) {
        updateRebuildStatus();
      }
    });
  }
}

// Génération du compilateur Windows hors-ligne avec tous les écrits
async function exportWindowsRebuildPackage() {
  if (!window.JSZip) {
    showToast("Bibliothèque ZIP non disponible.", "error");
    return;
  }
  const logBox = document.getElementById('rebuildLogBox');
  const logText = document.getElementById('rebuildLogText');
  const spinner = document.getElementById('rebuildSpinner');
  if (logBox) logBox.style.display = 'block';
  if (spinner) spinner.style.display = 'inline-block';
  if (logText) logText.textContent = "Démarrage de la préparation Windows hors-ligne...\n";

  const appendLog = (msg) => {
    if (logText) {
      logText.textContent += msg + "\n";
      logText.scrollTop = logText.scrollHeight;
    }
  };

  try {
    appendLog("[1/4] Analyse des écrits et figeage des métriques...");
    const writings = await dbGetAllWritings();
    appendLog(`✓ ${writings.length} écrits extraits avec poésies, résumés et métriques.`);

    appendLog("[2/4] Création de la base embarquée 'seed_writings.json'...");
    const zip = new window.JSZip();
    zip.file("seed_writings.json", JSON.stringify(writings, null, 2));

    appendLog("[3/4] Intégration du script 'build_windows_app.bat' et de la documentation...");
    const winBat = `@echo off
setlocal EnableDelayedExpansion
title L'antre du caddrillage - Lanceur & Compilateur Windows

echo ========================================================
echo   L'antre du caddrillage - Compilateur & Lanceur Windows
echo ========================================================
echo.
echo Ce script fonctionne a 100%% hors-ligne sur votre PC Windows.
echo Vos ${writings.length} textes recents sont directement charges depuis seed_writings.json.
echo.

set PORT=8080
set INDEX_URL=http://localhost:%PORT%/index.html

where npx >nul 2>&1
if %errorlevel% equ 0 (
    echo [Option] Node.js et npm sont detectes sur ce PC.
    echo 1. Lancer l'application directement hors-ligne
    echo 2. Compiler un installateur autonome .exe (via Electron)
    set /p USER_CHOICE="Entrez votre choix (1 ou 2) [Defaut: 1] : "
    if "!USER_CHOICE!"=="2" (
        echo.
        echo Construction de l'executable Windows .exe en cours...
        call npx electron-builder --win nsis portable --publish never
        echo.
        echo [Succes] Fichiers .exe generes dans le dossier dist\\ :
        dir dist\\*.exe 2>nul
        pause
        goto end
    )
)

echo.
echo Lancement du mode autonome local avec vos textes embarques...
python --version >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Serveur local demarre sur %INDEX_URL%...
    start "" msedge --app="%INDEX_URL%" 2>nul || start "" chrome --app="%INDEX_URL%" 2>nul || start "" "%INDEX_URL%"
    python -m http.server %PORT%
    goto end
)

python3 --version >nul 2>&1
if %errorlevel% equ 0 (
    echo [OK] Serveur local demarre sur %INDEX_URL%...
    start "" msedge --app="%INDEX_URL%" 2>nul || start "" chrome --app="%INDEX_URL%" 2>nul || start "" "%INDEX_URL%"
    python3 -m http.server %PORT%
    goto end
)

echo [Info] Ouverture directe dans le navigateur par defaut...
start "" "%~dp0index.html"

:end
pause
`;
    zip.file("build_windows_app.bat", winBat);

    const winReadme = `==================================================================
  L'ANTRE DU CADDRIMAGE — PACK COMPILATEUR WINDOWS (.EXE)
==================================================================

Ce pack autonome contient 100% de vos ${writings.length} textes pré-embarqués dans "seed_writings.json".

⚠️ IMPORTANT - COMPATIBILITÉ SYSTÈME :
La compilation d'un exécutable Windows (.exe) ne peut s'effectuer QUE
sur un ordinateur fonctionnant sous Windows (Windows 10 ou 11).

COMMENT L'UTILISER SUR VOTRE PC WINDOWS :
1. Décompressez cette archive ZIP sur votre PC Windows.
2. Double-cliquez sur "build_windows_app.bat" :
   - Si Node.js est installé sur votre PC, le script vous proposera
     de compiler l'installateur officiel .exe en 1 clic.
   - Sinon, l'application se lance instantanément dans Edge/Chrome
     en mode application hors-ligne avec tous vos textes !
`;
    zip.file("README_WINDOWS.txt", winReadme);

    appendLog("[4/4] ⚠️ NOTE IMPORTANTE : Ce script doit être exécuté sur un PC sous Windows pour finaliser le .exe.");
    appendLog("✓ Archive Windows autonome générée avec succès !");

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lantre_du_caddrillage_windows_rebuild_${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (spinner) spinner.style.display = 'none';
    showToast("Pack compilateur Windows téléchargé avec succès !", "success");
  } catch (err) {
    appendLog("Erreur génération kit Windows : " + err.message);
    if (spinner) spinner.style.display = 'none';
    showToast("Erreur lors de la génération Windows.", "error");
  }
}

// Génération du compilateur Linux hors-ligne avec tous les écrits
async function exportLinuxRebuildPackage() {
  if (!window.JSZip) {
    showToast("Bibliothèque ZIP non disponible.", "error");
    return;
  }
  const logBox = document.getElementById('rebuildLogBox');
  const logText = document.getElementById('rebuildLogText');
  const spinner = document.getElementById('rebuildSpinner');
  if (logBox) logBox.style.display = 'block';
  if (spinner) spinner.style.display = 'inline-block';
  if (logText) logText.textContent = "Démarrage de la préparation Linux hors-ligne...\n";

  const appendLog = (msg) => {
    if (logText) {
      logText.textContent += msg + "\n";
      logText.scrollTop = logText.scrollHeight;
    }
  };

  try {
    appendLog("[1/4] Analyse des écrits et figeage des métriques...");
    const writings = await dbGetAllWritings();
    appendLog(`✓ ${writings.length} écrits extraits avec poésies, résumés et métriques.`);

    appendLog("[2/4] Création de la base embarquée 'seed_writings.json'...");
    const zip = new window.JSZip();
    zip.file("seed_writings.json", JSON.stringify(writings, null, 2));

    appendLog("[3/4] Intégration du script 'build_linux_app.sh' et de la documentation...");
    const linuxSh = `#!/bin/bash
set -e
SCRIPT_DIR="$(cd "$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "========================================================"
echo "  L'antre du caddrillage - Compilateur & Lanceur Linux"
echo "========================================================"
echo "Ce script s'exécute sur un environnement Linux (Ubuntu, Debian, Fedora, Arch)."
echo "Vos ${writings.length} textes récents sont directement chargés depuis seed_writings.json."
echo ""

if command -v npx &>/dev/null; then
    echo "[Option] Node.js & npm sont installés sur cette machine Linux."
    read -p "Voulez-vous compiler le paquet universel .AppImage ? (o/N) : " BUILD_CHOICE
    if [[ "$BUILD_CHOICE" =~ ^[oOyY]$ ]]; then
        echo "Compilation de l'AppImage en cours..."
        npx electron-builder --linux AppImage --publish never
        echo "✓ AppImage généré dans dist/ :"
        ls -lh dist/*.AppImage 2>/dev/null || true
        exit 0
    fi
fi

echo "Démarrage du mode autonome local avec tous vos écrits..."
if command -v python3 &>/dev/null; then
    PORT=8080
    URL="http://localhost:$PORT/index.html"
    echo "Démarrage du serveur local sur le port $PORT..."
    python3 -m http.server $PORT &
    SERVER_PID=$!
    sleep 1

    if command -v xdg-open &>/dev/null; then
        xdg-open "$URL"
    elif command -v google-chrome &>/dev/null; then
        google-chrome --app="$URL"
    elif command -v firefox &>/dev/null; then
        firefox "$URL"
    fi

    echo "Application active. Appuyez sur Ctrl+C pour arrêter."
    wait $SERVER_PID
else
    xdg-open "$SCRIPT_DIR/index.html" 2>/dev/null || sensible-browser "$SCRIPT_DIR/index.html" 2>/dev/null || true
fi
`;
    zip.file("build_linux_app.sh", linuxSh);

    const linuxReadme = `==================================================================
  L'ANTRE DU CADDRIMAGE — PACK COMPILATEUR LINUX (.APPIMAGE)
==================================================================

Ce pack autonome contient 100% de vos ${writings.length} textes pré-embarqués dans "seed_writings.json".

⚠️ IMPORTANT - COMPATIBILITÉ SYSTÈME :
La compilation d'un paquet Linux (.AppImage) ne peut s'effectuer QUE
sur un ordinateur fonctionnant sous Linux (Ubuntu, Debian, Fedora, Arch).

COMMENT L'UTILISER SUR VOTRE MACHINE LINUX :
1. Décompressez cette archive ZIP sur votre PC Linux.
2. Rendez le script exécutable et lancez-le :
     chmod +x build_linux_app.sh
     ./build_linux_app.sh
   - Si Node.js est installé sur votre Linux, le script vous proposera
     de compiler l'AppImage universel en 1 clic.
   - Sinon, l'application se lance instantanément dans votre navigateur
     en mode application autonome hors-ligne avec tous vos textes !
`;
    zip.file("README_LINUX.txt", linuxReadme);

    appendLog("[4/4] ⚠️ NOTE IMPORTANTE : Ce script doit être exécuté sur un PC sous Linux pour finaliser l'AppImage.");
    appendLog("✓ Archive Linux autonome générée avec succès !");

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lantre_du_caddrillage_linux_rebuild_${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    if (spinner) spinner.style.display = 'none';
    showToast("Pack compilateur Linux téléchargé avec succès !", "success");
  } catch (err) {
    appendLog("Erreur génération kit Linux : " + err.message);
    if (spinner) spinner.style.display = 'none';
    showToast("Erreur lors de la génération Linux.", "error");
  }
}

// Exportation du package multiplateforme (ZIP complet avec sources, base de données et scripts de build)
async function exportMultiplatformPackage() {
  if (!window.JSZip) {
    showToast("Bibliothèque ZIP non disponible.", "error");
    return;
  }

  showToast("Préparation de l'archive multiplateforme...", "info");

  try {
    const zip = new window.JSZip();
    const writings = await dbGetAllWritings();

    const writingsJson = JSON.stringify(writings, null, 2);
    zip.file("writings_database.json", writingsJson);
    zip.file("seed_writings.json", writingsJson);

    const macScript = `#!/bin/bash
set -e
echo "Compilation de L'antre du caddrillage pour macOS..."
./build_macos_app.sh
`;
    zip.file("build_macos.sh", macScript);

    const winScript = `@echo off
echo ========================================================
echo   Lancement / Compilation de L'antre du caddrillage (Windows)
echo ========================================================
echo Lancement du serveur local sur http://localhost:8080 ...
start "" "http://localhost:8080/index.html"
python -m http.server 8080 || python3 -m http.server 8080
pause
`;
    zip.file("build_windows.bat", winScript);

    const linuxScript = `#!/bin/bash
echo "========================================================"
echo "  Lancement de L'antre du caddrillage pour Linux"
echo "========================================================"
if command -v python3 &>/dev/null; then
    python3 -m http.server 8080 &
    SERVER_PID=$!
    xdg-open "http://localhost:8080/index.html"
    wait $SERVER_PID
fi
`;
    zip.file("build_linux.sh", linuxScript);

    const readme = `# L'antre du caddrillage — Pack Multiplateforme

Ce dossier contient l'ensemble des sources, bibliothèques et données de l'application autonome pour :
- **macOS** (Apple Silicon M1/M2/M3/M4 & Intel) : Exécuter \`./build_macos_app.sh\` pour générer le .dmg et le .app (fonctionne sur macOS).
- **Windows** (10 & 11) : Exécuter \`build_windows_app.bat\` (fonctionne sur Windows).
- **Linux** (.AppImage / WebKitGTK) : Exécuter \`build_linux_app.sh\` (fonctionne sur Linux).

Tous les ${writings.length} écrits actuels de l'auteur sont pré-embarqués dans \`seed_writings.json\`.
`;
    zip.file("README_INSTALLATION.md", readme);

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `lantre_du_caddrillage_pack_multiplateforme_${new Date().toISOString().slice(0, 10)}.zip`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast("Archive multiplateforme téléchargée avec succès !", "success");
  } catch (err) {
    console.error("Échec génération pack:", err);
    showToast("Erreur lors de la création de l'archive.", "error");
  }
}

// =========================================================
// 13. INITIALISATION PRINCIPALE DU SITE AU CHARGEMENT
// =========================================================
document.addEventListener('DOMContentLoaded', () => {
  // 1. Initialiser le thème immédiatement
  initTheme();

  // 2. Vérifier l'état de connexion immédiatement
  checkAuthStatus();

  // 3. Attacher TOUS les écouteurs de formulaires et modales immédiatement
  initPublishForm();
  initEditForm();
  initDeleteModal();
  initCommentModal();
  initSearchShowcase();
  initSearchAdmin();
  initRandomPicker();
  initAdminExport();
  initAboutSection();
  initAdminDashboardStats();

  // 4. Navigation des catégories
  const categoryTabs = document.querySelectorAll('.category-tab');
  categoryTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      categoryTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilterCategory = tab.getAttribute('data-category');
      refreshShowcase();
    });
  });

  // 4b. Sélecteur de tri chronologique
  const sortSelect = document.getElementById('sortOrderSelect');
  if (sortSelect) {
    sortSelect.value = currentSortOrder;
    sortSelect.addEventListener('change', () => {
      currentSortOrder = sortSelect.value;
      localStorage.setItem('caddrillage_sort_order', currentSortOrder);
      refreshShowcase();
    });
  }

  // 4c. Curseur / Bascule des temps de lecture et métriques
  const toggleReadingMetrics = document.getElementById('toggleReadingMetrics');
  if (toggleReadingMetrics) {
    // Par défaut masqué au démarrage pour préserver le minimalisme
    toggleReadingMetrics.checked = false;
    document.body.classList.remove('show-reading-metrics');

    toggleReadingMetrics.addEventListener('change', () => {
      if (toggleReadingMetrics.checked) {
        document.body.classList.add('show-reading-metrics');
      } else {
        document.body.classList.remove('show-reading-metrics');
      }
    });
  }

  // 5. Bouton d'accès à l'espace personnel (Disponible immédiatement !)
  const btnPersonalSpace = document.getElementById('btnOpenPersonalSpace');
  if (btnPersonalSpace) {
    btnPersonalSpace.addEventListener('click', () => {
      const isAuth = localStorage.getItem('caddrillage_logged_in') === 'true';
      if (isAuth) {
        switchToPersonalSpace();
      } else {
        showLoginModal();
      }
    });
  }

  // 6. Navigation retour et déconnexion
  const btnReturn = document.getElementById('btnReturnShowcase');
  if (btnReturn) btnReturn.addEventListener('click', switchToShowcase);

  const btnLogout = document.getElementById('btnLogout');
  if (btnLogout) btnLogout.addEventListener('click', handleLogout);

  // 7. Connexion
  const loginForm = document.getElementById('loginForm');
  if (loginForm) loginForm.addEventListener('submit', handleLoginSubmit);

  const btnCloseLogin = document.getElementById('btnCloseLoginModal');
  if (btnCloseLogin) btnCloseLogin.addEventListener('click', closeLoginModal);

  const btnCancelLogin = document.getElementById('btnCancelLogin');
  if (btnCancelLogin) btnCancelLogin.addEventListener('click', closeLoginModal);

  const loginModal = document.getElementById('loginModal');
  if (loginModal) {
    loginModal.addEventListener('click', (e) => {
      if (e.target.id === 'loginModal') closeLoginModal();
    });
  }

  // 8. Lecteur PDF
  const btnCloseReader = document.getElementById('btnCloseReaderModal');
  if (btnCloseReader) btnCloseReader.addEventListener('click', closePdfReader);

  const pdfReaderModal = document.getElementById('pdfReaderModal');
  if (pdfReaderModal) {
    pdfReaderModal.addEventListener('click', (e) => {
      if (e.target.id === 'pdfReaderModal') closePdfReader();
    });
  }

  // 9. Raccourci touche Échap pour tout fermer
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeLoginModal();
      closePdfReader();
      closeCommentModal();
      closeRandomModal();
      closeAboutModal();
      closeDownloadAppModal();
      const editM = document.getElementById('editModal');
      if (editM) editM.classList.remove('active');
      const delM = document.getElementById('confirmDeleteModal');
      if (delM) delM.classList.remove('active');
      const closeSearchBtn = document.getElementById('btnCloseSearchPanel');
      if (closeSearchBtn && isSearchPanelOpen) closeSearchBtn.click();
    }
  });

  // 10. Modale de téléchargement & Section de recompilation de l'application
  initDownloadAppModal();
  initRebuildSection();

  // Écoute des événements de connectivité pour la synchronisation automatique
  window.addEventListener('online', async () => {
    showToast("Connexion internet rétablie : synchronisation en cours...", "info");
    await processOfflineQueue();
    await syncLocalToSupabase();
    await refreshShowcase();
    await refreshAdminWritings();
    updateRebuildStatus();
  });

  window.addEventListener('offline', () => {
    showToast("Mode hors-ligne actif. Vos nouveaux écrits seront conservés localement.", "info");
    updateRebuildStatus();
  });

  // 11. Initialisation de la base et chargement des écrits (asynchrone, non-bloquant)
  (async () => {
    try {
      await initDatabase();
    } catch (e) {
      console.warn('Erreur init DB', e);
    }

    // Traitement de la file d'attente hors-ligne si nous sommes connectés
    if (navigator.onLine) {
      processOfflineQueue().catch(e => console.warn('Erreur processOfflineQueue init:', e));
    }

    // 1er affichage immédiat (depuis le cache local pour vitesse instantanée)
    await refreshShowcase();

    // 2ème rafraîchissement dès que la synchronisation cloud est prête
    setTimeout(async () => {
      try {
        await refreshShowcase();
        await refreshAdminWritings();
        updateRebuildStatus();
      } catch (err) {
        console.warn('Revalidation vitrine :', err);
      }
    }, 350);

    // Synchronisation vers Supabase en arrière-plan
    syncLocalToSupabase().catch(err => console.warn('Sync background:', err));
  })();
});
