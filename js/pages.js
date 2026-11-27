/* Tableau de bord, CRM, Finance, Catalogue, Rapports, Réglages */
const MONTHS = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];
const thisYear = () => +today().slice(0, 4);
const monthRange = (y, m) => { const p = `${y}-${String(m).padStart(2, '0')}`; return [p + '-01', p + '-31']; };
const pct = (a, b) => b ? Math.round(a / b * 1000) / 10 : 0;
const group = (list, keyFn, valFn) => {
  const map = new Map();
  list.forEach(x => { const k = keyFn(x) || 'Non renseigné'; map.set(k, round((map.get(k) || 0) + valFn(x))); });
  return [...map].sort((a, b) => b[1] - a[1]);
};
const barList = rows => { const max = Math.max(1, ...rows.map(r => r[1])); return rows.length ? rows.map(([k, v]) => `<div style="margin-bottom:10px"><div class="row"><span>${esc(k)}</span><span class="sp"></span><b>${money(v)}</b></div><div class="bar"><i style="width:${Math.max(0, v / max * 100)}%"></i></div></div>`).join('') : '<div class="muted">Aucune donnée.</div>'; };

function revenueChart(y) {
  const cur = MONTHS.map((_, i) => revenue(...monthRange(y, i + 1))), prev = MONTHS.map((_, i) => revenue(...monthRange(y - 1, i + 1)));
  const max = Math.max(1, ...cur, ...prev);
  const bar = (v, x, color, label) => { const h = Math.max(0, v) / max * 150; return `<rect x="${x}" y="${170 - h}" width="15" height="${h}" rx="3" fill="${color}"><title>${label} : ${money(v)} MAD HT</title></rect>`; };
  return `<div class="legend"><span><i style="background:#00D6FF"></i>${y}</span><span><i style="background:#C5CEDB"></i>${y - 1}</span></div>
  <svg viewBox="0 0 640 196" style="width:100%;display:block" role="img" aria-label="Chiffre d'affaires HT mensuel ${y} comparé à ${y - 1}">
  ${[0, .5, 1].map(f => `<line x1="42" x2="636" y1="${170 - f * 150}" y2="${170 - f * 150}" stroke="#E5E9F0"/><text x="36" y="${173 - f * 150}" text-anchor="end" font-size="9" fill="#8791A1">${Math.round(max * f / 1000)} K</text>`).join('')}
  ${MONTHS.map((m, i) => { const x = 50 + i * 49; return bar(prev[i], x, '#C5CEDB', `${m} ${y - 1}`) + bar(cur[i], x + 17, '#00D6FF', `${m} ${y}`) + `<text x="${x + 16}" y="187" text-anchor="middle" font-size="10" fill="#4B5563">${m}</text>`; }).join('')}</svg>`;
}

ROUTES.dashboard = el => {
  const y = thisYear(), now = today(), from = `${y}-01-01`;
  const ca = revenue(from, now), caPrev = revenue(`${y - 1}-01-01`, `${y - 1}${now.slice(4)}`);
  const late = finals('invoice').filter(lateDays), old = late.filter(d => lateDays(d) > 60);
  const toValidate = DB.docs.filter(d => d.type === 'estimate' && d.status === 'draft').length;
  const ch = expenses(from, now), res = round(ca - ch);
  const estimates = DB.docs.filter(d => d.type === 'estimate' && d.status !== 'draft' && d.date >= from);
  const won = estimates.filter(d => ['accepted', 'invoiced', 'converted'].includes(d.status));
  const rate = pct(sum(won, d => totals(d).ht), sum(estimates, d => totals(d).ht));
  const [mf, mt] = monthRange(y, +now.slice(5, 7)), v = vatFor(mf, mt);
  const goal = +DB.goals[now.slice(0, 7)] || 0, caMonth = revenue(mf, mt);
  const receivable = sum(finals('invoice'), dueOn), payable = sum(finals('pinvoice'), dueOn);
  const body = pageHead(el, 'Tableau de bord', '<a class="btn primary" href="#/goals">Objectifs ' + y + '</a>');
  body.innerHTML = `<div class="grid g4 mb">
    ${kpi("Chiffre d'affaires " + y, money(ca), caPrev ? `${ca >= caPrev ? '+' : ''}${pct(ca - caPrev, caPrev)} % vs ${y - 1} à date` : 'Facturé moins avoirs, HT')}
    ${kpi('Encaissements en retard', money(sum(late, dueOn)), `${late.length} facture(s) · ${old.length} à plus de 60 j`, 'MAD TTC', 'red')}
    ${kpi('Trésorerie disponible', money(treasury()), 'Solde initial + recettes − dépenses')}
    <a class="card dark kpi" href="#/docs/estimate"><div class="lbl"><i></i>Aujourd'hui</div><div class="val">${toValidate}</div><div class="sub">devis à valider</div></a>
    ${kpi("Marge d'exploitation", String(pct(res, ca)).replace('.', ','), `Résultat : ${money(res)} MAD`, '%', res < 0 ? 'red' : 'green')}
    ${kpi('Taux de transformation', String(rate).replace('.', ','), 'Devis acceptés, en valeur HT', '%')}
    ${kpi('Créances clients', money(receivable), 'Reste à encaisser', 'MAD TTC')}
    ${kpi('Dettes fournisseurs', money(payable), 'Reste à payer', 'MAD TTC')}</div>
  <div class="grid g2 mb"><div class="card"><h2>Chiffre d'affaires mensuel HT</h2>${revenueChart(y)}</div>
    <div class="card"><h2>Factures récentes</h2><div class="list">${finals('invoice').sort((a, b) => b.date.localeCompare(a.date)).slice(0, 7).map(d => `<a href="#/doc/${d.id}"><span><b>${esc(accountName(d.accountId))}</b> <span class="muted">${esc(d.ref)}</span></span><b>${money(totals(d).ttc)}</b></a>`).join('') || '<div class="muted">Aucune facture.</div>'}</div></div></div>
  <div class="grid g3"><div class="card"><h2>Meilleurs clients ${y}</h2>${barList(group(finals('invoice').filter(d => d.date >= from), d => accountName(d.accountId), d => totals(d).ht).slice(0, 5))}</div>
    <div class="card"><h2>TVA du mois (sur facturation)</h2><div class="list"><div><span>Collectée</span><b>${money(v.collected)}</b></div><div><span>Déductible</span><b>${money(v.deductible)}</b></div><div><b>${v.net >= 0 ? 'À payer' : 'Crédit de TVA'}</b><b>${money(Math.abs(v.net))} MAD</b></div></div></div>
    <div class="card"><h2>Objectif du mois</h2>${goal ? `<div class="row"><b>${money(caMonth)}</b><span class="muted">sur ${money(goal)} MAD HT</span></div><div class="bar" style="margin-top:10px"><i style="width:${Math.min(100, Math.max(0, pct(caMonth, goal)))}%"></i></div><p>${pct(caMonth, goal)} % atteint</p>` : '<p class="muted">Aucun objectif pour ce mois.</p><a class="btn sm" href="#/goals">Fixer mes objectifs</a>'}</div></div>`;
};

/* ---------- CRM ---------- */
const ACCOUNT_TYPES = [['client', 'Client'], ['supplier', 'Fournisseur'], ['prospect', 'Prospect'], ['partner', 'Partenaire']];
const accountFields = a => [
  { k: 'name', label: 'Entreprise', value: a.name, required: 1, wide: 1 }, { k: 'type', label: 'Type', type: 'select', options: ACCOUNT_TYPES, value: a.type || 'client' },
  { k: 'ice', label: 'ICE', value: a.ice }, { k: 'address', label: 'Adresse', value: a.address, wide: 1 }, { k: 'city', label: 'Ville', value: a.city }, { k: 'country', label: 'Pays', value: a.country || 'Maroc' },
  { k: 'phone', label: 'Téléphone', value: a.phone }, { k: 'email', label: 'Email', type: 'email', value: a.email }];
const editAccount = a => formModal(a.id ? 'Modifier le compte' : 'Nouveau compte', accountFields(a), v => {
  if (!v.name.trim()) return false;
  if (a.id) Object.assign(a, v); else DB.accounts.push({ id: uid(), ref: takeRef(v.type), ...v });
});
function removeFrom(list, row, label, used) {
  if (used) return toast('Suppression impossible : cet élément est utilisé dans des documents ou des transactions.');
  if (confirm(`Supprimer définitivement ${label} ?`)) { DB[list] = DB[list].filter(x => x !== row); save(); render(); }
}

ROUTES.accounts = el => {
  const body = pageHead(el, 'Comptes', '<button class="btn primary" id="add">+ Nouveau compte</button>');
  const count = t => DB.accounts.filter(a => a.type === t).length;
  body.innerHTML = `<div class="grid g4 mb">${ACCOUNT_TYPES.map(([k, l]) => kpi(l + 's', count(k), '', '')).join('')}</div><div id="tbl"></div>`;
  $('#add', el).onclick = () => editAccount({});
  dataTable($('#tbl'), { id: 'comptes', rows: [...DB.accounts].sort((a, b) => a.name.localeCompare(b.name)), href: a => '#/account/' + a.id,
    filters: { options: ACCOUNT_TYPES, test: (a, f) => a.type === f },
    cols: [{ h: 'Référence', v: a => a.ref }, { h: 'Entreprise', v: a => a.name, html: a => `<b>${esc(a.name)}</b>` }, { h: 'Type', v: a => Object.fromEntries(ACCOUNT_TYPES)[a.type] }, { h: 'Ville', v: a => a.city || '' }, { h: 'Téléphone', v: a => a.phone || '' }],
    actions: [{ label: 'Modifier', run: editAccount }, { label: 'Supprimer', cls: 'danger', run: a => removeFrom('accounts', a, a.name, DB.docs.some(d => d.accountId === a.id) || DB.transactions.some(t => t.accountId === a.id) || DB.contacts.some(c => c.accountId === a.id)) }] });
};
ROUTES.account = (el, id) => {
  const a = accountById(id); if (!a) return ROUTES.accounts(el);
  const docs = DB.docs.filter(d => d.accountId === id).sort((x, y) => y.date.localeCompare(x.date));
  const mainType = a.type === 'supplier' ? 'pinvoice' : 'invoice', inv = docs.filter(d => d.type === mainType && isFinal(d));
  const body = pageHead(el, esc(a.name), '<button class="btn primary" id="edit">Modifier</button>', badge([Object.fromEntries(ACCOUNT_TYPES)[a.type], 'info']));
  body.innerHTML = `<div class="grid g3 mb">${kpi('Facturé TTC', money(sum(inv, d => totals(d).ttc)))}${kpi('Reste dû', money(sum(inv, dueOn)))}${kpi('En retard', money(sum(inv.filter(lateDays), dueOn)), '', 'MAD', 'red')}</div>
  <div class="grid g2 mb"><div class="card"><h2>Fiche</h2><div class="list">${[['Référence', a.ref], ['ICE', a.ice], ['RC', a.rc], ['Identifiant fiscal', a.taxId], ['Adresse', a.address], ['Code postal', a.zip], ['Ville', a.city], ['Pays', a.country], ['Téléphone', a.phone], ['Portable', a.mobile], ['Email', a.email], ['Site web', a.website], ["Secteur d'activité", a.sector], ['Catégorie', a.category], ['Responsable', a.owner], ['Créé le', a.createdAt && fdate(a.createdAt)]].map(([k, v]) => `<div><span class="muted">${k}</span><span>${esc(v || '—')}</span></div>`).join('')}</div></div>
  <div class="card"><h2>Contacts</h2><div class="list">${DB.contacts.filter(c => c.accountId === id).map(c => `<div><span><b>${esc(c.name)}</b> <span class="muted">${esc(c.role)}</span></span><span>${esc(c.email || c.phone)}</span></div>`).join('') || '<div class="muted">Aucun contact.</div>'}</div></div></div>
  <div class="card"><h2>Documents</h2><div class="list">${docs.map(d => `<a href="#/doc/${d.id}"><span>${TYPES[d.type].one} <b>${esc(d.ref)}</b> <span class="muted">${fdate(d.date)}</span></span><span>${badge(statusOf(d))} <b>${money(totals(d).ttc)}</b></span></a>`).join('') || '<div class="muted">Aucun document.</div>'}</div></div>`;
  $('#edit', el).onclick = () => editAccount(a);
};

const accountOptions = (empty = '—') => [['', empty], ...[...DB.accounts].sort((a, b) => a.name.localeCompare(b.name)).map(a => [a.id, a.name])];

/* Page « liste + formulaire » générique */
function crudPage(el, { title, list, addLabel, fields, cols, defaults = {}, prepare = v => v, extra = [], filters, used = () => false, name = r => r.name || r.title || r.label || r.ref || 'cet élément' }) {
  const body = pageHead(el, title, `<button class="btn primary" id="add">+ ${addLabel}</button>`);
  const edit = row => formModal(row ? 'Modifier' : addLabel, fields(row || defaults), v => {
    const data = prepare(v, row); if (data === false) return false;
    if (row) Object.assign(row, data); else DB[list].push({ id: uid(), ...defaults, ...data });
  });
  $('#add', el).onclick = () => edit(null);
  dataTable(body, { id: list, rows: [...DB[list]], cols, filters, actions: [...extra, { label: 'Modifier', run: edit }, { label: 'Supprimer', cls: 'danger', run: r => removeFrom(list, r, name(r), used(r)) }] });
}

ROUTES.contacts = el => crudPage(el, { title: 'Contacts', list: 'contacts', addLabel: 'Nouveau contact',
  fields: r => [{ k: 'name', label: 'Nom complet', value: r.name, required: 1 }, { k: 'accountId', label: 'Compte', type: 'select', options: accountOptions(), value: r.accountId, required: 1 }, { k: 'role', label: 'Fonction', value: r.role }, { k: 'phone', label: 'Téléphone', value: r.phone }, { k: 'email', label: 'Email', type: 'email', value: r.email }],
  cols: [{ h: 'Nom', v: r => r.name }, { h: 'Compte', v: r => accountName(r.accountId) }, { h: 'Fonction', v: r => r.role || '' }, { h: 'Email', v: r => r.email || '' }, { h: 'Téléphone', v: r => r.phone || '' }] });

ROUTES.todos = el => crudPage(el, { title: 'Mes actions', list: 'todos', addLabel: 'Nouvelle action', defaults: { done: false },
  fields: r => [{ k: 'title', label: 'Action', value: r.title, required: 1, wide: 1 }, { k: 'due', label: 'Échéance', type: 'date', value: r.due || today() }, { k: 'accountId', label: 'Compte', type: 'select', options: accountOptions(), value: r.accountId }],
  cols: [{ h: 'Action', v: r => r.title }, { h: 'Compte', v: r => accountName(r.accountId) }, { h: 'Échéance', v: r => r.due, html: r => fdate(r.due) }, { h: 'État', v: r => r.done ? 'Terminée' : r.due < today() ? 'En retard' : 'À faire', html: r => badge(r.done ? ['Terminée', 'ok'] : r.due < today() ? ['En retard', 'bad'] : ['À faire', 'warn']) }],
  extra: [{ label: 'Terminer', show: r => !r.done, run: r => { r.done = true; save(); render(); } }] });

/* ---------- Catalogue ---------- */
ROUTES.items = el => crudPage(el, { title: 'Articles', list: 'items', addLabel: 'Ajouter un article',
  fields: r => [{ k: 'name', label: 'Désignation', value: r.name, required: 1, wide: 1 }, { k: 'type', label: 'Type', type: 'select', options: ['Service', 'Produit'], value: r.type }, { k: 'family', label: 'Famille', value: r.family || 'Famille par défaut' }, { k: 'price', label: 'Prix unitaire HT', type: 'number', value: r.price, required: 1 }, { k: 'tax', label: 'TVA %', type: 'select', options: DB.settings.taxes, value: r.tax ?? 20 }, { k: 'description', label: 'Description', type: 'textarea', value: r.description }],
  prepare: (v, row) => ({ ...v, price: round(v.price), tax: +v.tax, ...(row ? {} : { ref: takeRef('item') }) }),
  cols: [{ h: 'Référence', v: r => r.ref }, { h: 'Désignation', v: r => r.name, html: r => `<b>${esc(r.name)}</b>` }, { h: 'Type', v: r => r.type }, { h: 'Famille', v: r => r.family }, { h: 'PU HT', num: 1, v: r => +r.price, html: r => money(r.price) }, { h: 'TVA %', num: 1, v: r => +r.tax }] });

/* ---------- Finance ---------- */
function txModal(kind, row) {
  const r = row || {}, cats = kind === 'income' ? DB.settings.incomeCats : DB.settings.expenseCats;
  const linked = !!r.docId;
  formModal(row ? 'Modifier la transaction' : kind === 'income' ? 'Nouvelle recette' : 'Nouvelle dépense', [
    { k: 'date', label: 'Date', type: 'date', value: r.date || today(), required: 1 },
    ...(linked ? [] : [{ k: 'amount', label: 'Montant TTC', type: 'number', value: r.amount, required: 1 }, { k: 'tax', label: 'dont TVA % (dépense sans facture)', type: 'select', options: [0, ...DB.settings.taxes.filter(Boolean)], value: r.tax || 0 }]),
    { k: 'category', label: 'Catégorie', type: 'select', options: cats, value: r.category }, { k: 'method', label: 'Mode de paiement', type: 'select', options: DB.settings.methods, value: r.method || 'Virement bancaire' },
    { k: 'accountId', label: 'Partenaire', type: 'select', options: accountOptions(), value: r.accountId }, { k: 'notes', label: 'Notes', value: r.notes, wide: 1 }],
  v => {
    if (!linked && !(+v.amount > 0)) { toast('Le montant doit être positif.'); return false; }
    const data = { ...v, ...(linked ? {} : { amount: round(v.amount), tax: +v.tax }) };
    if (row) Object.assign(row, data); else DB.transactions.push({ id: uid(), kind, docId: '', ...data });
  });
}
ROUTES.transactions = el => {
  const body = pageHead(el, 'Transactions', '<button class="btn accent" id="inc">+ Recette</button><button class="btn primary" id="exp">+ Dépense</button>');
  const i = cashFlow('income', '0000', '9999'), e = cashFlow('expense', '0000', '9999');
  body.innerHTML = `<div class="grid g4 mb">${kpi('Total recettes', money(i), '', 'TTC')}${kpi('Total dépenses', money(e), '', 'TTC')}${kpi('Résultat', money(i - e), '', 'TTC', i - e < 0 ? 'red' : '')}${kpi('Trésorerie', money(treasury()), 'avec solde initial', 'TTC')}</div><div id="tbl"></div>`;
  $('#inc', el).onclick = () => txModal('income'); $('#exp', el).onclick = () => txModal('expense');
  dataTable($('#tbl'), { id: 'transactions', rows: [...DB.transactions].sort((a, b) => b.date.localeCompare(a.date)),
    filters: { options: [['income', 'Recettes'], ['expense', 'Dépenses']], test: (r, f) => r.kind === f },
    cols: [{ h: 'Date', v: r => r.date, html: r => fdate(r.date) }, { h: 'Catégorie', v: r => r.category }, { h: 'Partenaire', v: r => accountName(r.accountId) }, { h: 'Document', v: r => docById(r.docId)?.ref || '' }, { h: 'Mode', v: r => r.method }, { h: 'Notes', v: r => r.notes || '' }, { h: 'Montant', num: 1, v: r => r.kind === 'income' ? +r.amount : -r.amount, html: r => `<b class="${r.kind === 'income' ? 'green' : 'red'}">${r.kind === 'income' ? '+' : '−'}${money(r.amount)}</b>` }],
    actions: [{ label: 'Modifier', run: r => txModal(r.kind, r) }, { label: 'Supprimer', cls: 'danger', run: r => { if (confirm(`Supprimer la transaction de ${money(r.amount)} MAD ? Le reste dû du document lié sera recalculé.`)) { DB.transactions = DB.transactions.filter(x => x !== r); DB.checks = DB.checks.filter(c => c.txId !== r.id); save(); render(); } } }] });
};

/* Balance âgée : tranches de retard en jours */
const AGES = ['Non échu', '1–30 j', '31–60 j', '61–90 j', '+90 j'];
function aging(type) {
  const map = new Map();
  finals(type).filter(d => dueOn(d) > 0).forEach(d => {
    const n = lateDays(d), i = !n ? 0 : n <= 30 ? 1 : n <= 60 ? 2 : n <= 90 ? 3 : 4;
    const row = map.get(d.accountId) || { id: d.accountId, b: [0, 0, 0, 0, 0], total: 0, docs: [] };
    row.b[i] = round(row.b[i] + dueOn(d)); row.total = round(row.total + dueOn(d)); row.docs.push(d); map.set(d.accountId, row);
  });
  return [...map.values()].sort((a, b) => b.total - a.total);
}
ROUTES.recovery = el => {
  const body = pageHead(el, 'Recouvrement'), rows = aging('invoice');
  const col = i => sum(rows, r => r.b[i]);
  body.innerHTML = `<div class="grid g4 mb">${kpi('Reste à encaisser', money(sum(rows, r => r.total)))}${kpi('En retard', money(round(col(1) + col(2) + col(3) + col(4))), '', 'MAD', 'red')}${kpi('Retard de plus de 60 j', money(round(col(3) + col(4))))}${kpi('Clients concernés', rows.length, '', '')}</div><div id="tbl"></div>`;
  dataTable($('#tbl'), { id: 'recouvrement', rows,
    cols: [{ h: 'Client', v: r => accountName(r.id), html: r => `<a href="#/account/${r.id}"><b>${esc(accountName(r.id))}</b></a>` }, ...AGES.map((h, i) => ({ h, num: 1, v: r => r.b[i], html: r => money(r.b[i]) })), { h: 'Total dû', num: 1, v: r => r.total, html: r => `<b>${money(r.total)}</b>` }],
    actions: [{ label: 'Préparer la relance', show: r => r.docs.some(lateDays), run: r => {
      const late = r.docs.filter(lateDays);
      const text = `Objet : Relance de factures échues\n\nBonjour,\n\nSauf erreur de notre part, les factures suivantes de ${accountName(r.id)} restent à régler :\n${late.map(d => `- ${d.ref} du ${fdate(d.date)}, échue le ${fdate(d.due)} : ${money(dueOn(d))} MAD`).join('\n')}\n\nTotal échu : ${money(sum(late, dueOn))} MAD.\n\nMerci de procéder au règlement. Si celui-ci a déjà été effectué, veuillez ne pas tenir compte de ce message.\n\nCordialement,\n${DB.settings.company.name}`;
      formModal('Relance à copier', [{ k: 'text', label: 'Message (aucun envoi automatique)', type: 'textarea', value: text }], v => { navigator.clipboard?.writeText(v.text).then(() => toast('Message copié.'), () => toast('Copie refusée : sélectionnez le texte manuellement.')); }, 'Copier');
      $('#modal textarea').rows = 14;
    } }] });
};

ROUTES.checks = el => crudPage(el, { title: 'Chèques et effets', list: 'checks', addLabel: 'Ajouter un chèque ou effet', defaults: { txId: '' }, name: r => 'ce ' + r.kind.toLowerCase(),
  fields: r => [{ k: 'kind', label: 'Nature', type: 'select', options: ['Chèque', 'Lettre de change'], value: r.kind }, { k: 'direction', label: 'Sens', type: 'select', options: ['Reçu', 'Émis'], value: r.direction }, { k: 'number', label: 'Numéro', value: r.number }, { k: 'bank', label: 'Banque', value: r.bank }, { k: 'amount', label: 'Montant', type: 'number', value: r.amount, required: 1 }, { k: 'date', label: 'Date de réception / émission', type: 'date', value: r.date || today() }, { k: 'due', label: 'Échéance', type: 'date', value: r.due || today() }, { k: 'accountId', label: 'Partenaire', type: 'select', options: accountOptions(), value: r.accountId }, { k: 'status', label: 'Statut', type: 'select', options: ['En portefeuille', 'Remis en banque', 'Encaissé / débité', 'Impayé'], value: r.status }],
  prepare: v => ({ ...v, amount: round(v.amount) }),
  cols: [{ h: 'Nature', v: r => r.kind }, { h: 'Sens', v: r => r.direction }, { h: 'Numéro', v: r => r.number }, { h: 'Partenaire', v: r => accountName(r.accountId) }, { h: 'Échéance', v: r => r.due, html: r => fdate(r.due) }, { h: 'Montant', num: 1, v: r => +r.amount, html: r => money(r.amount) }, { h: 'Statut', v: r => r.status, html: r => badge([r.status, r.status === 'Impayé' ? 'bad' : r.status === 'Encaissé / débité' ? 'ok' : 'warn']) }] });

/* ---------- Récurrentes et objectifs ---------- */
function addMonths(s, n) {
  const [y, m, d] = s.split('-').map(Number), last = new Date(y, m - 1 + n + 1, 0).getDate();
  return iso(new Date(y, m - 1 + n, Math.min(d, last), 12));
}
ROUTES.recurring = el => crudPage(el, { title: 'Factures récurrentes', list: 'recurring', addLabel: 'Nouvel abonnement', defaults: { active: true },
  fields: r => [{ k: 'accountId', label: 'Client', type: 'select', options: accountOptions(), value: r.accountId, required: 1 }, { k: 'label', label: 'Désignation', value: r.label, required: 1 }, { k: 'amount', label: 'Montant HT', type: 'number', value: r.amount, required: 1 }, { k: 'tax', label: 'TVA %', type: 'select', options: DB.settings.taxes, value: r.tax ?? 20 }, { k: 'every', label: 'Périodicité', type: 'select', options: [[1, 'Mensuelle'], [3, 'Trimestrielle'], [6, 'Semestrielle'], [12, 'Annuelle']], value: r.every }, { k: 'nextDate', label: 'Prochaine facture', type: 'date', value: r.nextDate || today(), required: 1 }],
  prepare: v => ({ ...v, amount: round(v.amount), tax: +v.tax, every: +v.every }),
  cols: [{ h: 'Client', v: r => accountName(r.accountId) }, { h: 'Désignation', v: r => r.label }, { h: 'Montant HT', num: 1, v: r => +r.amount, html: r => money(r.amount) }, { h: 'Tous les (mois)', num: 1, v: r => r.every }, { h: 'Prochaine', v: r => r.nextDate, html: r => fdate(r.nextDate) + (r.nextDate <= today() ? ' ' + badge(['À générer', 'warn']) : '') }],
  extra: [{ label: 'Générer la facture', run: r => {
    const d = blankDoc('invoice');
    Object.assign(d, { accountId: r.accountId, subject: r.label, date: r.nextDate, due: addDays(r.nextDate, 30), lines: [{ kind: 'item', label: r.label, description: '', qty: 1, price: r.amount, discount: 0, tax: r.tax }] });
    d.ref = takeRef('invoice', d.date); DB.docs.push(d); r.nextDate = addMonths(r.nextDate, r.every); save(); toast('Brouillon créé : à vérifier puis valider.'); location.hash = '#/doc/' + d.id;
  } }] });

ROUTES.goals = el => {
  const y = thisYear(), body = pageHead(el, 'Objectifs ' + y, '<button class="btn primary" id="save">Enregistrer</button>');
  body.innerHTML = `<div class="card flush"><table><thead><tr><th>Mois</th><th>Objectif HT (MAD)</th><th class="num">Réalisé HT</th><th class="num">Atteinte</th></tr></thead><tbody>${MONTHS.map((m, i) => { const key = `${y}-${String(i + 1).padStart(2, '0')}`, ca = revenue(...monthRange(y, i + 1)), g = +DB.goals[key] || 0; return `<tr><td>${m}</td><td><input type="number" min="0" data-goal="${key}" value="${g || ''}" aria-label="Objectif ${m}" style="max-width:180px"></td><td class="num">${money(ca)}</td><td class="num">${g ? pct(ca, g) + ' %' : '—'}</td></tr>`; }).join('')}</tbody></table></div>`;
  $('#save', el).onclick = () => { $$('[data-goal]', el).forEach(n => DB.goals[n.dataset.goal] = Math.max(0, +n.value || 0)); save(); render(); toast('Objectifs enregistrés.'); };
};

/* ---------- Rapports ---------- */
const inRange = (list, f, t) => list.filter(d => inPeriod(d.date, f, t));
const salesDocs = (f, t) => [...inRange(finals('invoice'), f, t).map(d => ({ d, s: 1 })), ...inRange(finals('credit'), f, t).map(d => ({ d, s: -1 }))];
const grouped = (title, head, rows) => ({ head: [title, head], rows });
const salesBy = (title, key) => (f, t) => grouped(title, 'CA HT', group(salesDocs(f, t), x => key(x.d), x => x.s * totals(x.d).ht));
const txBy = (title, kind, key) => (f, t) => grouped(title, 'Montant TTC', group(inRange(DB.transactions.filter(x => x.kind === kind), f, t), key, x => +x.amount));
const monthsBetween = (f, t) => { const out = []; let [y, m] = f.split('-').map(Number); while (`${y}-${String(m).padStart(2, '0')}` <= t.slice(0, 7) && out.length < 60) { out.push([y, m]); if (++m > 12) { m = 1; y++; } } return out; };
const monthly = (head, fn) => (f, t) => ({ head: ['Mois', ...head], rows: monthsBetween(f, t).map(([y, m]) => { const [a, b] = monthRange(y, m); return [`${MONTHS[m - 1]} ${y}`, ...fn(a < f ? f : a, b > t ? t : b)]; }) });
const agedReport = type => () => ({ head: ['Compte', ...AGES, 'Total'], rows: aging(type).map(r => [accountName(r.id), ...r.b, r.total]), current: true });
const docRows = (list, val) => ({ head: ['Référence', 'Compte', 'Date', 'Montant'], rows: list.map(d => [d.ref, accountName(d.accountId), fdate(d.date), val(d)]) });
const itemBy = (types, title) => (f, t) => {
  const lines = types.flatMap(([type, s]) => inRange(finals(type), f, t).flatMap(d => { const x = totals(d), ratio = x.sub ? x.ht / x.sub : 0; return d.lines.map((l, i) => ({ l, v: s * (x.lineTotals[i] || 0) * ratio })).filter(r => r.l.kind === 'item'); }));
  return grouped(title, 'Montant HT', group(lines, r => r.l.label, r => r.v));
};
const REPORTS = {
  Comptes: { 'ca-client': ['CA par client', salesBy('Client', d => accountName(d.accountId))], 'ca-ville': ['CA par ville', salesBy('Ville', d => accountById(d.accountId)?.city)], 'ca-pays': ['CA par pays', salesBy('Pays', d => accountById(d.accountId)?.country)] },
  Finance: {
    'dep-cat': ['Dépenses par catégorie', txBy('Catégorie', 'expense', x => x.category)], 'rec-cat': ['Recettes par catégorie', txBy('Catégorie', 'income', x => x.category)],
    modes: ['Modes de paiement (encaissements)', txBy('Mode', 'income', x => x.method)],
    'res-treso': ['Résultat de trésorerie', monthly(['Recettes', 'Dépenses', 'Résultat'], (a, b) => { const i = cashFlow('income', a, b), e = cashFlow('expense', a, b); return [i, e, round(i - e)]; })],
    marge: ["Marge d'exploitation", monthly(['CA HT', 'Charges HT', 'Résultat'], (a, b) => { const c = revenue(a, b), e = expenses(a, b); return [c, e, round(c - e)]; })],
    tva: ['TVA par mois', monthly(['Collectée', 'Déductible', 'Nette'], (a, b) => { const v = vatFor(a, b); return [v.collected, v.deductible, v.net]; })],
    'age-clients': ['Balance âgée clients', agedReport('invoice')], 'age-fourn': ['Balance âgée fournisseurs', agedReport('pinvoice')] },
  Ventes: {
    'ca-mois': ['CA par mois', monthly(['CA HT'], (a, b) => [revenue(a, b)])],
    impayees: ['Factures impayées', () => ({ ...docRows(finals('invoice').filter(d => dueOn(d) > 0), dueOn), current: true })],
    'devis-attente': ['Devis en attente', () => ({ ...docRows(DB.docs.filter(d => d.type === 'estimate' && d.status === 'validated'), d => totals(d).ttc), current: true })],
    'ventes-article': ['Ventes par article', itemBy([['invoice', 1], ['credit', -1]], 'Article')] },
  Achats: {
    'achats-fourn': ['Achats par fournisseur', (f, t) => grouped('Fournisseur', 'Montant HT', group([...inRange(finals('pinvoice'), f, t).map(d => ({ d, s: 1 })), ...inRange(finals('pcredit'), f, t).map(d => ({ d, s: -1 }))], x => accountName(x.d.accountId), x => x.s * totals(x.d).ht))],
    'achats-article': ['Achats par article', itemBy([['pinvoice', 1], ['pcredit', -1]], 'Article')],
    'achats-dus': ["Factures d'achat non réglées", () => ({ ...docRows(finals('pinvoice').filter(d => dueOn(d) > 0), dueOn), current: true })] },
};
ROUTES.reports = el => {
  const body = pageHead(el, 'Rapports');
  body.innerHTML = `<div class="grid g4">${Object.entries(REPORTS).map(([m, list]) => `<div class="card"><h2>${m}</h2><div class="list">${Object.entries(list).map(([k, [label]]) => `<a href="#/report/${k}"><span>${esc(label)}</span><span>›</span></a>`).join('')}</div></div>`).join('')}</div>`;
};
let period;
ROUTES.report = (el, key) => {
  const entry = Object.values(REPORTS).map(m => m[key]).find(Boolean); if (!entry) return ROUTES.reports(el);
  period ||= { from: `${thisYear()}-01-01`, to: today() };
  const [label, run] = entry, res = run(period.from, period.to);
  const body = pageHead(el, label, '<a class="btn" href="#/reports">← Rapports</a>');
  body.innerHTML = `<div class="row mb">${res.current ? '<span class="muted">Situation à ce jour</span>' : `<span>Du</span><input type="date" id="from" value="${period.from}" style="width:auto"><span>au</span><input type="date" id="to" value="${period.to}" style="width:auto">`}</div><div id="tbl"></div>`;
  ['from', 'to'].forEach(k => { const n = $('#' + k, el); if (n) n.onchange = () => { if (n.value) { period[k] = n.value; render(); } }; });
  dataTable($('#tbl'), { id: 'rapport-' + key, rows: res.rows, cols: res.head.map((h, i) => { const num = typeof res.rows[0]?.[i] === 'number'; return { h, num, v: r => r[i], html: num ? r => money(r[i]) : undefined }; }) });
};

/* ---------- Réglages ---------- */
const COMPANY_FIELDS = [['name', 'Raison sociale'], ['activity', "Secteur d'activité"], ['legalForm', 'Forme juridique et capital'], ['address', 'Adresse'], ['zip', 'Code postal'], ['city', 'Ville'], ['country', 'Pays'], ['phone', 'Téléphone'], ['website', 'Site web'], ['email', 'Email'], ['ice', 'ICE'], ['rc', 'RC'], ['if', 'Identifiant fiscal'], ['patente', 'Patente'], ['cnss', 'CNSS'], ['bank', 'Banque'], ['rib', 'RIB']];
ROUTES.settings = el => {
  const s = DB.settings, body = pageHead(el, 'Réglages', '<button class="btn primary" id="save">Enregistrer</button>');
  const lists = [['taxes', 'Taux de TVA (%)'], ['methods', 'Modes de paiement'], ['expenseCats', 'Catégories des dépenses'], ['incomeCats', 'Catégories des recettes']];
  const kinds = { ...Object.fromEntries(Object.entries(TYPES).map(([k, t]) => [k, t.one + (t.buy ? ' (achats)' : '')])), client: 'Client', prospect: 'Prospect', supplier: 'Fournisseur', item: 'Article' };
  body.innerHTML = `<div class="card mb"><h2>Info société</h2><div class="grid g3">${COMPANY_FIELDS.map(([k, l]) => field(l, `<input data-c="${k}" value="${esc(s.company[k])}">`)).join('')}${field('Logo sur les documents (PNG ou JPG, 500 Ko max)', '<input type="file" id="logo" accept="image/png,image/jpeg">')}${field('Cachet (PNG ou JPG, 2 Mo max, fond blanc retiré automatiquement)', '<input type="file" id="stamp" accept="image/png,image/jpeg">')}${field('Solde de trésorerie initial (MAD)', `<input type="number" step="any" id="opening" value="${s.openingBalance}">`)}</div>${s.company.logo ? `<p><img src="${esc(s.company.logo)}" alt="Logo actuel" style="max-height:60px"></p>` : ''}${s.company.stamp ? `<p class="row"><img src="${esc(s.company.stamp)}" alt="Cachet actuel" style="max-height:90px"><button class="btn sm danger" id="unstamp">Retirer le cachet</button></p>` : ''}</div>
  <div class="grid g4 mb">${lists.map(([k, l]) => `<div class="card">${field(l + ' : un par ligne', `<textarea data-list="${k}" rows="12">${esc(s[k].join('\n'))}</textarea>`)}</div>`).join('')}</div>
  <div class="card"><h2>Numérotation</h2><p class="muted">AAAA = année, MM = mois, NNN = compteur. Pour continuer vos séries actuelles, indiquez le prochain numéro de chacune.</p><table><thead><tr><th>Objet</th><th>Gabarit</th><th>Prochain numéro</th><th>Aperçu</th></tr></thead><tbody>${Object.entries(kinds).map(([k, l]) => `<tr><td>${l}</td><td><input data-pat="${k}" value="${esc(s.patterns[k])}" aria-label="Gabarit ${l}"></td><td><input type="number" min="1" data-count="${k}" value="${s.counters[k] || 1}" aria-label="Prochain numéro ${l}"></td><td>${esc(peekRef(k))}</td></tr>`).join('')}</tbody></table></div>`;
  let logo = s.company.logo;
  $('#logo', el).onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    if (!['image/png', 'image/jpeg'].includes(f.type) || f.size > 512000) return toast('Choisissez un PNG ou JPG de moins de 500 Ko.');
    const r = new FileReader(); r.onload = () => { logo = r.result; toast('Logo chargé : cliquez sur Enregistrer.'); }; r.readAsDataURL(f);
  };
  $('#stamp', el).onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    if (!['image/png', 'image/jpeg'].includes(f.type) || f.size > 2e6) return toast('Choisissez un PNG ou JPG de moins de 2 Mo.');
    const r = new FileReader();
    r.onload = () => cleanStamp(r.result).then(png => { s.company.stamp = png; save(); render(); toast('Cachet enregistré.'); }, err => toast(err.message));
    r.readAsDataURL(f);
  };
  if ($('#unstamp', el)) $('#unstamp', el).onclick = () => { if (confirm('Retirer le cachet des documents ?')) { delete s.company.stamp; save(); render(); } };
  $('#save', el).onclick = () => {
    if ($$('[data-pat]', el).some(n => !/N/.test(n.value))) return toast('Chaque gabarit doit contenir un compteur (NNN).');
    $$('[data-c]', el).forEach(n => s.company[n.dataset.c] = n.value.trim());
    if (logo) s.company.logo = logo;
    s.openingBalance = +$('#opening', el).value || 0;
    $$('[data-list]', el).forEach(n => { let v = [...new Set(n.value.split('\n').map(x => x.trim()).filter(Boolean))]; if (n.dataset.list === 'taxes') v = v.map(x => parseFloat(x.replace(',', '.'))).filter(x => x >= 0 && x <= 100); if (v.length) s[n.dataset.list] = v; });
    $$('[data-pat]', el).forEach(n => s.patterns[n.dataset.pat] = n.value.trim());
    $$('[data-count]', el).forEach(n => s.counters[n.dataset.count] = Math.max(1, parseInt(n.value, 10) || 1));
    save(); render(); toast('Réglages enregistrés.');
  };
};

/* ---------- Données : sauvegarde, restauration, import CSV ---------- */
function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const first = text.split('\n')[0], sep = [';', '\t', ','].sort((a, b) => first.split(b).length - first.split(a).length)[0];
  const rows = [[]]; let cur = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else quoted = false; } else cur += ch; }
    else if (ch === '"' && !cur) quoted = true;
    else if (ch === sep) { rows.at(-1).push(cur); cur = ''; }
    else if (ch === '\n') { rows.at(-1).push(cur); rows.push([]); cur = ''; }
    else if (ch !== '\r') cur += ch;
  }
  rows.at(-1).push(cur);
  return rows.filter(r => r.some(c => c.trim()));
}
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
function importAccounts(rows) {
  const head = rows[0].map(norm), col = (...n) => head.findIndex(h => n.includes(h));
  const idx = { name: col('entreprise', 'raison sociale', 'nom', 'compte'), ref: col('reference'), type: col('type'), city: col('ville'), phone: col('telephone'), email: col('email', 'e-mail'), ice: col('ice'), address: col('adresse'), country: col('pays') };
  if (idx.name < 0) throw new Error('Colonne « Entreprise » introuvable.');
  let added = 0, skipped = 0;
  rows.slice(1).forEach(r => {
    const get = k => (idx[k] >= 0 ? (r[idx[k]] || '').trim() : ''), name = get('name');
    if (!name || DB.accounts.some(a => norm(a.name) === norm(name))) return skipped++;
    const t = norm(get('type'));
    DB.accounts.push({ id: uid(), ref: get('ref') || '', name, type: t.startsWith('fourn') ? 'supplier' : t.startsWith('prosp') ? 'prospect' : 'client', city: get('city'), phone: get('phone'), email: get('email'), ice: get('ice'), address: get('address'), country: get('country') || 'Maroc' });
    added++;
  });
  return `${added} compte(s) importé(s), ${skipped} ignoré(s) (vides ou déjà présents).`;
}
ROUTES.data = el => {
  const body = pageHead(el, 'Données et import');
  body.innerHTML = `<div class="card mb"><h2>Reprendre les données Manageo</h2><p>Sélectionnez ensemble les exports CSV (comptes obligatoire ; pour les documents, « une ligne d'article par ligne »). La reprise remplace les données présentes ici.</p>${field('Exports Manageo (.csv)', '<input type="file" id="manageo" accept=".csv" multiple>')}</div>
  <div class="grid g2"><div class="card"><h2>Sauvegarde</h2><p>Vos données sont enregistrées uniquement dans ce navigateur, sur cet appareil. Exportez régulièrement une sauvegarde.</p><div class="row"><button class="btn primary" id="backup">Exporter une sauvegarde</button></div><p style="margin-top:18px">${field('Restaurer une sauvegarde (.json)', '<input type="file" id="restore" accept=".json">')}</p></div>
  <div class="card"><h2>Importer des comptes (CSV)</h2><p>Colonne obligatoire : Entreprise. Colonnes reconnues : Référence, Type, ICE, Adresse, Ville, Pays, Téléphone, Email.</p>${field('Fichier CSV (UTF-8)', '<input type="file" id="csv" accept=".csv,text/csv">')}</div>
  <div class="card"><h2>Démarrer avec mes vraies données</h2><p>Efface toutes les données de ce navigateur et garde les réglages. Pensez ensuite à régler la numérotation.</p><button class="btn danger" id="clear">Vider les données</button></div></div>`;
  $('#manageo', el).onchange = async e => {
    try {
      const files = await Promise.all([...e.target.files].map(async f => ({ name: f.name, text: await f.text() })));
      if (!files.length) return;
      const dues = Object.fromEntries(DB.docs.filter(d => d.imported && d.due).map(d => [d.ref, d.due]));
      const { db, report } = buildFromManageo(files, DB.settings, dues);
      if (!confirm(`Remplacer les données actuelles par ${db.accounts.length} comptes et ${db.docs.length} documents ?`)) return;
      DB = db; save(); render(); toast(`Reprise terminée, ${report.warnings.length} point(s) à vérifier.`);
    } catch (err) { toast(err.message); }
    e.target.value = '';
  };
  $('#backup', el).onclick = () => downloadFile(`revo-manager-${today()}.json`, JSON.stringify(DB, null, 1), 'application/json');
  $('#restore', el).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text()), base = emptyDB();
      if (!data.settings || !Object.keys(base).every(k => !Array.isArray(base[k]) || Array.isArray(data[k]))) throw 0;
      if (data.docs.some(d => !TYPES[d.type] || !Array.isArray(d.lines) || !/^[\w-]+$/.test(d.id))) throw 0;
      if (['accounts', 'transactions'].some(k => data[k].some(r => !/^[\w-]+$/.test(r.id)))) throw 0;
      if (!confirm('Remplacer toutes les données actuelles par cette sauvegarde ?')) return;
      DB = data; save(); render(); toast('Sauvegarde restaurée.');
    } catch (err) { toast("Ce fichier n'est pas une sauvegarde Revo Manager valide."); }
  };
  $('#csv', el).onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    try { const msg = importAccounts(parseCSV(await f.text())); save(); toast(msg); } catch (err) { toast(err.message); }
    e.target.value = '';
  };
  $('#clear', el).onclick = () => {
    if (!confirm('Effacer définitivement toutes les données de Revo Manager dans ce navigateur ?')) return;
    DB = { ...emptyDB(), settings: DB.settings }; save(); render(); toast('Données vidées.');
  };
};
