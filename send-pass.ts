// send-pass.ts  ->  Supabase Edge Function named:  send-pass
// Sends each guest's pass link on WhatsApp through Termii, one small batch per call.
// The dashboard (whatsapp-send.js) keeps calling it until everyone is done.
//
// SECRETS to set in Supabase (Edge Functions -> Secrets). Never put these in a web page:
//   TERMII_API_KEY      your Termii API key
//   TERMII_BASE_URL     the base URL from your Termii dashboard, e.g. https://api.ng.termii.com
//   TERMII_DEVICE_ID    the Device ID of your Active WhatsApp device
//   TERMII_TEMPLATE_ID  the ID of your APPROVED template
// OPTIONAL secrets:
//   TERMII_VARS         order of the template blanks. Default: name,event,date,link
//                       (blank {{1}} = first name, {{2}} = event title, {{3}} = date, {{4}} = pass link)
//                       other words you can use: fullname, time, place, planner, code, guests
//   TICKET_PAGE_URL     default: https://hannas04.github.io/ticket-RSVP/

import { createClient } from 'npm:@supabase/supabase-js@2';

const DELAY_MS = 350;   // pause between messages (keeps the sending calm)
const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const env = (n: string): string => Deno.env.get(n) ?? '';
function keyFrom(single: string, multi: string): string {
  const k = env(single);
  if (k) return k;
  try { return String((JSON.parse(env(multi) || '{}') as Record<string, unknown>).default ?? ''); } catch { return ''; }
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Nigerian numbers: 0803... -> 234803..., +234... -> 234..., 803... -> 234803...
function waNumber(p: string): string {
  let n = String(p || '').replace(/\D/g, '');
  if (n.startsWith('00')) n = n.slice(2);
  else if (n.startsWith('0')) n = '234' + n.slice(1);
  else if (/^[789]\d{9}$/.test(n)) n = '234' + n;
  return /^\d{10,15}$/.test(n) ? n : '';
}

interface Cfg { key: string; base: string; device: string; template: string }
async function termiiSend(cfg: Cfg, phone: string, data: Record<string, string>) {
  const base = (cfg.base.startsWith('http') ? cfg.base : 'https://' + cfg.base).replace(/\/+$/, '');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(base + '/api/send/template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctl.signal,
      body: JSON.stringify({ phone_number: phone, device_id: cfg.device, template_id: cfg.template, api_key: cfg.key, data }),
    });
    let body: Record<string, unknown> = {};
    try { body = await res.json(); } catch { /* reply was not JSON */ }
    const ok = res.ok && (body.code === 'ok' || /success/i.test(String(body.message ?? '')));
    return {
      ok,
      id: String(body.message_id_str ?? body.message_id ?? ''),
      error: ok ? '' : String(body.message ?? body.error ?? ('HTTP ' + res.status)).slice(0, 300),
    };
  } catch (e) {
    const err = e as Error;
    return { ok: false, id: '', error: err.name === 'AbortError' ? 'Timed out' : String(err.message || err).slice(0, 300) };
  } finally {
    clearTimeout(t);
  }
}

// errors that will hit EVERY message (balance, limits, template, device): stop the run instead of failing 200 times
const STOP_RE = /insufficient|balance|wallet|limit|quota|too many|unauthori[sz]ed|api key|device|template|not approved/i;

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Use POST' }, 405);

  let input: Record<string, unknown>;
  try { input = await req.json(); } catch { return json({ error: 'Bad request body' }, 400); }

  const eventId = String(input.event_id ?? '');
  const mode = input.mode === 'failed' ? 'failed' : 'unsent';
  const force = input.force === true;
  const ids = Array.isArray(input.guest_ids) ? input.guest_ids.map(String).slice(0, 25) : null;
  const batch = Math.min(25, Math.max(1, Number(input.batch) || 20));
  const before = typeof input.before === 'string' && !isNaN(Date.parse(input.before))
    ? input.before : new Date().toISOString();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(eventId)) return json({ error: 'Bad event id' }, 400);

  // 1. config
  const cfg: Cfg = { key: env('TERMII_API_KEY'), base: env('TERMII_BASE_URL'), device: env('TERMII_DEVICE_ID'), template: env('TERMII_TEMPLATE_ID') };
  const missing = Object.entries({ TERMII_API_KEY: cfg.key, TERMII_BASE_URL: cfg.base, TERMII_DEVICE_ID: cfg.device, TERMII_TEMPLATE_ID: cfg.template })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) return json({ error: 'Missing secrets in Supabase: ' + missing.join(', ') }, 500);

  // 2. who is calling? must be signed in AND allowed to see this event
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Not signed in' }, 401);
  const url = env('SUPABASE_URL');
  const uc = createClient(url, keyFrom('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEYS'), {
    global: { headers: { Authorization: 'Bearer ' + token } },
    auth: { persistSession: false },
  });
  const { data: u, error: ue } = await uc.auth.getUser(token);
  if (ue || !u?.user) return json({ error: 'Not signed in' }, 401);
  const { data: mine, error: me } = await uc.rpc('my_events');
  if (me || !Array.isArray(mine) || !mine.some((e: { id: string }) => String(e.id) === eventId)) {
    return json({ error: 'No access to this event' }, 403);
  }

  // 3. from here on we use the service key (the caller is already checked)
  const sc = createClient(url, keyFrom('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEYS'), { auth: { persistSession: false } });
  const { data: ev, error: ee } = await sc.from('events').select('id,title,event_date,place,planner').eq('id', eventId).single();
  if (ee || !ev) return json({ error: 'Event not found' }, 404);

  const stale = new Date(Date.now() - 5 * 60 * 1000).toISOString();     // a "sending" row older than 5 min is treated as stuck
  const statuses = force ? 'none,failed,sent' : mode === 'failed' ? 'failed' : 'none';
  const orFilter = `wa_status.in.(${statuses}),and(wa_status.eq.sending,wa_updated_at.lt.${stale})`;

  const pick = () => {
    let q = sc.from('rsvps').select('id,name,phone,plus_ones,ticket_code,wa_status')
      .eq('event_id', eventId).eq('status', 'attending').neq('phone', '').or(orFilter);
    if (ids) q = q.in('id', ids);
    if (mode === 'failed' && !force) q = q.lt('wa_updated_at', before);   // do not retry the same failures again in one run
    return q;
  };

  const { data: cands, error: ce } = await pick().order('created_at', { ascending: true }).limit(batch);
  if (ce) return json({ error: 'Could not read guests: ' + ce.message }, 500);
  if (!cands || !cands.length) return json({ sent: 0, failed: 0, remaining: 0, before, results: [] });

  // 4. claim them (so two clicks can never send twice)
  const prior: Record<string, string> = {};
  for (const c of cands) prior[c.id] = c.wa_status === 'sending' ? 'none' : c.wa_status;
  const { data: claimed, error: ke } = await sc.from('rsvps')
    .update({ wa_status: 'sending', wa_error: null, wa_updated_at: new Date().toISOString() })
    .in('id', cands.map((c) => c.id)).or(orFilter)
    .select('id,name,phone,plus_ones,ticket_code');
  if (ke) return json({ error: 'Could not claim guests: ' + ke.message }, 500);
  const list = claimed ?? [];

  // 5. message values
  const d = new Date(ev.event_date);
  const TZ = 'Africa/Lagos';
  const dateStr = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: TZ });
  const timeStr = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TZ });
  const tokens = (env('TERMII_VARS') || 'name,event,date,link').split(',').map((s) => s.trim()).filter(Boolean);
  const ticketPage = env('TICKET_PAGE_URL') || 'https://hannas04.github.io/ticket-RSVP/';

  const results: { id: string; name: string; ok: boolean; error?: string }[] = [];
  const handled = new Set<string>();
  let sent = 0, failed = 0, stopReason = '';

  const mark = (id: string, patch: Record<string, unknown>) =>
    sc.from('rsvps').update({ ...patch, wa_updated_at: new Date().toISOString() }).eq('id', id);

  try {
    for (const g of list) {
      const phone = waNumber(g.phone);
      if (!phone) {
        await mark(g.id, { wa_status: 'failed', wa_error: 'Invalid phone number' });
        failed++; handled.add(g.id); results.push({ id: g.id, name: g.name, ok: false, error: 'Invalid phone number' });
        continue;
      }
      const vals: Record<string, string> = {
        name: String(g.name).trim().split(/\s+/)[0],
        fullname: String(g.name),
        event: String(ev.title ?? ''),
        date: dateStr,
        time: timeStr,
        place: String(ev.place ?? ''),
        planner: String(ev.planner ?? ''),
        link: ticketPage + '?c=' + encodeURIComponent(g.ticket_code),
        code: String(g.ticket_code),
        guests: String(1 + (Number(g.plus_ones) || 0)),
      };
      const data: Record<string, string> = {};
      tokens.forEach((t, i) => { data[String(i + 1)] = vals[t] ?? ''; });

      const r = await termiiSend(cfg, phone, data);
      if (r.ok) {
        await mark(g.id, { wa_status: 'sent', wa_sent_at: new Date().toISOString(), wa_message_id: r.id, wa_error: null });
        sent++; results.push({ id: g.id, name: g.name, ok: true });
      } else {
        await mark(g.id, { wa_status: 'failed', wa_error: r.error });
        failed++; results.push({ id: g.id, name: g.name, ok: false, error: r.error });
      }
      handled.add(g.id);
      if (!r.ok && STOP_RE.test(r.error)) { stopReason = r.error; break; }
      await sleep(DELAY_MS);
    }
  } finally {
    // give back anything we claimed but did not get to
    for (const g of list) {
      if (!handled.has(g.id)) await mark(g.id, { wa_status: prior[g.id] ?? 'none' });
    }
  }

  // how many are still waiting (the dashboard keeps calling until this is 0)
  let rq = sc.from('rsvps').select('id', { count: 'exact', head: true })
    .eq('event_id', eventId).eq('status', 'attending').neq('phone', '').or(orFilter);
  if (mode === 'failed' && !force) rq = rq.lt('wa_updated_at', before);
  const { count } = await rq;
  const remaining = ids ? 0 : (count ?? 0);

  return json({ sent, failed, remaining, before, stop: !!stopReason, stop_reason: stopReason, results });
});