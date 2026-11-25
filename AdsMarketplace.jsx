// Campagnes Ads › détail d'une marketplace (ouvert en touchant une marketplace de l'onglet).
// Données : data/ads/<marketplace>.json, préparées depuis les rapports de la régie (voir scripts/ads/).
// Aujourd'hui : Leroy Merlin France (Sponsored Products 3P + 1P). Les autres marketplaces affichent leur
// ligne du fichier budget marketing et ce qu'il faut fournir pour obtenir le même niveau de détail.
// Montants HT tels que fournis par la régie ; le CA est celui attribué aux annonces (CA web de la marque
// après clic, fenêtre de 15 jours) — pas le CA total de la marketplace.
import React, { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, Cell, ReferenceArea } from "recharts";
import { VZ } from "./FinanceViz.jsx";
import LM_FR from "./data/ads/leroy_merlin_fr.json";

const ORANGE = "#FF5A1F";
const DETAILS = { "LEROY MERLIN FR": LM_FR };
export const aDetailAds = (nom) => !!DETAILS[nom];

// ------------------------------------------------------------------ textes (4 langues ; analyse en fr/en/es)
const TX = {
  fr: {
    fermer: "Fermer", donnees_au: "Données au", perimetre: "Périmètre", total: "Total", p3: "3P · marketplace", p1: "1P · revendeur",
    depense: "Dépense", ca: "CA attribué", roas: "ROAS", acos: "ACoS", acos_l: "ACoS · dépense / CA", conv: "Conversions", cpc: "CPC moyen", cvr: "Taux de conversion", panier: "Panier attribué", cpa: "Coût / conversion",
    clics: "Clics", impr: "Impressions", ctr: "CTR", mois: "Mois", vs: "vs", meme_periode: "même période", marginal: "ROAS marginal", marginal_sub: "€ de CA par € ajouté vs",
    constats: "Ce qu'il faut retenir", mensuel: "Mois par mois", dep_mens: "Dépense mensuelle", ca_mens: "CA attribué mensuel", roas_annee: "ROAS mensuel, année sur année", detail_mens: "Détail mensuel",
    partiel: "partiel", categories: "Catégories", dep_cat: "Dépense par catégorie", roas_cat: "ROAS par catégorie et par mois", roas_cat_sub: "Rouge : ROAS < 2. Vide : pas de dépense.",
    produits: "Produits", produits_sub: "Cumul de l'année, action recommandée selon le ROAS", toutes: "Toutes", top15: "ROAS mensuel des 15 produits les plus financés",
    produit: "Produit", categorie: "Catégorie", canal: "Canal", part: "% budget", action: "Action", roas_mois: "ROAS du mois en cours",
    acc: "Accélérer", maint: "Maintenir", optim: "Optimiser", couper: "Couper", faible: "Volume faible",
    regle_action: "Accélérer : ROAS ≥ 10 · Maintenir : 6 à 10 · Optimiser : 3 à 6 · Couper : < 3 · Volume faible : < 150 € dépensés",
    jours: "Jour par jour", bf_roas: "ROAS journalier autour du Black Friday", bf_dep: "Dépense journalière autour du Black Friday", bf_sub: "Jours comptés depuis le Black Friday. Zone grisée : Black Friday → Cyber Monday.",
    semaine: "ROAS par jour de la semaine", mots: "Mots-clés", mots_top: "Mots-clés les plus financés", mot: "Mot-clé", statut: "Statut", sans_conv: "0 conversion",
    budgets: "Budgets", rythme: "Rythme du mois", par_jour: "/jour", reste: "Reste", rallonge: "Rallonge", plan: "Plan d'action", methode: "Méthode et définitions",
    jours_sem: ["Lun.", "Mar.", "Mer.", "Jeu.", "Ven.", "Sam.", "Dim."], pas_detail_titre: "Détail pas encore disponible",
    pas_detail: "Pour cette marketplace, l'application n'a que la ligne du fichier budget marketing (ci-dessus). Pour obtenir le même niveau de détail que Leroy Merlin France (mois par mois, produits, mots-clés, jour par jour), il faut importer les rapports de sa régie publicitaire.",
    ligne_budget: "Ligne du fichier budget marketing", src_budget: "tous dispositifs, janvier–juin 2026", dispositif: "Dispositif", source: "Source",
  },
  en: {
    fermer: "Close", donnees_au: "Data as of", perimetre: "Scope", total: "Total", p3: "3P · marketplace", p1: "1P · retailer",
    depense: "Spend", ca: "Attributed sales", roas: "ROAS", acos: "ACoS", acos_l: "ACoS · spend / sales", conv: "Conversions", cpc: "Avg. CPC", cvr: "Conversion rate", panier: "Attributed basket", cpa: "Cost / conversion",
    clics: "Clicks", impr: "Impressions", ctr: "CTR", mois: "Month", vs: "vs", meme_periode: "same period", marginal: "Marginal ROAS", marginal_sub: "€ of sales per extra € vs",
    constats: "Key takeaways", mensuel: "Month by month", dep_mens: "Monthly spend", ca_mens: "Monthly attributed sales", roas_annee: "Monthly ROAS, year over year", detail_mens: "Monthly detail",
    partiel: "partial", categories: "Categories", dep_cat: "Spend by category", roas_cat: "ROAS by category and month", roas_cat_sub: "Red: ROAS < 2. Empty: no spend.",
    produits: "Products", produits_sub: "Year to date, recommended action based on ROAS", toutes: "All", top15: "Monthly ROAS of the 15 most funded products",
    produit: "Product", categorie: "Category", canal: "Channel", part: "% budget", action: "Action", roas_mois: "ROAS current month",
    acc: "Scale up", maint: "Keep", optim: "Optimise", couper: "Cut", faible: "Low volume",
    regle_action: "Scale up: ROAS ≥ 10 · Keep: 6–10 · Optimise: 3–6 · Cut: < 3 · Low volume: < €150 spent",
    jours: "Day by day", bf_roas: "Daily ROAS around Black Friday", bf_dep: "Daily spend around Black Friday", bf_sub: "Days counted from Black Friday. Shaded: Black Friday → Cyber Monday.",
    semaine: "ROAS by day of week", mots: "Keywords", mots_top: "Most funded keywords", mot: "Keyword", statut: "Status", sans_conv: "0 conversion",
    budgets: "Budgets", rythme: "Pace this month", par_jour: "/day", reste: "Left", rallonge: "Top-up", plan: "Action plan", methode: "Method and definitions",
    jours_sem: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"], pas_detail_titre: "Detail not available yet",
    pas_detail: "For this marketplace the app only has the marketing budget file line (above). To get the same level of detail as Leroy Merlin France (monthly, products, keywords, daily), its ad platform reports need to be imported.",
    ligne_budget: "Marketing budget file line", src_budget: "all formats, January–June 2026", dispositif: "Format", source: "Source",
  },
  es: {
    fermer: "Cerrar", donnees_au: "Datos al", perimetre: "Ámbito", total: "Total", p3: "3P · marketplace", p1: "1P · revendedor",
    depense: "Gasto", ca: "Facturación atribuida", roas: "ROAS", acos: "ACoS", acos_l: "ACoS · gasto / facturación", conv: "Conversiones", cpc: "CPC medio", cvr: "Tasa de conversión", panier: "Cesta atribuida", cpa: "Coste / conversión",
    clics: "Clics", impr: "Impresiones", ctr: "CTR", mois: "Mes", vs: "vs", meme_periode: "mismo periodo", marginal: "ROAS marginal", marginal_sub: "€ de facturación por € añadido vs",
    constats: "Lo esencial", mensuel: "Mes a mes", dep_mens: "Gasto mensual", ca_mens: "Facturación atribuida mensual", roas_annee: "ROAS mensual, interanual", detail_mens: "Detalle mensual",
    partiel: "parcial", categories: "Categorías", dep_cat: "Gasto por categoría", roas_cat: "ROAS por categoría y mes", roas_cat_sub: "Rojo: ROAS < 2. Vacío: sin gasto.",
    produits: "Productos", produits_sub: "Acumulado del año, acción recomendada según el ROAS", toutes: "Todas", top15: "ROAS mensual de los 15 productos con más inversión",
    produit: "Producto", categorie: "Categoría", canal: "Canal", part: "% presupuesto", action: "Acción", roas_mois: "ROAS mes en curso",
    acc: "Acelerar", maint: "Mantener", optim: "Optimizar", couper: "Cortar", faible: "Volumen bajo",
    regle_action: "Acelerar: ROAS ≥ 10 · Mantener: 6–10 · Optimizar: 3–6 · Cortar: < 3 · Volumen bajo: < 150 € gastados",
    jours: "Día a día", bf_roas: "ROAS diario en torno al Black Friday", bf_dep: "Gasto diario en torno al Black Friday", bf_sub: "Días contados desde el Black Friday. Zona gris: Black Friday → Cyber Monday.",
    semaine: "ROAS por día de la semana", mots: "Palabras clave", mots_top: "Palabras clave con más inversión", mot: "Palabra clave", statut: "Estado", sans_conv: "0 conversiones",
    budgets: "Presupuestos", rythme: "Ritmo del mes", par_jour: "/día", reste: "Resta", rallonge: "Ampliación", plan: "Plan de acción", methode: "Método y definiciones",
    jours_sem: ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"], pas_detail_titre: "Detalle aún no disponible",
    pas_detail: "Para este marketplace la app solo tiene la línea del archivo de presupuesto de marketing (arriba). Para tener el mismo detalle que Leroy Merlin Francia (mes a mes, productos, palabras clave, día a día), hay que importar los informes de su plataforma publicitaria.",
    ligne_budget: "Línea del archivo de presupuesto de marketing", src_budget: "todos los formatos, enero–junio 2026", dispositif: "Formato", source: "Fuente",
  },
  zh: {
    fermer: "关闭", donnees_au: "数据截至", perimetre: "范围", total: "合计", p3: "3P · 平台卖家", p1: "1P · 零售商",
    depense: "花费", ca: "归因销售额", roas: "ROAS", acos: "ACoS", acos_l: "ACoS · 花费 / 归因销售额", conv: "转化", cpc: "平均 CPC", cvr: "转化率", panier: "归因客单价", cpa: "单次转化成本",
    clics: "点击", impr: "曝光", ctr: "点击率", mois: "月份", vs: "对比", meme_periode: "同期", marginal: "边际 ROAS", marginal_sub: "每增加 1 € 带来的销售额，对比",
    constats: "要点", mensuel: "按月", dep_mens: "月度花费", ca_mens: "月度归因销售额", roas_annee: "月度 ROAS 同比", detail_mens: "月度明细",
    partiel: "部分", categories: "品类", dep_cat: "按品类花费", roas_cat: "按品类和月份的 ROAS", roas_cat_sub: "红色：ROAS < 2。空白：无花费。",
    produits: "产品", produits_sub: "年初至今，按 ROAS 给出建议", toutes: "全部", top15: "投入最多的 15 个产品的月度 ROAS",
    produit: "产品", categorie: "品类", canal: "渠道", part: "预算占比", action: "建议", roas_mois: "本月 ROAS",
    acc: "加大投入", maint: "保持", optim: "优化", couper: "停投", faible: "量小",
    regle_action: "加大投入：ROAS ≥ 10 · 保持：6–10 · 优化：3–6 · 停投：< 3 · 量小：花费 < 150 €",
    jours: "按天", bf_roas: "黑色星期五前后的每日 ROAS", bf_dep: "黑色星期五前后的每日花费", bf_sub: "以黑色星期五为起点计天。灰色区域：黑色星期五 → 网络星期一。",
    semaine: "按星期几的 ROAS", mots: "关键词", mots_top: "投入最多的关键词", mot: "关键词", statut: "状态", sans_conv: "0 转化",
    budgets: "预算", rythme: "本月节奏", par_jour: "/天", reste: "剩余", rallonge: "追加", plan: "行动计划", methode: "方法与定义",
    jours_sem: ["周一", "周二", "周三", "周四", "周五", "周六", "周日"], pas_detail_titre: "暂无明细",
    pas_detail: "该平台目前只有营销预算文件中的一行数据（见上）。要获得与法国 Leroy Merlin 相同的明细（按月、产品、关键词、按天），需要导入其广告平台的报告。",
    ligne_budget: "营销预算文件中的一行", src_budget: "所有形式，2026年1月至6月", dispositif: "形式", source: "来源",
  },
};
const MOIS = {
  fr: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  es: ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sept.", "oct.", "nov.", "dic."],
  zh: ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"],
};
const LOC = { fr: "fr-FR", en: "en-GB", es: "es-ES", zh: "zh-CN" };

// ------------------------------------------------------------------ calculs
const CATS = ["Radiateurs inertie", "Sèche-serviettes", "Ventilateurs plafond", "Chauffage mobile/appoint", "Autres"];
const catKey = (c) => (CATS.includes(c) ? c : "Autres");
const somme = (rows) => rows.reduce((a, r) => ({ spend: a.spend + (r.spend || 0), sales: a.sales + (r.sales || 0), clicks: a.clicks + (r.clicks || 0), impr: a.impr + (r.impr || 0), conv: a.conv + (r.conv || 0) }), { spend: 0, sales: 0, clicks: 0, impr: 0, conv: 0 });
const ratios = (s) => ({ ...s, roas: s.spend ? s.sales / s.spend : null, acos: s.sales ? s.spend / s.sales : null, cpc: s.clicks ? s.spend / s.clicks : null, cvr: s.clicks ? s.conv / s.clicks : null, aov: s.conv ? s.sales / s.conv : null, cpa: s.conv ? s.spend / s.conv : null, ctr: s.impr ? s.clicks / s.impr : null });
const ajouterJours = (iso, n) => { const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ecartJours = (a, b) => Math.round((Date.parse(a + "T00:00:00Z") - Date.parse(b + "T00:00:00Z")) / 864e5);
// graduations rondes (pas de 1, 2, 2,5 ou 5 × 10^n) pour les axes en euros
function axe(max) {
  if (!(max > 0)) return { domain: [0, 1], ticks: [0, 1] };
  const brut = max / 4, p = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 2.5, 5, 10].map((m) => m * p).find((x) => x >= brut);
  const haut = Math.ceil(max / pas - 1e-9) * pas, ticks = [];
  for (let v = 0; v <= haut + pas / 1e6; v += pas) ticks.push(+v.toFixed(6));
  return { domain: [0, haut], ticks };
}
const actionDe = (p) => (p.spend < 150 ? "faible" : p.roas >= 10 ? "acc" : p.roas >= 6 ? "maint" : p.roas >= 3 ? "optim" : "couper");

function analyser(D) {
  const an = +D.donnees_au.slice(0, 4), anP = an - 1;
  const mois = [...new Set(D.mensuel.map((r) => r.mois))].sort();
  const parScope = (scope) => mois.map((m) => ({ mois: m, ...ratios(somme(D.mensuel.filter((r) => r.mois === m && (scope === "Total" || r.pf === scope)))) }));
  const comparables = (rows) => {
    const mm = rows.filter((r) => r.mois.startsWith(String(an)) && r.mois !== D.mois_partiel && r.spend > 0).map((r) => r.mois.slice(5)).filter((m) => rows.some((r) => r.mois === `${anP}-${m}` && r.spend > 0));
    const cur = ratios(somme(rows.filter((r) => mm.includes(r.mois.slice(5)) && r.mois.startsWith(String(an)))));
    const prev = ratios(somme(rows.filter((r) => mm.includes(r.mois.slice(5)) && r.mois.startsWith(String(anP)))));
    return { mm, cur, prev };
  };
  const produits = D.produits.map((p) => { const r = ratios(p); return { ...r, action: actionDe(r), nov_roas: p.nov_spend ? p.nov_sales / p.nov_spend : null, part: 0 }; }).sort((a, b) => b.spend - a.spend);
  const totP = produits.reduce((a, p) => a + p.spend, 0) || 1;
  produits.forEach((p) => { p.part = p.spend / totP; });
  const jours = D.quotidien.map(([jour, spend, sales, clicks, conv]) => ({ jour, spend, sales, clicks, conv }));
  return { an, anP, mois, parScope, comparables, produits, jours };
}

function sommeJours(jours, de, a) { return ratios(somme(jours.filter((j) => j.jour >= de && j.jour <= a))); }

// constats et plan d'action calculés sur les données (rien d'écrit en dur : ils suivent chaque nouvel import)
function lecture(D, A, lang, f) {
  const fr = lang === "fr", es = lang === "es";
  const L3 = (a, b, c) => (fr ? a : es ? c : b);
  const constats = [], plan = [];
  const total = A.parScope("Total");
  const ytd = ratios(somme(total.filter((r) => r.mois.startsWith(String(A.an)))));
  // 1. budgets
  const dernierJour = D.donnees_au, jourDuMois = +dernierJour.slice(8, 10);
  const rythme = (pf) => { const r = D.mensuel.find((x) => x.mois === D.mois_partiel && x.pf === pf); return r && jourDuMois ? r.spend / jourDuMois : null; };
  const b3 = D.budgets.find((b) => b.pf === "3P"), b1 = D.budgets.find((b) => b.pf === "1P");
  const bfProchain = D.black_friday && D.black_friday[String(A.an)];
  if (b3 && b3.budget) {
    const reste3 = b3.budget - b3.depense, r3 = rythme("3P"), reste1 = b1 ? b1.budget - b1.depense : null;
    const jRallonge = D.rallonge && r3 ? Math.round(D.rallonge.montant / r3) : null;
    const tendu = reste3 / b3.budget < 0.1;
    constats.push({ ton: tendu ? "bad" : "ok", tag: L3("Budget", "Budget", "Presupuesto"),
      titre: tendu ? L3("Budget 3P quasi épuisé", "3P budget almost used up", "Presupuesto 3P casi agotado") : L3("Budget 3P sous contrôle", "3P budget under control", "Presupuesto 3P bajo control"),
      texte: L3(`Il reste ${f.eur(reste3)} sur ${f.eur(b3.budget)} en 3P${reste1 != null ? ` et ${f.eur(reste1)} en 1P` : ""} au ${f.date(dernierJour)}.`, `${f.eur(reste3)} left out of ${f.eur(b3.budget)} on 3P${reste1 != null ? ` and ${f.eur(reste1)} on 1P` : ""} as of ${f.date(dernierJour)}.`, `Quedan ${f.eur(reste3)} de ${f.eur(b3.budget)} en 3P${reste1 != null ? ` y ${f.eur(reste1)} en 1P` : ""} al ${f.date(dernierJour)}.`)
        + (jRallonge ? L3(` La rallonge de ${f.eur(D.rallonge.montant)} tient environ ${jRallonge} jours au rythme 3P du mois (${f.eur(r3)}/jour).`, ` The ${f.eur(D.rallonge.montant)} top-up lasts about ${jRallonge} days at this month's 3P pace (${f.eur(r3)}/day).`, ` La ampliación de ${f.eur(D.rallonge.montant)} dura unos ${jRallonge} días al ritmo 3P del mes (${f.eur(r3)}/día).`) : "") });
    if (tendu) plan.push(L3(`Sécuriser la fin d'année : vérifier avec la régie que la rallonge a pris le relais (3P restant : ${f.eur(reste3)}), lever le plafond journalier jusqu'au Cyber Monday puis redescendre après.`, `Secure year-end: check with the ad platform that the top-up has taken over (3P left: ${f.eur(reste3)}), lift the daily cap until Cyber Monday, then scale down.`, `Asegurar el fin de año: comprobar con la plataforma que la ampliación ha tomado el relevo (3P restante: ${f.eur(reste3)}), quitar el tope diario hasta el Cyber Monday y bajar después.`));
  }
  // 2. efficacité année sur année
  const C = A.comparables(total);
  if (C.mm.length >= 3 && C.prev.spend > 0) {
    const vS = C.cur.spend / C.prev.spend - 1, vC = C.cur.sales / C.prev.sales - 1, marg = (C.cur.sales - C.prev.sales) / (C.cur.spend - C.prev.spend);
    const periode = `${f.mois(C.mm[0])}–${f.mois(C.mm[C.mm.length - 1])}`;
    const cher = C.cur.roas < C.prev.roas * 0.85;
    constats.push({ ton: cher ? "bad" : "ok", tag: L3("Efficacité", "Efficiency", "Eficiencia"),
      titre: cher ? L3("La croissance a été achetée cher", "Growth was bought at a high price", "El crecimiento ha salido caro") : L3("Efficacité maintenue", "Efficiency maintained", "Eficiencia mantenida"),
      texte: L3(`${periode} : dépense ${f.var(vS)}, CA attribué ${f.var(vC)} sur un an. ROAS ${f.x(C.prev.roas)} → ${f.x(C.cur.roas)}${isFinite(marg) && C.cur.spend > C.prev.spend ? ` ; chaque euro ajouté a rapporté ${f.eur2(marg)}` : ""}.`, `${periode}: spend ${f.var(vS)}, attributed sales ${f.var(vC)} year over year. ROAS ${f.x(C.prev.roas)} → ${f.x(C.cur.roas)}${isFinite(marg) && C.cur.spend > C.prev.spend ? `; each extra euro brought ${f.eur2(marg)}` : ""}.`, `${periode}: gasto ${f.var(vS)}, facturación atribuida ${f.var(vC)} interanual. ROAS ${f.x(C.prev.roas)} → ${f.x(C.cur.roas)}${isFinite(marg) && C.cur.spend > C.prev.spend ? `; cada euro añadido aportó ${f.eur2(marg)}` : ""}.`) });
  }
  // 3. gaspillage : produits à ROAS < 2
  const faibles = A.produits.filter((p) => p.spend >= 150 && (p.roas || 0) < 2).sort((a, b) => b.spend - a.spend);
  if (faibles.length) {
    const dep = faibles.reduce((a, p) => a + p.spend, 0), ca = faibles.reduce((a, p) => a + p.sales, 0);
    const reste = A.produits.filter((p) => !faibles.includes(p)), roasHors = reste.reduce((a, p) => a + p.sales, 0) / (reste.reduce((a, p) => a + p.spend, 0) || 1);
    const noms = [...new Set(faibles.map((p) => p.gamme))].slice(0, 4).join(", ");
    constats.push({ ton: dep / ytd.spend > 0.1 ? "bad" : "warn", tag: L3("Gaspillage", "Waste", "Despilfarro"),
      titre: L3(`${faibles.length} produits à ROAS < 2`, `${faibles.length} products with ROAS < 2`, `${faibles.length} productos con ROAS < 2`),
      texte: L3(`${f.eur(dep)} dépensés (${f.pct(dep / ytd.spend)} du budget ${A.an}) pour ${f.eur(ca)} de CA, surtout ${noms}. Sans eux, le ROAS ${A.an} serait de ${f.x(roasHors)}.`, `${f.eur(dep)} spent (${f.pct(dep / ytd.spend)} of the ${A.an} budget) for ${f.eur(ca)} of sales, mainly ${noms}. Without them, ${A.an} ROAS would be ${f.x(roasHors)}.`, `${f.eur(dep)} gastados (${f.pct(dep / ytd.spend)} del presupuesto ${A.an}) para ${f.eur(ca)} de facturación, sobre todo ${noms}. Sin ellos, el ROAS ${A.an} sería ${f.x(roasHors)}.`) });
    plan.push(L3(`Couper les produits à ROAS < 2 (${noms}…) : ${f.eur(dep)} engagés cette année.`, `Cut products with ROAS < 2 (${noms}…): ${f.eur(dep)} committed this year.`, `Cortar los productos con ROAS < 2 (${noms}…): ${f.eur(dep)} comprometidos este año.`));
  }
  // 4. mois en cours vs même jours N-1
  if (D.mois_partiel) {
    const debut = `${D.mois_partiel}-01`, debP = `${A.anP}${debut.slice(4)}`, finP = `${A.anP}${dernierJour.slice(4)}`;
    const cur = ratios(somme(total.filter((r) => r.mois === D.mois_partiel))), prev = sommeJours(A.jours, debP, finP);
    if (prev.spend > 0) {
      const bon = cur.roas >= prev.roas;
      constats.push({ ton: bon ? "ok" : "warn", tag: L3("Mois en cours", "This month", "Mes en curso"),
        titre: bon ? L3(`${f.moisLong(D.mois_partiel)} : bonne dynamique`, `${f.moisLong(D.mois_partiel)}: good momentum`, `${f.moisLong(D.mois_partiel)}: buena dinámica`) : L3(`${f.moisLong(D.mois_partiel)} : rendement en baisse`, `${f.moisLong(D.mois_partiel)}: returns down`, `${f.moisLong(D.mois_partiel)}: rendimiento a la baja`),
        texte: L3(`Du 1er au ${f.date(dernierJour)} : ROAS ${f.x(cur.roas)} contre ${f.x(prev.roas)} sur les mêmes jours de ${A.anP}, CA attribué ${f.var(cur.sales / prev.sales - 1)}, taux de conversion ${f.pct(cur.cvr)} (${f.pct(prev.cvr)} en ${A.anP}), CPC ${f.var(cur.cpc / prev.cpc - 1)}.`, `1st to ${f.date(dernierJour)}: ROAS ${f.x(cur.roas)} vs ${f.x(prev.roas)} on the same days of ${A.anP}, attributed sales ${f.var(cur.sales / prev.sales - 1)}, conversion rate ${f.pct(cur.cvr)} (${f.pct(prev.cvr)} in ${A.anP}), CPC ${f.var(cur.cpc / prev.cpc - 1)}.`, `Del 1 al ${f.date(dernierJour)}: ROAS ${f.x(cur.roas)} frente a ${f.x(prev.roas)} los mismos días de ${A.anP}, facturación atribuida ${f.var(cur.sales / prev.sales - 1)}, conversión ${f.pct(cur.cvr)} (${f.pct(prev.cvr)} en ${A.anP}), CPC ${f.var(cur.cpc / prev.cpc - 1)}.`) });
    }
  }
  // 5. Black Friday de l'an dernier
  const bfP = D.black_friday && D.black_friday[String(A.anP)];
  if (bfP && A.jours.some((j) => j.jour === bfP)) {
    const sem = sommeJours(A.jours, ajouterJours(bfP, -3), ajouterJours(bfP, 4)), avant = sommeJours(A.jours, ajouterJours(bfP, -13), ajouterJours(bfP, -4)), apres = sommeJours(A.jours, ajouterJours(bfP, 5), ajouterJours(bfP, 16));
    constats.push({ ton: "warn", tag: "Black Friday",
      titre: L3(`Black Friday ${A.anP} : la semaine la plus rentable`, `Black Friday ${A.anP}: the most profitable week`, `Black Friday ${A.anP}: la semana más rentable`),
      texte: L3(`Semaine du Black Friday ${A.anP} : ROAS ${f.x(sem.roas)} avec ${f.eur(sem.spend / 8)}/jour, contre ${f.x(avant.roas)} et ${f.eur(avant.spend / 10)}/jour les 10 jours d'avant. Ensuite, ROAS ${f.x(apres.roas)}.`, `Black Friday ${A.anP} week: ROAS ${f.x(sem.roas)} at ${f.eur(sem.spend / 8)}/day, vs ${f.x(avant.roas)} and ${f.eur(avant.spend / 10)}/day in the 10 days before. Afterwards, ROAS ${f.x(apres.roas)}.`, `Semana del Black Friday ${A.anP}: ROAS ${f.x(sem.roas)} con ${f.eur(sem.spend / 8)}/día, frente a ${f.x(avant.roas)} y ${f.eur(avant.spend / 10)}/día los 10 días previos. Después, ROAS ${f.x(apres.roas)}.`) });
    if (bfProchain && ecartJours(bfProchain, dernierJour) > -5) plan.push(L3(`Concentrer le budget du ${f.date(ajouterJours(bfProchain, -3))} au ${f.date(ajouterJours(bfProchain, 4))} (ROAS ${f.x(sem.roas)} l'an dernier) plutôt que la semaine d'avant (${f.x(avant.roas)}), puis baisser fortement (${f.x(apres.roas)} ensuite).`, `Concentrate budget from ${f.date(ajouterJours(bfProchain, -3))} to ${f.date(ajouterJours(bfProchain, 4))} (ROAS ${f.x(sem.roas)} last year) rather than the week before (${f.x(avant.roas)}), then cut back (${f.x(apres.roas)} afterwards).`, `Concentrar el presupuesto del ${f.date(ajouterJours(bfProchain, -3))} al ${f.date(ajouterJours(bfProchain, 4))} (ROAS ${f.x(sem.roas)} el año pasado) en lugar de la semana anterior (${f.x(avant.roas)}), y bajar después (${f.x(apres.roas)}).`));
  }
  // 6. locomotive
  const parGamme = {};
  A.produits.forEach((p) => { const g = (parGamme[p.gamme] ||= { gamme: p.gamme, spend: 0, sales: 0, clicks: 0, conv: 0 }); g.spend += p.spend; g.sales += p.sales; g.clicks += p.clicks; g.conv += p.conv; });
  const gammes = Object.values(parGamme).map(ratios);
  const loco = gammes.sort((a, b) => b.sales - a.sales)[0];
  if (loco) {
    const pS = loco.sales / ytd.sales, pD = loco.spend / ytd.spend;
    constats.push({ ton: "ok", tag: L3("Locomotive", "Top range", "Gama líder"),
      titre: L3(`${loco.gamme} : ${f.pct(pS)} du CA attribué`, `${loco.gamme}: ${f.pct(pS)} of attributed sales`, `${loco.gamme}: ${f.pct(pS)} de la facturación atribuida`),
      texte: L3(`Pour ${f.pct(pD)} du budget : ROAS ${f.x(loco.roas)}, conversion ${f.pct(loco.cvr)} (moyenne ${f.pct(ytd.cvr)}).`, `For ${f.pct(pD)} of the budget: ROAS ${f.x(loco.roas)}, conversion ${f.pct(loco.cvr)} (average ${f.pct(ytd.cvr)}).`, `Con el ${f.pct(pD)} del presupuesto: ROAS ${f.x(loco.roas)}, conversión ${f.pct(loco.cvr)} (media ${f.pct(ytd.cvr)}).`) });
  }
  const fortes = gammes.filter((g) => g.spend >= 500 && g.roas >= 10).sort((a, b) => b.spend - a.spend).slice(0, 5).map((g) => g.gamme);
  if (fortes.length) plan.push(L3(`Réallouer vers les gammes à ROAS ≥ 10 : ${fortes.join(", ")}.`, `Shift budget to ranges with ROAS ≥ 10: ${fortes.join(", ")}.`, `Reasignar a las gamas con ROAS ≥ 10: ${fortes.join(", ")}.`));
  // 7. saisonnalité : catégories sous ROAS 3 sur les 3 derniers mois complets
  const complets = A.mois.filter((m) => m !== D.mois_partiel).slice(-3);
  CATS.forEach((c) => {
    const s = ratios(somme(D.categories.filter((r) => complets.includes(r.mois) && catKey(r.categorie) === c)));
    if (s.spend > 1000 && s.roas < 3) plan.push(L3(`${c} : ${f.eur(s.spend)} dépensés sur les 3 derniers mois à ROAS ${f.x(s.roas)} — limiter à sa saison et plafonner le budget mensuel.`, `${c}: ${f.eur(s.spend)} spent over the last 3 months at ROAS ${f.x(s.roas)} — restrict to its season and cap the monthly budget.`, `${c}: ${f.eur(s.spend)} gastados en los 3 últimos meses con ROAS ${f.x(s.roas)} — limitar a su temporada y topar el presupuesto mensual.`));
  });
  // 8. mots-clés et jour de semaine
  const K = D.mots_cles_resume;
  if (K && K.spend) plan.push(L3(`Exclure les ${f.int(K.n_sans_conv)} mots-clés sans conversion (${f.pct(K.spend_sans_conv / K.spend)} de la dépense mots-clés).`, `Exclude the ${f.int(K.n_sans_conv)} keywords with no conversion (${f.pct(K.spend_sans_conv / K.spend)} of keyword spend).`, `Excluir las ${f.int(K.n_sans_conv)} palabras clave sin conversión (${f.pct(K.spend_sans_conv / K.spend)} del gasto en palabras clave).`));
  const sem = [0, 1, 2, 3, 4, 5, 6].map((d) => ({ d, ...ratios(somme(A.jours.filter((j) => j.jour.startsWith(String(A.an)) && (new Date(j.jour + "T00:00:00Z").getUTCDay() + 6) % 7 === d))) }));
  const meilleur = sem.reduce((a, b) => (b.roas > a.roas ? b : a)), pire = sem.reduce((a, b) => (b.roas < a.roas ? b : a));
  if (meilleur.roas && pire.roas && meilleur.roas / pire.roas > 1.15) plan.push(L3(`Moduler les enchères selon le jour : ROAS ${f.x(pire.roas)} le ${f.jourSem(pire.d)} contre ${f.x(meilleur.roas)} le ${f.jourSem(meilleur.d)}.`, `Adjust bids by day: ROAS ${f.x(pire.roas)} on ${f.jourSem(pire.d)} vs ${f.x(meilleur.roas)} on ${f.jourSem(meilleur.d)}.`, `Modular las pujas según el día: ROAS ${f.x(pire.roas)} el ${f.jourSem(pire.d)} frente a ${f.x(meilleur.roas)} el ${f.jourSem(meilleur.d)}.`));
  plan.push(L3("Pour l'an prochain : ROAS plancher par catégorie, ROAS marginal d'au moins 4 avant toute rallonge, budget ventilé par mois selon la saison, et un reporting du CA par produit vendu (pas seulement le CA de marque).", "For next year: a ROAS floor per category, a marginal ROAS of at least 4 before any top-up, a monthly budget split by season, and sales reporting per product sold (not only brand sales).", "Para el próximo año: ROAS mínimo por categoría, ROAS marginal de al menos 4 antes de cualquier ampliación, presupuesto mensual según temporada e informe de facturación por producto vendido (no solo de marca)."));
  return { constats, plan, ytd, C, semaine: sem };
}

// ------------------------------------------------------------------ petits éléments d'interface
const Box = ({ children, className = "", style }) => <div className={`rounded-2xl border p-4 sm:p-5 ${className}`} style={{ background: VZ.card, borderColor: VZ.line, ...style }}>{children}</div>;
const H = ({ children, sub }) => (<div className="mb-3"><h3 className="text-[13.5px] font-semibold">{children}</h3>{sub && <p className="text-[11.5px] mt-1 leading-relaxed" style={{ color: VZ.muted }}>{sub}</p>}</div>);
const Zone = ({ children }) => (<div className="flex items-center gap-3 mt-8 mb-3"><span className="text-[10px] uppercase tracking-[0.22em] font-bold shrink-0" style={{ color: ORANGE }}>{children}</span><span className="flex-1 h-px" style={{ background: VZ.line }} /></div>);
function Stat({ label, value, sub, color }) {
  return (
    <div className="rounded-xl p-3.5 min-w-0 border" style={{ background: VZ.card, borderColor: VZ.line }}>
      <div className="text-[10.5px] uppercase tracking-wider leading-snug" style={{ color: VZ.muted }}>{label}</div>
      <div className="text-[19px] font-bold mt-1 tabular-nums whitespace-nowrap" style={{ color: color || VZ.text }}>{value}</div>
      {sub && <div className="text-[11px] mt-0.5" style={{ color: VZ.dim }}>{sub}</div>}
    </div>
  );
}
function Chips({ items, value, onChange, label }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl p-1 text-xs" style={{ background: VZ.bg }} role="tablist" aria-label={label}>
      {items.map(([id, lab]) => (
        <button key={id} role="tab" aria-selected={value === id} onClick={() => onChange(id)} className="px-3 py-1.5 rounded-lg whitespace-nowrap transition"
          style={{ background: value === id ? ORANGE : "transparent", color: value === id ? "#fff" : VZ.muted, fontWeight: value === id ? 600 : 400 }}>{lab}</button>
      ))}
    </div>
  );
}
const tipStyle = { background: "#1E1B15", border: `1px solid ${VZ.line}`, borderRadius: 12, color: VZ.text, fontSize: 12, padding: "8px 10px", boxShadow: "0 8px 24px rgba(0,0,0,.45)" };
const TT = { contentStyle: tipStyle, itemStyle: { color: VZ.text, padding: 0, fontSize: 12 }, labelStyle: { color: VZ.muted, fontSize: 11, marginBottom: 2 }, wrapperStyle: { zIndex: 20, outline: "none" }, cursor: { fill: "rgba(255,255,255,0.04)" } };
const axisTick = { fill: VZ.muted, fontSize: 11 };
const toneRoas = (v) => (v == null || !isFinite(v) ? VZ.muted : v >= 8 ? VZ.good : v >= 3 ? VZ.warn : VZ.bad);
const ACTION_COUL = { acc: VZ.good, maint: VZ.muted, optim: VZ.warn, couper: VZ.bad, faible: VZ.dim };
function heat(v) {
  if (v == null || !isFinite(v)) return {};
  if (v < 2) return { background: "rgba(255,77,79,0.22)", color: VZ.bad };
  return { background: `rgba(255,90,31,${(0.08 + Math.min(1, v / 15) * 0.5).toFixed(2)})` };
}
const Tableau = ({ children }) => <div className="overflow-auto rounded-xl border" style={{ borderColor: VZ.line, maxHeight: 460 }}><table className="w-full text-[11.5px] tabular-nums" style={{ borderCollapse: "collapse" }}>{children}</table></div>;
const Th = ({ children, l, style }) => <th className={`sticky top-0 px-2.5 py-2 font-semibold whitespace-nowrap ${l ? "text-left" : "text-right"}`} style={{ background: VZ.card, color: VZ.muted, borderBottom: `1px solid ${VZ.line}`, zIndex: 1, ...style }}>{children}</th>;
const Td = ({ children, l, style, wrap }) => <td className={`px-2.5 py-1.5 ${l ? "text-left" : "text-right"} ${wrap ? "" : "whitespace-nowrap"}`} style={{ borderBottom: `1px solid ${VZ.line}`, ...style }}>{children}</td>;

// ------------------------------------------------------------------ composant principal
export function AdsDetailMarketplace({ nom, ligne, lang = "fr", facteur = 1, onClose }) {
  const D = DETAILS[nom];
  const t = TX[lang] || TX.fr;
  const loc = LOC[lang] || "fr-FR";
  const MO = MOIS[lang] || MOIS.fr;
  const f = useMemo(() => {
    const n = (v, d = 0) => (v == null || !isFinite(v) ? "–" : v.toLocaleString(loc, { maximumFractionDigits: d, minimumFractionDigits: d }));
    return {
      eur: (v) => (v == null || !isFinite(v) ? "–" : n(v * facteur) + " €"), eur2: (v) => (v == null || !isFinite(v) ? "–" : n(v, 2) + " €"), eurU: (v) => (v == null || !isFinite(v) ? "–" : n(v * facteur, 2) + " €"),
      k: (v) => (v == null || !isFinite(v) ? "–" : Math.abs(v * facteur) >= 1000 ? n((v * facteur) / 1000, Math.abs(v * facteur) >= 1e5 || (v * facteur) % 1000 === 0 ? 0 : 1).replace(/[,.]0$/, "") + " k€" : n(v * facteur) + " €"),
      kBrut: (v) => (Math.abs(v) >= 1000 ? (v / 1000).toLocaleString(loc, { maximumFractionDigits: 1 }) + " k" : String(Math.round(v))),
      x: (v) => n(v, 1), pct: (v) => (v == null || !isFinite(v) ? "–" : n(v * 100, 1) + " %"), int: (v) => n(v),
      var: (v) => (v == null || !isFinite(v) ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + n(Math.abs(v * 100)) + " %"),
      mois: (mm) => MO[+mm - 1], moisCourt: (m) => `${MO[+m.slice(5, 7) - 1]} ${m.slice(2, 4)}`, moisLong: (m) => `${MO[+m.slice(5, 7) - 1].replace(".", "")} ${m.slice(0, 4)}`,
      date: (iso) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`, jourSem: (d) => (lang === "fr" ? ["lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi", "dimanche"] : lang === "es" ? ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] : ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"])[d],
    };
  }, [loc, facteur, lang]);
  const [scope, setScope] = useState("Total");
  const [act, setAct] = useState("tous");

  useEffect(() => {
    const k = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = prev; };
  }, [onClose]);

  const A = useMemo(() => (D ? analyser(D) : null), [D]);
  const Lx = useMemo(() => (D ? lecture(D, A, lang, f) : null), [D, A, lang, f]);

  const entete = (
    <div className="sticky top-0 z-10 flex items-start justify-between gap-3 px-4 sm:px-6 py-3.5 border-b" style={{ background: "rgba(10,9,8,0.92)", backdropFilter: "blur(12px)", borderColor: VZ.line }}>
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.2em] font-bold" style={{ color: ORANGE }}>Campagnes Ads</div>
        <h2 className="text-[17px] sm:text-[19px] font-bold truncate">{D ? D.titre : nom}</h2>
        {D && <div className="text-[11px] mt-0.5" style={{ color: VZ.muted }}>{D.dispositif} · {t.donnees_au} {new Date(D.donnees_au + "T12:00:00").toLocaleDateString(loc)}</div>}
      </div>
      <button onClick={onClose} aria-label={t.fermer} className="shrink-0 rounded-full w-9 h-9 flex items-center justify-center text-[18px]" style={{ background: VZ.card, border: `1px solid ${VZ.line}`, color: VZ.text }}>×</button>
    </div>
  );

  const ligneBudget = ligne && (
    <Box className="mb-4">
      <H sub={t.src_budget}>{t.ligne_budget}</H>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Stat label={t.depense} value={f.eur(ligne.spend)} />
        <Stat label={t.ca} value={f.eur(ligne.ca_genere)} />
        <Stat label={t.roas} value={ligne.roas ? f.x(ligne.roas) : "–"} color={toneRoas(ligne.roas)} />
        <Stat label="Budget" value={ligne.budget_annuel ? f.eur(ligne.budget_annuel) : "–"} sub={ligne.pct_budget != null ? `${f.x(ligne.pct_budget)} %` : null} />
      </div>
    </Box>
  );

  let corps;
  if (!D) {
    corps = (<>{ligneBudget}<Box><H>{t.pas_detail_titre}</H><p className="text-[12.5px] leading-relaxed" style={{ color: VZ.muted }}>{t.pas_detail}</p></Box></>);
  } else {
    const rows = A.parScope(scope);
    const an = A.an, anP = A.anP;
    const ytd = ratios(somme(rows.filter((r) => r.mois.startsWith(String(an)))));
    const C = A.comparables(rows);
    const marg = C.prev.spend && C.cur.spend > C.prev.spend ? (C.cur.sales - C.prev.sales) / (C.cur.spend - C.prev.spend) : null;
    const per = C.mm.length ? `${f.mois(C.mm[0])}–${f.mois(C.mm[C.mm.length - 1])} ${anP}` : "";
    const cmp = (v) => (C.mm.length ? `${t.vs} ${per} : ${v}` : null);
    const graphe = rows.filter((r) => r.spend > 0 || r.sales > 0).map((r) => ({ ...r, lab: f.moisCourt(r.mois), partiel: r.mois === D.mois_partiel }));
    const roasAnnee = Array.from({ length: 12 }, (_, i) => {
      const mm = String(i + 1).padStart(2, "0");
      const a = rows.find((r) => r.mois === `${anP}-${mm}`), b = rows.find((r) => r.mois === `${an}-${mm}`);
      return { m: MO[i], [anP]: a && a.spend ? +a.roas.toFixed(2) : null, [an]: b && b.spend ? +b.roas.toFixed(2) : null };
    });
    // catégories
    const moisCat = [...new Set(D.categories.map((r) => r.mois))].sort();
    const catGraphe = moisCat.map((m) => { const o = { lab: f.moisCourt(m) }; CATS.forEach((c) => { o[c] = D.categories.filter((r) => r.mois === m && catKey(r.categorie) === c).reduce((a, r) => a + r.spend, 0) * facteur || null; }); return o; });
    const catMax = Math.max(...catGraphe.map((o) => CATS.reduce((a, c) => a + (o[c] || 0), 0)));
    const catRoas = (c, m) => { const s = ratios(somme(D.categories.filter((r) => r.mois === m && catKey(r.categorie) === c))); return s.spend > 0 ? s.roas : null; };
    // produits
    const prods = A.produits.filter((p) => act === "tous" || p.action === act);
    const top = A.produits.slice(0, 15);
    const moisAn = A.mois.filter((m) => m.startsWith(String(an)));
    const pm = (id, m) => { const r = D.produits_mois.find((x) => x.id === id && x.mois === m); return r && r.spend > 0 ? r.sales / r.spend : null; };
    // Black Friday aligné
    const bf = D.black_friday || {};
    const bfData = []; for (let o = -26; o <= 14; o++) bfData.push({ o });
    [anP, an].forEach((y) => { const ref = bf[String(y)]; if (!ref) return; A.jours.forEach((j) => { const o = ecartJours(j.jour, ref); if (o >= -26 && o <= 14) { const row = bfData[o + 26]; row["r" + y] = j.spend ? +(j.sales / j.spend).toFixed(2) : null; row["s" + y] = Math.round(j.spend * facteur); row["d" + y] = j.jour; } }); });
    const semData = Lx.semaine.map((s) => ({ j: t.jours_sem[s.d], roas: s.roas ? +s.roas.toFixed(2) : 0, spend: s.spend, cvr: s.cvr }));
    const K = D.mots_cles_resume;

    corps = (
      <>
        {ligneBudget && <details className="mb-4"><summary className="text-[11.5px] cursor-pointer" style={{ color: VZ.muted }}>{t.ligne_budget} ({t.src_budget})</summary><div className="mt-2">{ligneBudget}</div></details>}
        <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
          <span className="text-[11px]" style={{ color: VZ.muted }}>{t.source} : {D.source}</span>
          <Chips label={t.perimetre} value={scope} onChange={setScope} items={[["Total", t.total], ["3P", t.p3], ["1P", t.p1]]} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
          <Stat label={`${t.depense} ${an}`} value={f.eur(ytd.spend)} sub={cmp(f.var(C.cur.spend / C.prev.spend - 1))} />
          <Stat label={`${t.ca} ${an}`} value={f.eur(ytd.sales)} sub={cmp(f.var(C.cur.sales / C.prev.sales - 1))} />
          <Stat label={`${t.roas} ${an}`} value={f.x(ytd.roas)} color={toneRoas(ytd.roas)} sub={cmp(`${f.x(C.prev.roas)} → ${f.x(C.cur.roas)}`)} />
          <Stat label={t.acos_l} value={f.pct(ytd.acos)} sub={cmp(f.pct(C.prev.acos))} />
          <Stat label={t.marginal} value={marg != null ? f.eur2(marg) : "–"} color={marg != null ? toneRoas(marg) : undefined} sub={marg != null ? `${t.marginal_sub} ${per}` : null} />
          <Stat label={t.conv} value={f.int(ytd.conv)} sub={`${t.cvr} ${f.pct(ytd.cvr)}`} />
          <Stat label={t.cpc} value={f.eurU(ytd.cpc)} sub={cmp(f.eurU(C.prev.cpc))} />
          <Stat label={t.panier} value={f.eur(ytd.aov)} sub={cmp(f.eur(C.prev.aov))} />
        </div>

        <Zone>{t.constats}</Zone>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
          {Lx.constats.map((c, i) => (
            <Box key={i} style={{ borderLeft: `3px solid ${c.ton === "bad" ? VZ.bad : c.ton === "warn" ? VZ.warn : VZ.good}` }}>
              <div className="text-[10px] uppercase tracking-wider font-bold" style={{ color: c.ton === "bad" ? VZ.bad : c.ton === "warn" ? VZ.warn : VZ.good }}>{c.tag}</div>
              <div className="text-[13.5px] font-semibold mt-1">{c.titre}</div>
              <p className="text-[12.5px] mt-1.5 leading-relaxed" style={{ color: "#DCD5C9" }}>{c.texte}</p>
            </Box>
          ))}
        </div>

        <Zone>{t.mensuel}</Zone>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
          {[["spend", t.dep_mens], ["sales", t.ca_mens]].map(([k, titre]) => (
            <Box key={k}>
              <H sub={D.mois_partiel ? `${f.moisLong(D.mois_partiel)} : ${t.partiel} (1–${+D.donnees_au.slice(8, 10)})` : null}>{titre}</H>
              <div style={{ height: 230 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={graphe} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={VZ.line} vertical={false} />
                    <XAxis dataKey="lab" tick={axisTick} tickLine={false} axisLine={{ stroke: VZ.line }} interval="preserveStartEnd" minTickGap={14} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} width={58} {...axe(Math.max(...graphe.map((r) => r[k] || 0)))} interval={0} tickFormatter={(v) => f.k(v)} />
                    <Tooltip {...TT} formatter={(v, n, p) => [f.eur(p.payload[k]), titre]} labelFormatter={(l, p) => (p && p[0] ? `${f.moisLong(p[0].payload.mois)}${p[0].payload.partiel ? ` (${t.partiel})` : ""} · ROAS ${f.x(p[0].payload.roas)}` : l)} />
                    <Bar dataKey={k} radius={[4, 4, 0, 0]} maxBarSize={28}>
                      {graphe.map((r, i) => <Cell key={i} fill={k === "spend" ? ORANGE : VZ.series[0]} fillOpacity={r.partiel ? 0.45 : 1} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Box>
          ))}
          <Box>
            <H>{t.roas_annee}</H>
            <div className="flex gap-4 text-[11px] mb-1" style={{ color: VZ.muted }}><span><i className="inline-block w-3.5 h-[2px] align-middle mr-1.5" style={{ background: VZ.neutral }} />{anP}</span><span><i className="inline-block w-3.5 h-[2px] align-middle mr-1.5" style={{ background: ORANGE }} />{an}</span></div>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={roasAnnee} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={VZ.line} vertical={false} />
                  <XAxis dataKey="m" tick={axisTick} tickLine={false} axisLine={{ stroke: VZ.line }} interval="preserveStartEnd" minTickGap={8} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={30} />
                  <Tooltip {...TT} formatter={(v, n) => [f.x(v), `ROAS ${n}`]} />
                  <Line type="linear" dataKey={String(anP)} stroke={VZ.neutral} strokeWidth={2} dot={{ r: 3, fill: VZ.neutral }} connectNulls={false} />
                  <Line type="linear" dataKey={String(an)} stroke={ORANGE} strokeWidth={2} dot={{ r: 3.5, fill: ORANGE }} connectNulls={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </Box>
          <Box>
            <H>{t.semaine} ({an})</H>
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={semData} margin={{ top: 16, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={VZ.line} vertical={false} />
                  <XAxis dataKey="j" tick={axisTick} tickLine={false} axisLine={{ stroke: VZ.line }} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={30} />
                  <Tooltip {...TT} formatter={(v, n, p) => [`${f.x(v)} · ${t.cvr} ${f.pct(p.payload.cvr)}`, "ROAS"]} />
                  <Bar dataKey="roas" fill={VZ.series[0]} radius={[4, 4, 0, 0]} maxBarSize={34} label={{ position: "top", fill: VZ.muted, fontSize: 10.5, formatter: (v) => f.x(v) }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Box>
        </div>
        <Box className="mt-2.5">
          <H>{t.detail_mens}</H>
          <Tableau>
            <thead><tr><Th l>{t.mois}</Th><Th>{t.depense}</Th><Th>{t.ca}</Th><Th>{t.roas}</Th><Th>{t.acos}</Th><Th>{t.impr}</Th><Th>{t.clics}</Th><Th>{t.ctr}</Th><Th>{t.cpc}</Th><Th>{t.conv}</Th><Th>{t.cvr}</Th><Th>{t.panier}</Th><Th>{t.cpa}</Th></tr></thead>
            <tbody>
              {[...rows].reverse().filter((r) => r.spend > 0).map((r) => (
                <tr key={r.mois} style={{ fontStyle: r.mois === D.mois_partiel ? "italic" : "normal" }}>
                  <Td l>{f.moisLong(r.mois)}{r.mois === D.mois_partiel ? ` (${t.partiel})` : ""}</Td><Td>{f.eur(r.spend)}</Td><Td>{f.eur(r.sales)}</Td>
                  <Td style={{ color: toneRoas(r.roas), fontWeight: 600 }}>{f.x(r.roas)}</Td><Td>{f.pct(r.acos)}</Td><Td>{f.int(r.impr)}</Td><Td>{f.int(r.clicks)}</Td><Td>{f.pct(r.ctr)}</Td>
                  <Td>{f.eurU(r.cpc)}</Td><Td>{f.int(r.conv)}</Td><Td>{f.pct(r.cvr)}</Td><Td>{f.eur(r.aov)}</Td><Td>{f.eurU(r.cpa)}</Td>
                </tr>
              ))}
            </tbody>
          </Tableau>
        </Box>

        <Zone>{t.categories}</Zone>
        <div className="grid grid-cols-1 gap-2.5">
          <Box>
            <H>{t.dep_cat}</H>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] mb-1" style={{ color: VZ.muted }}>{CATS.map((c, i) => <span key={c}><i className="inline-block w-2.5 h-2.5 rounded-sm align-middle mr-1.5" style={{ background: VZ.series[i] }} />{c}</span>)}</div>
            <div style={{ height: 260 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={catGraphe} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={VZ.line} vertical={false} />
                  <XAxis dataKey="lab" tick={axisTick} tickLine={false} axisLine={{ stroke: VZ.line }} interval="preserveStartEnd" minTickGap={14} />
                  <YAxis tick={axisTick} tickLine={false} axisLine={false} width={46} {...axe(catMax)} interval={0} tickFormatter={f.kBrut} />
                  <Tooltip {...TT} formatter={(v, n) => [f.eur(v / facteur), n]} />
                  {CATS.map((c, i) => <Bar key={c} dataKey={c} stackId="a" fill={VZ.series[i]} stroke={VZ.card} strokeWidth={1} maxBarSize={30} />)}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Box>
          <Box>
            <H sub={t.roas_cat_sub}>{t.roas_cat}</H>
            <Tableau>
              <thead><tr><Th l>{t.categorie}</Th>{moisCat.map((m) => <Th key={m} style={{ textAlign: "center" }}>{f.moisCourt(m)}</Th>)}</tr></thead>
              <tbody>{CATS.map((c) => (<tr key={c}><Td l>{c}</Td>{moisCat.map((m) => { const v = catRoas(c, m); return <Td key={m} style={{ textAlign: "center", ...heat(v) }}>{v == null ? "" : f.x(v)}</Td>; })}</tr>))}</tbody>
            </Tableau>
          </Box>
        </div>

        <Zone>{t.produits}</Zone>
        <Box>
          <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
            <H sub={t.regle_action}>{t.produits_sub}</H>
            <Chips label={t.action} value={act} onChange={setAct} items={[["tous", t.toutes], ["acc", t.acc], ["maint", t.maint], ["optim", t.optim], ["couper", t.couper], ["faible", t.faible]]} />
          </div>
          <Tableau>
            <thead><tr><Th l>{t.produit}</Th><Th l>{t.categorie}</Th><Th l>{t.canal}</Th><Th>{t.depense}</Th><Th>{t.part}</Th><Th>{t.ca}</Th><Th>{t.roas}</Th><Th>{t.acos}</Th><Th>{t.cpc}</Th><Th>{t.cvr}</Th><Th>{t.roas_mois}</Th><Th l>{t.action}</Th></tr></thead>
            <tbody>{prods.map((p) => (
              <tr key={p.id}>
                <Td l wrap><span className="block" style={{ minWidth: 200, maxWidth: 340 }}>{p.produit}</span></Td><Td l>{p.categorie}</Td><Td l>{p.pf}</Td><Td>{f.eur(p.spend)}</Td><Td>{f.pct(p.part)}</Td><Td>{f.eur(p.sales)}</Td>
                <Td style={{ color: toneRoas(p.roas), fontWeight: 600 }}>{f.x(p.roas)}</Td><Td>{f.pct(p.acos)}</Td><Td>{f.eurU(p.cpc)}</Td><Td>{f.pct(p.cvr)}</Td><Td>{p.nov_roas == null ? "–" : f.x(p.nov_roas)}</Td>
                <Td l><span className="px-2 py-0.5 rounded-full text-[10.5px] border" style={{ color: ACTION_COUL[p.action], borderColor: ACTION_COUL[p.action] }}>{t[p.action]}</span></Td>
              </tr>))}
            </tbody>
          </Tableau>
        </Box>
        <Box className="mt-2.5">
          <H sub={t.roas_cat_sub}>{t.top15}</H>
          <Tableau>
            <thead><tr><Th l>{t.produit}</Th><Th>{t.depense}</Th>{moisAn.map((m) => <Th key={m} style={{ textAlign: "center" }}>{f.moisCourt(m)}</Th>)}</tr></thead>
            <tbody>{top.map((p) => (<tr key={p.id}><Td l wrap><span className="block" style={{ minWidth: 190, maxWidth: 320 }}>{p.produit}</span></Td><Td>{f.eur(p.spend)}</Td>{moisAn.map((m) => { const v = pm(p.id, m); return <Td key={m} style={{ textAlign: "center", ...heat(v) }}>{v == null ? "" : f.x(v)}</Td>; })}</tr>))}</tbody>
          </Tableau>
        </Box>

        <Zone>{t.jours}</Zone>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5">
          {[["r", t.bf_roas, (v) => f.x(v)], ["s", t.bf_dep, (v) => f.eur(v / facteur)]].map(([k, titre, fmt]) => (
            <Box key={k}>
              <H sub={t.bf_sub}>{titre}</H>
              <div className="flex gap-4 text-[11px] mb-1" style={{ color: VZ.muted }}><span><i className="inline-block w-3.5 h-[2px] align-middle mr-1.5" style={{ background: VZ.neutral }} />{anP}</span><span><i className="inline-block w-3.5 h-[2px] align-middle mr-1.5" style={{ background: ORANGE }} />{an}</span></div>
              <div style={{ height: 220 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={bfData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid stroke={VZ.line} vertical={false} />
                    <ReferenceArea x1={0} x2={3} fill="rgba(255,255,255,0.06)" stroke="none" />
                    <XAxis dataKey="o" type="number" domain={[-26, 14]} ticks={[-21, -14, -7, 0, 7, 14]} tickFormatter={(v) => (v === 0 ? "BF" : v > 0 ? `J+${v}` : `J${v}`)} tick={axisTick} tickLine={false} axisLine={{ stroke: VZ.line }} />
                    <YAxis tick={axisTick} tickLine={false} axisLine={false} width={40} {...(k === "s" ? axe(Math.max(...bfData.map((r) => Math.max(r["s" + anP] || 0, r["s" + an] || 0)))) : {})} interval={0} tickFormatter={k === "s" ? f.kBrut : undefined} />
                    <Tooltip {...TT} labelFormatter={(o) => (o === 0 ? "Black Friday" : o > 0 ? `J+${o}` : `J${o}`)} formatter={(v, n, p) => { const y = n.slice(1); const dj = p.payload["d" + y]; return [fmt(v), dj ? f.date(dj) + "/" + y : y]; }} />
                    <Line type="linear" dataKey={k + anP} stroke={VZ.neutral} strokeWidth={2} dot={false} connectNulls />
                    <Line type="linear" dataKey={k + an} stroke={ORANGE} strokeWidth={2} dot={false} connectNulls />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </Box>
          ))}
        </div>

        <Zone>{t.mots}</Zone>
        <Box>
          <H sub={K ? (lang === "fr" ? `${f.int(K.n)} mots-clés en ${an} · ${f.eur(K.spend)} dépensés (le reste du budget passe par les pages catégories et produits) · ${f.pct(K.spend_sans_conv / K.spend)} de cette dépense sur ${f.int(K.n_sans_conv)} mots-clés sans conversion.` : `${f.int(K.n)} keywords in ${an} · ${f.eur(K.spend)} spent · ${f.pct(K.spend_sans_conv / K.spend)} of it on ${f.int(K.n_sans_conv)} keywords with no conversion.`) : null}>{t.mots_top}</H>
          <Tableau>
            <thead><tr><Th l>{t.mot}</Th><Th>{t.depense}</Th><Th>{t.ca}</Th><Th>{t.roas}</Th><Th>{t.clics}</Th><Th>{t.cpc}</Th><Th>{t.conv}</Th><Th l>{t.statut}</Th></tr></thead>
            <tbody>{D.mots_cles.map((m) => { const r = ratios(m); const st = !m.conv ? ["couper", t.sans_conv] : r.roas < 3 ? ["optim", "ROAS < 3"] : r.roas >= 10 ? ["acc", "ROAS ≥ 10"] : ["maint", "ROAS 3–10"]; return (
              <tr key={m.mot_cle}><Td l>{m.mot_cle}</Td><Td>{f.eur(m.spend)}</Td><Td>{f.eur(m.sales)}</Td><Td style={{ color: toneRoas(r.roas), fontWeight: 600 }}>{f.x(r.roas)}</Td><Td>{f.int(m.clicks)}</Td><Td>{f.eurU(r.cpc)}</Td><Td>{f.int(m.conv)}</Td>
                <Td l><span className="px-2 py-0.5 rounded-full text-[10.5px] border" style={{ color: ACTION_COUL[st[0]], borderColor: ACTION_COUL[st[0]] }}>{st[1]}</span></Td></tr>); })}
            </tbody>
          </Tableau>
        </Box>

        <Zone>{t.budgets}</Zone>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {D.budgets.map((b) => { const pct = b.budget ? Math.min(1, b.depense / b.budget) : 0; const r = D.mensuel.find((x) => x.mois === D.mois_partiel && x.pf === b.pf); const rythme = r ? r.spend / +D.donnees_au.slice(8, 10) : null; return (
            <Box key={b.campagne}>
              <div className="flex items-baseline justify-between gap-2"><span className="text-[13px] font-semibold">{b.pf} · {b.campagne}</span><span className="text-[12px] tabular-nums" style={{ color: VZ.muted }}>{f.eur(b.depense)} / {f.eur(b.budget)}</span></div>
              <div className="h-2.5 rounded-full mt-2 overflow-hidden" style={{ background: VZ.bg }}><div className="h-full rounded-full" style={{ width: `${pct * 100}%`, background: pct > 0.9 ? VZ.bad : pct > 0.7 ? VZ.warn : VZ.good }} /></div>
              <div className="flex justify-between text-[11.5px] mt-1.5" style={{ color: VZ.muted }}><span>{t.reste} <b style={{ color: VZ.text }}>{f.eur(b.budget - b.depense)}</b></span>{rythme != null && <span>{t.rythme} <b style={{ color: VZ.text }}>{f.eur(rythme)}</b>{t.par_jour}</span>}</div>
            </Box>); })}
        </div>
        {D.rallonge && <p className="text-[11.5px] mt-2" style={{ color: VZ.muted }}>{t.rallonge} : {f.eur(D.rallonge.montant)} ({new Date(D.rallonge.signee + "T12:00:00").toLocaleDateString(loc)}), {lang === "fr" ? "prend le relais du budget 3P à son épuisement (devis régie)." : "takes over from the 3P budget once used up."}</p>}

        <Zone>{t.plan}</Zone>
        <Box><ol className="list-decimal pl-5 flex flex-col gap-2 text-[12.5px] leading-relaxed">{Lx.plan.map((p, i) => <li key={i}>{p}</li>)}</ol></Box>

        <details className="mt-6 mb-2">
          <summary className="text-[12.5px] font-semibold cursor-pointer">{t.methode}</summary>
          <ul className="list-disc pl-5 mt-2 flex flex-col gap-1.5 text-[11.5px] leading-relaxed" style={{ color: VZ.muted }}>
            {(lang === "fr" ? [
              `Sources : ${D.source}. Campagnes : ${D.campagnes.map((c) => c[0]).join(", ")}.`,
              "CA attribué (« CA Web » de la régie) : CA réalisé sur toute la marque par les visiteurs ayant cliqué sur une annonce, dans les 15 jours. Il inclut l'effet de halo : le ROAS est plus généreux qu'une attribution au produit exact.",
              "ROAS = CA attribué ÷ dépense. ACoS = dépense ÷ CA attribué (part des dépenses sur les ventes attribuées). ROAS marginal = écart de CA ÷ écart de dépense sur les mêmes mois de l'année précédente.",
              "Le mois en cours est partiel. La part de la pub sur le CA total de la marketplace (TACoS) n'est pas dans ces rapports.",
              "Les constats et le plan d'action sont recalculés sur les données à chaque import ; les seuils (ROAS 2, 3, 6, 10) sont des repères à ajuster à la marge réelle.",
              "Montants hors frais de gestion de la régie. Catégories et gammes déduites du nom des produits.",
            ] : [
              `Sources: ${D.source}.`,
              "Attributed sales: sales on the whole brand by visitors who clicked an ad, within 15 days (includes halo effect).",
              "ROAS = attributed sales ÷ spend. ACoS = spend ÷ attributed sales. Marginal ROAS = sales difference ÷ spend difference vs the same months last year.",
              "The current month is partial. Ad share of total marketplace sales (TACoS) is not in these reports.",
              "Takeaways and action plan are recomputed from the data on each import; thresholds are guides to adjust to actual margin.",
            ]).map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </details>
      </>
    );
  }

  return createPortal(
    <div className="fixed inset-0 z-[70] flex justify-center" role="dialog" aria-modal="true" aria-label={D ? D.titre : nom}>
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.6)" }} onClick={onClose} />
      <div className="relative w-full max-w-[1200px] h-full overflow-y-auto overscroll-contain sm:my-4 sm:h-[calc(100%-2rem)] sm:rounded-2xl sm:border" style={{ background: VZ.bg, borderColor: VZ.line, color: VZ.text }}>
        {entete}
        <div className="px-3 sm:px-6 py-4 pb-16">{corps}</div>
      </div>
    </div>,
    document.body
  );
}
