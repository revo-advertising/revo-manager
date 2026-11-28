/* Données, persistance et calculs */
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

const emptyDB = () => ({ settings: structuredClone(DEFAULT_SETTINGS), accounts: [], contacts: [], todos: [], items: [], docs: [], transactions: [], checks: [], recurring: [], goals: {} });
let DB;

function load() {
  try { DB = JSON.parse(localStorage.getItem(KEY)); } catch (e) { DB = null; }
  // les anciennes données de démonstration sont effacées ; les données réelles sont conservées
  if (!DB || !DB.settings || DB.demo) { DB = emptyDB(); save(); }
  normalize();
}
/* complète les champs société ajoutés ou restés vides */
function normalize() {
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS.company)) if (!DB.settings.company[k]) DB.settings.company[k] = v;
}
function save() {
  if (Cloud.enabled) return cloudSave();
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
