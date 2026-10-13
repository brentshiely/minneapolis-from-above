#!/usr/bin/env node
// Loads the app in headless Chrome and reports anything the page's security
// headers blocked (CSP violations), plus console errors, failed requests and
// every third-party host the browser contacted directly.
//
//   npm run build && npx wrangler pages dev dist --port 8788 &
//   node scripts/csp-check.mjs [url] [seconds]
//
// Exits non-zero on a CSP violation or a missing security header.
import puppeteer from "puppeteer-core";

const url = process.argv[2] ?? "http://localhost:8788";
const seconds = Number(process.argv[3] ?? 40);
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"],
  defaultViewport: { width: 1280, height: 800 },
});
let failed = false;
try {
  const page = await browser.newPage();
  const violations = [], errors = [], hosts = new Map();
  await page.evaluateOnNewDocument(() => {
    try { sessionStorage.setItem("mfa-splash-seen", "1"); } catch { /* fine */ }
    window.__csp = [];
    document.addEventListener("securitypolicyviolation", (e) => window.__csp.push(`${e.violatedDirective} blocked ${e.blockedURI}`));
  });
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 300)); });
  page.on("response", (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url().slice(0, 140)}`); });
  page.on("requestfailed", (r) => errors.push(`FAILED ${r.url().slice(0, 140)} ${r.failure()?.errorText}`));
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (!/^https?:$/.test(u.protocol)) return;
    if (u.origin !== new URL(url).origin) hosts.set(u.host, (hosts.get(u.host) ?? 0) + 1);
  });
  const res = await page.goto(url, { waitUntil: "load" });
  const h = res.headers();
  for (const name of ["content-security-policy", "referrer-policy", "x-content-type-options", "x-frame-options", "strict-transport-security", "permissions-policy", "cross-origin-opener-policy"]) {
    const ok = !!h[name];
    if (!ok) failed = true;
    console.log(`${ok ? "  ok " : "FAIL"} header ${name}`);
  }
  await page.waitForFunction(() => window.fromAbove?.fleet?.vehicles.size > 0, { timeout: 40_000 }).catch(() => console.log("note: no vehicles appeared"));
  // Exercise the interactive bits: layers panel, search, a camera card, the credits.
  await page.evaluate(() => { window.fromAbove.map.jumpTo({ center: [-93.27, 44.97], zoom: 12 }); });
  await sleep(seconds * 1000 / 2);
  await page.click("#layers-button").catch(() => {});
  await page.click("#search-button").catch(() => {});
  await page.keyboard.type("Lake and Hennepin").catch(() => {});
  await sleep(seconds * 1000 / 2);
  violations.push(...await page.evaluate(() => window.__csp));
  console.log(`\nthird-party hosts contacted directly by the browser:`);
  for (const [host, n] of [...hosts].sort()) console.log(`  ${host} (${n})`);
  console.log(`\nCSP violations: ${violations.length}`);
  for (const v of [...new Set(violations)]) console.log(`  ${v}`);
  console.log(`console errors: ${errors.length}`);
  for (const e of [...new Set(errors)].slice(0, 12)) console.log(`  ${e}`);
  if (violations.length) failed = true;
} finally {
  await browser.close();
}
process.exit(failed ? 1 : 0);
