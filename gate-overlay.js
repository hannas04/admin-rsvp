/* gate-overlay.js
   Full-screen result for CAMERA scanning on the Gate tab (works great on a phone):
   - the moment a QR is seen, the screen shows "Checking..." (instant feedback)
   - as soon as Supabase answers, it turns GREEN / ORANGE / RED with a big name
   - the camera is paused until the guest is dealt with
   - a big "Continue scanning" button resumes the camera
   - faster detection: uses the phone's built-in QR detector when it exists, jsQR otherwise
   Typing a code or using a USB scanner machine is NOT affected (they keep the normal result card).

   Add this line just before </body> in the dashboard, AFTER the main <script>
   (and after cards-module.js if you use it):
       <script src="gate-overlay.js"></script>
*/
(function () {
  if (typeof showRes !== 'function' || typeof verify !== 'function' || typeof jsQR !== 'function') {
    console.warn('gate-overlay: main dashboard script not found, overlay not started.');
    return;
  }

  /* ---------- styles + overlay ---------- */
  const st = document.createElement('style');
  st.textContent = `
  .gov{position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;
    width:100%;height:100vh;height:100dvh;overflow-y:auto;overscroll-behavior:contain;
    padding:calc(24px + env(safe-area-inset-top,0px)) calc(20px + env(safe-area-inset-right,0px)) calc(24px + env(safe-area-inset-bottom,0px)) calc(20px + env(safe-area-inset-left,0px));
    text-align:center;color:#fff;background:#2a1620}
  .gov[hidden]{display:none}
  .gov.valid{background:#1f9d6b}.gov.used{background:#d98a1c}.gov.invalid,.gov.declined{background:#d12e5f}.gov.checking{background:#2a1620}
  .gov .ic{font-size:clamp(5rem,28vw,9rem);line-height:1}
  .gov .t{font:700 clamp(2rem,10vw,3.4rem)/1.1 "Playfair Display",Georgia,serif;word-break:break-word}
  .gov .s{font-size:clamp(1.1rem,5vw,1.5rem);opacity:.95}
  .gov .go{margin-top:18px;width:100%;max-width:420px;min-height:64px;border-radius:999px;background:#fff;color:#2a1620;
    font:700 1rem Montserrat,system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase;border:0;cursor:pointer}
  .gov .undo{margin-top:6px;padding:10px 16px;color:#fff;text-decoration:underline;font:600 .8rem Montserrat,system-ui,sans-serif;
    letter-spacing:.1em;text-transform:uppercase;background:none;border:0;cursor:pointer}
  .gov .undo[hidden],.gov .go[hidden]{display:none}`;
  document.head.appendChild(st);

  const ov = document.createElement('div');
  ov.className = 'gov checking';
  ov.hidden = true;
  ov.setAttribute('role', 'alertdialog');
  ov.setAttribute('aria-live', 'assertive');
  ov.innerHTML = '<div class="ic"></div><div class="t"></div><div class="s"></div>' +
    '<button type="button" class="go">Continue scanning</button>' +
    '<button type="button" class="undo" hidden>Undo this check-in</button>';
  document.body.appendChild(ov);
  const ic = ov.querySelector('.ic'), tt = ov.querySelector('.t'), ss = ov.querySelector('.s');
  const go = ov.querySelector('.go'), undo = ov.querySelector('.undo');

  let ovOpen = false, state = 'checking', timer = 0, bodyOverflow = '';
  const ICONS = { checking: '\u2026', valid: '\u2713', used: '!', invalid: '\u2715', declined: '\u2715' };

  function paint(type, title, sub) {
    state = type;
    ov.className = 'gov ' + type;
    ic.textContent = ICONS[type] || '!';
    tt.textContent = title;          // textContent on purpose: guest names are typed by guests
    ss.textContent = sub || '';
    go.hidden = type === 'checking';
    undo.hidden = type !== 'valid';
    if (!ovOpen) {
      ovOpen = true;
      ov.hidden = false;
      bodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    if (type !== 'checking') { clearTimeout(timer); go.focus({ preventScroll: true }); }
  }

  function closeOv() {
    clearTimeout(timer);
    ovOpen = false; ov.hidden = true; document.body.style.overflow = bodyOverflow;
    lastAt = Date.now();             // same pass is ignored for 2.5 s so it does not instantly re-scan
  }

  go.addEventListener('click', closeOv);
  undo.addEventListener('click', () => {
    const u = document.getElementById('gUndo');
    if (u) u.click();                // uses the existing undo code
    closeOv();
  });

  /* ---------- show the overlay when a result arrives ---------- */
  const origShowRes = window.showRes;
  window.showRes = function (type, title, sub) {
    origShowRes(type, title, sub);   // keeps the normal result card, beep and vibration
    if (scanning || ovOpen) paint(type, title, sub);
  };

  /* ---------- faster scanning ---------- */
  let detector = null, detecting = false, lastFrameAt = 0;
  try {
    if ('BarcodeDetector' in window) {
      BarcodeDetector.getSupportedFormats().then(f => {
        if (f.includes('qr_code')) detector = new BarcodeDetector({ formats: ['qr_code'] });
      }).catch(() => {});
    }
  } catch (e) {}

  function onHit(raw) {
    const c = String(raw || '').trim().toUpperCase(), now = Date.now();
    if (!c) return;
    if (c === lastCode && now - lastAt < 2500) return;
    lastCode = c; lastAt = now;
    paint('checking', 'Checking\u2026', 'Please wait');
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (state === 'checking') paint('invalid', 'No answer', 'Check the internet, then continue scanning.');
    }, 8000);
    verify(c);                       // the existing check; it calls showRes when Supabase answers
  }

  window.scanLoop = function () {
    if (!scanning) return;
    const now = performance.now();
    if (!ovOpen && !busy && now - lastFrameAt >= 100 && gv.readyState >= 2 && gv.videoWidth) {
      lastFrameAt = now;
      if (detector) {
        if (!detecting) {
          detecting = true;
          detector.detect(gv).then(r => {
            detecting = false;
            if (r && r[0] && !ovOpen) onHit(r[0].rawValue);
          }).catch(() => { detecting = false; detector = null; });   // fall back to jsQR
        }
      } else {
        const w = Math.min(480, gv.videoWidth), h = Math.round(w * gv.videoHeight / gv.videoWidth);
        gcv.width = w; gcv.height = h; gcx.drawImage(gv, 0, 0, w, h);
        const img = gcx.getImageData(0, 0, w, h);
        const hit = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' });
        if (hit && hit.data) onHit(hit.data);
      }
    }
    requestAnimationFrame(window.scanLoop);
  };
})();