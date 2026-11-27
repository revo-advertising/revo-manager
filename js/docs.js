/* Documents commerciaux : listes, fiche, éditeur, règlement, impression */
const newLabel = t => `${t.fem ? 'Nouvelle' : 'Nouveau'} ${t.one.charAt(0).toLowerCase() + t.one.slice(1)}`;

ROUTES.docs = (el, type) => {
  const t = TYPES[type]; if (!t) return ROUTES.dashboard(el);
  const body = pageHead(el, t.label, `<a class="btn primary" href="#/new/${type}">+ ${newLabel(t)}</a>`);
  const rows = DB.docs.filter(d => d.type === type).sort((a, b) => b.date.localeCompare(a.date) || b.ref.localeCompare(a.ref));
  const ttc = list => money(sum(list, d => totals(d).ttc));
  const ht = list => money(sum(list, d => totals(d).ht)) + ' HT';
  const ok = rows.filter(isFinal);
  let cards;
  if (t.money) {
    const paid = sum(ok, d => paidOn(d.id) + (+d.settled || 0)), late = ok.filter(d => lateDays(d));
    cards = [kpi('Total', ttc(ok), ht(ok), 'TTC'), kpi(t.buy ? 'Décaissé' : 'Encaissé', money(paid), '', 'TTC'), kpi('À payer', money(sum(ok, dueOn)), '', 'TTC'), kpi('En retard', money(sum(late, dueOn)), `${late.length} facture(s)`, 'TTC', 'red')];
  } else if (type === 'estimate') {
    const g = s => rows.filter(d => s.includes(d.status));
    cards = [kpi('Total', ttc(rows), ht(rows), 'TTC'), kpi('Acceptés', ttc(g(['accepted', 'invoiced', 'converted'])), '', 'TTC'), kpi('En attente', ttc(g(['validated'])), `${g(['validated']).length} devis`, 'TTC'), kpi('Refusés', ttc(g(['refused'])), '', 'TTC')];
  } else cards = [kpi('Total', ttc(ok), ht(ok), 'TTC'), kpi('Brouillons', rows.filter(d => d.status === 'draft').length, '', '')];
  body.innerHTML = `<div class="grid g4 mb">${cards.join('')}</div><div id="tbl"></div>`;
  const statuses = [...new Set(rows.map(d => statusOf(d)[0].replace(/ \(.*/, '')))];
  dataTable($('#tbl'), {
    id: 'liste-' + type, rows, href: d => '#/doc/' + d.id,
    filters: { options: statuses.map(s => [s, s]), test: (d, f) => statusOf(d)[0].replace(/ \(.*/, '') === f },
    cols: [
      { h: 'Référence', v: d => d.ref, html: d => `<b>${esc(d.ref)}</b>` },
      { h: 'Objet', v: d => d.subject || '' },
      { h: 'Compte', v: d => accountName(d.accountId) },
      { h: 'Date', v: d => d.date, html: d => fdate(d.date) },
      { h: type === 'estimate' ? 'Validité' : 'Échéance', v: d => d.due || '', html: d => fdate(d.due) },
      { h: 'Total HT', num: 1, v: d => totals(d).ht, html: d => money(totals(d).ht) },
      { h: 'Total TTC', num: 1, v: d => totals(d).ttc, html: d => `<b>${money(totals(d).ttc)}</b>` },
      ...(t.money ? [{ h: 'Reste dû', num: 1, v: d => dueOn(d), html: d => money(dueOn(d)) }] : []),
      { h: 'Statut', v: d => statusOf(d)[0], html: d => badge(statusOf(d)) },
    ],
  });
};

/* Copie un document vers un autre type */
function convert(src, type) {
  const doc = blankDoc(type);
  Object.assign(doc, { accountId: src.accountId, subject: src.subject, discount: src.discount, notes: src.notes, intro: src.intro, terms: src.terms, method: src.method, sourceId: src.id, lines: structuredClone(src.lines) });
  pendingDraft = doc; location.hash = '#/new/' + type;
}
let pendingDraft = null;
const blankDoc = type => ({ id: uid(), type, ref: '', date: today(), due: addDays(today(), 30), accountId: '', status: 'draft', subject: '', discount: 0, notes: 'REVO ADVERTISING vous remercie de votre confiance.', intro: '', terms: '', method: 'Virement bancaire', sourceId: '', lines: [] });

function paymentModal(d) {
  const buy = TYPES[d.type].buy, due = dueOn(d);
  formModal(`${buy ? 'Décaissement' : 'Encaissement'} : ${d.ref}`, [
    { k: 'amount', label: 'Montant (MAD)', type: 'number', value: due, required: 1 },
    { k: 'date', label: 'Date', type: 'date', value: today(), required: 1 },
    { k: 'method', label: 'Mode de paiement', type: 'select', options: DB.settings.methods, value: d.method },
    { k: 'notes', label: 'Référence / notes', value: 'Règlement ' + d.ref },
  ], v => {
    const amount = round(v.amount);
    if (!(amount > 0) || amount > due) { toast(`Le montant doit être compris entre 0,01 et ${money(due)}.`); return false; }
    const tx = { id: uid(), kind: buy ? 'expense' : 'income', date: v.date, amount, category: buy ? 'Marchandises' : 'Vente', accountId: d.accountId, method: v.method, docId: d.id, tax: 0, notes: v.notes };
    DB.transactions.push(tx);
    if (['Chèque', 'Lettre de change'].includes(v.method)) DB.checks.push({ id: uid(), kind: v.method, direction: buy ? 'Émis' : 'Reçu', number: '', bank: '', amount, date: v.date, due: v.date, accountId: d.accountId, status: 'En portefeuille', txId: tx.id });
    toast('Règlement enregistré.');
  });
}

function stepper(d) {
  const t = TYPES[d.type];
  let steps, cur;
  if (d.type === 'estimate') {
    steps = ['Brouillon', 'Validé', d.status === 'refused' ? 'Refusé' : 'Accepté', 'Facturé'];
    cur = { draft: 0, validated: 1, expired: 1, accepted: 2, refused: 2, converted: 2, invoiced: 3 }[d.status] ?? 0;
  } else if (t.money) {
    steps = ['Brouillon', 'Validée', 'Partiel', 'Payée'];
    cur = d.status === 'draft' ? 0 : dueOn(d) === 0 ? 3 : paidOn(d.id) ? 2 : 1;
  } else { steps = ['Brouillon', 'Validé', 'Transformé']; cur = d.status === 'draft' ? 0 : ['converted', 'invoiced', 'delivered'].includes(d.status) ? 2 : 1; }
  return `<div class="card mb"><div class="steps">${steps.map((s, i) => `<div class="step ${i <= cur ? 'done' : ''} ${i === cur ? 'cur' : ''}"><b>${i < cur ? '✓' : i === cur ? '●' : ''}</b>${s}</div>`).join('<hr>')}</div></div>`;
}

function recapHTML(d) {
  const x = totals(d);
  return `<div class="card dark recap"><div class="muted" style="font-weight:700;font-size:10.5px">RÉCAPITULATIF</div>
    <div><span>Sous-total</span><span>${money(x.sub)}</span></div>
    ${x.discount ? `<div><span>Remise ${esc(d.discount)} %</span><span>−${money(x.discount)}</span></div>` : ''}
    <div><b>Total HT</b><b>${money(x.ht)}</b></div>
    ${x.taxes.map(v => `<div><span>TVA ${v.rate} %</span><span>${money(v.amount)}</span></div>`).join('')}
    <div class="muted"><span>Total TVA</span><span>${money(x.vat)}</span></div>
    <div class="ttc"><span>Total TTC (MAD)</span><b>${money(x.ttc)}</b></div></div>`;
}

function linesTable(d) {
  const x = totals(d);
  return `<div class="card flush mb"><table><thead><tr><th>Désignation</th><th class="num">Qté</th><th class="num">PU HT</th><th class="num">Remise</th><th class="num">TVA</th><th class="num">PT HT</th></tr></thead><tbody>${d.lines.map((l, i) => {
    if (l.kind === 'item') return `<tr><td><b>${esc(l.label)}</b><div class="muted pre">${esc(l.description)}</div></td><td class="num">${esc(l.qty)}</td><td class="num">${money(l.price)}</td><td class="num">${+l.discount ? esc(l.discount) + ' %' : '—'}</td><td class="num">${esc(l.tax)} %</td><td class="num"><b>${money(x.lineTotals[i])}</b></td></tr>`;
    if (l.kind === 'subtotal') return `<tr><td colspan="5" class="num"><b>Sous-total</b></td><td class="num"><b>${money(x.lineTotals[i])}</b></td></tr>`;
    return `<tr><td colspan="6" class="pre">${l.kind === 'section' ? `<b style="text-transform:uppercase">${esc(l.label)}</b>` : esc(l.label)}</td></tr>`;
  }).join('') || '<tr><td colspan="6" class="empty">Aucune ligne.</td></tr>'}</tbody></table></div>`;
}

ROUTES.doc = (el, id) => {
  const d = docById(id); if (!d) return ROUTES.dashboard(el);
  const t = TYPES[d.type], x = totals(d), btn = (a, label, cls = '') => `<button class="btn ${cls}" data-a="${a}">${label}</button>`;
  const buttons = [];
  if (d.status === 'draft') buttons.push(`<a class="btn" href="#/edit/${d.id}">Modifier</a>`, btn('validate', 'Valider', 'accent'), btn('delete', 'Supprimer', 'danger'));
  else {
    if (d.type === 'estimate' && d.status === 'validated') buttons.push(btn('accept', 'Marquer accepté', 'accent'), btn('refuse', 'Marquer refusé'));
    if (t.money && dueOn(d) > 0) buttons.push(btn('pay', t.buy ? 'Payer' : 'Encaisser', 'accent'));
    if (isFinal(d) && d.status !== 'refused') t.next.forEach(n => { if (!(d.type === 'estimate' && d.status === 'validated') && !DB.docs.some(c => c.sourceId === d.id && c.type === n && n !== 'credit' && n !== 'pcredit')) buttons.push(btn('to:' + n, 'Créer : ' + TYPES[n].one.toLowerCase())); });
  }
  buttons.push(btn('dup', 'Dupliquer'), btn('pdf', 'PDF / Imprimer', 'primary'));
  el.innerHTML = `<div class="head"><a class="btn sm" href="#/docs/${d.type}" aria-label="Retour">←</a><h1>${t.one} <span class="muted" style="font-weight:500">${esc(d.ref)}</span></h1>${badge(statusOf(d))}<span class="sp"></span>${buttons.join('')}</div><div class="content">
    <div class="hero mb"><div>${esc(accountName(d.accountId))}</div><div class="amt">${money(x.ttc)} MAD <small style="font-size:12px;opacity:.6">TTC</small></div><div style="opacity:.65">${fdate(d.date)} · échéance ${fdate(d.due)}${d.subject ? ' · ' + esc(d.subject) : ''}</div></div>
    ${d.official && Math.abs(totals({ ...d, official: null }).ttc - d.official.ttc) > 0.05 ? `<div class="demo mb">Totaux repris de Manageo (${money(d.official.ttc)} MAD TTC) différents du calcul des lignes (${money(totals({ ...d, official: null }).ttc)} MAD). À vérifier : modifier puis enregistrer recalcule les totaux.</div>` : ''}
    ${stepper(d)}${linesTable(d)}
    <div class="grid g2"><div class="grid" style="align-content:start">
      ${d.notes ? `<div class="card"><h3>Notes</h3><div class="pre">${esc(d.notes)}</div></div>` : ''}
      ${t.money ? `<div class="card"><h3>Règlements</h3><div class="list">${DB.transactions.filter(p => p.docId === d.id).map(p => `<div><span>${fdate(p.date)} · ${esc(p.method)}</span><b>${money(p.amount)}</b></div>`).join('') || (d.settled ? '' : '<div class="muted">Aucun règlement.</div>')}${d.settled ? `<div><span>Marquée payée dans Manageo (date et mode non repris)</span><b>${money(d.settled)}</b></div>` : ''}${creditedOn(d.id) ? `<div><span>Avoirs imputés</span><b>${money(creditedOn(d.id))}</b></div>` : ''}<div><b>Reste dû</b><b class="${dueOn(d) ? 'red' : 'green'}">${money(dueOn(d))} MAD</b></div></div></div>` : ''}
      <div class="card"><h3>Documents associés</h3><div class="list">${[docById(d.sourceId), ...DB.docs.filter(c => c.sourceId === d.id)].filter(Boolean).map(c => `<a href="#/doc/${c.id}"><span>${TYPES[c.type].one} ${esc(c.ref)}</span><b>${money(totals(c).ttc)}</b></a>`).join('') || '<div class="muted">Aucun document lié.</div>'}</div></div>
    </div><div style="align-self:start">${recapHTML(d)}</div></div></div>`;
  $('.head', el).onclick = e => {
    const a = e.target.closest('[data-a]')?.dataset.a; if (!a) return;
    if (a === 'pdf') return printDoc(d);
    if (a === 'pay') return paymentModal(d);
    if (a.startsWith('to:')) return convert(d, a.slice(3));
    if (a === 'dup') { convert(d, d.type); pendingDraft.sourceId = ''; return; }
    if (a === 'delete') { if (confirm(`Supprimer définitivement le brouillon ${d.ref} ?`)) { DB.docs = DB.docs.filter(y => y !== d); save(); location.hash = '#/docs/' + d.type; } return; }
    if (a === 'validate') { if (!d.lines.some(l => l.kind === 'item')) return toast('Ajoutez au moins une ligne avant de valider.'); validateDoc(d); }
    if (a === 'accept') d.status = 'accepted';
    if (a === 'refuse') d.status = 'refused';
    save(); render();
  };
};

function validateDoc(d) {
  d.status = 'validated';
  const src = docById(d.sourceId);
  if (src && !['credit', 'pcredit'].includes(d.type)) src.status = (d.type === 'invoice' || d.type === 'pinvoice') ? 'invoiced' : 'converted';
}

/* ---------- Éditeur ---------- */
let editor = null;
function editorRoute(el, doc, isNew) {
  editor = { doc, isNew, tab: 'entete' };
  const t = TYPES[doc.type];
  const accounts = DB.accounts.filter(a => t.buy ? a.type === 'supplier' : a.type !== 'supplier').sort((a, b) => a.name.localeCompare(b.name));
  el.innerHTML = `<div class="head"><h1>${isNew ? newLabel(t) : 'Modifier ' + esc(doc.ref)}</h1><span class="sp"></span><a class="btn" href="${isNew ? '#/docs/' + doc.type : '#/doc/' + doc.id}">Annuler</a><button class="btn primary" data-save="draft">Brouillon</button><button class="btn accent" data-save="validated">Valider</button></div>
  <div class="tabs">${[['entete', 'Entête'], ['reglement', 'Règlement'], ['conditions', 'Conditions']].map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('')}</div>
  <div class="content"><div data-pane="entete" class="card mb"><div class="grid g2">
      ${field((t.buy ? 'Fournisseur' : 'Compte') + ' *', `<select data-f="accountId"><option value="">Sélectionner un compte</option>${opts(accounts.map(a => [a.id, a.name]), doc.accountId)}</select>`)}
      ${field('Référence', `<input value="${esc(doc.ref || peekRef(doc.type, doc.date))}" disabled>`)}
      ${field('Objet', `<input data-f="subject" value="${esc(doc.subject)}">`)}
      ${field("Date d'émission *", `<input type="date" data-f="date" value="${doc.date}">`)}
      ${field(doc.type === 'estimate' ? "Valide jusqu'au" : 'Échéance', `<input type="date" data-f="due" value="${doc.due}">`)}
    </div></div>
    <div data-pane="reglement" class="card mb" hidden><div class="grid g2">${field('Mode de paiement', `<select data-f="method">${opts([['', 'Non renseigné'], ...DB.settings.methods], doc.method)}</select>`)}</div></div>
    <div data-pane="conditions" class="card mb" hidden><div class="grid">${field('Introduction', `<textarea data-f="intro">${esc(doc.intro)}</textarea>`)}${field('Conditions', `<textarea data-f="terms" placeholder="50 % d'avance et 50 % à la livraison">${esc(doc.terms)}</textarea>`)}${field('Notes visibles pour le destinataire', `<textarea data-f="notes">${esc(doc.notes)}</textarea>`)}</div></div>
    <div class="card flush mb"><div class="toolbar"><b>Lignes de facturation</b><span class="sp"></span>
      <select data-catalog aria-label="Ajouter depuis le catalogue"><option value="">Depuis le catalogue…</option>${opts(DB.items.map(i => [i.id, i.name]))}</select>
      ${[['item', '+ Ligne'], ['section', 'Section'], ['text', 'Texte libre'], ['subtotal', 'Sous-total']].map(([k, l]) => `<button class="btn sm" data-add="${k}">${l}</button>`).join('')}</div><div id="lines" style="overflow:auto"></div></div>
    <div class="grid g2"><div class="card" style="align-self:start">${field('Remise globale (%)', `<input type="number" min="0" max="100" step="any" data-f="discount" value="${esc(doc.discount)}">`)}</div><div id="recap"></div></div></div>`;

  const showTab = k => { $$('[data-tab]', el).forEach(b => b.classList.toggle('on', b.dataset.tab === k)); $$('[data-pane]', el).forEach(p => p.hidden = p.dataset.pane !== k); };
  showTab('entete');
  const recap = () => $('#recap', el).innerHTML = recapHTML(doc);
  const drawLines = () => {
    const x = totals(doc);
    $('#lines', el).innerHTML = doc.lines.length ? `<table class="lines" style="min-width:760px"><thead><tr><th style="width:40%">Désignation</th><th>Qté</th><th>PU HT</th><th>Remise %</th><th>TVA %</th><th class="num">PT HT</th><th></th></tr></thead><tbody>${doc.lines.map((l, i) => {
      const del = `<td class="num"><button class="btn sm" data-up="${i}" aria-label="Monter la ligne">↑</button> <button class="btn sm danger" data-del="${i}" aria-label="Supprimer la ligne">✕</button></td>`;
      const inp = (k, v, extra = '') => `<input data-l="${i}" data-k="${k}" value="${esc(v)}" ${extra}>`;
      if (l.kind === 'item') return `<tr><td>${inp('label', l.label, 'placeholder="Désignation"')}<textarea data-l="${i}" data-k="description" placeholder="Description" style="margin-top:4px">${esc(l.description)}</textarea></td><td>${inp('qty', l.qty, 'type="number" step="any" min="0"')}</td><td>${inp('price', l.price, 'type="number" step="any"')}</td><td>${inp('discount', l.discount, 'type="number" step="any" min="0" max="100"')}</td><td><select data-l="${i}" data-k="tax">${opts(DB.settings.taxes, l.tax)}</select></td><td class="num" data-total="${i}">${money(x.lineTotals[i])}</td>${del}</tr>`;
      if (l.kind === 'subtotal') return `<tr><td colspan="5" class="num"><b>Sous-total</b></td><td class="num" data-total="${i}">${money(x.lineTotals[i])}</td>${del}</tr>`;
      return `<tr><td colspan="6">${inp('label', l.label, `placeholder="${l.kind === 'section' ? 'Titre de section' : 'Texte libre'}"`)}</td>${del}</tr>`;
    }).join('')}</tbody></table>` : '<div class="empty">Aucune ligne pour l\'instant. Ajoutez des articles depuis le catalogue ou manuellement.</div>';
    recap();
  };
  drawLines();
  const blankLine = kind => kind === 'item' ? { kind, label: '', description: '', qty: 1, price: 0, discount: 0, tax: 20 } : { kind, label: '' };
  el.oninput = e => {
    const n = e.target;
    if (n.dataset.f) { doc[n.dataset.f] = n.value; if (n.dataset.f === 'discount') { doc.discount = Math.min(100, Math.max(0, +n.value || 0)); recap(); } }
    if (n.dataset.l != null) {
      doc.lines[+n.dataset.l][n.dataset.k] = n.value;
      const x = totals(doc); $$('[data-total]', el).forEach(c => c.textContent = money(x.lineTotals[+c.dataset.total])); recap();
    }
  };
  el.onchange = e => {
    if (e.target.matches('[data-catalog]') && e.target.value) {
      const it = DB.items.find(i => i.id === e.target.value);
      doc.lines.push({ ...blankLine('item'), itemId: it.id, label: it.name, description: it.description || '', price: it.price, tax: it.tax });
      e.target.value = ''; drawLines();
    }
  };
  el.onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.tab) return showTab(b.dataset.tab);
    if (b.dataset.add) { doc.lines.push(blankLine(b.dataset.add)); return drawLines(); }
    if (b.dataset.del != null) { doc.lines.splice(+b.dataset.del, 1); return drawLines(); }
    if (b.dataset.up != null) { const i = +b.dataset.up; if (i) [doc.lines[i - 1], doc.lines[i]] = [doc.lines[i], doc.lines[i - 1]]; return drawLines(); }
    if (b.dataset.save) {
      if (!doc.accountId) return toast('Choisissez un compte.');
      if (!doc.date) return toast("Indiquez la date d'émission.");
      if (b.dataset.save === 'validated') {
        if (!doc.lines.some(l => l.kind === 'item' && l.label.trim())) return toast('Ajoutez au moins une ligne avec une désignation.');
        const src = docById(doc.sourceId);
        if (['credit', 'pcredit'].includes(doc.type) && src && totals(doc).ttc > round(totals(src).ttc - creditedOn(src.id))) return toast("L'avoir dépasse le montant restant de la facture d'origine.");
      }
      delete doc.official; // une modification enregistrée recalcule les totaux
      if (isNew) { doc.ref = takeRef(doc.type, doc.date); DB.docs.push(doc); }
      else DB.docs[DB.docs.findIndex(y => y.id === doc.id)] = doc;
      if (b.dataset.save === 'validated') validateDoc(doc);
      save(); toast(doc.ref + ' enregistré.'); location.hash = '#/doc/' + doc.id;
    }
  };
}
ROUTES.new = (el, type) => {
  if (!TYPES[type]) return ROUTES.dashboard(el);
  const doc = pendingDraft?.type === type ? pendingDraft : blankDoc(type);
  pendingDraft = null;
  editorRoute(el, doc, true);
};
ROUTES.edit = (el, id) => {
  const d = docById(id);
  if (!d || d.status !== 'draft') return ROUTES.doc(el, id);
  editorRoute(el, structuredClone(d), false);
};

/* ---------- Impression : modèle « Classique » ---------- */
function inWords(amount) {
  const u = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
  const tens = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];
  const two = (n, final) => {
    if (n < 20) return u[n];
    let t = Math.floor(n / 10), r = n % 10;
    if (t === 7 || t === 9) r += 10;
    if (!r) return tens[t] + (t === 8 && final ? 's' : '');
    return tens[t] + ((r === 1 || r === 11) && t < 8 ? ' et ' : '-') + u[r];
  };
  const three = (n, final) => {
    const h = Math.floor(n / 100), r = n % 100;
    const hs = h ? (h > 1 ? u[h] + ' ' : '') + 'cent' + (h > 1 && !r && final ? 's' : '') : '';
    return [hs, r ? two(r, final) : ''].filter(Boolean).join(' ');
  };
  const int = n => {
    if (!n) return 'zéro';
    const m = Math.floor(n / 1e6), k = Math.floor(n % 1e6 / 1000), r = n % 1000, out = [];
    if (m) out.push(three(m, true) + ' million' + (m > 1 ? 's' : ''));
    if (k) out.push((k > 1 ? three(k, false) + ' ' : '') + 'mille');
    if (r) out.push(three(r, true));
    return out.join(' ');
  };
  const cents = Math.round(amount * 100), dh = Math.floor(cents / 100), ct = cents % 100;
  return `${int(dh)} ${dh > 1 ? 'dirhams' : 'dirham'}${ct ? ` et ${int(ct)} ${ct > 1 ? 'centimes' : 'centime'}` : ''}`;
}

const STAMPED = ['estimate', 'order', 'delivery', 'invoice', 'credit', 'porder'];
function sheetHTML(d, withStamp = false) {
  const t = TYPES[d.type], x = totals(d), c = DB.settings.company, a = accountById(d.accountId) || {}, src = docById(d.sourceId);
  const priced = !['delivery', 'receipt', 'rfq'].includes(d.type);
  const legal = [['ICE', c.ice], ['RC', c.rc], ['IF', c.if], ['Patente', c.patente], ['CNSS', c.cnss]].filter(v => v[1]).map(v => `${v[0]} : ${esc(v[1])}`).join(' · ');
  return `<div class="sheet"><header><img src="${esc(c.logo || 'assets/logo-societe.svg')}" alt="revo."><div><h1>${t.one}</h1><div style="text-align:right">${esc(d.ref)}${d.status === 'draft' ? ' · BROUILLON' : ''}</div></div></header>
  <div class="meta"><dl><dt>Référence</dt><dd>${esc(d.ref)}</dd><dt>Date</dt><dd>${fdate(d.date)}</dd>${priced ? `<dt>${d.type === 'estimate' ? 'Validité' : 'Échéance'}</dt><dd>${fdate(d.due)}</dd>` : ''}${src ? `<dt>Origine</dt><dd>${esc(src.ref)}</dd>` : ''}</dl>
  <div class="client"><b>${esc(a.name)}</b><br>${a.ice ? `<b>ICE :</b> ${esc(a.ice)}<br>` : ''}${a.address ? esc(a.address) + '<br>' : ''}${esc(a.city)}<br>${esc(a.country)}</div></div>
  ${d.subject ? `<p><b>Objet :</b> ${esc(d.subject)}</p>` : ''}${d.intro ? `<p class="pre">${esc(d.intro)}</p>` : ''}
  <table><thead><tr><th>Désignation</th><th class="num">Quantité</th>${priced ? '<th class="num">PU HT</th><th class="num">TVA</th><th class="num">PT HT</th>' : ''}</tr></thead><tbody>${d.lines.map((l, i) => {
    const span = priced ? 5 : 2;
    if (l.kind === 'item') return `<tr><td><b>${esc(l.label)}</b>${l.description ? `<div class="pre">${esc(l.description)}</div>` : ''}</td><td class="num">${esc(l.qty)}</td>${priced ? `<td class="num">${money(l.price)}${+l.discount ? `<br>−${esc(l.discount)} %` : ''}</td><td class="num">${esc(l.tax)} %</td><td class="num"><b>${money(x.lineTotals[i])}</b></td>` : ''}</tr>`;
    if (l.kind === 'subtotal') return priced ? `<tr><td colspan="4" class="num"><b>Sous-total</b></td><td class="num"><b>${money(x.lineTotals[i])}</b></td></tr>` : '';
    return `<tr><td colspan="${span}">${l.kind === 'section' ? `<b>${esc(l.label)}</b>` : esc(l.label)}</td></tr>`;
  }).join('')}</tbody></table>
  ${priced ? `<div class="tot"><div><span>Total HT${x.discount ? ' (après remise)' : ''}</span><b>${money(x.ht)}</b></div>${x.taxes.map(v => `<div><span>TVA ${v.rate} %</span><span>${money(v.amount)}</span></div>`).join('')}<div class="ttc"><span>Total TTC (MAD)</span><span>${money(x.ttc)}</span></div></div>
  <p>Arrêté ${t.fem ? 'la présente' : 'le présent'} ${t.one.toLowerCase()} à la somme de : <b>${inWords(x.ttc)} TTC</b>.</p>` : '<p style="margin-top:40px">Signature et cachet :</p>'}
  ${d.terms ? `<p class="pre"><b>Conditions :</b> ${esc(d.terms)}</p>` : ''}${priced && d.method ? `<p><b>Mode de paiement :</b> ${esc(d.method)}${c.rib ? `<br><b>Banque :</b> ${esc(c.bank)} · <b>RIB :</b> ${esc(c.rib)}` : ''}</p>` : ''}${d.notes ? `<p class="pre">${esc(d.notes)}</p>` : ''}
  ${withStamp && c.stamp && STAMPED.includes(d.type) ? `<div class="stamp"><img src="${esc(c.stamp)}" alt="Cachet"></div>` : ''}
  <footer><b>${esc(c.name)}</b>${c.legalForm ? ' · ' + esc(c.legalForm) : ''} · ${esc(c.address)}, ${esc(c.zip)} ${esc(c.city)}, ${esc(c.country)}<br>Tél. ${esc(c.phone)} · ${esc(c.website)}${c.email ? ' · ' + esc(c.email) : ''}${legal ? '<br>' + legal : ''}</footer></div>`;
}
function printDoc(d) {
  const available = !!DB.settings.company.stamp && STAMPED.includes(d.type);
  let withStamp = available && d.status !== 'draft'; // jamais coché d'office sur un brouillon
  $('#modal').innerHTML = `<div class="ovl"><form style="width:min(820px,100%)"><div class="row mb"><b>Aperçu ${esc(d.ref)}</b><span class="sp"></span>${available ? `<label class="row" style="gap:6px"><input type="checkbox" data-stamp ${withStamp ? 'checked' : ''}> Apposer le cachet</label>` : ''}<button type="button" class="btn" data-close>Fermer</button><button type="button" class="btn primary" data-go>Imprimer / Enregistrer en PDF</button></div><div data-sheet></div></form></div>`;
  const draw = () => { $('#modal [data-sheet]').innerHTML = $('#print').innerHTML = sheetHTML(d, withStamp); };
  draw();
  if (available) $('#modal [data-stamp]').onchange = e => { withStamp = e.target.checked; draw(); };
  $('#modal [data-close]').onclick = closeModal;
  $('#modal [data-go]').onclick = () => { const old = document.title; document.title = d.ref; window.print(); document.title = old; };
}
