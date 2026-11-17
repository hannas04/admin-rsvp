/* seating-module.js
   Adds a "Seating" tab to the admin dashboard:
   - create tables one by one or many at once (name optional, any number of seats, round / long / head shape)
   - wedding mode: groom side and bride side for guests and tables (names can be changed)
   - drag a guest onto a table, or use the "Seat at..." menu (works on phones)
   - auto-arrange, clear seating, export CSV
   - the gate result also shows "Groom's side - Table 7" after a scan
   Needs seating.sql to be run in Supabase first.

   Add this line just before </body>, after the other <script> lines:
       <script src="seating-module.js"></script>
*/
(function () {
  const sidebar = document.querySelector('.side');
  const main = document.querySelector('.main');
  const out = document.getElementById('out');
  if (!sidebar || !main || !out) return;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const E = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const note = t => { if (typeof toast === 'function') toast(t); };
  const same = (a, b) => String(a) === String(b);

  /* ---------- styles ---------- */
  const st = document.createElement('style');
  st.textContent = `
  #v-seating .sb-chips{display:flex;flex-wrap:wrap;gap:8px}
  .sb-pill{padding:.35em .9em;border-radius:999px;background:var(--hi);color:var(--lo);font-size:.6rem;letter-spacing:.1em;text-transform:uppercase;font-weight:600}
  .sb-pill.warn{background:rgba(217,138,28,.18);color:var(--warn)}
  .sb-set{display:flex;flex-wrap:wrap;gap:12px 22px;align-items:center;margin-bottom:14px}
  .sb-set label{display:flex;gap:8px;align-items:center}
  .sb-labs{display:flex;flex-wrap:wrap;gap:12px 18px;align-items:center}
  .sb-labs .in{width:140px}
  .sb-tools{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:14px}
  .sb-grid{display:grid;grid-template-columns:340px 1fr;gap:14px;align-items:start}
  @media(max-width:1000px){.sb-grid{grid-template-columns:1fr}}
  .sb-guests{position:sticky;top:12px}
  @media(max-width:1000px){.sb-guests{position:static}}
  .sb-filters{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0}
  .sb-f{padding:.4em .9em;border-radius:999px;border:1px solid var(--hair);font-size:.58rem;letter-spacing:.1em;text-transform:uppercase}
  .sb-f.on{background:var(--acc);border-color:var(--acc);color:#fff}
  .sb-list{display:grid;gap:8px;max-height:calc(100vh - 280px);overflow:auto;padding:2px;min-height:60px}
  @media(max-width:1000px){.sb-list{max-height:420px}}
  .sb-g{display:grid;grid-template-columns:1fr auto;gap:6px 8px;align-items:center;padding:10px;border:1px solid var(--hair);border-radius:10px;background:var(--card);cursor:grab}
  .sb-g.drag{opacity:.4}
  .sb-gn b{display:block;font-weight:600}
  .sb-gn small{color:var(--soft);font-size:.68rem}
  .sb-as{grid-column:1/-1;padding:.5em .7em;font-size:.74rem}
  .sb-sg{display:inline-flex;gap:4px}
  .sb-sg button{width:28px;height:28px;border-radius:50%;border:1px solid var(--hair);font-size:.65rem;font-weight:700;color:var(--soft)}
  .sb-sg button.on.groom{background:#3a7bd5;border-color:#3a7bd5;color:#fff}
  .sb-sg button.on.bride{background:var(--acc);border-color:var(--acc);color:#fff}
  .sb-sd{display:inline-block;margin-left:6px;padding:.15em .7em;border-radius:999px;font-size:.55rem;letter-spacing:.08em;text-transform:uppercase;font-weight:600}
  .sb-sd.groom{background:rgba(58,123,213,.16);color:#3a7bd5}
  .sb-sd.bride{background:rgba(214,64,122,.16);color:var(--acc)}
  .sb-tables{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px}
  .sb-rn{display:inline-block;margin-left:6px;padding:0;font-size:.66rem;color:var(--acc);text-decoration:underline}
  .sb-t{background:var(--card);border:1px solid var(--hair);border-radius:14px;padding:14px;transition:box-shadow .2s,border-color .2s}
  .sb-t.over{border-color:var(--acc);box-shadow:0 0 0 3px var(--hi)}
  .sb-th{display:flex;align-items:center;gap:10px;margin-bottom:10px}
  .sb-th>div{flex:1;min-width:0}
  .sb-th b{font:500 1rem var(--caps)}
  .sb-ic svg{width:24px;height:24px;stroke:var(--acc);fill:var(--hi);stroke-width:1.6}
  .sb-bar{height:6px;border-radius:6px;background:var(--hair);overflow:hidden}
  .sb-bar i{display:block;height:100%;background:var(--ok);border-radius:6px;transition:width .3s}
  .sb-t.full .sb-bar i{background:var(--warn)}
  .sb-t.bad .sb-bar i{background:var(--bad)}
  .sb-cnt{font-size:.68rem;color:var(--soft);margin:6px 0 10px}
  .sb-t.bad .sb-cnt{color:var(--bad);font-weight:600}
  .sb-ts{display:flex;flex-wrap:wrap;gap:6px;min-height:34px}
  .sb-c{display:inline-flex;align-items:center;gap:6px;padding:.3em .3em .3em .8em;border-radius:999px;background:var(--hi);color:var(--ink);font-size:.74rem;cursor:grab}
  .sb-c.groom{background:rgba(58,123,213,.16)}
  .sb-c.bride{background:rgba(214,64,122,.16)}
  .sb-c.warn{outline:2px solid var(--warn)}
  .sb-c em{font-style:normal;color:var(--soft);font-size:.68rem}
  .sb-c button{width:20px;height:20px;border-radius:50%;background:rgba(0,0,0,.1);font-size:.8rem;line-height:1}
  .sb-empty{grid-column:1/-1;text-align:center;padding:40px;color:var(--soft);border:1px dashed var(--hair);border-radius:14px}
  .gov .seat{font:700 clamp(1.4rem,7vw,2.2rem)/1.15 "Playfair Display",Georgia,serif;margin-top:4px}`;
  document.head.appendChild(st);

  /* ---------- nav button + section ---------- */
  const btn = document.createElement('button');
  btn.className = 'nav';
  btn.id = 'navSeating';
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><circle cx="12" cy="4" r="1.6"/><circle cx="12" cy="20" r="1.6"/><circle cx="4" cy="12" r="1.6"/><circle cx="20" cy="12" r="1.6"/></svg>Seating';
  sidebar.insertBefore(btn, out);

  const sec = document.createElement('section');
  sec.id = 'v-seating';
  sec.hidden = true;
  sec.innerHTML = `
    <div class="bar"><h2>Seating</h2><div class="sb-chips" id="sbSum"></div></div>
    <div class="muted" id="sbErr" style="margin-bottom:14px;font-weight:600"></div>
    <div id="sbBody">
      <div class="box sb-set">
        <label><input type="checkbox" id="sbWed"> This event is a wedding (groom and bride sides)</label>
        <span class="sb-labs" id="sbLabs">
          <label class="muted">Groom <input class="in" id="sbGL" maxlength="20" placeholder="Groom"></label>
          <label class="muted">Bride <input class="in" id="sbBL" maxlength="20" placeholder="Bride"></label>
          <button class="btn btn-line btn-sm" type="button" id="sbSaveL">Save names</button>
          <label class="muted"><input type="checkbox" id="sbApart" checked> Keep sides apart when auto-arranging</label>
        </span>
      </div>
      <div class="sb-tools">
        <button class="btn btn-acc" type="button" id="sbAdd">+ Add table</button>
        <button class="btn btn-line" type="button" id="sbAuto">Auto-arrange unseated</button>
        <button class="btn btn-line" type="button" id="sbClear">Clear seating</button>
        <button class="btn btn-line" type="button" id="sbCsv">Export CSV</button>
        <label class="muted" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="sbCards"> Include printed cards</label>
        <span class="sb-labs" id="sbBatchW" hidden>
          <select class="in" id="sbBatch" style="width:auto" aria-label="Batch of cards"></select>
          <button class="btn btn-line btn-sm" type="button" data-bside="groom">Batch = groom side</button>
          <button class="btn btn-line btn-sm" type="button" data-bside="bride">Batch = bride side</button>
          <button class="btn btn-line btn-sm" type="button" data-bside="none">Batch = no side</button>
        </span>
      </div>
      <div class="sb-grid">
        <aside class="box sb-guests">
          <h3>Guests</h3>
          <input class="in" id="sbQ" placeholder="Search a guest\u2026" autocomplete="off">
          <div class="sb-filters" id="sbFil"></div>
          <div class="sb-list" id="sbList"></div>
        </aside>
        <div class="sb-tables" id="sbTables"></div>
      </div>
    </div>`;
  main.appendChild(sec);

  const dlg = document.createElement('dialog');
  dlg.id = 'sbDlg';
  dlg.innerHTML = `
    <div class="dh"><span id="sbDlgT">Table</span><button type="button" id="sbDlgX" aria-label="Close" style="font-size:1.5rem">\u00d7</button></div>
    <form id="sbForm">
      <div class="db">
        <label class="muted" id="sbCountW">How many tables to add<input class="in" id="sbCount" type="number" min="1" max="100" value="1"></label>
        <label class="muted">Name (optional, leave empty for "Table 1, Table 2\u2026")<input class="in" id="sbN" maxlength="40" placeholder="e.g. Family table"></label>
        <label class="muted">Seats<input class="in" id="sbSeats" type="number" min="1" max="60" value="8" required></label>
        <label class="muted" id="sbSideW">This table is for<select class="in" id="sbSide"></select></label>
        <label class="muted">Shape<select class="in" id="sbShape"><option value="round">Round table</option><option value="long">Long table</option><option value="head">Head table</option></select></label>
      </div>
      <div class="df"><button class="btn btn-acc" type="submit">Save</button><button class="btn btn-line" type="button" id="sbDel" hidden>Delete table</button></div>
    </form>`;
  document.body.appendChild(dlg);

  btn.onclick = () => {
    $$('.nav').forEach(x => x.classList.toggle('on', x === btn));
    main.querySelectorAll(':scope > section').forEach(s => { s.hidden = s !== sec; });
    if (typeof stopCam === 'function') stopCam();
    openTab();
  };
  $$('.nav[data-v]').forEach(b => b.addEventListener('click', () => { sec.hidden = true; }));

  /* ---------- state + helpers ---------- */
  const S = { eventId: null, settings: { wedding: false, groom_label: 'Groom', bride_label: 'Bride' }, tables: [], ready: false, err: '', filter: 'unseated', q: '', cards: false };
  const ICON = {
    round: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7"/></svg>',
    long: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2" y="8" width="20" height="8" rx="2"/></svg>',
    head: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="1" y="9" width="22" height="6" rx="2"/><path d="M5 5h14M5 19h14"/></svg>'
  };
  const party = g => 1 + (+g.plus_ones || 0);
  const guests = () => (typeof R === 'undefined' ? [] : R.filter(r => r.status === 'attending' && (S.cards || r.source !== 'batch')));
  const tlabel = t => t.name || 'Table ' + t.no;
  const sideLabel = s => s === 'groom' ? S.settings.groom_label + "'s side" : s === 'bride' ? S.settings.bride_label + "'s side" : '';
  const used = id => guests().filter(g => g.table_id && same(g.table_id, id)).reduce((s, g) => s + party(g), 0);
  const byName = (a, b) => String(a.name).localeCompare(String(b.name));
  const evId = () => (typeof EV !== 'undefined' && EV ? String(EV.id) : null);

  async function rpc(name, args) {
    const { data, error } = await sb.rpc(name, args);
    if (error) { note(error.message); throw error; }
    return data;
  }

  async function fetchSeating() {
    const id = evId();
    if (!id) { $('#sbErr').textContent = 'Pick an event at the top first.'; return; }
    const { data, error } = await sb.rpc('seating_load', { p_event: id });
    S.eventId = id;
    if (error) {
      S.ready = false;
      S.err = /function|does not exist|schema cache/i.test(error.message) ? 'Run seating.sql in Supabase first.' : error.message;
    } else {
      S.err = ''; S.ready = true;
      S.settings = Object.assign({ wedding: false, groom_label: 'Groom', bride_label: 'Bride' }, data.settings || {});
      S.tables = data.tables || [];
    }
    renderSeating();
  }

  function openTab() {
    if (!evId()) { $('#sbErr').textContent = 'Pick an event at the top first.'; $('#sbBody').hidden = true; return; }
    fetchSeating();
  }

  /* ---------- changing seats (instant on screen, saved in the background) ---------- */
  async function assign(rows) {
    if (!rows.length) return;
    const prev = rows.map(r => { const g = R.find(x => same(x.id, r.id)); return g && { g, table_id: g.table_id, side: g.side }; });
    rows.forEach(r => {
      const g = R.find(x => same(x.id, r.id));
      if (!g) return;
      if ('table_id' in r) g.table_id = r.table_id;
      if ('side' in r) g.side = r.side;
    });
    renderSeating();
    try { await rpc('seat_assign', { p_event: evId(), p_rows: rows }); }
    catch (e) { prev.forEach(p => { if (p) { p.g.table_id = p.table_id; p.g.side = p.side; } }); renderSeating(); }
  }
  function fits(tableId, g) {
    const t = S.tables.find(x => same(x.id, tableId));
    if (!t) return false;
    const mine = g.table_id && same(g.table_id, tableId) ? party(g) : 0;
    return t.seats - used(tableId) + mine >= party(g);
  }
  function seatGuest(gid, tableId) {
    const g = guests().find(x => same(x.id, gid));
    if (!g) return;
    if (tableId && !fits(tableId, g)) return note('That table does not have enough free seats.');
    assign([{ id: g.id, table_id: tableId || null }]);
  }

  /* ---------- drawing ---------- */
  function renderSummary() {
    const gs = guests();
    const total = gs.reduce((s, g) => s + party(g), 0);
    const seated = gs.filter(g => g.table_id).reduce((s, g) => s + party(g), 0);
    const seats = S.tables.reduce((s, t) => s + t.seats, 0);
    const pill = (t, v, warn) => `<span class="sb-pill${warn ? ' warn' : ''}">${t}: ${E(v)}</span>`;
    $('#sbSum').innerHTML = pill('Tables', S.tables.length) + pill('Seats', seats) +
      pill('Seated', seated + ' / ' + total) + pill('Unseated', total - seated, total - seated > 0);
  }

  function renderSettings() {
    $('#sbWed').checked = !!S.settings.wedding;
    $('#sbLabs').hidden = !S.settings.wedding;
    if (document.activeElement !== $('#sbGL')) $('#sbGL').value = S.settings.groom_label;
    if (document.activeElement !== $('#sbBL')) $('#sbBL').value = S.settings.bride_label;
  }

  function renderBatchTools() {
    $('#sbCards').checked = !!S.cards;
    const all = typeof R === 'undefined' ? [] : R;
    const labels = [...new Set(all.filter(r => r.source === 'batch').map(r => r.batch_label))];
    const sel = $('#sbBatch'), cur = sel.value;
    sel.innerHTML = labels.map(l => `<option value="${E(l)}">${E(l)}</option>`).join('');
    if (labels.includes(cur)) sel.value = cur;
    $('#sbBatchW').hidden = !(S.cards && S.settings.wedding && labels.length);
  }

  function renderFilters() {
    const f = [['unseated', 'Unseated'], ['all', 'All'], ['seated', 'Seated']];
    if (S.settings.wedding) f.push(['groom', S.settings.groom_label], ['bride', S.settings.bride_label], ['noside', 'No side']);
    if (S.cards) f.push(['forms', 'Form guests'], ['cards', 'Cards']);
    if (!f.some(x => x[0] === S.filter)) S.filter = 'unseated';
    $('#sbFil').innerHTML = f.map(([k, l]) => `<button type="button" class="sb-f${S.filter === k ? ' on' : ''}" data-f="${k}">${E(l)}</button>`).join('');
  }

  function guestRow(g) {
    const t = S.tables.find(x => g.table_id && same(x.id, g.table_id));
    const sides = S.settings.wedding
      ? `<span class="sb-sg"><button type="button" data-side="groom" class="${g.side === 'groom' ? 'on groom' : ''}" title="${E(sideLabel('groom'))}">G</button><button type="button" data-side="bride" class="${g.side === 'bride' ? 'on bride' : ''}" title="${E(sideLabel('bride'))}">B</button></span>`
      : '';
    const opts = S.tables.map(x => {
      const mine = g.table_id && same(g.table_id, x.id);
      const free = x.seats - used(x.id) + (mine ? party(g) : 0);
      return `<option value="${E(x.id)}" ${mine ? 'selected' : ''} ${(!mine && free < party(g)) ? 'disabled' : ''}>${E(tlabel(x))} (${free} free)</option>`;
    }).join('');
    return `<div class="sb-g" draggable="true" data-gid="${E(g.id)}">
      <div class="sb-gn"><b>${E(g.name)}</b><small>${party(g)} seat${party(g) > 1 ? 's' : ''}${g.source === 'batch' ? ' \u00b7 Card' : ''}${t ? ' \u00b7 ' + E(tlabel(t)) : ''}</small>${g.source === 'batch' ? '<button type="button" class="sb-rn" data-rename>Rename</button>' : ''}</div>${sides}
      <select class="in sb-as" aria-label="Seat ${E(g.name)} at"><option value="">${t ? 'Unseat' : 'Seat at\u2026'}</option>${opts}</select></div>`;
  }

  function renderGuests() {
    let list = guests();
    const f = S.filter;
    if (f === 'unseated') list = list.filter(g => !g.table_id);
    else if (f === 'seated') list = list.filter(g => g.table_id);
    else if (f === 'groom' || f === 'bride') list = list.filter(g => g.side === f);
    else if (f === 'noside') list = list.filter(g => !g.side);
    else if (f === 'forms') list = list.filter(g => g.source !== 'batch');
    else if (f === 'cards') list = list.filter(g => g.source === 'batch');
    const q = S.q.trim().toLowerCase();
    if (q) list = list.filter(g => String(g.name || '').toLowerCase().includes(q));
    list.sort(byName);
    $('#sbList').innerHTML = list.length ? list.map(guestRow).join('')
      : `<div class="muted" style="padding:14px;text-align:center">${guests().length ? 'Nobody here.' : 'No attending guests yet.'}</div>`;
  }

  function tableCard(t, gs) {
    const u = used(t.id), pct = Math.min(100, Math.round(u / t.seats * 100));
    const cls = u > t.seats ? 'bad' : u === t.seats ? 'full' : '';
    const chips = gs.filter(g => g.table_id && same(g.table_id, t.id)).sort(byName).map(g => {
      const mism = S.settings.wedding && t.side && g.side && g.side !== t.side;
      return `<span class="sb-c ${g.side || ''} ${mism ? 'warn' : ''}" draggable="true" data-gid="${E(g.id)}" title="${mism ? 'Different side from this table' : ''}">${E(g.name)}${party(g) > 1 ? ` <em>\u00d7${party(g)}</em>` : ''}<button type="button" data-unseat aria-label="Unseat ${E(g.name)}">\u00d7</button></span>`;
    }).join('');
    const badge = S.settings.wedding && t.side ? `<span class="sb-sd ${t.side}">${E(sideLabel(t.side))}</span>` : '';
    return `<div class="sb-t ${cls}" data-tid="${E(t.id)}">
      <div class="sb-th"><span class="sb-ic">${ICON[t.shape] || ICON.round}</span><div><b>${E(tlabel(t))}</b>${badge}</div><button class="btn btn-line btn-sm" type="button" data-tedit>Edit</button></div>
      <div class="sb-bar"><i style="width:${pct}%"></i></div>
      <div class="sb-cnt">${u} / ${t.seats} seats${u > t.seats ? ' \u00b7 over capacity' : ''}</div>
      <div class="sb-ts">${chips || '<span class="muted">Drop guests here</span>'}</div></div>`;
  }

  function renderTables() {
    const gs = guests();
    $('#sbTables').innerHTML = S.tables.length ? S.tables.map(t => tableCard(t, gs)).join('')
      : '<div class="sb-empty">No tables yet.<br>Click <b>+ Add table</b> and choose how many tables and how many seats each.</div>';
  }

  function renderSeating() {
    if (sec.hidden) return;
    $('#sbErr').textContent = S.err;
    $('#sbBody').hidden = !!S.err || !S.ready;
    if (S.err || !S.ready) return;
    renderSummary(); renderSettings(); renderBatchTools(); renderFilters(); renderGuests(); renderTables();
  }

  /* ---------- settings (wedding mode) ---------- */
  async function saveWedding() {
    try {
      await rpc('seating_set_wedding', { p_event: evId(), p_wedding: $('#sbWed').checked, p_groom: $('#sbGL').value, p_bride: $('#sbBL').value });
      await fetchSeating();
    } catch (e) { $('#sbWed').checked = !!S.settings.wedding; }
  }
  $('#sbWed').addEventListener('change', saveWedding);
  $('#sbSaveL').addEventListener('click', async () => { await saveWedding(); note('Names saved'); });

  /* ---------- guest list: search, filters, side buttons, seat menu ---------- */
  $('#sbQ').addEventListener('input', e => { S.q = e.target.value; renderGuests(); });
  $('#sbFil').addEventListener('click', e => {
    const k = e.target.dataset && e.target.dataset.f;
    if (!k) return;
    S.filter = k; renderFilters(); renderGuests();
  });
  $('#sbList').addEventListener('click', e => {
    const s = e.target.dataset && e.target.dataset.side;
    if (!s) return;
    const row = e.target.closest('[data-gid]');
    const g = row && guests().find(x => same(x.id, row.dataset.gid));
    if (g) assign([{ id: g.id, side: g.side === s ? null : s }]);
  });
  $('#sbList').addEventListener('change', e => {
    if (!e.target.classList.contains('sb-as')) return;
    const row = e.target.closest('[data-gid]');
    if (row) seatGuest(row.dataset.gid, e.target.value);
  });

  /* ---------- printed cards: include them, set a side for a whole batch, give a card a name ---------- */
  $('#sbCards').addEventListener('change', e => { S.cards = e.target.checked; renderSeating(); });
  $('#sbBatchW').addEventListener('click', e => {
    const s = e.target.dataset && e.target.dataset.bside;
    const b = $('#sbBatch').value;
    if (!s || !b) return;
    const rows = R.filter(r => r.source === 'batch' && r.batch_label === b && r.status === 'attending')
      .map(r => ({ id: r.id, side: s === 'none' ? null : s }));
    assign(rows);
  });
  $('#sbList').addEventListener('click', async e => {
    if (!e.target.closest('[data-rename]')) return;
    const row = e.target.closest('[data-gid]');
    const g = row && guests().find(x => same(x.id, row.dataset.gid));
    if (!g) return;
    const v = prompt('Name for this card (shown at the gate and on the seating list):', /-\d{3}$/.test(g.name) ? '' : g.name);
    if (!v || !v.trim()) return;
    try {
      await rpc('card_set_name', { p_event: evId(), p_id: String(g.id), p_name: v.trim() });
      g.name = v.trim().slice(0, 60);
      renderSeating();
      note('Name saved');
    } catch (err) { /* message already shown */ }
  });

  /* ---------- tables: edit, unseat chips, drag and drop ---------- */
  $('#sbTables').addEventListener('click', e => {
    const card = e.target.closest('[data-tid]');
    if (!card) return;
    if (e.target.closest('[data-tedit]')) {
      const t = S.tables.find(x => same(x.id, card.dataset.tid));
      if (t) openDlg(t);
    } else if (e.target.closest('[data-unseat]')) {
      const chip = e.target.closest('[data-gid]');
      if (chip) seatGuest(chip.dataset.gid, null);
    }
  });

  let dragId = null;
  document.addEventListener('dragstart', e => {
    const el = e.target.closest && e.target.closest('#v-seating [data-gid]');
    if (!el) return;
    dragId = el.dataset.gid;
    e.dataTransfer.setData('text/plain', dragId);
    e.dataTransfer.effectAllowed = 'move';
    el.classList.add('drag');
  });
  document.addEventListener('dragend', () => { dragId = null; $$('#v-seating .drag').forEach(x => x.classList.remove('drag')); $$('#v-seating .over').forEach(x => x.classList.remove('over')); });
  sec.addEventListener('dragover', e => {
    if (!dragId) return;
    const card = e.target.closest('[data-tid]');
    if (card || e.target.closest('#sbList')) {
      e.preventDefault();
      $$('#v-seating .over').forEach(x => x.classList.remove('over'));
      if (card) card.classList.add('over');
    }
  });
  sec.addEventListener('drop', e => {
    if (!dragId) return;
    const card = e.target.closest('[data-tid]');
    if (card) { e.preventDefault(); seatGuest(dragId, card.dataset.tid); }
    else if (e.target.closest('#sbList')) { e.preventDefault(); seatGuest(dragId, null); }
    dragId = null;
    $$('#v-seating .over').forEach(x => x.classList.remove('over'));
  });

  /* ---------- add / edit table dialog ---------- */
  let editing = null;
  function openDlg(t) {
    editing = t || null;
    $('#sbDlgT').textContent = t ? 'Edit ' + tlabel(t) : 'Add tables';
    $('#sbCountW').hidden = !!t;
    $('#sbCount').value = 1;
    $('#sbN').value = t ? (t.name || '') : '';
    $('#sbSeats').value = t ? t.seats : 8;
    $('#sbShape').value = t ? t.shape : 'round';
    $('#sbSideW').hidden = !S.settings.wedding;
    $('#sbSide').innerHTML = '<option value="">Anyone</option><option value="groom">' + E(sideLabel('groom')) + '</option><option value="bride">' + E(sideLabel('bride')) + '</option>';
    $('#sbSide').value = t && t.side ? t.side : '';
    $('#sbDel').hidden = !t;
    dlg.showModal();
  }
  $('#sbAdd').addEventListener('click', () => openDlg(null));
  $('#sbDlgX').addEventListener('click', () => dlg.close());
  $('#sbForm').addEventListener('submit', async e => {
    e.preventDefault();
    const seats = Math.max(1, Math.min(60, +$('#sbSeats').value || 8));
    const sideV = S.settings.wedding ? $('#sbSide').value : '';
    const shape = $('#sbShape').value, name = $('#sbN').value.trim(), ev = evId();
    try {
      if (editing) {
        await rpc('seating_save_table', { p_event: ev, p_id: editing.id, p_name: name, p_seats: seats, p_side: sideV, p_shape: shape });
      } else {
        const n = Math.max(1, Math.min(100, +$('#sbCount').value || 1));
        if (n === 1) await rpc('seating_save_table', { p_event: ev, p_id: null, p_name: name, p_seats: seats, p_side: sideV, p_shape: shape });
        else await rpc('seating_make_tables', { p_event: ev, p_count: n, p_seats: seats, p_side: sideV, p_shape: shape });
      }
      dlg.close();
      await fetchSeating();
    } catch (err) { /* the message was already shown */ }
  });
  $('#sbDel').addEventListener('click', async () => {
    if (!editing) return;
    const n = guests().filter(g => g.table_id && same(g.table_id, editing.id)).length;
    if (!confirm(`Delete "${tlabel(editing)}"?${n ? ` Its ${n} guest${n > 1 ? 's' : ''} will become unseated.` : ''}`)) return;
    try {
      await rpc('seating_delete_table', { p_event: evId(), p_id: editing.id });
      guests().forEach(g => { if (g.table_id && same(g.table_id, editing.id)) g.table_id = null; });
      dlg.close();
      await fetchSeating();
    } catch (err) { /* message already shown */ }
  });

  /* ---------- auto-arrange, clear, export ---------- */
  $('#sbAuto').addEventListener('click', async () => {
    if (!S.tables.length) return note('Add some tables first.');
    const apart = S.settings.wedding && $('#sbApart').checked;
    const gs = guests();
    const free = {}, owner = {};
    S.tables.forEach(t => {
      free[t.id] = t.seats - used(t.id);
      const occ = gs.find(g => g.table_id && same(g.table_id, t.id) && g.side);
      owner[t.id] = apart ? (t.side || (occ ? occ.side : null)) : null;
    });
    const order = { groom: 0, bride: 1 };
    const todo = gs.filter(g => !g.table_id).sort((a, b) =>
      (order[a.side] ?? 2) - (order[b.side] ?? 2) || party(b) - party(a) || byName(a, b));
    const rows = []; let left = 0;
    for (const g of todo) {
      const n = party(g);
      const cand = S.tables.filter(t => free[t.id] >= n && (!apart || !g.side || !owner[t.id] || owner[t.id] === g.side));
      const rank = t => (g.side && owner[t.id] === g.side) ? 0 : (!owner[t.id] ? 1 : 2);
      cand.sort((a, b) => rank(a) - rank(b) || a.no - b.no);
      const t = cand[0];
      if (!t) { left++; continue; }
      free[t.id] -= n;
      if (apart && g.side && !owner[t.id]) owner[t.id] = g.side;
      rows.push({ id: g.id, table_id: t.id });
    }
    if (!rows.length) return note(left ? 'No free seats left. Add tables or seats.' : 'Everybody is already seated.');
    await assign(rows);
    note(`Seated ${rows.length}.${left ? ' ' + left + ' did not fit. Add tables or seats.' : ''}`);
  });
  $('#sbClear').addEventListener('click', async () => {
    const rows = guests().filter(g => g.table_id).map(g => ({ id: g.id, table_id: null }));
    if (!rows.length) return note('Nobody is seated.');
    if (!confirm(`Remove all ${rows.length} guests from their tables? The tables stay.`)) return;
    await assign(rows);
  });
  $('#sbCsv').addEventListener('click', () => {
    const q = v => `"${String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
    const rows = [['Name', 'Phone', 'Side', 'Table', 'Seats']].concat(guests().sort(byName).map(g => {
      const t = S.tables.find(x => g.table_id && same(x.id, g.table_id));
      return [g.name, g.phone, sideLabel(g.side), t ? tlabel(t) : '', party(g)];
    }));
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([rows.map(r => r.map(q).join(',')).join('\n')], { type: 'text/csv' }));
    a.download = 'seating.csv'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  });

  /* ---------- keep the tab in step with the rest of the dashboard ---------- */
  let hooked = false;
  function hook() {
    if (hooked) return;
    hooked = true;
    if (typeof render === 'function') {
      const origRender = window.render;
      let rt = 0;
      window.render = function () {
        origRender();
        clearTimeout(rt);
        rt = setTimeout(() => {      // wait until the Cards code has put the full guest list back
          if (sec.hidden) return;
          const id = evId();
          if (id && S.eventId !== id) fetchSeating(); else renderSeating();
        }, 0);
      };
    }
    /* gate: after a scan, show "Groom's side - Table 7" under the result */
    if (typeof verify === 'function') {
      const origVerify = window.verify;
      window.verify = function (raw) {
        lastScan = String(raw || '').trim().toUpperCase();
        $$('.gov .seat').forEach(x => { x.textContent = ''; });
        return origVerify(raw);
      };
    }
    if (typeof showRes === 'function') {
      const origShow = window.showRes;
      window.showRes = function (type, title, subtext) {
        origShow(type, title, subtext);
        if (type === 'valid' || type === 'used') showSeat(lastScan);
      };
    }
  }
  let lastScan = '';
  async function showSeat(code) {
    if (!/^[A-Z0-9]{6,20}$/.test(code)) return;
    try {
      const { data } = await sb.rpc('guest_seat', { p_code: code });
      if (!data || (!data.table && !data.side)) return;
      const txt = [data.side, data.table].filter(Boolean).join(' \u00b7 ');
      $$('.gov').forEach(o => {
        if (o.hidden) return;
        let d = o.querySelector('.seat');
        if (!d) { d = document.createElement('div'); d.className = 'seat'; const s = o.querySelector('.s'); if (s) s.after(d); else o.prepend(d); }
        d.textContent = txt;
      });
      const r = $('#gRes span');
      if (r && !r.textContent.includes(txt)) r.textContent += ' \u2014 ' + txt;
    } catch (e) { /* the gate must never break because of this */ }
  }
  // works whether this file loads before or after the main script
  if (typeof render === 'function') hook(); else document.addEventListener('DOMContentLoaded', hook);
})();