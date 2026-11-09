/* cards-module.js  (fixed version)
   "Cards" tab for the admin dashboard: make print-only QR batches and download ONE zip for the designer.
   Fixes against the old version:
   - The ZIP no longer keeps hundreds of huge canvases in memory (that crashed or froze the tab, so no download).
   - Backup CDN for the ZIP tool, and clear error messages if a tool is missing.
   - The download link is attached to the page before the click (Firefox/Safari need that).
   - Lists and downloads read ALL rows (Supabase returns only 1000 rows per request).
   - The preview sheet is size-limited and can never block the ZIP.
   - CSV values are quoted safely.
   Keep this line just before </body>, AFTER the main <script>:
       <script src="cards-module.js"></script>
*/
(function () {
  const JSZIP_URLS = [
    'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js'
  ];
  const side = document.querySelector('.side');
  const main = document.querySelector('.main');
  const out = document.getElementById('out');
  if (!side || !main || !out) return;
  const $ = (s, r = document) => r.querySelector(s);

  /* ---------- nav button + section ---------- */
  const btn = document.createElement('button');
  btn.className = 'nav';
  btn.id = 'navCards';
  btn.type = 'button';
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v7M14 20h3"/></svg>Cards';
  side.insertBefore(btn, out);

  const sec = document.createElement('section');
  sec.id = 'v-cards';
  sec.hidden = true;
  sec.innerHTML = `
    <div class="bar"><h2>Print-only Cards</h2></div>
    <p class="muted" style="margin-bottom:14px">Create QR batches for your graphic designer. These cards are not sent to guest phone numbers; use the RSVP tab for guest passes on WhatsApp.</p>
    <div class="two">
      <div class="box">
        <h3>1. Create a print-only batch</h3>
        <div style="display:grid;gap:12px">
          <label class="muted">Batch name (letters, numbers, dash)
            <input class="in" id="cLabel" placeholder="e.g. FAMILY" maxlength="20" autocomplete="off"></label>
          <label class="muted">How many cards (1 to 500)
            <input class="in" id="cCount" type="number" min="1" max="500" value="100"></label>
          <label class="muted">People each card admits (1 to 10)
            <input class="in" id="cAdmits" type="number" min="1" max="10" value="1"></label>
          <button class="btn btn-acc" id="cMake" type="button">Generate print cards</button>
        </div>
      </div>
      <div class="box">
        <h3>2. Download the designer ZIP</h3>
        <p class="muted" style="margin-bottom:14px">Choose a saved print batch below to download it again for your designer.</p>
        <label class="muted" style="display:flex;gap:8px;align-items:center;margin-bottom:14px">
          <input type="checkbox" id="cShow" checked> Write the code under each QR (backup if a QR is damaged)</label>
        <p class="muted" id="cMsg" role="status" aria-live="polite" style="margin-top:12px;font-weight:600"></p>
      </div>
    </div>`;
  const batchesBox = document.createElement('div');
  batchesBox.className = 'box';
  batchesBox.style.marginTop = '14px';
  batchesBox.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px">
      <h3 style="margin:0">Saved print batches for this event</h3>
      <button class="btn btn-line btn-sm" id="cRefresh" type="button">Refresh list</button>
    </div>
    <div id="cBatches" class="muted">Select an event to view its print batches.</div>
    <p class="muted" style="margin-top:14px">ZIP files are downloaded to this device. Keep them private: every code in a ZIP opens the gate.</p>`;
  sec.appendChild(batchesBox);
  main.appendChild(sec);

  btn.onclick = () => {
    document.querySelectorAll('.nav').forEach(x => x.classList.toggle('on', x === btn));
    main.querySelectorAll(':scope > section').forEach(s => { s.hidden = s !== sec; });
    if (typeof stopCam === 'function') stopCam();
    refreshPrintBatches();
  };
  document.querySelectorAll('.nav[data-v]').forEach(b => b.addEventListener('click', () => { sec.hidden = true; }));

  /* ---------- helpers ---------- */
  let working = false;
  const say = t => { $('#cMsg').textContent = t; };
  const busy = on => {
    working = on;
    $('#cMake').disabled = on;
    sec.querySelectorAll('[data-print-zip]').forEach(b => { b.disabled = on; });
  };
  const label = () => $('#cLabel').value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const pause = () => new Promise(r => setTimeout(r));
  const toBlob = c => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('The browser could not make a picture. Try a smaller batch or another browser.')), 'image/png'));
  const cell = v => { const s = String(v ?? ''); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };

  function loadScript(src) {
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      const t = setTimeout(() => { s.remove(); rej(new Error('timeout')); }, 15000);
      s.src = src;
      s.onload = () => { clearTimeout(t); res(); };
      s.onerror = () => { clearTimeout(t); s.remove(); rej(new Error('blocked')); };
      document.head.appendChild(s);
    });
  }
  async function loadZip() {
    if (window.JSZip) return;
    for (const u of JSZIP_URLS) { try { await loadScript(u); if (window.JSZip) return; } catch (e) { /* try next */ } }
    throw new Error('Could not load the ZIP tool. Check your internet or ad-blocker and try again.');
  }

  /* Supabase answers at most 1000 rows per request, so read in pages */
  async function fetchBatchRows(eventId, columns, batch) {
    const all = [];
    for (let from = 0; ; from += 1000) {
      let q = sb.from('rsvps').select(columns).eq('event_id', eventId).eq('source', 'batch');
      if (batch) q = q.eq('batch_label', batch);
      const { data, error } = await q.order('batch_label').order('card_no').range(from, from + 999);
      if (error) throw new Error(error.message);
      all.push(...data);
      if (data.length < 1000) break;
    }
    return all;
  }

  async function refreshPrintBatches() {
    const list = $('#cBatches');
    if (typeof EV === 'undefined' || !EV) { list.textContent = 'Select an event to view its print batches.'; return; }
    const eventId = EV.id;
    list.textContent = 'Loading print batches...';
    let rows;
    try { rows = await fetchBatchRows(eventId, 'batch_label,card_no'); }
    catch (e) { list.textContent = 'Could not load print batches: ' + e.message; return; }
    if (!EV || EV.id !== eventId) return;               // user switched event meanwhile
    const batches = new Map();
    rows.forEach(r => { if (r.batch_label) batches.set(r.batch_label, (batches.get(r.batch_label) || 0) + 1); });
    if (!batches.size) { list.textContent = 'No print batches for this event yet.'; return; }
    list.innerHTML = `<div class="tw"><table style="min-width:0"><thead><tr><th>Batch</th><th>Cards</th><th></th></tr></thead><tbody>${
      [...batches].map(([name, count]) => `<tr><td><b>${escapeHtml(name)}</b></td><td>${count}</td><td><button class="btn btn-line btn-sm" type="button" data-print-zip="${escapeHtml(name)}"${working ? ' disabled' : ''}>Download designer ZIP</button></td></tr>`).join('')
    }</tbody></table></div>`;
  }
  window.refreshPrintBatches = refreshPrintBatches;
  $('#cRefresh').onclick = refreshPrintBatches;
  $('#cBatches').addEventListener('click', e => {
    const b = e.target.closest('[data-print-zip]');
    if (b && !working) downloadZip(b.dataset.printZip);
  });

  /* Black on white with a 4-module quiet zone. Returns a canvas; the caller MUST free it. */
  function qrCanvas(text, showText, cellPx = 32, quiet = 4) {
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    const n = q.getModuleCount(), size = (n + quiet * 2) * cellPx, extra = showText ? cellPx * 3 : 0;
    const c = document.createElement('canvas'); c.width = size; c.height = size + extra;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, size, size + extra);
    x.fillStyle = '#000';
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (q.isDark(i, j)) x.fillRect((j + quiet) * cellPx, (i + quiet) * cellPx, cellPx, cellPx);
    if (showText) {
      x.font = `700 ${Math.round(cellPx * 1.8)}px "Courier New", monospace`;
      x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText(text, size / 2, size + extra / 2);
    }
    return c;
  }

  /* ---------- 1. generate ---------- */
  $('#cMake').onclick = async () => {
    if (working) return;
    if (typeof EV === 'undefined' || !EV) return say('Select an event before creating print cards.');
    const l = label(), n = Math.floor(+$('#cCount').value), a = Math.floor(+$('#cAdmits').value);
    if (!l) return say('Type a batch name first.');
    if (!(n >= 1 && n <= 500)) return say('Cards must be between 1 and 500.');
    if (!(a >= 1 && a <= 10)) return say('Admits must be between 1 and 10.');
    if (!confirm(`Create ${n} cards in batch ${l} for "${EV.title}", each admitting ${a}?`)) return;
    const eventId = EV.id;
    busy(true); say('Creating cards...');
    try {
      const { data, error } = await sb.rpc('create_card_batch', { p_event: eventId, p_count: n, p_admits: a, p_label: l });
      if (error) throw new Error(error.message);
      say(`Done. ${data.length} print-only cards created in batch ${l}. Download the designer ZIP below.`);
      $('#cLabel').value = l;
      await refreshPrintBatches();
      if (typeof load === 'function' && EV && EV.id === eventId) load(true);
    } catch (e) {
      say('Failed: ' + (e.message || e));
    } finally {
      busy(false);
    }
  };

  /* ---------- 2. download zip ---------- */
  async function downloadZip(l) {
    if (typeof EV === 'undefined' || !EV) return say('Select an event before downloading print cards.');
    if (!l) return say('Choose a print batch first.');
    if (typeof qrcode !== 'function') return say('The QR tool did not load. Reload the page and try again.');
    const eventId = EV.id, eventSlug = EV.slug;
    busy(true); say('Loading cards...');
    try {
      const rows = await fetchBatchRows(eventId, 'ticket_code,name,card_no,plus_ones', l);
      if (!rows.length) throw new Error('No cards found for batch ' + l);
      await loadZip();

      const showText = $('#cShow').checked;
      const zip = new JSZip();
      const csv = ['card_no,ticket_code,name,admits,@QR'];

      // preview sheet, drawn as we go (small, never more than about 9 million pixels)
      const cols = 20, t = 100, pad = 20, lh = 22, cw = t + pad, ch = t + pad + lh;
      const rowsN = Math.ceil(rows.length / cols);
      const sheet = document.createElement('canvas');
      sheet.width = cols * cw + pad; sheet.height = rowsN * ch + pad;
      const sx = sheet.getContext('2d');
      sx.fillStyle = '#fff'; sx.fillRect(0, 0, sheet.width, sheet.height);
      sx.fillStyle = '#000'; sx.font = '600 11px "Courier New", monospace'; sx.textAlign = 'center';

      for (let i = 0; i < rows.length; i++) {
        const r = rows[i], no = String(r.card_no).padStart(3, '0'), file = `card-${no}.png`;
        const c = qrCanvas(r.ticket_code, showText);
        zip.file(file, await toBlob(c));
        try {
          const gx = pad + (i % cols) * cw, gy = pad + Math.floor(i / cols) * ch;
          sx.drawImage(c, 0, 0, c.width, c.width, gx, gy, t, t);      // only the square QR part
          sx.fillText(no + ' ' + r.ticket_code, gx + t / 2, gy + t + 15);
        } catch (e) { /* preview is optional */ }
        c.width = c.height = 0;                                       // free the memory right away
        csv.push([no, r.ticket_code, r.name, (+r.plus_ones || 0) + 1, file].map(cell).join(','));
        if (i % 5 === 0) { say(`Drawing ${i + 1} of ${rows.length}...`); await pause(); }
      }
      try { zip.file('preview.png', await toBlob(sheet)); } catch (e) { /* preview is optional */ }
      sheet.width = sheet.height = 0;

      zip.file('designer-data.csv', csv.join('\r\n'));
      zip.file('READ-ME.txt',
`QR CARDS - batch ${l} (${rows.length} cards)

CONFIDENTIAL: every QR in this folder opens the gate. Do not share it. Delete it after printing.

FILES
- card-001.png ... : one QR code per card, already with a white border. Do not crop the border.${showText ? `
  The code is also written under the QR, as a backup in case the QR is damaged. Keep it with the QR.
  Because of that line, each picture is about 10 percent taller than it is wide. Use a frame with that shape.` : ''}
- designer-data.csv : card number, code, name, people admitted, and the picture file name (column @QR).
- preview.png : all QR codes and their codes on one page, for looking only. Do not print from it.

BULK PLACEMENT (InDesign or Affinity Data Merge)
1. Unzip everything into ONE folder. Keep the CSV and the PNG files together in that folder.
2. Do NOT open and re-save the CSV in Excel (Excel breaks the @QR heading). Use it as it is.
3. Design one card with an empty frame for the QR picture.
4. Select designer-data.csv as the data source and drag the @QR field into the frame.
5. Create the merged document and check a few cards.

PRINT RULES
- Keep each QR at least 3 cm wide (bigger is safer).
- Black on white only. Nothing printed over or behind it. Matte paper is best.
- Print ONE sample and test it with the gate scanner before printing the full batch.
`);

      say('Building ZIP...');
      // PNG files are already compressed, so STORE is much faster and uses less memory
      const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE', streamFiles: true });
      const name = `qr-cards-${eventSlug}-${l}.zip`;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.rel = 'noopener';
      a.style.display = 'none';
      document.body.appendChild(a);                                   // needed by Firefox and some Safari versions
      a.click();
      setTimeout(() => { a.remove(); URL.revokeObjectURL(a.href); }, 60000);
      say(`Downloaded ${name} with ${rows.length} print-only cards. Check your Downloads folder.`);
    } catch (e) {
      say('Failed: ' + (e.message || e));
    } finally {
      busy(false);
    }
  }
})();