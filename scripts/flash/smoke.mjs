#!/usr/bin/env node
/**
 * Test d'affichage du bloc « Flash Shopify » (onglets Total / Marketplaces / Site web) sur le build
 * de production (dossier dist/).
 *
 *   node scripts/flash/smoke.mjs [--shots dossier]
 *
 * Lance un petit serveur statique, ouvre l'application dans Chromium (Playwright), passe
 * l'écran d'accès et vérifie : aucune erreur JavaScript, carte Flash présente avec les chiffres
 * de shopify_flash.json et shopify_flash_site.json (total, marketplaces, site web), quatre
 * langues, pastille « non actualisé » après 3 jours, filtre « Site Web », affichage mobile sans
 * débordement horizontal.
 *
 * Codes de sortie : 0 ok · 2 échec d'affichage · 77 test impossible (Playwright ou Chromium
 * indisponible : à signaler, ce n'est pas un échec de l'application).
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, "..", "..");
const DIST = path.join(REPO, "dist");
const shotsDir = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;

function chargerPlaywright() {
  const racines = [process.env.NODE_PATH, "/opt/npm-tools/node_modules"].filter(Boolean);
  try { racines.push(execSync("npm root -g", { encoding: "utf8" }).trim()); } catch { /* ignoré */ }
  racines.push(path.join(REPO, "node_modules"));
  for (const r of racines) {
    try { return createRequire(path.join(r, "_.js"))("playwright"); } catch { /* suivant */ }
  }
  return null;
}

const norm = (s) => s.replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const contient = (texte, motif) => texte.toLowerCase().includes(norm(motif).toLowerCase());

function lireBloc() {
  const src = fs.readFileSync(path.join(REPO, "App.jsx"), "utf8");
  const lire = (f) => JSON.parse(fs.readFileSync(path.join(REPO, f), "utf8"));
  const F = lire("shopify_flash.json"), S = lire("shopify_flash_site.json");
  const dm = /DMAX = "(\d{4}-\d{2}-\d{2})"/.exec(src);
  const kpi = /"kpi":\{"ca_total_2026":([\d.]+),[^}]*"objectif_annuel_total":(\d+)/.exec(src);
  const data = JSON.parse(/^const DATA = (.*);\s*$/m.exec(src)[1]);
  const site = data.mp_vs_objectif.find((m) => m.marketplace === "Site Web");
  return { F, S, dmax: dm[1], ca: Number(kpi[1]), obj: Number(kpi[2]), siteCa: site.ca, siteObj: site.objectif };
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2" };
function serveur() {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
      if (p === "/") p = "/index.html";
      const f = path.join(DIST, path.normalize(p));
      if (!f.startsWith(DIST) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(f)] ?? "application/octet-stream" });
      fs.createReadStream(f).pipe(res);
    });
    s.listen(0, "127.0.0.1", () => ok(s));
  });
}

const echecs = [];
const verifier = (cond, msg) => { if (!cond) echecs.push(msg); return cond; };

async function ouvrir(browser, { largeur = 1280, hauteur = 900, avance = 0 } = {}) {
  const ctx = await browser.newContext({ locale: "fr-FR", viewport: { width: largeur, height: hauteur } });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) erreurs.push(`console: ${m.text()}`); });
  page.on("response", (r) => {
    const u = new URL(r.url());
    if (r.status() >= 400 && !/favicon|^\/api\//.test(u.pathname)) erreurs.push(`ressource ${r.status()}: ${u.pathname}`);
  });
  await page.addInitScript((avanceMs) => {
    const reel = Date.now.bind(Date);
    if (avanceMs) Date.now = () => reel() + avanceMs;
    try { localStorage.setItem("homy_remember_until", String(reel() + 400 * 864e5)); } catch { /* ignoré */ }
  }, avance * 864e5);
  return { ctx, page, erreurs };
}

async function versDashboard(page, base) {
  await page.goto(base, { waitUntil: "load" });
  // Depuis le 14/10/2026 l'app ouvre directement le dashboard (écran de conversation retiré).
  // On tolère quand même son retour éventuel : s'il est présent, on le passe.
  const passer = page.getByRole("button", { name: /Passer au dashboard|Skip to dashboard|跳到仪表盘|Ir al dashboard/ });
  await page.waitForFunction(
    // insensible à la casse : innerText restitue la mise en majuscules appliquée par le CSS
    () => /Flash Shopify|Shopify flash|Shopify 快报|Passer au dashboard|Skip to dashboard|跳到仪表盘|Ir al dashboard/i.test(document.body.innerText),
    null, { timeout: 30000 });
  if (await passer.count()) await passer.first().click({ timeout: 20000 });
  await page.waitForSelector("text=/Flash Shopify|Shopify flash|Shopify 快报/", { timeout: 30000 });
}

async function textesCarte(page) {
  // Le texte de la carte entière : on remonte du titre jusqu'au conteneur de la carte
  return norm(await page.evaluate(() => {
    const el = [...document.querySelectorAll("span")].find((s) => /Flash Shopify|Shopify flash|Shopify 快报/.test(s.textContent));
    let n = el;
    for (let i = 0; i < 8 && n; i++, n = n.parentElement) if (n.className && String(n.className).includes("p-4") && String(n.className).includes("mb-5")) return n.innerText;
    return "";
  }));
}

const somme = (F) => F.jours.reduce((a, j) => ({ ca: a.ca + j.ca, cmd: a.cmd + j.cmd, qte: a.qte + j.qte }), { ca: 0, cmd: 0, qte: 0 });
const fmtN = (n) => norm(new Intl.NumberFormat("fr-FR").format(n));
const chiffres = (t, avecPanier = true) => ({
  ca: `${Math.round(t.ca / 1000)}k€`,
  cmd: fmtN(t.cmd),
  qte: fmtN(t.qte),
  ...(avecPanier ? { panier: norm(new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(t.ca / t.cmd)) + " €") } : {}),
});
const mEur = (v) => new Intl.NumberFormat("fr", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v / 1e6) + " M€";
const PLACEHOLDERS = /\{(boutique|date|dmax|du|au|shopify|excel|ecart|n|mp|site)\}/;

async function onglet(page, i) {
  await page.getByRole("tab").nth(i).click();
  await page.waitForTimeout(250);
}

async function main() {
  if (!fs.existsSync(path.join(DIST, "index.html"))) { console.error("dist/ introuvable : lancer « npx vite build » d'abord"); return 2; }
  const pw = chargerPlaywright();
  if (!pw) { console.log("TEST IMPOSSIBLE · Playwright introuvable"); return 77; }
  const { F, S, dmax, ca, obj, siteCa, siteObj } = lireBloc();
  if (!F || !S) { console.log("Bloc Flash vide : rien à afficher, test sans objet"); return 0; }
  let browser;
  try { browser = await pw.chromium.launch(); } catch (e) { console.log(`TEST IMPOSSIBLE · Chromium indisponible (${String(e.message).split("\n")[0]})`); return 77; }
  const srv = await serveur();
  const base = `http://127.0.0.1:${srv.address().port}/`;
  try {
    const tm = somme(F), ts = somme(S), tt = { ca: tm.ca + ts.ca, cmd: tm.cmd + ts.cmd, qte: tm.qte + ts.qte };
    const total = {
      ...chiffres(tt),
      cumul: mEur(ca + tt.ca),
      pctObj: ((ca + tt.ca) / obj * 100).toFixed(1) + " %",
      tendance: F.n1?.ca > 0 && S.n1?.ca > 0 ? Math.abs((tt.ca / (F.n1.ca + S.n1.ca) - 1) * 100).toFixed(0) + "%" : null,
    };
    const siteCumul = { cumul: mEur(siteCa + ts.ca), pctObj: ((siteCa + ts.ca) / siteObj * 100).toFixed(1) + " %" };

    // 1) français, bureau : onglet Total par défaut, puis chaque boutique
    {
      const { ctx, page, erreurs } = await ouvrir(browser);
      await versDashboard(page, base);
      let t = await textesCarte(page);
      verifier(t.length > 50, "carte Flash introuvable ou vide");
      verifier((await page.getByRole("tab").count()) === 3, "FR · trois onglets attendus (Total, Marketplaces, Site web)");
      for (const [k, v] of Object.entries(total)) if (v) verifier(t.includes(norm(v)), `FR · Total · « ${v} » (${k}) absent de la carte`);
      verifier(contient(t, "Cumul 2026 estimé"), "FR · libellé du cumul absent (Total)");
      verifier(!/Non actualisé/.test(t), "FR · pastille « non actualisé » affichée alors que les données sont fraîches");
      verifier(!PLACEHOLDERS.test(t), "FR · Total · variable de modèle non remplacée");
      if (shotsDir) { fs.mkdirSync(shotsDir, { recursive: true }); await page.screenshot({ path: path.join(shotsDir, "bureau-fr-total.png"), fullPage: false }); }

      await onglet(page, 1); // Marketplaces
      t = await textesCarte(page);
      for (const [k, v] of Object.entries(chiffres(tm))) verifier(t.includes(norm(v)), `FR · Marketplaces · « ${v} » (${k}) absent`);
      verifier(F.pays.slice(0, 5).every((p) => t.includes(p.nom)), "FR · Marketplaces · un des 5 premiers pays est absent");
      verifier(F.produits.slice(0, 5).every((p) => t.includes(p.nom)), "FR · Marketplaces · un des 5 premiers produits est absent");
      if (F.recoupement) verifier(/Contrôle .* Shopify .* vs fichier ODP hors site web/.test(t), "FR · Marketplaces · phrase de contrôle absente");
      verifier(!contient(t, "Cumul 2026 estimé"), "FR · Marketplaces · pas de cumul attendu avec deux boutiques");
      verifier(!PLACEHOLDERS.test(t), "FR · Marketplaces · variable de modèle non remplacée");
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, "bureau-fr-marketplaces.png"), fullPage: false });

      await onglet(page, 2); // Site web
      t = await textesCarte(page);
      for (const [k, v] of Object.entries(chiffres(ts))) verifier(t.includes(norm(v)), `FR · Site web · « ${v} » (${k}) absent`);
      verifier(S.pays.slice(0, 5).every((p) => t.includes(p.nom)), "FR · Site web · un des 5 premiers pays est absent");
      verifier(S.produits.slice(0, 5).every((p) => t.includes(p.nom)), "FR · Site web · un des 5 premiers produits est absent");
      if (S.recoupement) verifier(/Contrôle .* Shopify .* vs fichier ODP « Site Web »/.test(t), "FR · Site web · phrase de contrôle absente");
      verifier(contient(t, "Cumul 2026 estimé · site web") && t.includes(siteCumul.cumul) && t.includes(siteCumul.pctObj), `FR · Site web · cumul du site (${siteCumul.cumul}, ${siteCumul.pctObj}) absent`);
      verifier(!PLACEHOLDERS.test(t), "FR · Site web · variable de modèle non remplacée");
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, "bureau-fr-site.png"), fullPage: false });

      // 2) langues : chaque onglet, sans variable de modèle restante
      await onglet(page, 0);
      const marques = { en: ["Estimated 2026 total", "Same dates 2025 (Shopify)", "Website"], es: ["Acumulado 2026 estimado", "Sitio web"], zh: ["2026 年预估累计", "官网"] };
      for (const [code, etiquette] of [["en", "EN"], ["es", "ES"], ["zh", "中文"]]) {
        await page.getByRole("button", { name: etiquette, exact: true }).last().click();
        await page.waitForTimeout(400);
        for (let i = 0; i < 3; i++) {
          await onglet(page, i);
          const tl = await textesCarte(page);
          verifier(!PLACEHOLDERS.test(tl), `${code.toUpperCase()} · onglet ${i + 1} · variable de modèle non remplacée`);
          if (i === 0) for (const m of marques[code]) verifier(contient(tl, m), `${code.toUpperCase()} · « ${m} » absent de la carte`);
        }
        await onglet(page, 0);
      }
      verifier(erreurs.length === 0, `erreurs JavaScript (bureau) : ${erreurs.slice(0, 3).join(" | ")}`);
      await ctx.close();
    }

    // 3) pastille « non actualisé » : on avance l'horloge de 3 jours
    {
      const { ctx, page, erreurs } = await ouvrir(browser, { avance: 3 });
      await versDashboard(page, base);
      const t = await textesCarte(page);
      verifier(/Non actualisé depuis [34] j/.test(t), `pastille « non actualisé » absente après 3 jours (texte : ${t.slice(0, 120)})`);
      verifier(erreurs.length === 0, `erreurs JavaScript (horloge +3 j) : ${erreurs.slice(0, 3).join(" | ")}`);
      await ctx.close();
    }

    // 4) filtre « Site Web » du tableau de bord : seule la boutique du site, sans onglets
    {
      const { ctx, page, erreurs } = await ouvrir(browser);
      await versDashboard(page, base);
      await page.locator("select", { has: page.locator("option[value='Site Web']") }).first().selectOption("Site Web");
      await page.waitForTimeout(500);
      const t = await textesCarte(page);
      verifier((await page.getByRole("tab").count()) === 0, "filtre Site Web : aucun onglet attendu");
      for (const [k, v] of Object.entries(chiffres(ts))) verifier(t.includes(norm(v)), `filtre Site Web · « ${v} » (${k}) absent`);
      verifier(t.includes(siteCumul.cumul), "filtre Site Web · cumul du site absent");
      verifier(!PLACEHOLDERS.test(t), "filtre Site Web · variable de modèle non remplacée");
      verifier(erreurs.length === 0, `erreurs JavaScript (filtre Site Web) : ${erreurs.slice(0, 3).join(" | ")}`);
      await ctx.close();
    }

    // 5) mobile : pas de défilement horizontal de la page
    {
      const { ctx, page, erreurs } = await ouvrir(browser, { largeur: 390, hauteur: 844 });
      await versDashboard(page, base);
      const defil = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      verifier(defil <= 1, `mobile : débordement horizontal de ${defil}px`);
      const t = await textesCarte(page);
      verifier(t.includes(norm(total.cumul)), "mobile : cumul absent");
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, "mobile-fr.png"), fullPage: false });
      verifier(erreurs.length === 0, `erreurs JavaScript (mobile) : ${erreurs.slice(0, 3).join(" | ")}`);
      await ctx.close();
    }
  } finally {
    await browser.close();
    srv.close();
  }
  if (echecs.length) { for (const e of echecs) console.log(`ÉCHEC · ${e}`); return 2; }
  console.log("SMOKE_OK · carte Flash affichée (onglets Total / Marketplaces / Site web, 4 langues, filtre Site Web, pastille de fraîcheur, mobile), aucune erreur JavaScript");
  return 0;
}

main().then((c) => process.exit(c), (e) => { console.error(e); process.exit(2); });
