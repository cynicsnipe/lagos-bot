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
} catch(e) { console.log("[INIT ERROR]", e.message); }

if (!ledger.length) { console.log("[ERROR] No accounts found in ./store"); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));

function secureShuffle(arr) {
  const salt = Date.now() % 1000;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor((Math.random() * (i + 1) + salt) % (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function tag(i, total, u) { return `[${i+1}/${total}][${u}]`; }

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
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  LAGOS DRAIN ENGINE`);
  console.log(`  Accounts : ${ledger.length}`);
  console.log(`  Workers  : ${CONCURRENT_LIMIT}`);
  console.log(`  Target   : ${TO}`);
  console.log(`  Domains  : MAIN + ALT fallback`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  discord(`🚀 Engine online — ${ledger.length} accounts loaded. TO: ${TO}`);

  const sessionStart = Date.now();
  let sessionTotal = 0, globalCycles = 0;

  while (true) {
    if (TARGET_HOURS > 0 && Date.now() - sessionStart >= TARGET_HOURS * 3600000) break;
    globalCycles++;
    let idx = 0, cycleTotal = 0;
    let drained = 0, checkinOnly = 0, broke = 0, fail = 0;
    console.log(`\n┌─ CYCLE #${globalCycles} STARTED — ${new Date().toISOString()}`);

    async function worker(wid) {
      await sleep(Math.floor(Math.random() * 100) + wid * 15);

      while (idx < ledger.length) {
        const i = idx++, a = ledger[i];
        if (!a) break;
        const t = tag(i, ledger.length, a.u);

        try {
          // ── LOGIN ──────────────────────────────────────────
          let cookie = '', API = '', domain = '';
          for (const [label, base] of [['MAIN', API_MAIN], ['ALT', API_ALT]]) {
            const lr = await req(`${base}/auth/login`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ username: a.u, password: a.p })
            });
            if (lr.res.ok) {
              const lj = await lr.res.json().catch(() => ({}));
              if (lj.user || lj.ok !== false) {
                cookie = lr.cookie; API = base; domain = label;
                console.log(`${t} ✅ LOGIN ok via ${label}`);
                break;
              }
            }
            console.log(`${t} ❌ LOGIN failed via ${label} — status ${lr.res.status ?? 0}`);
          }
          if (!cookie) { fail++; console.log(`${t} ⛔ SKIP — no domain accepted login`); continue; }

          // ── CHECKIN ────────────────────────────────────────
          const cr = await req(`${API}/levels`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ op: "checkin", xp: 5 })
          }, cookie);
          const cj = cr.res.ok ? await cr.res.json().catch(() => ({})) : {};
          console.log(`${t} 📅 CHECKIN → status:${cr.res.status} money:${cj.money ?? '?'} streak:${cj.streak?.streak ?? '?'}`);

          // ── GET SAVE ───────────────────────────────────────
          const svr = await req(`${API}/save`, {}, cookie);
          const sv  = svr.res.ok ? await svr.res.json() : null;
          if (!sv?.game) { fail++; console.log(`${t} ⛔ SKIP — no game state`); continue; }

          const canSend = sv.canSend ?? 0;
          const money   = Math.floor(Number(sv.game.money ?? 0));
          console.log(`${t} 💰 SAVE → money:₦${money.toLocaleString()} canSend:₦${canSend.toLocaleString()}`);

          // ── ALT DOMAIN CHECK if canSend=0 ─────────────────
          let useAPI = API, useDomain = domain, useMoney = money, useCanSend = canSend;
          if (canSend <= MIN && API === API_MAIN) {
            console.log(`${t} 🔄 canSend=0 on MAIN — checking ALT...`);
            const altSvr = await req(`${API_ALT}/save`, {}, cookie);
            const altSv  = altSvr.res.ok ? await altSvr.res.json() : null;
            if (altSv?.canSend > MIN) {
              useAPI = API_ALT; useDomain = 'ALT';
              useMoney   = Math.floor(Number(altSv.game?.money ?? 0));
              useCanSend = altSv.canSend;
              console.log(`${t} ✅ ALT canSend:₦${useCanSend.toLocaleString()} money:₦${useMoney.toLocaleString()}`);
            } else {
              console.log(`${t} ❌ ALT canSend also 0 — account blocked`);
              checkinOnly++; continue;
            }
          }

          // ── SEND ───────────────────────────────────────────
          let amount = Math.min(useMoney - FEE, useCanSend - FEE);
          if (amount < MIN) { broke++; console.log(`${t} 💸 SKIP — amount ₦${amount} below min`); continue; }

          console.log(`${t} 📤 SENDING ₦${amount.toLocaleString()} via ${useDomain}...`);
          const sr = await req(`${useAPI}/send`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ to: TO, amount })
          }, cookie);

          const sBody = await sr.res.text?.() ?? '';
          let sj = {};
          try { sj = JSON.parse(sBody); } catch(_) {}

          if (sr.res.ok && sj.ok !== false) {
            cycleTotal += amount; sessionTotal += amount; drained++;
            console.log(`${t} ✅ SENT ₦${amount.toLocaleString()} | Running: ₦${sessionTotal.toLocaleString()}`);
          } else {
            broke++;
            console.log(`${t} ❌ SEND FAILED → ${sBody.slice(0, 120)}`);
          }

          await sleep(10);
        } catch(e) {
          fail++;
          console.log(`${tag(i, ledger.length, a?.u ?? '?')} 💥 EXCEPTION: ${e.message}`);
        }
      }
    }

    await Promise.all(Array.from({ length: CONCURRENT_LIMIT }, (_, i) => worker(i)));
    secureShuffle(ledger);

    const elapsed = Math.round((Date.now() - sessionStart) / 1000);
    console.log(`\n└─ CYCLE #${globalCycles} DONE`);
    console.log(`   Drained    : ${drained}`);
    console.log(`   CheckinOnly: ${checkinOnly} (canSend=0 both domains)`);
    console.log(`   Broke      : ${broke}`);
    console.log(`   Failed     : ${fail}`);
    console.log(`   Cycle ₦    : ₦${cycleTotal.toLocaleString()}`);
    console.log(`   Total ₦    : ₦${sessionTotal.toLocaleString()}`);
    console.log(`   Elapsed    : ${elapsed}s`);

    discord(`📊 Cycle #${globalCycles}\n✅ Drained: ${drained} | ⛔ Blocked: ${checkinOnly} | 💥 Fail: ${fail}\n💰 Cycle: ₦${cycleTotal.toLocaleString()} | Total: ₦${sessionTotal.toLocaleString()}`);
    await sleep(200);
  }

  discord(`🏁 FINISHED — ₦${sessionTotal.toLocaleString()} across ${globalCycles} cycles`);
  console.log(`\nFINISHED — ₦${sessionTotal.toLocaleString()} total`);
})();
