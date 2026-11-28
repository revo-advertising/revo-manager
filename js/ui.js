/* Aides d'interface, coquille de l'application et routage */
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => (Number(n) || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).replace(/ /g, ' ');
const fdate = s => s ? s.split('-').reverse().join('/') : '—';
const badge = ([label, tone]) => `<span class="badge ${tone}">${esc(label)}</span>`;
const kpi = (label, value, sub = '', unit = 'MAD', cls = '') => `<div class="card kpi"><div class="lbl"><i></i>${esc(label)}</div><div class="val ${cls}">${value}<small>${unit}</small></div><div class="sub">${sub}</div></div>`;
const opts = (list, sel) => list.map(o => { const [v, l] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(v)}" ${String(v) === String(sel ?? '') ? 'selected' : ''}>${esc(l)}</option>`; }).join('');
const field = (label, inner) => `<label class="f"><span>${esc(label)}</span>${inner}</label>`;

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 2800);
}

/* Formulaire en fenêtre : fields = [{k,label,type,options,required,value,wide}] */
function formModal(title, fields, onSubmit, submitLabel = 'Enregistrer') {
  const control = f => {
    const req = f.required ? 'required' : '';
    if (f.type === 'select') return `<select name="${f.k}" ${req}>${opts(f.options, f.value)}</select>`;
    if (f.type === 'textarea') return `<textarea name="${f.k}" ${req}>${esc(f.value)}</textarea>`;
    return `<input name="${f.k}" type="${f.type || 'text'}" ${f.type === 'number' ? 'step="any"' : ''} value="${esc(f.value)}" ${req}>`;
  };
  $('#modal').innerHTML = `<div class="ovl"><form><h2>${esc(title)}</h2><div class="grid g2">${fields.map(f => `<div ${f.wide || f.type === 'textarea' ? 'style="grid-column:1/-1"' : ''}>${field(f.label + (f.required ? ' *' : ''), control(f))}</div>`).join('')}</div>
    <div class="row" style="margin-top:18px"><span class="sp"></span><button type="button" class="btn" data-close>Annuler</button><button class="btn primary">${esc(submitLabel)}</button></div></form></div>`;
  const form = $('#modal form');
  $('[data-close]', form).onclick = closeModal;
  form.onsubmit = e => {
    e.preventDefault();
    if (onSubmit(Object.fromEntries(new FormData(form))) !== false) { closeModal(); save(); render(); }
  };
  $('input,select,textarea', form)?.focus();
}
const closeModal = () => { $('#modal').innerHTML = ''; };

/* Tableau avec recherche, filtre, tri et export CSV.
   cols = [{h, v: ligne=>valeur triable, html?: ligne=>html, num?}] */
const tableState = {};
function dataTable(el, { id, cols, rows, href, filters, empty = 'Aucun résultat.', actions }) {
  const st = tableState[id] ||= { q: '', f: '', sort: null, dir: 1 };
  el.innerHTML = `<div class="card flush"><div class="toolbar"><input type="search" placeholder="Rechercher…" value="${esc(st.q)}" aria-label="Rechercher">
    ${filters ? `<select aria-label="Filtrer">${opts([['', 'Tous'], ...filters.options], st.f)}</select>` : ''}<span class="sp"></span><span class="muted" data-count></span><button class="btn sm" data-csv>Exporter CSV</button></div><div data-body style="overflow:auto"></div></div>`;
  let visible = [];
  const draw = () => {
    visible = rows.filter(r => (!st.q || cols.some(c => String(c.v(r) ?? '').toLowerCase().includes(st.q.toLowerCase()))) && (!st.f || filters.test(r, st.f)));
    if (st.sort != null) visible.sort((a, b) => { const x = cols[st.sort].v(a), y = cols[st.sort].v(b); return (typeof x === 'number' ? x - y : String(x).localeCompare(String(y), 'fr')) * st.dir; });
    $('[data-count]', el).textContent = `${visible.length} résultat${visible.length > 1 ? 's' : ''}`;
    $('[data-body]', el).innerHTML = visible.length ? `<table><thead><tr>${cols.map((c, i) => `<th data-sort="${i}" class="${c.num ? 'num' : ''}">${esc(c.h)} ${st.sort === i ? (st.dir > 0 ? '↑' : '↓') : ''}</th>`).join('')}${actions ? '<th></th>' : ''}</tr></thead>
      <tbody>${visible.map((r, n) => `<tr data-n="${n}" ${href ? `data-href="${href(r)}"` : ''}>${cols.map(c => `<td class="${c.num ? 'num' : ''}">${c.html ? c.html(r) : esc(c.v(r))}</td>`).join('')}${actions ? `<td class="num">${actions.map((a, i) => (!a.show || a.show(r)) ? `<button class="btn sm ${a.cls || ''}" data-act="${i}">${esc(a.label)}</button>` : '').join(' ')}</td>` : ''}</tr>`).join('')}</tbody></table>` : `<div class="empty">${esc(empty)}</div>`;
  };
  $('input[type=search]', el).oninput = e => { st.q = e.target.value; draw(); };
  if (filters) $('select', el).onchange = e => { st.f = e.target.value; draw(); };
  $('[data-body]', el).onclick = e => {
    const th = e.target.closest('th[data-sort]');
    if (th) { const i = +th.dataset.sort; st.dir = st.sort === i ? -st.dir : 1; st.sort = i; return draw(); }
    const tr = e.target.closest('tr[data-n]'); if (!tr) return;
    const row = visible[+tr.dataset.n], b = e.target.closest('[data-act]');
    if (b) return actions[+b.dataset.act].run(row);
    if (tr.dataset.href) location.hash = tr.dataset.href;
  };
  $('[data-csv]', el).onclick = () => downloadCSV(id, [cols.map(c => c.h), ...visible.map(r => cols.map(c => c.v(r)))]);
  draw();
}

/* Cachet : rend le papier blanc transparent et recadre sur l'encre */
function cleanStamp(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onerror = () => reject(new Error('Image illisible.'));
    img.onload = () => {
      const scale = Math.min(1, 900 / img.width), c = document.createElement('canvas');
      c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, c.width, c.height);
      const data = ctx.getImageData(0, 0, c.width, c.height), px = data.data, rows = new Array(c.height).fill(0), cols = new Array(c.width).fill(0);
      for (let i = 0; i < px.length; i += 4) {
        const lum = .299 * px[i] + .587 * px[i + 1] + .114 * px[i + 2];
        px[i + 3] = Math.round(px[i + 3] * Math.max(0, Math.min(1, (238 - lum) / 50)));
        if (px[i + 3] > 80) { rows[Math.floor(i / 4 / c.width)]++; cols[(i / 4) % c.width]++; }
      }
      ctx.putImageData(data, 0, 0);
      /* les petites poussières isolées ne comptent pas dans le cadrage */
      const first = a => a.findIndex(n => n > 8), last = a => a.length - 1 - first([...a].reverse());
      if (first(rows) < 0 || first(cols) < 0) return reject(new Error('Aucune encre détectée sur cette image.'));
      const x = Math.max(0, first(cols) - 4), y = Math.max(0, first(rows) - 4), w = Math.min(c.width, last(cols) + 5) - x, h = Math.min(c.height, last(rows) + 5) - y;
      const out = document.createElement('canvas'); out.width = w; out.height = h;
      out.getContext('2d').drawImage(c, x, y, w, h, 0, 0, w, h);
      resolve(out.toDataURL('image/png'));
    };
    img.src = src;
  });
}

function downloadFile(name, content, mime) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function downloadCSV(name, rows) {
  const cell = v => {
    let s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
    if (typeof v !== 'number' && /^[=+\-@]/.test(s)) s = "'" + s; // évite l'exécution de formules dans le tableur
    return `"${s.replace(/"/g, '""')}"`;
  };
  downloadFile(name + '.csv', '﻿' + rows.map(r => r.map(cell).join(';')).join('\n'), 'text/csv;charset=utf-8');
}

const icon = p => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${p}"/></svg>`;
const MODULES = [
  { id: 'accueil', label: 'Accueil', icon: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z', title: 'Tableau de bord', links: [['dashboard', "Vue d'ensemble"]] },
  { id: 'crm', label: 'CRM', icon: 'M9 11a4 4 0 100-8 4 4 0 000 8zM2 21c0-4 3-6 7-6s7 2 7 6M16 4a4 4 0 010 7M18 15c2.500.8 4 2.800 4 6', title: 'CRM', links: [['accounts', 'Comptes'], ['contacts', 'Contacts'], ['todos', 'Mes actions']] },
  { id: 'ventes', label: 'Ventes', icon: 'M3 4h2l2.5 11h10L20 7H6M9 20h.01M17 20h.01', title: 'Ventes', links: [['docs/estimate', 'Devis'], ['docs/order', 'Commandes'], ['docs/delivery', 'Bons de livraison'], ['docs/invoice', 'Factures'], ['docs/credit', 'Avoirs'], ['recurring', 'Factures récurrentes'], ['goals', 'Objectifs']] },
  { id: 'achats', label: 'Achats', icon: 'M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19h.01M17 19h.01', title: 'Achats', links: [['docs/rfq', 'Demandes de prix'], ['docs/porder', 'Bons de commande'], ['docs/receipt', 'Bons de réception'], ['docs/pinvoice', 'Factures'], ['docs/pcredit', 'Avoirs']] },
  { id: 'finance', label: 'Finance', icon: 'M3 7h18v13H3zM3 7l13-4v4M17 13h.01', title: 'Finance', links: [['transactions', 'Transactions'], ['recovery', 'Recouvrement'], ['checks', 'Chèques et effets']] },
  { id: 'catalogue', label: 'Catalogue', icon: 'M3 3h8l10 10-8 8L3 11zM8 8h.01', title: 'Catalogue', links: [['items', 'Articles']] },
  { id: 'rapports', label: 'Rapports', icon: 'M4 20V10M10 20V4M16 20v-7M21 20H3', title: 'Rapports', links: [['reports', 'Tous les rapports']], bottom: true },
  { id: 'reglages', label: 'Réglages', icon: 'M12 15a3 3 0 100-6 3 3 0 000 6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2', title: 'Réglages', links: [['settings', 'Société et finance'], ['data', 'Données et import']] },
];

const ROUTES = {};
function render() {
  const path = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [name, a, b] = path.split('/');
  const route = ROUTES[name] || ROUTES.dashboard;
  const doc = (name === 'doc' || name === 'edit') ? docById(a) : null;
  const type = doc?.type || ((name === 'docs' || name === 'new') ? a : null);
  const linkKey = type ? `docs/${type}` : name === 'account' ? 'accounts' : name === 'report' ? 'reports' : ROUTES[name] ? name : 'dashboard';
  const mod = MODULES.find(m => m.links.some(l => l[0] === linkKey)) || MODULES[0];
  const railLink = m => `<a href="#/${m.links[0][0]}" class="${m === mod ? 'on' : ''}">${icon(m.icon)}<span>${m.label}</span></a>`;
  $('#app').innerHTML = `<div class="shell">
    <nav class="rail" aria-label="Modules"><img class="brand" src="assets/icone.svg" alt="">${MODULES.filter(m => !m.bottom && m.id !== 'reglages').map(railLink).join('')}<span class="sp"></span>${MODULES.filter(m => m.bottom || m.id === 'reglages').map(railLink).join('')}</nav>
    <aside class="side"><a href="#/dashboard" style="padding:0;border:0;background:none"><img src="assets/logo.svg" alt="Revo Manager"></a><div class="mod">${mod.title}</div>${mod.links.map(([k, l]) => `<a href="#/${k}" class="${k === linkKey ? 'on' : ''}">${l}</a>`).join('')}</aside>
    <main><div class="top"><span>${mod.title} / <b style="color:var(--navy)">${esc(mod.links.find(l => l[0] === linkKey)?.[1] || '')}</b></span><span class="sp"></span>
      <input type="search" id="gsearch" list="gsearch-list" placeholder="Rechercher un document ou un compte…" aria-label="Recherche globale"><datalist id="gsearch-list">${DB.docs.map(d => `<option value="${esc(d.ref)}">${esc(accountName(d.accountId))}</option>`).join('')}${DB.accounts.map(x => `<option value="${esc(x.name)}"></option>`).join('')}</datalist>
      <button class="btn accent" id="gcreate">+ Créer</button></div>
      ${!Cloud.enabled && !DB.docs.length && !DB.accounts.length ? '<div class="demo">Aucune donnée dans ce navigateur. <a href="#/data" style="text-decoration:underline">Restaurer une sauvegarde</a></div>' : ''}
      <div id="page"></div></main></div>`;
  $('#gsearch').onchange = e => {
    const q = e.target.value.trim().toLowerCase();
    const d = DB.docs.find(x => x.ref.toLowerCase() === q), acc = DB.accounts.find(x => x.name.toLowerCase() === q);
    if (d) location.hash = '#/doc/' + d.id; else if (acc) location.hash = '#/account/' + acc.id; else if (q) toast('Aucun document ni compte avec ce nom.');
  };
  $('#gcreate').onclick = () => formModal('Créer', [{ k: 't', label: 'Type de document', type: 'select', wide: true, options: Object.entries(TYPES).map(([k, t]) => [k, t.one]) }], v => { setTimeout(() => location.hash = '#/new/' + v.t, 0); }, 'Continuer');
  route($('#page'), a, b);
}
function pageHead(el, title, buttons = '', extra = '') {
  el.innerHTML = `<div class="head"><h1>${title}</h1>${extra}<span class="sp"></span>${buttons}</div><div class="content"></div>`;
  return $('.content', el);
}
function start() {
  window.addEventListener('hashchange', () => {
    if (Cloud.enabled && !Cloud.ready) return;
    closeModal(); render(); window.scrollTo(0, 0);
    if (Cloud.enabled) pull();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
  if (Cloud.enabled) return cloudStart();
  load(); render();
}
