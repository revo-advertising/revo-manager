/* Reprise des exports CSV de Manageo (« une ligne d'article par ligne ») */
const mNum = s => { const n = parseFloat(String(s || '').replace(/[,\s]/g, '')); return Number.isFinite(n) ? n : 0; };
const mDate = s => /^\d{2}\/\d{2}\/\d{4}/.test(s || '') ? s.slice(0, 10).split('/').reverse().join('-') : '';
const mRows = text => { const [head, ...rows] = parseCSV(text); return rows.map(r => Object.fromEntries(head.map((h, i) => [h.trim(), (r[i] || '').trim()]))); };
const pick = (row, ...names) => { for (const n of names) if (row[n]) return row[n]; return ''; };

function manageoKind(text) {
  const h = parseCSV(text.split('\n')[0] + '\n')[0].map(x => x.trim()), has = (...n) => n.every(x => h.includes(x));
  if (has('Entreprise', 'Type', 'Registre de commerce')) return 'accounts';
  if (has('Compte', 'Prénom', 'Nom')) return 'contacts';
  if (has('Désignation', 'Prix de vente HT')) return 'items';
  if (has('Ref Client', 'Désignation Ligne')) return 'invoice';
  if (has('Fournisseur', 'Référence Ext')) return 'pinvoice';
  if (has('Fournisseur', 'Arrivée prévue')) return 'porder';
  if (has('Compte', 'Expédition prévue')) return 'delivery';
  if (has('Compte', 'Livraison prévue')) return 'order';
  if (has('Client', "Date d'émission", 'Désignation')) return 'estimate';
  return null;
}

const M_STATUS = { Brouillon: 'draft', Validé: 'validated', Validée: 'validated', Retard: 'validated', 'Payée': 'validated', 'Payé': 'validated', 'Facturé': 'invoiced', 'Facturée': 'invoiced', 'Accepté': 'accepted', 'Acceptée': 'accepted', 'Refusé': 'refused', 'Refusée': 'refused', 'Expiré': 'expired', 'Livrée': 'delivered', 'Annulé': 'cancelled', 'Annulée': 'cancelled' };

/* files = [{name, text}] ; dues = {référence: 'AAAA-MM-JJ'} pour les factures (absentes de l'export) */
function buildFromManageo(files, settings, dues = {}) {
  const db = { ...emptyDB(), settings: structuredClone(settings) }, report = { files: [], warnings: [] };
  const byKind = {};
  for (const f of files) {
    const kind = manageoKind(f.text);
    if (!kind) throw new Error(`Fichier non reconnu : ${f.name}`);
    if (byKind[kind]) throw new Error(`Deux fichiers du même type : ${f.name}`);
    byKind[kind] = mRows(f.text); report.files.push(kind);
  }
  if (!byKind.accounts) throw new Error("Ajoutez l'export des comptes.");
  const types = { Client: 'client', Fournisseur: 'supplier', Prospect: 'prospect', Partenaire: 'partner' };
  byKind.accounts.forEach(r => db.accounts.push({ id: uid(), ref: r['Référence'], name: r.Entreprise, type: types[r.Type] || 'client', category: r['Catégorie'], email: r.Email, phone: r['Téléphone'], mobile: r.Portable, website: r['Site web'], address: r.Adresse, zip: r['Code postal'], city: r.Ville, country: r.Pays, rc: r['Registre de commerce'], ice: r['N° TVA'], taxId: r['Identifiant fiscal'], sector: r["Secteur d'activité"], owner: r.Responsable, createdAt: mDate(r['Date de création']) }));
  const findAccount = (name, ref, supplier) => {
    let list = db.accounts.filter(a => ref && a.ref === ref && norm(a.name) === norm(name));
    if (!list.length) list = db.accounts.filter(a => norm(a.name) === norm(name));
    let a = list.find(x => supplier ? x.type === 'supplier' : x.type !== 'supplier') || list[0];
    if (!a) { a = { id: uid(), ref: ref || '', name: name || 'Compte non renseigné', type: supplier ? 'supplier' : 'client', city: '', country: 'Maroc', ice: '', phone: '', email: '', address: '' }; db.accounts.push(a); report.warnings.push(`Compte absent de l'export, créé : ${a.name}`); }
    return a;
  };
  (byKind.contacts || []).forEach(r => db.contacts.push({ id: uid(), accountId: findAccount(r.Compte).id, name: `${r['Prénom']} ${r.Nom}`.trim(), title: r['Civilité'], role: r.Fonction, email: r.Email, phone: pick(r, 'Téléphone', 'Mobile') }));
  (byKind.items || []).forEach(r => db.items.push({ id: uid(), ref: r['Référence'], name: r['Désignation'], type: r.Type === 'service' ? 'Service' : 'Produit', family: r['Famille'], description: r.Description, price: mNum(r['Prix de vente HT']), tax: mNum(r.TVA) }));

  for (const type of ['estimate', 'order', 'delivery', 'invoice', 'porder', 'pinvoice']) {
    const groups = new Map();
    (byKind[type] || []).forEach(r => { const k = r['Référence']; (groups.get(k) || groups.set(k, []).get(k)).push(r); });
    for (const [ref, rows] of groups) {
      const h = rows[0], src = h.Statut, date = mDate(h["Date d'émission"]);
      if (!M_STATUS[src]) report.warnings.push(`${ref} : statut « ${src} » inconnu, repris en brouillon.`);
      const lines = rows.map(r => {
        const label = pick(r, 'Désignation Ligne', 'Désignation article', 'Désignation'), description = pick(r, 'Description Ligne', 'Description article', 'Description');
        const qty = mNum(r['Quantité']), price = mNum(r['PU HT']), rate = type === 'invoice' || type === 'pinvoice' ? r['Taxe %'] : r.Taxe;
        if (!qty && !price) return { kind: 'text', label: [label, description].filter(Boolean).join('\n') };
        return { kind: 'item', label: label || pick(r, 'Ref Ligne', 'Référence article', 'Réf article', 'Article'), description, qty, price, discount: mNum(r.Remise), tax: mNum(rate), unit: r['Unité'] || '', code: pick(r, 'Ref Ligne', 'Référence article', 'Réf article', 'Article') };
      }).filter(l => l.kind === 'item' || l.label);
      const doc = { id: uid(), type, ref, date, due: dues[ref] || mDate(pick(h, 'Livraison prévue', 'Expédition prévue', 'Arrivée prévue')), accountId: findAccount(pick(h, 'Client', 'Compte', 'Fournisseur'), h['Ref Client'], !!TYPES[type].buy).id, status: M_STATUS[src] || 'draft', subject: h.Objet || '', discount: 0, notes: '', intro: '', terms: '', method: '', sourceId: '', owner: h.Responsable || '', extRef: h['Référence Ext'] || '', imported: src, lines };
      /* le total affiché par Manageo fait foi ; un écart est conservé et signalé */
      const official = mNum(h['Total TTC']), computed = totals(doc).ttc;
      if (Math.abs(computed - official) > 0.005) {
        const vat = mNum(h.TVA);
        doc.official = { ht: mNum(h['Total HT']) || round(official - vat), vat, ttc: official };
        if (Math.abs(computed - official) > 0.05) report.warnings.push(`${ref} : lignes ${money(computed)} contre total Manageo ${money(official)} MAD. Total Manageo conservé, à vérifier.`);
      }
      const final = totals(doc).ttc;
      if (src === 'Payée' || src === 'Payé') doc.settled = final;
      db.docs.push(doc);
    }
  }
  /* numérotation : on continue après le plus grand numéro repris */
  const highest = refs => Math.max(0, ...refs.map(r => +(/(\d+)$/.exec(r || '')?.[1] || 0))) + 1;
  Object.keys(TYPES).forEach(t => db.settings.counters[t] = highest(db.docs.filter(d => d.type === t).map(d => d.ref)));
  for (const [k, p] of [['client', 'C-'], ['supplier', 'F-'], ['prospect', 'P-']]) db.settings.counters[k] = highest(db.accounts.map(a => a.ref).filter(r => r.startsWith(p) && r.length <= 5));
  db.settings.counters.item = highest(db.items.map(i => i.ref));
  return { db, report };
}
