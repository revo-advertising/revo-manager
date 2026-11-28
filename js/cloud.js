/* Connexion et enregistrement en ligne automatique (API REST de Supabase, sans bibliothèque) */
const SESSION_KEY = 'revo-manager-session';
const SYNC_KEY = 'revo-manager-sync';          // { userId, version, dirty, saveId }
const ASIDE_KEY = 'revo-manager-copie-locale'; // copie mise de côté avant tout remplacement non envoyé

const Cloud = {
  get enabled() { return !!(CLOUD_CONFIG.url && CLOUD_CONFIG.key); },
  ready: false,      // vrai une fois les données en ligne chargées
  version: 0,
  dirty: false,
  saveId: null,      // identifiant du dernier envoi, pour reconnaître un envoi dont la réponse s'est perdue
  changes: 0,
  pushing: false,
  blocked: false,
  timer: null,
  state: 'ok',
};

const readJSON = k => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
const writeJSON = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const session = () => readJSON(SESSION_KEY);

function isSecretKey(key) {
  if (key.startsWith('sb_secret_')) return true;
  try { return JSON.parse(atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).role === 'service_role'; } catch (e) { return false; }
}

class CloudError extends Error { constructor(kind, message) { super(message || kind); this.kind = kind; } }

async function request(path, { method = 'GET', body, token, headers = {} } = {}) {
  let res;
  try {
    res = await fetch(CLOUD_CONFIG.url.replace(/\/$/, '') + path, {
      method, cache: 'no-store',
      headers: { apikey: CLOUD_CONFIG.key, 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) { throw new CloudError('network'); }
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch (e) { /* réponse non JSON */ }
  if (!res.ok) {
    const kind = res.status === 401 ? 'auth' : res.status === 409 ? 'exists' : res.status >= 500 || res.status === 429 ? 'network' : 'refused';
    const err = new CloudError(kind, json?.msg || json?.message || json?.error_description || `Erreur ${res.status}`);
    err.status = res.status; throw err;
  }
  return json;
}

function keepSession(s) {
  writeJSON(SESSION_KEY, { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: Math.floor(Date.now() / 1000) + (s.expires_in || 3600), userId: s.user.id, email: s.user.email });
}
let refreshing = null;
async function accessToken(force = false) {
  const s = session();
  if (!s) throw new CloudError('auth');
  if (!force && s.expires_at - 60 > Date.now() / 1000) return s.access_token;
  refreshing ||= request('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } })
    .then(keepSession)
    .catch(e => { throw e.kind === 'network' ? e : new CloudError('auth'); })
    .finally(() => { refreshing = null; });
  await refreshing;
  return session().access_token;
}
async function rest(path, opts = {}) {
  try { return await request('/rest/v1/' + path, { ...opts, token: await accessToken() }); }
  catch (e) {
    if (e.kind !== 'auth') throw e;
    return request('/rest/v1/' + path, { ...opts, token: await accessToken(true) });
  }
}
const fetchRemote = async (columns = 'data,version,save_id') => (await rest(`workspace?select=${columns}&user_id=eq.${session().userId}`))[0] || null;

/* ---------- Cache local et état ---------- */
function rememberSync() { writeJSON(SYNC_KEY, { userId: session()?.userId, version: Cloud.version, dirty: Cloud.dirty, saveId: Cloud.saveId }); }
function cacheLocally() {
  try { writeJSON(KEY, DB); rememberSync(); }
  catch (e) { /* cache plein ou refusé : l'envoi en ligne reste fait depuis la mémoire */ }
}
const SYNC_LABELS = { ok: 'Enregistré en ligne', saving: 'Enregistrement…', offline: 'Hors ligne : pas encore enregistré', error: 'Non enregistré : réessayer' };
function setState(state) {
  Cloud.state = state;
  let el = $('#sync');
  if (!el) {
    el = document.createElement('button'); el.id = 'sync'; el.type = 'button'; el.setAttribute('role', 'status');
    el.onclick = () => { if (Cloud.dirty) push(); };
    document.body.append(el);
  }
  el.hidden = !Cloud.ready;
  el.className = state; el.textContent = SYNC_LABELS[state];
}

/* ---------- Envoi ---------- */
function cloudSave() {
  if (!Cloud.ready || Cloud.blocked) return;
  Cloud.dirty = true; Cloud.changes++;
  cacheLocally(); setState('saving');
  clearTimeout(Cloud.timer); Cloud.timer = setTimeout(push, 800);
}
async function push() {
  if (Cloud.pushing || Cloud.blocked || !Cloud.dirty) return;
  Cloud.pushing = true; clearTimeout(Cloud.timer); setState('saving');
  const sent = Cloud.changes;
  try {
    /* si l'envoi précédent est arrivé sans que la réponse revienne, on repart de sa version */
    if (Cloud.saveId) {
      const remote = await fetchRemote('version,save_id');
      if (remote && remote.save_id === Cloud.saveId) Cloud.version = remote.version;
    }
    Cloud.saveId = uid(); rememberSync();
    const rows = await rest(`workspace?user_id=eq.${session().userId}&version=eq.${Cloud.version}&select=version`, {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: { data: DB, version: Cloud.version + 1, save_id: Cloud.saveId },
    });
    if (!rows.length) { Cloud.pushing = false; return showConflict(); }
    Cloud.version = rows[0].version; Cloud.saveId = null;
    Cloud.dirty = Cloud.changes !== sent;
    rememberSync();
    setState(Cloud.dirty ? 'saving' : 'ok');
    Cloud.pushing = false;
    if (Cloud.dirty) push();
  } catch (e) {
    Cloud.pushing = false;
    if (e.kind === 'auth') return showLogin('Votre session a expiré. Reconnectez-vous : vos dernières modifications sont conservées.');
    setState(e.kind === 'network' ? 'offline' : 'error');
    if (e.kind !== 'network') toast('Enregistrement refusé : ' + e.message);
    clearTimeout(Cloud.timer); Cloud.timer = setTimeout(push, 8000);
  }
}

/* Récupère les changements faits sur un autre appareil, sans interrompre une saisie en cours */
async function pull() {
  if (!Cloud.ready || Cloud.blocked || Cloud.pushing) return;
  if (Cloud.dirty) return push();
  if (/^#\/(new|edit|settings)/.test(location.hash) || $('#modal').innerHTML) return;
  try {
    const head = await fetchRemote('version');
    if (!head || head.version === Cloud.version) return;
    const changes = Cloud.changes, remote = await fetchRemote();
    if (Cloud.changes !== changes || /^#\/(new|edit|settings)/.test(location.hash) || $('#modal').innerHTML) return;
    adopt(remote); render(); toast('Données mises à jour.');
  } catch (e) { if (e.kind === 'auth') showLogin('Votre session a expiré. Reconnectez-vous.'); }
}
function adopt(remote) {
  DB = remote.data; normalize();
  Cloud.version = remote.version; Cloud.dirty = false; Cloud.saveId = null;
  cacheLocally();
}

/* ---------- Écrans ---------- */
function gate(inner) {
  closeModal();
  if ($('#sync')) $('#sync').hidden = true;
  $('#app').innerHTML = `<div class="gate"><div class="card"><img src="assets/logo.svg" alt="Revo Manager">${inner}</div></div>`;
  return $('.gate .card');
}
function showLogin(message = '') {
  Cloud.ready = false;
  const el = gate(`<h2>Connexion</h2>${message ? `<p class="demo">${esc(message)}</p>` : ''}<form class="grid">${field('Email', '<input type="email" name="email" autocomplete="username" required>')}${field('Mot de passe', '<input type="password" name="password" autocomplete="current-password" required>')}<button class="btn primary">Se connecter</button><p class="red" data-error role="alert"></p></form>`);
  $('form', el).onsubmit = async e => {
    e.preventDefault();
    const button = $('button', el); button.disabled = true; $('[data-error]', el).textContent = '';
    try {
      keepSession(await request('/auth/v1/token?grant_type=password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }));
      await openWorkspace();
    } catch (err) {
      if (!el.isConnected) return showError(err);
      button.disabled = false;
      $('[data-error]', el).textContent = err.kind === 'network' ? 'Pas de connexion au serveur. Réessayez.' : err.status === 400 ? 'Email ou mot de passe incorrect.' : err.message;
    }
  };
}
function showError(err) {
  const el = gate(`<h2>Données indisponibles</h2><p>${err.kind === 'network' ? 'Impossible de joindre le serveur. Vérifiez votre connexion Internet.' : esc(err.message)}</p><div class="row"><button class="btn primary" data-retry>Réessayer</button><button class="btn" data-out>Se déconnecter</button></div>`);
  $('[data-retry]', el).onclick = () => openWorkspace().catch(showError);
  $('[data-out]', el).onclick = () => { localStorage.removeItem(SESSION_KEY); showLogin(); };
}
/* Première connexion : la base est vide, on la remplit avec les données réelles */
function showFirstUpload(local) {
  const has = local && (local.docs?.length || local.accounts?.length);
  const el = gate(`<h2>Première mise en ligne</h2><p>Votre espace en ligne est vide. Choisissez les données de départ.</p>
    ${has ? `<p><button class="btn primary" data-local>Mettre en ligne les données de ce navigateur (${local.accounts.length} comptes, ${local.docs.length} documents)</button></p>` : ''}
    ${field('Ou choisir un fichier de sauvegarde (.json)', '<input type="file" accept=".json">')}
    <p><button class="btn sm" data-empty>Commencer avec une application vide</button></p><p class="red" data-error role="alert"></p>`);
  const create = async data => {
    try {
      await rest('workspace', { method: 'POST', body: { data, version: 1 } });
      await openWorkspace();
    } catch (err) {
      if (err.kind === 'exists') return openWorkspace().catch(showError);
      if (el.isConnected) $('[data-error]', el).textContent = err.kind === 'network' ? 'Pas de connexion au serveur. Réessayez.' : err.message;
    }
  };
  if (has) $('[data-local]', el).onclick = e => { e.target.disabled = true; create(local); };
  $('input[type=file]', el).onchange = async e => {
    let data;
    try { data = parseBackup(await e.target.files[0].text()); }
    catch (err) { return $('[data-error]', el).textContent = "Ce fichier n'est pas une sauvegarde Revo Manager valide."; }
    if (confirm(`Mettre en ligne ${data.accounts.length} comptes et ${data.docs.length} documents ?`)) create(data);
  };
  $('[data-empty]', el).onclick = () => { if (confirm('Démarrer sans aucune donnée ?')) create(emptyDB()); };
}
/* Modifié ailleurs pendant qu'une modification locale n'était pas envoyée : on n'écrase rien sans le dire */
function showConflict() {
  Cloud.blocked = true;
  const mine = JSON.stringify(DB, null, 1);
  try { localStorage.setItem(ASIDE_KEY, mine); } catch (e) { /* le téléchargement reste possible */ }
  const el = gate(`<h2>Données modifiées ailleurs</h2><p>Un autre appareil ou onglet a enregistré des changements avant celui-ci. Votre dernière modification faite ici n'a pas été envoyée.</p><div class="row"><button class="btn primary" data-load>Charger la version en ligne</button><button class="btn" data-keep>Télécharger ma version d'ici</button></div>`);
  $('[data-keep]', el).onclick = () => downloadFile(`revo-manager-${today()}-non-envoye.json`, mine, 'application/json');
  $('[data-load]', el).onclick = () => { Cloud.blocked = false; Cloud.dirty = false; Cloud.saveId = null; rememberSync(); openWorkspace().catch(showError); };
}

/* ---------- Ouverture ---------- */
async function openWorkspace() {
  const s = session();
  if (!s) return showLogin();
  Cloud.ready = false;
  const meta = readJSON(SYNC_KEY), cached = readJSON(KEY);
  const mine = meta && meta.userId === s.userId && cached?.settings;
  let remote;
  try { remote = await fetchRemote(); }
  catch (e) {
    if (e.kind === 'auth') { localStorage.removeItem(SESSION_KEY); return showLogin('Reconnectez-vous.'); }
    if (e.kind !== 'network' || !mine) throw e;
    /* hors ligne : on travaille sur la dernière copie de ce navigateur, envoyée au retour du réseau */
    DB = cached; normalize();
    Object.assign(Cloud, { version: meta.version, dirty: meta.dirty, saveId: meta.saveId, ready: true });
    setState('offline'); render();
    if (Cloud.dirty) Cloud.timer = setTimeout(push, 8000);
    return;
  }
  if (!remote) return showFirstUpload(cached?.settings && !cached.demo && (!meta || meta.userId === s.userId) ? cached : null);

  if (mine && meta.dirty) {
    const arrived = meta.saveId && remote.save_id === meta.saveId;
    DB = cached; normalize();
    Object.assign(Cloud, { version: arrived ? remote.version : meta.version, dirty: true, saveId: meta.saveId, ready: true });
    if (remote.version !== Cloud.version) return showConflict();
    setState('saving'); render(); return push();
  }
  /* données présentes dans ce navigateur avant la mise en ligne : on les garde de côté */
  if (!meta && cached?.settings && cached.docs?.length) { try { writeJSON(ASIDE_KEY, cached); } catch (e) { /* facultatif */ } }
  adopt(remote);
  Cloud.ready = true; setState('ok'); render();
}

async function signOut() {
  if (Cloud.dirty) { push(); return toast("Attendez la fin de l'enregistrement avant de vous déconnecter."); }
  if (!confirm('Se déconnecter de Revo Manager sur cet appareil ?')) return;
  try { await request('/auth/v1/logout?scope=local', { method: 'POST', token: await accessToken() }); } catch (e) { /* déconnexion locale quand même */ }
  Cloud.ready = false;
  [SESSION_KEY, SYNC_KEY, ASIDE_KEY, KEY].forEach(k => localStorage.removeItem(k));
  DB = emptyDB(); showLogin();
}

/* Versions gardées automatiquement par la base : une par jour de modification */
const listHistory = () => rest(`workspace_history?select=id,day&user_id=eq.${session().userId}&order=day.desc`);
async function restoreHistory(id) {
  const [row] = await rest(`workspace_history?select=data&id=eq.${+id}`);
  if (!row) throw new CloudError('refused', 'Version introuvable.');
  DB = row.data; normalize(); save(); render();
}

function cloudStart() {
  if (isSecretKey(CLOUD_CONFIG.key)) return gate('<h2>Configuration refusée</h2><p>La clé indiquée est une clé secrète. Utilisez la clé publique du projet, et remplacez la clé secrète dans Supabase.</p>');
  gate('<p>Chargement de vos données…</p>');
  window.addEventListener('online', () => pull());
  window.addEventListener('focus', () => pull());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); else if (Cloud.dirty) push(); });
  window.addEventListener('beforeunload', e => { if (Cloud.dirty) { e.preventDefault(); e.returnValue = ''; } });
  openWorkspace().catch(showError);
}
