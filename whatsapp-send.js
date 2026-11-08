/* whatsapp-send.js
   Adds to the RSVPs tab of the admin dashboard:
   - a panel: Not sent / Sent / Failed counters
   - "Send to all unsent": sends passes on WhatsApp through Termii, in small batches, with progress
   - "Retry failed", a Stop button, and a "daily cap" box (Termii says 250 new people per 24h until Meta verification)
   - a Send / Resend button and a status line on every guest row
   The actual sending is done by the Supabase Edge Function "send-pass" (the Termii key never touches this page).

   Add this line just before </body>, AFTER the main <script>:
       <script src="whatsapp-send.js"></script>
*/
(function () {
  const PRICE = 78;          // naira per message, only used for the cost estimate in the confirm box
  const DEFAULT_CAP = 250;   // Termii guide: unverified business = 250 unique people per 24 hours
  const BATCH = 20;          // guests per call to the function

  const sec = document.getElementById('v-rsvps');
  const tR = document.getElementById('tR');
  if (!sec || !tR) return;
  const $ = (s, r = document) => r.querySelector(s);

  /* ---------- panel ---------- */
  const panel = document.createElement('div');
  panel.className = 'box';
  panel.id = 'wsPanel';
  panel.style.marginBottom = '14px';
  panel.innerHTML = `
    <h3>Send passes on WhatsApp (Termii)</h3>
    <div class="cards" id="wsStats" style="margin-bottom:14px"></div>
    <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end">
      <label class="muted">Send at most (per run)
        <input class="in" id="wsCap" type="number" min="1" max="2000" value="${DEFAULT_CAP}" style="width:130px;margin-top:4px"></label>
      <button class="btn btn-acc" id="wsAll" type="button">Send to all unsent</button>
      <button class="btn btn-line" id="wsRetry" type="button">Retry failed</button>
      <button class="btn btn-line" id="wsStop" type="button" hidden>Stop</button>
    </div>
    <div class="muted" id="wsMsg" style="margin-top:12px;font-weight:600"></div>
    <p class="muted" style="margin-top:8px">"Sent" means Termii accepted the message. Delivery receipts are not tracked here.</p>`;
  const bar = sec.querySelector('.bar');
  if (bar) bar.insertAdjacentElement('afterend', panel); else sec.prepend(panel);

  const msg = t => { $('#wsMsg').textContent = t; };
  const note = t => { if (typeof toast === 'function') toast(t); };
  const hasPhone = g => String(g.phone || '').trim() !== '';

  /* ---------- counters ---------- */
  function stats() {
    if (typeof R === 'undefined') return;
    const att = R.filter(r => r.status === 'attending');
    if (att.length && att[0].wa_status === undefined) {
      msg('Run whatsapp-send.sql in Supabase first (the WhatsApp columns are missing).');
    }
    const cnt = s => att.filter(r => hasPhone(r) && r.wa_status === s).length;
    const nophone = att.filter(r => !hasPhone(r)).length;
    $('#wsStats').innerHTML = [
      ['Not sent', cnt('none'), 'waiting', 1],
      ['Sent', cnt('sent'), 'accepted by Termii'],
      ['Failed', cnt('failed'), 'can be retried'],
      ['No phone', nophone, 'print cards']
    ].map(([t, v, s, h]) => `<div class="c${h ? ' hl' : ''}"><small>${t}</small><b>${v}</b><span>${s}</span></div>`).join('');
  }

  /* ---------- status line + Send button on each guest row ---------- */
  function label(g) {
    if (!hasPhone(g)) return 'No phone number (print card)';
    if (g.wa_status === 'sent') {
      return '\u2713 WhatsApp sent ' + new Date(g.wa_sent_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    }
    if (g.wa_status === 'failed') return '\u2715 Failed: ' + String(g.wa_error || '').slice(0, 80);
    if (g.wa_status === 'sending') return 'Sending\u2026';
    return 'Not sent on WhatsApp';
  }
  function decorate() {
    if (typeof R === 'undefined') return;
    tR.querySelectorAll('tr').forEach(tr => {
      if (tr.querySelector('.wst')) return;
      const pass = tr.querySelector('[data-wa]');
      if (!pass) return;
      const g = R.find(r => r.id === pass.dataset.wa);
      if (!g) return;
      const line = document.createElement('div');
      line.className = 'muted wst';
      line.textContent = label(g);                        // textContent: names and errors are never treated as HTML
      tr.querySelector('td').appendChild(line);
      if (hasPhone(g)) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'btn btn-line btn-sm';
        b.dataset.wsend = g.id;
        b.textContent = g.wa_status === 'sent' ? 'Resend' : 'Send';
        pass.after(' ', b);
      }
    });
  }
  new MutationObserver(() => { stats(); decorate(); }).observe(tR, { childList: true });
  stats();

  /* ---------- calling the Edge Function ---------- */
  async function call(body) {
    const { data, error } = await sb.functions.invoke('send-pass', { body });
    if (error) {
      let m = error.message;
      try { const j = await error.context.json(); if (j && j.error) m = j.error; } catch (e) { /* keep default */ }
      throw new Error(m);
    }
    return data;
  }

  let running = false, stopFlag = false;
  function ui(on) {
    $('#wsAll').disabled = on; $('#wsRetry').disabled = on;
    $('#wsStop').hidden = !on;
  }

  async function runSend({ mode = 'unsent', ids = null, force = false, cap = Infinity }) {
    if (running) return;
    if (typeof EV === 'undefined' || !EV) return msg('Pick an event first.');
    running = true; stopFlag = false; ui(true);
    let sent = 0, failed = 0, why = '', before, dry = false;
    try {
      for (;;) {
        const room = cap === Infinity ? BATCH : Math.min(BATCH, cap - (sent + failed));
        if (room <= 0) { why = 'Run limit reached. Click again later (or tomorrow) to continue.'; break; }
        msg(`Sending\u2026 ${sent} sent, ${failed} failed`);
        const r = await call({ event_id: EV.id, mode, guest_ids: ids, force, batch: ids ? 1 : room, before });
        before = r.before; if (r.dry) dry = true;
        sent += r.sent; failed += r.failed;
        if (r.stop) { why = 'Stopped: ' + (r.stop_reason || 'Termii refused the message.'); break; }
        if (ids || r.remaining === 0 || (r.sent + r.failed) === 0) break;
        if (stopFlag) { why = 'Stopped by you.'; break; }
        await load();                                    // refresh the counters between batches
      }
    } catch (e) {
      why = 'Problem: ' + (e.message || e);
    } finally {
      running = false; ui(false);
      await load();
    }
    msg(`${dry ? 'TEST MODE - nothing was really sent. ' : ''}Done. ${sent} sent, ${failed} failed. ${why}`.trim());
    note(`${sent} sent, ${failed} failed`);
  }

  /* ---------- buttons ---------- */
  function eligible(mode) {
    return R.filter(r => r.status === 'attending' && hasPhone(r) && r.wa_status === (mode === 'failed' ? 'failed' : 'none')).length;
  }
  function start(mode) {
    if (typeof R === 'undefined') return;
    const cap = Math.max(1, +$('#wsCap').value || DEFAULT_CAP);
    const n = eligible(mode);
    if (!n) return msg(mode === 'failed' ? 'No failed messages to retry.' : 'Nobody left to send to.');
    const count = Math.min(n, cap);
    const ok = confirm(
      `Send passes to ${count} guest${count > 1 ? 's' : ''} on WhatsApp?\n\n` +
      `Estimated cost: about \u20A6${(count * PRICE).toLocaleString('en-NG')} from your Termii balance.\n` +
      `Only continue if these guests agreed to receive messages from this number.`);
    if (ok) runSend({ mode, cap });
  }
  $('#wsAll').onclick = () => start('unsent');
  $('#wsRetry').onclick = () => start('failed');
  $('#wsStop').onclick = () => { stopFlag = true; msg('Stopping after this batch\u2026'); };

  tR.addEventListener('click', e => {
    const id = e.target.dataset && e.target.dataset.wsend;
    if (!id) return;
    const g = R.find(r => r.id === id);
    if (!g) return;
    if (g.wa_status === 'sent' && !confirm('This guest was already sent a pass. Send again? (It costs another message.)')) return;
    runSend({ ids: [id], force: true });
  });
})();