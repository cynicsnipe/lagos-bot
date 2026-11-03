const fs = require('fs');

const API_MAIN = "https://lagoslife.app/api";
const API_ALT  = "https://lagoslife.eliysites.com/api";
const TO   = process.env.TO;
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

const FEE  = 50, MIN = 100, SEED = 1096000;
const CONCURRENT_LIMIT = 75;
const TARGET_HOURS = parseFloat(process.env.DURATION_HOURS || "0");

const storeDir = './store';
if (!fs.existsSync(storeDir)) fs.mkdirSync(storeDir);

let ledger = [];
try {
  const files = fs.readdirSync(storeDir).filter(f => f.startsWith('accs'));
  for (const file of files) {
    const raw = fs.readFileSync(`${storeDir}/${file}`, 'utf8');
    if (raw.trim()) ledger.push(...JSON.parse(raw));
  }
} catch(e) { console.log("[INIT]", e.message); }

if (!ledger.length) { console.log("[ERROR] No accounts"); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

function secureShuffle(arr) {
  const salt = Date.now() % 1000;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor((Math.random() * (i + 1) + salt) % (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function req(url, opts = {}, cookie = '') {
  opts.headers = opts.headers || {};
  if (cookie) opts.headers['cookie'] = cookie;
  const res = await fetch(url, { ...opts, signal: AbortSignal.timeout(5000) })
    .catch(e => ({ ok: false, statusText: e.message }));
  if (!res.ok && !res.headers) return { res: { ok: false, text: async () => res.statusText }, cookie };
  const sc = res.headers?.get('set-cookie');
  let newCookie = cookie;
  if (sc) { const c = sc.split(',')[0].split(';')[0]; newCookie = cookie ? `${cookie};${c}` : c; }
  return { res, cookie: newCookie };
}

async function discord(msg) {
  if (!DISCORD_WEBHOOK_URL) return;
  fetch(DISCORD_WEBHOOK_URL, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: msg })
  }).catch(() => {});
}

(async () => {
  secureShuffle(ledger);
  console.log(`Loaded ${ledger.length} accounts`);
  discord(`🚀 Engine online — ${ledger.length} accounts loaded`);

  const sessionStart = Date.now();
  let sessionTotal = 0, globalCycles = 0;

  while (true) {
    if (TARGET_HOURS > 0 && Date.now() - sessionStart >= TARGET_HOURS * 3600000) break;
    globalCycles++;
    let idx = 0, cycleTotal = 0;
    let drained = 0, checkinOnly = 0, broke = 0, fail = 0;

    async function worker(wid) {
      await sleep(Math.floor(Math.random() * 100) + wid * 15);

      while (idx < ledger.length) {
        const i = idx++, a = ledger[i];
        if (!a) break;

        try {
          // try main domain first, fall back to alt
          let cookie = '', API = API_MAIN;
          for (const domain of [API_MAIN, API_ALT]) {
            const lr = await req(`${domain}/auth/login`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ username: a.u, password: a.p })
            });
            if (lr.res.ok) { cookie = lr.cookie; API = domain; break; }
          }
          if (!cookie) { fail++; continue; }

          // checkin — server writes srv.streak directly, may restore canSend
          await req(`${API}/levels`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ op: "checkin", xp: 5 })
          }, cookie);

          // get save — check canSend + money
          const svr = await req(`${API}/save`, {}, cookie);
          const sv  = svr.res.ok ? await svr.res.json() : null;
          if (!sv?.game) { fail++; continue; }

          const canSend = sv.canSend ?? 0;
          let amount = Math.min(
            Math.floor(Number(sv.game.money ?? 0)) - FEE,
            canSend - FEE
          );

          // if canSend still 0, try seeding on alt domain
          if (canSend <= MIN && API === API_MAIN) {
            const svAlt = await req(`${API_ALT}/save`, {}, cookie);
            const altSv = svAlt.res.ok ? await svAlt.res.json() : null;
            if (altSv?.canSend > MIN) {
              amount = Math.min(Math.floor(Number(altSv.game?.money ?? 0)) - FEE, altSv.canSend - FEE);
              API = API_ALT;
            }
          }

          if (amount < MIN) { broke++; continue; }

          // send
          const sr = await req(`${API}/send`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ to: TO, amount })
          }, cookie);

          if (sr.res.ok) {
            const sj = await sr.res.json().catch(() => ({}));
            if (sj.ok !== false) {
              cycleTotal += amount; sessionTotal += amount; drained++;
              console.log(`[✓] [${i+1}/${ledger.length}] ${a.u} → ₦${amount.toLocaleString()} via ${API.includes('eliy') ? 'ALT' : 'MAIN'} | Total: ₦${sessionTotal.toLocaleString()}`);
            } else { broke++; }
          } else {
            const err = await sr.res.text?.() ?? '';
            if (err.includes('canSend') || err.includes('0')) { checkinOnly++; }
            else { fail++; }
          }

          await sleep(10);
        } catch(e) { fail++; }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENT_LIMIT }, (_, i) => worker(i)));
    secureShuffle(ledger);

    const summary = `\n--- CYCLE #${globalCycles} ---\nDrained: ${drained} | CheckinOnly: ${checkinOnly} | Broke: ${broke} | Fail: ${fail}\nCycle: ₦${cycleTotal.toLocaleString()} | Total: ₦${sessionTotal.toLocaleString()}\n`;
    console.log(summary);
    discord(`📊 Cycle #${globalCycles} — Drained: ${drained} | ₦${cycleTotal.toLocaleString()} | Running total: ₦${sessionTotal.toLocaleString()}`);
    await sleep(200);
  }

  discord(`🏁 Done — ₦${sessionTotal.toLocaleString()} total across ${globalCycles} cycles`);
})();
