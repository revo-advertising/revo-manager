/* Données, persistance (navigateur) et calculs */
const KEY = 'revo-manager-v1';
const round = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const today = () => iso(new Date());
const addDays = (s, n) => { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); };
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);

/* Types de documents : mêmes objets et gabarits de numérotation que l'appli actuelle */
const TYPES = {
  estimate: { mod: 'ventes', label: 'Devis', one: 'Devis', pattern: 'D-AAAAMM-NNN', next: ['order', 'invoice'] },
  order:    { mod: 'ventes', label: 'Commandes', one: 'Commande', fem: true, pattern: 'C-AAAAMM-NNN', next: ['delivery', 'invoice'] },
  delivery: { mod: 'ventes', label: 'Bons de livraison', one: 'Bon de livraison', pattern: 'BL-AAAAMM-NNN', next: ['invoice'] },
  invoice:  { mod: 'ventes', label: 'Factures', one: 'Facture', fem: true, pattern: 'F-AAAAMM-NNN', next: ['credit'], money: 1 },
  credit:   { mod: 'ventes', label: 'Avoirs', one: 'Avoir', pattern: 'AV-AAAAMM-NNN', next: [] },
  rfq:      { mod: 'achats', label: 'Demandes de prix', one: 'Demande de prix', fem: true, pattern: 'DP-AAAAMM-NNN', next: ['porder'], buy: 1 },
  porder:   { mod: 'achats', label: 'Bons de commande', one: 'Bon de commande', pattern: 'BC-AAAAMM-NNN', next: ['receipt', 'pinvoice'], buy: 1 },
  receipt:  { mod: 'achats', label: 'Bons de réception', one: 'Bon de réception', pattern: 'BR-AAAAMM-NNN', next: ['pinvoice'], buy: 1 },
  pinvoice: { mod: 'achats', label: "Factures d'achat", one: "Facture d'achat", fem: true, pattern: 'FA-AAAAMM-NNN', next: ['pcredit'], buy: 1, money: -1 },
  pcredit:  { mod: 'achats', label: "Avoirs d'achat", one: "Avoir d'achat", pattern: 'AVF-AAAAMM-NNN', next: [], buy: 1 },
};

const DEFAULT_SETTINGS = {
  company: { name: 'REVO ADVERTISING', activity: 'Agence pub / Marketing Direct', address: 'Espace Majorelles, 11 rue Abou Hayane Attaouhidi, Maârif, 5e étage, n° 10', zip: '20000', city: 'Casablanca', country: 'Maroc', phone: '+212 5 29 27 60 40', website: 'www.revo.ma', legalForm: 'SARLAU au capital de 100 000 DHS', email: 'contact@revo.ma', ice: '003270043000082', rc: '580623', if: '53748327', patente: '35705393', cnss: '4800201', bank: '', rib: '' },
  taxes: [20, 18, 14, 10, 7, 0],
  methods: ['Carte bancaire', 'Chèque', 'Espèces', 'Lettre de change', 'Prélèvement', 'Virement bancaire'],
  expenseCats: ['Agencements & installations', 'Amortissement', 'Brevets, marques & droits', 'Caisses de retraite', 'CNSS & AMO', 'Communication', 'Comptabilité', 'Cotisations et dons', 'Cotisations patronales', 'Déplacements, missions & réceptions', 'Eau & Électricité', 'Fond commercial', 'Frais bancaires', 'Frais de constitution', 'Impôts sur les résultats', 'Installations techniques', 'Marchandises', 'Matériel de bureau', 'Matériel informatique', 'Matières consommables', 'Matières premières', 'Mobilier de bureau', 'Mutuelles', 'Paiement de TVA', 'Prêts au personnel', 'Prêts aux associés', "Produits d'entretien", 'Publicité', 'Restauration', 'Retrait', 'Salaires', 'Téléphone & Internet', 'Transport du personnel'],
  incomeCats: ['Augmentation du capital', 'Remboursement de TVA', 'Vente', 'Versement'],
  patterns: { ...Object.fromEntries(Object.entries(TYPES).map(([k, t]) => [k, t.pattern])), client: 'C-NNN', prospect: 'P-NNN', supplier: 'F-NNN', item: 'A-AAAA-NNN' },
  counters: {},
  openingBalance: 0,
};
/* Catégories exclues du résultat d'exploitation */
const NON_OPERATING = ['Paiement de TVA', 'Impôts sur les résultats', 'Prêts au personnel', 'Prêts aux associés', 'Fond commercial', 'Frais de constitution', 'Retrait', 'Augmentation du capital', 'Remboursement de TVA', 'Versement'];

const emptyDB = () => ({ demo: false, settings: structuredClone(DEFAULT_SETTINGS), accounts: [], contacts: [], todos: [], items: [], docs: [], transactions: [], checks: [], recurring: [], goals: {} });
let DB;

function load() {
  try { DB = JSON.parse(localStorage.getItem(KEY)); } catch (e) { DB = null; }
  if (!DB || !DB.settings) { DB = demoDB(); save(); }
  // complète les champs société ajoutés ou restés vides
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS.company)) if (!DB.settings.company[k]) DB.settings.company[k] = v;
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(DB)); }
  catch (e) { toast('Enregistrement impossible dans ce navigateur. Exportez une sauvegarde.'); }
}

/* ---------- Numérotation ---------- */
function formatRef(pattern, n, date) {
  return pattern.replace('AAAAMM', date.slice(0, 4) + date.slice(5, 7)).replace('AAAA', date.slice(0, 4)).replace(/N+/, m => String(n).padStart(m.length, '0'));
}
const peekRef = (kind, date = today()) => formatRef(DB.settings.patterns[kind], DB.settings.counters[kind] || 1, date);
function takeRef(kind, date = today()) {
  const ref = peekRef(kind, date);
  DB.settings.counters[kind] = (DB.settings.counters[kind] || 1) + 1;
  return ref;
}

/* ---------- Totaux d'un document ---------- */
function totals(doc) {
  let sub = 0, running = 0;
  const base = {}, lineTotals = [];
  for (const l of doc.lines || []) {
    if (l.kind === 'item') {
      const ht = round((+l.qty || 0) * (+l.price || 0) * (1 - (+l.discount || 0) / 100));
      sub = round(sub + ht); running = round(running + ht);
      base[+l.tax || 0] = round((base[+l.tax || 0] || 0) + ht);
      lineTotals.push(ht);
    } else if (l.kind === 'subtotal') { lineTotals.push(running); running = 0; }
    else lineTotals.push(null);
  }
  const discount = round(sub * (+doc.discount || 0) / 100);
  const ratio = sub ? (sub - discount) / sub : 0;
  const taxes = Object.entries(base).map(([rate, b]) => ({ rate: +rate, base: round(b * ratio), amount: round(b * ratio * rate / 100) })).sort((a, b) => a.rate - b.rate);
  const ht = round(sub - discount);
  const vat = round(taxes.reduce((s, t) => s + t.amount, 0));
  /* document repris dont les totaux d'origine diffèrent du calcul des lignes */
  const o = doc.official;
  if (o) return { sub, discount: 0, ht: o.ht, taxes: [{ rate: taxes.at(-1)?.rate ?? 20, base: o.ht, amount: o.vat }], vat: o.vat, ttc: o.ttc, lineTotals };
  return { sub, discount, ht, taxes, vat, ttc: round(ht + vat), lineTotals };
}

const docById = id => DB.docs.find(d => d.id === id);
const accountById = id => DB.accounts.find(a => a.id === id);
const accountName = id => accountById(id)?.name || '—';
const isFinal = d => d.status !== 'draft' && d.status !== 'cancelled';
const paidOn = docId => round(DB.transactions.filter(t => t.docId === docId).reduce((s, t) => s + +t.amount, 0));
const creditedOn = docId => round(DB.docs.filter(d => (d.type === 'credit' || d.type === 'pcredit') && d.sourceId === docId && isFinal(d)).reduce((s, d) => s + totals(d).ttc, 0));
const dueOn = d => (TYPES[d.type].money && isFinal(d)) ? Math.max(0, round(totals(d).ttc - paidOn(d.id) - creditedOn(d.id) - (+d.settled || 0))) : 0;
const lateDays = d => (dueOn(d) > 0 && d.due && d.due < today()) ? daysBetween(d.due, today()) : 0;

/* Statut affiché : [libellé, couleur] */
function statusOf(d) {
  if (d.status === 'draft') return ['Brouillon', ''];
  if (d.status === 'cancelled') return ['Annulé', 'bad'];
  if (TYPES[d.type].money) {
    if (dueOn(d) === 0) return [creditedOn(d.id) && !paidOn(d.id) ? 'Soldée par avoir' : 'Payée', 'ok'];
    if (lateDays(d)) return [`En retard (${lateDays(d)} j)`, 'bad'];
    return paidOn(d.id) ? ['Partiellement payée', 'warn'] : ['À payer', 'warn'];
  }
  const map = { validated: ['Validé', 'info'], accepted: ['Accepté', 'ok'], refused: ['Refusé', 'bad'], invoiced: ['Facturé', 'ok'], converted: ['Transformé', 'ok'], delivered: ['Livrée', 'ok'], expired: ['Expiré', 'bad'] };
  return map[d.status] || [d.status, ''];
}

/* ---------- Agrégats ---------- */
const finals = type => DB.docs.filter(d => d.type === type && isFinal(d));
const sum = (arr, fn) => round(arr.reduce((s, x) => s + fn(x), 0));
const inPeriod = (date, from, to) => date >= from && date <= to;
function revenue(from, to) {
  return round(sum(finals('invoice').filter(d => inPeriod(d.date, from, to)), d => totals(d).ht) - sum(finals('credit').filter(d => inPeriod(d.date, from, to)), d => totals(d).ht));
}
/* Charges : factures d'achat moins avoirs (HT) + dépenses d'exploitation saisies sans facture */
function expenses(from, to) {
  const bills = sum(finals('pinvoice').filter(d => inPeriod(d.date, from, to)), d => totals(d).ht);
  const credits = sum(finals('pcredit').filter(d => inPeriod(d.date, from, to)), d => totals(d).ht);
  const direct = sum(DB.transactions.filter(t => t.kind === 'expense' && !t.docId && !NON_OPERATING.includes(t.category) && inPeriod(t.date, from, to)), t => +t.amount / (1 + (+t.tax || 0) / 100));
  return round(bills - credits + direct);
}
const cashFlow = (kind, from, to) => sum(DB.transactions.filter(t => t.kind === kind && inPeriod(t.date, from, to)), t => +t.amount);
const treasury = () => round((+DB.settings.openingBalance || 0) + cashFlow('income', '0000', '9999') - cashFlow('expense', '0000', '9999'));
/* TVA sur la base de la facturation (date des documents) */
function vatFor(from, to) {
  const part = (type) => sum(finals(type).filter(d => inPeriod(d.date, from, to)), d => totals(d).vat);
  const direct = sum(DB.transactions.filter(t => t.kind === 'expense' && !t.docId && +t.tax && inPeriod(t.date, from, to)), t => +t.amount - +t.amount / (1 + +t.tax / 100));
  const collected = round(part('invoice') - part('credit'));
  const deductible = round(part('pinvoice') - part('pcredit') + direct);
  return { collected, deductible, net: round(collected - deductible) };
}

/* ---------- Données de démonstration (fictives) ---------- */
function demoDB() {
  const db = emptyDB(); db.demo = true;
  const Y = new Date().getFullYear(), now = today();
  const clients = [['Atlas Boissons (démo)', 'Casablanca'], ['Verde Agro (démo)', 'Marrakech'], ['Nova Intérim (démo)', 'Rabat'], ['Campus Horizon (démo)', 'Benguerir'], ['Riad Capital (démo)', 'Casablanca']];
  clients.forEach(([name, city], i) => db.accounts.push({ id: 'c' + i, ref: formatRef('C-NNN', i + 1, now), type: 'client', name, city, country: 'Maroc', phone: '', email: '', ice: '', address: '' }));
  [['Imprimerie du Port (démo)', 'Casablanca'], ['Studio Lumière (démo)', 'Rabat']].forEach(([name, city], i) => db.accounts.push({ id: 's' + i, ref: formatRef('F-NNN', i + 1, now), type: 'supplier', name, city, country: 'Maroc', phone: '', email: '', ice: '', address: '' }));
  db.accounts.push({ id: 'p0', ref: 'P-001', type: 'prospect', name: 'Oasis Retail (démo)', city: 'Agadir', country: 'Maroc', phone: '', email: '', ice: '', address: '' });
  db.contacts.push({ id: uid(), accountId: 'c0', name: 'Contact Démo', role: 'Direction marketing', email: 'contact@exemple.ma', phone: '' });
  const services = [['Forfait mensuel création de contenu et réseaux sociaux', 13000], ['Sponsoring mensuel réseaux sociaux', 2000], ['Conception et exécution de supports print', 8500], ['Production vidéo', 24000], ['Goodies et objets publicitaires', 11500]];
  services.forEach(([name, price], i) => db.items.push({ id: 'a' + i, ref: formatRef('A-AAAA-NNN', i + 1, now), name, type: 'Service', family: 'Famille par défaut', price, tax: 20, description: '' }));

  const counters = {};
  const mk = (type, date, accountId, picks, status, extra = {}) => {
    counters[type] = (counters[type] || 0) + 1;
    const d = { id: uid(), type, ref: formatRef(TYPES[type].pattern, counters[type], date), date, due: addDays(date, 30), accountId, status, subject: services[picks[0][0]][0], discount: 0, notes: 'REVO ADVERTISING vous remercie de votre confiance.', intro: '', terms: '', method: 'Virement bancaire',
      lines: picks.map(([i, qty, price]) => ({ kind: 'item', itemId: 'a' + i, label: services[i][0], description: '', qty, price: price || services[i][1], discount: 0, tax: 20 })), ...extra };
    db.docs.push(d); return d;
  };
  const pay = (d, ratio, delay) => {
    let date = addDays(d.date, delay); if (date > now) date = now;
    db.transactions.push({ id: uid(), kind: d.type === 'invoice' ? 'income' : 'expense', date, amount: round(totals(d).ttc * ratio), category: d.type === 'invoice' ? 'Vente' : 'Marchandises', accountId: d.accountId, method: 'Virement bancaire', docId: d.id, tax: 0, notes: 'Règlement ' + d.ref });
  };
  for (let y = Y - 1; y <= Y; y++) {
    const last = y === Y ? +now.slice(5, 7) : 12;
    for (let m = 1; m <= last; m++) {
      const day = k => { const s = `${y}-${String(m).padStart(2, '0')}-${String(k).padStart(2, '0')}`; return s > now ? now : s; };
      const inv = mk('invoice', day(5), 'c' + (m % 5), [[0, 1], [1, 1 + (m % 3)]], 'validated');
      const age = daysBetween(inv.date, now);
      if (age > 100 || m % 3 === 0 && age > 40) pay(inv, 1, 35);
      else if (age > 45 && m % 2) pay(inv, 0.5, 30);
      if (m % 2 === 0) { const i2 = mk('invoice', day(14), 'c' + ((m + 2) % 5), [[2 + (m % 3), 1]], 'validated'); if (daysBetween(i2.date, now) > 70) pay(i2, 1, 45); }
      const bill = mk('pinvoice', day(10), 's' + (m % 2), [[2, 1, 3200 + m * 210]], 'validated');
      if (daysBetween(bill.date, now) > 40) pay(bill, 1, 30);
      db.transactions.push({ id: uid(), kind: 'expense', date: day(26), amount: 9500, category: 'Salaires', accountId: '', method: 'Virement bancaire', docId: '', tax: 0, notes: 'Salaires (démo)' });
    }
  }
  mk('estimate', addDays(now, -3), 'p0', [[3, 1], [2, 2]], 'draft');
  mk('estimate', addDays(now, -9), 'c1', [[4, 2]], 'validated');
  mk('estimate', addDays(now, -20), 'c2', [[0, 1], [1, 1]], 'accepted');
  mk('estimate', addDays(now, -34), 'c3', [[3, 2]], 'refused');
  mk('order', addDays(now, -12), 'c4', [[2, 3]], 'validated');
  mk('porder', addDays(now, -6), 's0', [[4, 1, 6400]], 'validated');
  Object.entries(counters).forEach(([k, v]) => db.settings.counters[k] = v + 1);
  Object.assign(db.settings.counters, { client: 6, supplier: 3, prospect: 2, item: 6 });
  db.settings.openingBalance = 120000;
  db.todos.push({ id: uid(), title: 'Relancer le devis Verde Agro', due: addDays(now, 2), accountId: 'c1', done: false });
  db.recurring.push({ id: uid(), accountId: 'c0', label: services[0][0], amount: 13000, tax: 20, every: 1, nextDate: addDays(now, 4), active: true });
  return db;
}
