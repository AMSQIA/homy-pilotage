#!/usr/bin/env node
/**
 * Test d'affichage de Campagnes Ads › détail par marketplace, sur le build de production (dossier dist/).
 *
 *   npx vite build && node scripts/ads/test_detail_ads.mjs [--shots dossier]
 *
 * Vérifie, dans Chromium (Playwright) :
 *   - chaque marketplace de l'onglet (anneaux de budget, top 3, à surveiller, liste) s'ouvre au clic ou au clavier (Entrée) ;
 *   - Leroy Merlin France : entrée (synthèse : « 1 € de pub a rapporté … », dépense et CA attribué recalculés ici depuis
 *     data/ads/leroy_merlin_fr.json, périmètres Total | 3P | 1P, 3 constats puis les autres, « Plan complet ») ; 8 sections repliées à
 *     l'entrée, ouvertes/refermées au toucher, « Tout ouvrir » ; mois partiel signalé, produits filtrés par action ; 4 langues ;
 *   - une marketplace sans rapports (Amazon FR) : ligne du fichier budget + message « détail pas encore disponible » ;
 *   - fermeture par la croix, par Échap et par le fond ; le défilement de la page revient ;
 *   - mobile 390 et 360 px : aucun débordement horizontal de la page (les tableaux défilent dans leur cadre) ;
 *   - aucune erreur JavaScript.
 */
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIST = path.join(RACINE, "dist");
const D = JSON.parse(fs.readFileSync(path.join(RACINE, "data/ads/leroy_merlin_fr.json"), "utf8"));
const argShots = process.argv.indexOf("--shots");
const SHOTS = argShots > 0 ? process.argv[argShots + 1] : null;
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });

function chargerPlaywright() {
  const racines = [process.env.NODE_PATH, "/opt/npm-tools/node_modules"].filter(Boolean);
  try { racines.push(execSync("npm root -g", { encoding: "utf8" }).trim()); } catch { /* ignoré */ }
  racines.push(path.join(RACINE, "node_modules"));
  for (const r of racines) { try { return createRequire(path.join(r, "_.js"))("playwright"); } catch { /* suivant */ } }
  return null;
}
const norm = (s) => String(s).replace(/[  ]/g, " ").replace(/\s+/g, " ").trim();
const eur = (v) => norm(new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(v)) + " €";
// même arrondi que l'entrée du détail (k€ : sans décimale au-delà de 100 k€, une décimale en dessous)
const k = (v) => (Math.abs(v) >= 1000 ? norm((v / 1000).toLocaleString("fr-FR", { maximumFractionDigits: Math.abs(v) >= 1e5 ? 0 : 1, minimumFractionDigits: Math.abs(v) >= 1e5 ? 0 : 1 })).replace(/,0$/, "") + " k€" : eur(v));

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json", ".woff2": "font/woff2" };
const serveur = () => new Promise((ok) => {
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

const echecs = [];
const verifier = (cond, msg) => { if (!cond) echecs.push(msg); return cond; };

// chiffres attendus, recalculés ici depuis le fichier de données
const an = D.donnees_au.slice(0, 4);
const tot = (pf) => D.mensuel.filter((r) => r.mois.startsWith(an) && (!pf || r.pf === pf)).reduce((a, r) => ({ spend: a.spend + r.spend, sales: a.sales + r.sales }), { spend: 0, sales: 0 });
const ATTENDU = { Total: tot(), "3P": tot("3P"), "1P": tot("1P") };

async function ouvrir(browser, largeur, hauteur = 900) {
  const ctx = await browser.newContext({ locale: "fr-FR", viewport: { width: largeur, height: hauteur }, ...(largeur < 500 ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
  const page = await ctx.newPage();
  const erreurs = [];
  page.on("pageerror", (e) => erreurs.push(`pageerror: ${e.message}`));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) erreurs.push(`console: ${m.text()}`); });
  await page.addInitScript(() => { try { localStorage.setItem("homy_remember_until", String(Date.now() + 400 * 864e5)); } catch { /* ignoré */ } });
  return { ctx, page, erreurs };
}
async function onglet(page, base, lang) {
  await page.goto(`${base}?${new URLSearchParams({ lang, tab: "ads" })}`, { waitUntil: "load" });
  await page.waitForFunction(() => document.body && document.body.innerText.includes("LEROY MERLIN FR"), null, { timeout: 30000 });
  await page.waitForTimeout(800);
}
const dialogue = (page) => page.locator('[role="dialog"][aria-modal="true"]');
// innerText suit text-transform (libellés en capitales) : comparaisons en minuscules
const texteDialogue = async (page) => norm(await dialogue(page).innerText()).toLowerCase();
const bas = (x) => norm(x).toLowerCase();
const debordement = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);

async function main() {
  const pw = chargerPlaywright();
  if (!pw) { console.log("TEST IMPOSSIBLE · Playwright introuvable"); return 77; }
  if (!fs.existsSync(path.join(DIST, "index.html"))) { console.log("TEST IMPOSSIBLE · lancer d'abord npx vite build"); return 77; }
  const srv = await serveur();
  const base = `http://127.0.0.1:${srv.address().port}/`;
  let browser;
  try { browser = await pw.chromium.launch(); } catch (e) { console.log(`TEST IMPOSSIBLE · Chromium indisponible (${String(e.message).split("\n")[0]})`); srv.close(); return 77; }
  try {
    // ---- bureau, français : contenu complet
    {
      const { ctx, page, erreurs } = await ouvrir(browser, 1280);
      await onglet(page, base, "fr");
      const cartes = page.locator('[role="button"][aria-label="LEROY MERLIN FR"]');
      verifier(await cartes.count() >= 2, `marketplace cliquable attendue à au moins 2 endroits (anneau + classement), trouvée ${await cartes.count()} fois`);
      verifier(norm(await page.locator("body").innerText()).includes("Touchez une marketplace pour ouvrir son détail"), "indication « Touchez une marketplace » absente");
      await cartes.first().click();
      await dialogue(page).waitFor({ timeout: 8000 });
      await page.waitForTimeout(700);
      let t = await texteDialogue(page);
      verifier(t.includes(bas("Leroy Merlin France")), "titre « Leroy Merlin France » absent");
      verifier(t.includes(bas(`Données au ${new Date(D.donnees_au + "T12:00:00").toLocaleDateString("fr-FR")}`)), "date des données absente");
      // entrée : synthèse visible, toutes les sections repliées
      for (const lib of ["Synthèse", "Ce qu'il faut retenir", "À faire maintenant", "Explorer l'analyse", "Mois par mois", "Catégories", "Produits", "Jour par jour", "Mots-clés", "Budgets", "Plan d'action", "Méthode et définitions"]) verifier(t.includes(bas(lib)), `« ${lib} » absent de l'entrée`);
      const fermees = () => dialogue(page).locator('section > button[aria-expanded="false"]').count();
      const ouvertes = () => dialogue(page).locator('section > button[aria-expanded="true"]').count();
      verifier(await fermees() === 8 && await ouvertes() === 0, `8 sections repliées attendues à l'entrée (repliées ${await fermees()}, ouvertes ${await ouvertes()})`);
      verifier(await dialogue(page).locator("table").count() === 0, "un tableau est affiché alors que les sections sont repliées");
      if (SHOTS) await page.screenshot({ path: path.join(SHOTS, "lm_bureau_entree.png") });
      for (const [scope, lab] of [["Total", "Total"], ["3P", "3P · marketplace"], ["1P", "1P · revendeur"]]) {
        await dialogue(page).getByRole("tab", { name: lab, exact: true }).click();
        await page.waitForTimeout(250);
        t = await texteDialogue(page);
        const a = ATTENDU[scope];
        const roas = norm((a.sales / a.spend).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })) + " €";
        verifier(t.includes(bas(`En ${an}, 1 € de pub a rapporté ${roas} de CA attribué`)), `${scope} : « 1 € de pub a rapporté ${roas} » attendu`);
        verifier(t.includes(bas(`Dépense ${k(a.spend)}`)) && t.includes(bas(`CA attribué ${k(a.sales)}`)), `${scope} : dépense ${k(a.spend)} et CA attribué ${k(a.sales)} attendus`);
      }
      await dialogue(page).getByRole("tab", { name: "Total", exact: true }).click();
      const tags = () => dialogue(page).locator("text=/^(Budget|Efficacité|Gaspillage|Mois en cours|Black Friday|Locomotive)$/").count();
      verifier(await tags() === 3, `3 constats attendus à l'entrée, ${await tags()} affichés`);
      await dialogue(page).getByRole("button", { name: /Voir les \d+ autres constats/ }).click();
      verifier(await tags() >= 5, `au moins 5 constats attendus une fois dépliés, ${await tags()} trouvés`);
      // « Plan complet » ouvre la section du plan
      await dialogue(page).getByRole("button", { name: /Plan complet/ }).click();
      await page.waitForTimeout(400);
      verifier(await dialogue(page).locator('#sec-plan > button').getAttribute("aria-expanded") === "true", "« Plan complet » n'ouvre pas la section du plan");
      // une section s'ouvre et se referme au toucher
      const mois = dialogue(page).locator('#sec-mois > button');
      await mois.click(); await page.waitForTimeout(300);
      verifier(await mois.getAttribute("aria-expanded") === "true" && norm(await dialogue(page).locator("#sec-mois").innerText()).includes("(partiel)"), "la section « Mois par mois » ne s'ouvre pas (ou mois partiel non signalé)");
      await mois.click(); await page.waitForTimeout(200);
      verifier(await mois.getAttribute("aria-expanded") === "false", "la section « Mois par mois » ne se referme pas");
      // tout ouvrir
      await dialogue(page).getByRole("button", { name: "Tout ouvrir" }).click();
      await page.waitForTimeout(600);
      verifier(await ouvertes() === 8, `« Tout ouvrir » : ${await ouvertes()} sections ouvertes sur 8`);
      t = await texteDialogue(page);
      for (const lib of ["Détail mensuel", "Dépense par catégorie", "ROAS journalier autour du Black Friday", "Mots-clés les plus financés", "Rythme du mois", "Ligne du fichier budget marketing"]) verifier(t.includes(bas(lib)), `« ${lib} » absent une fois les sections ouvertes`);
      // filtre produits par action : chaque ligne affichée porte l'action choisie
      await dialogue(page).getByRole("tab", { name: "Couper", exact: true }).click();
      await page.waitForTimeout(250);
      const actions = await dialogue(page).locator("#sec-produits table").first().locator("tbody tr td:last-child").allInnerTexts();
      verifier(actions.length > 0 && actions.every((x) => norm(x) === "Couper"), `filtre « Couper » : ${actions.length} lignes, actions ${[...new Set(actions.map(norm))].join("/")}`);
      if (SHOTS) await dialogue(page).screenshot({ path: path.join(SHOTS, "lm_bureau.png") }).catch(() => {});
      verifier(await page.evaluate(() => document.body.style.overflow) === "hidden", "défilement de la page non bloqué pendant le détail");
      await page.keyboard.press("Escape");
      await page.waitForTimeout(250);
      verifier(await dialogue(page).count() === 0, "Échap ne ferme pas le détail");
      verifier(await page.evaluate(() => document.body.style.overflow) !== "hidden", "défilement de la page non rétabli après fermeture");
      // clavier : Entrée sur une carte
      await cartes.first().focus();
      await page.keyboard.press("Enter");
      await dialogue(page).waitFor({ timeout: 5000 });
      await dialogue(page).getByRole("button", { name: "Fermer" }).click();
      await page.waitForTimeout(250);
      verifier(await dialogue(page).count() === 0, "la croix ne ferme pas le détail");
      // marketplace sans rapports
      const amazon = page.locator('[role="button"][aria-label="AMAZON FR"]').first();
      if (verifier(await amazon.count() === 1, "AMAZON FR non cliquable")) {
        await amazon.click();
        await dialogue(page).waitFor({ timeout: 5000 });
        t = await texteDialogue(page);
        verifier(t.includes(bas("Détail pas encore disponible")) && t.includes(bas("Ligne du fichier budget marketing")), "Amazon FR : repli (ligne budget + message) absent");
        await page.mouse.click(5, 5); // fond
        await page.waitForTimeout(250);
        verifier(await dialogue(page).count() === 0, "un clic sur le fond ne ferme pas le détail");
      }
      // toutes les lignes de la liste du bas s'ouvrent
      const lignes = await page.locator('.stagger-row[role="button"]').all();
      for (const l of lignes.slice(0, 3)) { await l.click(); await dialogue(page).waitFor({ timeout: 5000 }); await page.keyboard.press("Escape"); await page.waitForTimeout(150); }
      verifier(erreurs.length === 0, `erreurs JS (bureau) : ${erreurs.slice(0, 3).join(" | ")}`);
      await ctx.close();
    }
    // ---- 4 langues
    for (const [lang, titre, sections] of [["en", "Leroy Merlin France", ["Key takeaways", "Month by month", "Action plan"]], ["es", "Leroy Merlin France", ["Lo esencial", "Mes a mes", "Plan de acción"]], ["zh", "Leroy Merlin France", ["要点", "按月", "行动计划"]]]) {
      const { ctx, page, erreurs } = await ouvrir(browser, 1280);
      await onglet(page, base, lang);
      await page.locator('[role="button"][aria-label="LEROY MERLIN FR"]').first().click();
      await dialogue(page).waitFor({ timeout: 8000 });
      await page.waitForTimeout(500);
      const t = await texteDialogue(page);
      verifier(t.includes(bas(titre)), `${lang} : titre absent`);
      for (const s of sections) verifier(t.includes(bas(s)), `${lang} : « ${s} » absent`);
      verifier(!/undefined|nan\b/.test(t), `${lang} : « undefined » ou « NaN » affiché`);
      verifier(erreurs.length === 0, `erreurs JS (${lang}) : ${erreurs.slice(0, 3).join(" | ")}`);
      await ctx.close();
    }
    // ---- mobile
    for (const largeur of [390, 360]) {
      const { ctx, page, erreurs } = await ouvrir(browser, largeur, 844);
      await onglet(page, base, "fr");
      await page.locator('[role="button"][aria-label="LEROY MERLIN FR"]').first().click();
      await dialogue(page).waitFor({ timeout: 8000 });
      await page.waitForTimeout(700);
      verifier(await debordement(page) <= 1, `${largeur} px : débordement horizontal de ${await debordement(page)} px`);
      const panneau = dialogue(page).locator(":scope > div").nth(1);
      const largeurPanneau = await panneau.evaluate((el) => el.scrollWidth - el.clientWidth);
      verifier(largeurPanneau <= 1, `${largeur} px : le détail déborde de ${largeurPanneau} px`);
      if (SHOTS) {
        await panneau.evaluate((el) => { el.scrollTop = 0; });
        for (let i = 1; i <= 3; i++) { await page.screenshot({ path: path.join(SHOTS, `lm_${largeur}_entree_${i}.png`) }); await panneau.evaluate((el) => { el.scrollTop += el.clientHeight * 0.9; }); await page.waitForTimeout(250); }
      }
      await dialogue(page).getByRole("button", { name: "Tout ouvrir" }).click();
      await page.waitForTimeout(700);
      verifier(await debordement(page) <= 1, `${largeur} px, sections ouvertes : débordement horizontal de ${await debordement(page)} px`);
      const largeurOuvert = await panneau.evaluate((el) => el.scrollWidth - el.clientWidth);
      verifier(largeurOuvert <= 1, `${largeur} px, sections ouvertes : le détail déborde de ${largeurOuvert} px`);
      if (SHOTS) { await dialogue(page).locator("#sec-produits").scrollIntoViewIfNeeded(); await page.waitForTimeout(300); await page.screenshot({ path: path.join(SHOTS, `lm_${largeur}_produits.png`) }); }
      verifier(erreurs.length === 0, `erreurs JS (${largeur} px) : ${erreurs.slice(0, 3).join(" | ")}`);
      await ctx.close();
    }
  } finally { await browser.close(); srv.close(); }
  if (echecs.length) { console.log(`ECHEC · ${echecs.length} contrôle(s)\n - ${echecs.join("\n - ")}`); return 1; }
  console.log(`DETAIL_ADS_OK · Leroy Merlin France ${an} : dépense ${eur(ATTENDU.Total.spend)}, CA attribué ${eur(ATTENDU.Total.sales)} · 4 langues · 1280/390/360 px`);
  return 0;
}
process.exit(await main());
