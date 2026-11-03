const { chromium } = require('playwright');
const fs = require('fs');

const COUNT = parseInt(process.env.ACCOUNT_COUNT || "50");
const DISCORD = process.env.DISCORD_WEBHOOK_URL;
const results = [];

const sleep = ms => new Promise(r => setTimeout(r, ms));
function rand(n) { return Math.random().toString(36).slice(2, 2+n); }

function genAcc() {
  const first = ["Tolu","Kemi","Emeka","Ngozi","Seun","Bayo","Chidi","Amaka","Yemi","Funke","Ade","Sola","Biodun","Rotimi","Dami","Uche","Tobi","Lola","Femi","Nkem"];
  const last  = ["Ade","Bello","Chukwu","Dike","Eze","Falade","Gani","Hassan","Ibe","James"];
  const name  = first[Math.floor(Math.random()*first.length)] + " " + last[Math.floor(Math.random()*last.length)];
  const u     = name.replace(" ","").toLowerCase() + rand(4) + Math.floor(Math.random()*99);
  const yr    = 1995 + Math.floor(Math.random()*7);
  const mo    = 1 + Math.floor(Math.random()*11);
  const dy    = 10 + Math.floor(Math.random()*18);
  return { name, u, p: "Vatar2024@" + rand(4), email: rand(10) + "@gmail.com", yr, mo, dy };
}

async function discord(msg) {
  if (!DISCORD) return;
  await fetch(DISCORD, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: msg })
  }).catch(() => {});
}

(async () => {
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  VATAR ACCOUNT CREATOR`);
  console.log(`  Target: ${COUNT} accounts`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━\n`);
  await discord(`🏭 Vatar creator started — target: ${COUNT}`);

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  for (let i = 0; i < COUNT; i++) {
    const acc = genAcc();
    console.log(`[${i+1}/${COUNT}] creating ${acc.u}...`);
    const page = await browser.newPage();

    try {
      // go to homepage
      await page.goto("https://lagoslife.app/", {
        waitUntil: "networkidle",
        timeout: 30000
      });

      // click Sign up button on homepage
      await page.locator('a[href*="register"], button:has-text("Sign up"), a:has-text("Sign up")').first().click();
      await page.waitForURL("**/register**", { timeout: 10000 }).catch(() => {});
      await page.waitForLoadState("networkidle");

      // fill name
      await page.locator('input[placeholder*="Tolu" i], input[name="name"]').first().fill(acc.name);
      await sleep(300);

      // fill username
      await page.locator('input[placeholder*="tolu_eko" i], input[name="username"]').first().fill(acc.u);
      await sleep(300);

      // fill password
      await page.locator('input[type="password"]').first().fill(acc.p);
      await sleep(300);

      // fill email
      await page.locator('input[type="email"]').first().fill(acc.email);
      await sleep(300);

      // date of birth — day month year dropdowns
      await page.locator('select').nth(0).selectOption(String(acc.dy));
      await page.locator('select').nth(1).selectOption(String(acc.mo));
      await page.locator('select').nth(2).selectOption(String(acc.yr));
      await sleep(300);

      // tick terms checkbox
      const cb = page.locator('input[type="checkbox"]').first();
      if (!await cb.isChecked()) await cb.check();

      // wait for turnstile "Checking you're a person" to clear
      console.log(`[${i+1}] waiting for Turnstile...`);
      await page.waitForFunction(() => {
        const el = document.querySelector('[data-testid="cf-turnstile-status"], .cf-turnstile iframe');
        const checking = document.body.innerText.includes("Checking you");
        return !checking;
      }, { timeout: 20000 }).catch(() => {});
      await sleep(2000);

      // submit
      const [response] = await Promise.all([
        page.waitForResponse(r => r.url().includes('/api/auth/register'), { timeout: 20000 }),
        page.locator('button:has-text("Sign up")').last().click()
      ]);

      const status = response.status();
      const json   = await response.json().catch(() => ({}));

      if (status === 200 || json.user || json.ok || json.id) {
        console.log(`[${i+1}] ✅ ${acc.u} / ${acc.p}`);
        results.push({ u: acc.u, p: acc.p });
      } else {
        console.log(`[${i+1}] ❌ ${status} — ${JSON.stringify(json)}`);
      }

    } catch(e) {
      console.log(`[${i+1}] 💥 ${e.message.slice(0,100)}`);
    }

    await page.close();

    // discord update every 10
    if (results.length && results.length % 10 === 0) {
      const lines = results.slice(-10).map(a => `${a.u}:${a.p}`).join('\n');
      await discord(`📦 ${results.length}/${COUNT} done\n\`\`\`\n${lines}\n\`\`\``);
    }

    await sleep(2000 + Math.random() * 1000);
  }

  await browser.close();

  // save file
  if (!fs.existsSync('./store')) fs.mkdirSync('./store');
  fs.writeFileSync(`./store/accs_${Date.now()}.json`, JSON.stringify(results, null, 2));

  // send all to Discord in chunks of 25
  if (results.length) {
    const lines = results.map(a => `${a.u}:${a.p}`);
    for (let i = 0; i < lines.length; i += 25) {
      const chunk = lines.slice(i, i+25).join('\n');
      await discord(`📋 [${i+1}-${Math.min(i+25, lines.length)}/${results.length}]\n\`\`\`\n${chunk}\n\`\`\``);
      await sleep(800);
    }
    await discord(`✅ DONE — ${results.length}/${COUNT} Vatar accounts created`);
  } else {
    await discord(`❌ 0 accounts created — Turnstile may be blocking headless. Try count=1 to debug.`);
  }
})();
