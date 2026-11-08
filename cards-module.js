/* cards-module.js
   Adds a "Cards" tab to the admin dashboard:
   - make a batch of blank pass cards (calls create_card_batch in Supabase)
   - download ONE zip for the graphic designer:
       card-001.png ... card-100.png   (the QR codes, big, black on white, with white border)
       designer-data.csv               (for InDesign / Affinity Data Merge)
       preview.png                     (all QR codes on one sheet, for looking only)
       READ-ME.txt                     (short instructions for the designer)
   Add this line just before </body> in the dashboard, AFTER the main <script>:
       <script src="cards-module.js"></script>
*/
(function () {
  const JSZIP = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
  const side = document.querySelector('.side');
  const main = document.querySelector('.main');
  const out = document.getElementById('out');
  if (!side || !main || !out) return;
  const $ = (s, r = document) => r.querySelector(s);

  /* ---------- nav button + section ---------- */
  const btn = document.createElement('button');
  btn.className = 'nav';
  btn.id = 'navCards';
  btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v7M14 20h3"/></svg>Cards';
  side.insertBefore(btn, out);

  const sec = document.createElement('section');
  sec.id = 'v-cards';
  sec.hidden = true;
  sec.innerHTML = `
    <div class="bar"><h2>Print Cards</h2></div>
    <div class="two">
      <div class="box">
        <h3>1. Make a batch</h3>
        <div style="display:grid;gap:12px">
          <label class="muted">Batch name (letters, numbers, dash)
            <input class="in" id="cLabel" placeholder="e.g. FAMILY" maxlength="20" autocomplete="off"></label>
          <label class="muted">How many cards (1 to 500)
            <input class="in" id="cCount" type="number" min="1" max="500" value="100"></label>
          <label class="muted">People each card admits (1 to 10)
            <input class="in" id="cAdmits" type="number" min="1" max="10" value="1"></label>
          <button class="btn btn-acc" id="cMake" type="button">Generate cards</button>
        </div>
      </div>
      <div class="box">
        <h3>2. Download for the designer</h3>
        <p class="muted" style="margin-bottom:14px">Uses the batch name on the left. You can download an older batch again any time by typing its name.</p>
        <button class="btn btn-line" id="cZip" type="button">Download ZIP</button>
        <p class="muted" style="margin-top:14px">Keep the ZIP private. Every code in it opens the gate.</p>
        <div class="muted" id="cMsg" style="margin-top:12px;font-weight:600"></div>
      </div>
    </div>`;
  main.appendChild(sec);

  btn.onclick = () => {
    document.querySelectorAll('.nav').forEach(x => x.classList.toggle('on', x === btn));
    main.querySelectorAll(':scope > section').forEach(s => { s.hidden = s !== sec; });
    if (typeof stopCam === 'function') stopCam();
  };
  document.querySelectorAll('.nav[data-v]').forEach(b => b.addEventListener('click', () => { sec.hidden = true; }));

  /* ---------- helpers ---------- */
  const say = t => { $('#cMsg').textContent = t; };
  const busy = on => { $('#cMake').disabled = on; $('#cZip').disabled = on; };
  const label = () => $('#cLabel').value.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const pause = () => new Promise(r => setTimeout(r));
  const toBlob = c => new Promise(r => c.toBlob(r, 'image/png'));
  const loadZip = () => window.JSZip ? Promise.resolve() : new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = JSZIP; s.onload = res;
    s.onerror = () => rej(new Error('Could not load the ZIP tool. Check your internet.'));
    document.head.appendChild(s);
  });

  /* big, pure black on white, 4-module white border (quiet zone) so it scans well when printed */
  function qrCanvas(text, cell = 40, quiet = 4) {
    const q = qrcode(0, 'M'); q.addData(text); q.make();
    const n = q.getModuleCount(), size = (n + quiet * 2) * cell;
    const c = document.createElement('canvas'); c.width = c.height = size;
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, size, size);
    x.fillStyle = '#000';
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (q.isDark(i, j)) x.fillRect((j + quiet) * cell, (i + quiet) * cell, cell, cell);
    return c;
  }

  /* ---------- 1. generate ---------- */
  $('#cMake').onclick = async () => {
    const l = label(), n = +$('#cCount').value, a = +$('#cAdmits').value;
    if (!l) return say('Type a batch name first.');
    if (!(n >= 1 && n <= 500)) return say('Cards must be between 1 and 500.');
    if (!(a >= 1 && a <= 10)) return say('Admits must be between 1 and 10.');
    if (!confirm(`Create ${n} cards in batch ${l}, each admitting ${a}?`)) return;
    busy(true); say('Creating cards...');
    const { data, error } = await sb.rpc('create_card_batch', { p_count: n, p_admits: a, p_label: l });
    busy(false);
    if (error) return say('Failed: ' + error.message);
    say(`Done. ${data.length} cards created in batch ${l}. Now click Download ZIP.`);
    if (typeof load === 'function') load(true);
  };

  /* ---------- 2. download zip ---------- */
  $('#cZip').onclick = async () => {
    const l = label();
    if (!l) return say('Type the batch name first.');
    busy(true); say('Loading cards...');
    try {
      const { data: rows, error } = await sb.from('rsvps')
        .select('ticket_code,name,card_no,plus_ones')
        .eq('source', 'batch').eq('batch_label', l).order('card_no');
      if (error) throw new Error(error.message);
      if (!rows || !rows.length) throw new Error('No cards found for batch ' + l);
      await loadZip();

      const zip = new JSZip();
      const csv = ['card_no,ticket_code,name,admits,@QR'];
      const thumbs = [];
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i], no = String(r.card_no).padStart(3, '0'), file = `card-${no}.png`;
        const c = qrCanvas(r.ticket_code);
        zip.file(file, await toBlob(c));
        csv.push([no, r.ticket_code, r.name, r.plus_ones + 1, file].join(','));
        thumbs.push({ c, no });
        if (i % 5 === 0) { say(`Drawing ${i + 1} of ${rows.length}...`); await pause(); }
      }

      // preview sheet: 10 per row, for looking only (never print from it)
      const cols = 10, t = 140, pad = 20, lh = 26;
      const cw = t + pad, ch = t + pad + lh, rowsN = Math.ceil(thumbs.length / cols);
      const sheet = document.createElement('canvas');
      sheet.width = cols * cw + pad; sheet.height = rowsN * ch + pad;
      const sx = sheet.getContext('2d');
      sx.fillStyle = '#fff'; sx.fillRect(0, 0, sheet.width, sheet.height);
      sx.fillStyle = '#000'; sx.font = '600 18px Arial, sans-serif'; sx.textAlign = 'center';
      thumbs.forEach((th, k) => {
        const gx = pad + (k % cols) * cw, gy = pad + Math.floor(k / cols) * ch;
        sx.drawImage(th.c, gx, gy, t, t);
        sx.fillText(th.no, gx + t / 2, gy + t + 20);
      });
      zip.file('preview.png', await toBlob(sheet));

      zip.file('designer-data.csv', csv.join('\r\n'));
      zip.file('READ-ME.txt',
`QR CARDS - batch ${l} (${rows.length} cards)

CONFIDENTIAL: every QR in this folder opens the gate. Do not share it. Delete it after printing.

FILES
- card-001.png ... : one QR code per card, already with a white border. Do not crop the border.
- designer-data.csv : card number, code, name, people admitted, and the picture file name (column @QR).
- preview.png : all QR codes on one page, for looking only. Do not print from it.

BULK PLACEMENT (InDesign or Affinity Data Merge)
1. Unzip everything into ONE folder. Keep the CSV and the PNG files together in that folder.
2. Do NOT open and re-save the CSV in Excel (Excel breaks the @QR heading). Use it as it is.
3. Design one card with an empty square frame for the QR.
4. Select designer-data.csv as the data source and drag the @QR field into the square frame.
5. Create the merged document and check a few cards.

PRINT RULES
- Keep each QR at least 3 cm wide (bigger is safer).
- Black on white only. Nothing printed over or behind it. Matte paper is best.
- Print ONE sample and test it with the gate scanner before printing the full batch.
`);

      say('Building ZIP...');
      const blob = await zip.generateAsync({ type: 'blob' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `qr-cards-${l}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      say(`Downloaded qr-cards-${l}.zip with ${rows.length} cards.`);
    } catch (e) {
      say('Failed: ' + (e.message || e));
    } finally {
      busy(false);
    }
  };
})();