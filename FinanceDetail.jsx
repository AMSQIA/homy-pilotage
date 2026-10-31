// Détails de l'onglet « Analyse financière » : compte d'exploitation par marketplace, remboursements,
// publicité par marketplace et par produit (avec les autres frais), explication du transport.
import React, { useMemo, useState } from "react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, LineChart, Line, Legend, Cell, LabelList } from "recharts";
import { VZ, POSTE } from "./FinanceViz.jsx";

const ORANGE = "#FF5A1F", ORANGE2 = "#FF8A50";
const eur = (v, d = 0) => (v == null || !isFinite(v) ? "–" : v.toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d }) + " €");
const keu = (v) => (v == null || !isFinite(v) ? "–" : Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " M€" : Math.abs(v) >= 1000 ? Math.round(v / 1000).toLocaleString("fr-FR") + " k€" : Math.round(v).toLocaleString("fr-FR") + " €");
const pc = (v, d = 1) => (v == null || !isFinite(v) ? "–" : (v * 100).toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d }) + " %");
const pts = (v) => (v == null || !isFinite(v) ? "–" : (v >= 0 ? "+" : "−") + Math.abs(v * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + " pt");
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const moisFR = (m) => MOIS[+m.slice(5, 7) - 1] + " " + m.slice(2, 4);
const tip = { background: "#1E1B15", border: `1px solid ${VZ.line}`, borderRadius: 12, color: VZ.text, fontSize: 12 };
const axisTick = { fill: VZ.muted, fontSize: 11 };

export function Chips({ items, value, onChange, label, color = ORANGE }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl p-1 text-xs" style={{ background: VZ.bg }} role="tablist" aria-label={label}>
      {items.map((k) => {
        const [id, lab] = Array.isArray(k) ? k : [k, k];
        return (
          <button key={id} role="tab" aria-selected={value === id} onClick={() => onChange(id)} className="px-3 py-1.5 rounded-lg whitespace-nowrap transition"
            style={{ background: value === id ? color : "transparent", color: value === id ? "#fff" : VZ.muted, fontWeight: value === id ? 600 : 400 }}>{lab}</button>
        );
      })}
    </div>
  );
}
const Box = ({ children, className = "" }) => <div className={`rounded-2xl border p-5 ${className}`} style={{ background: VZ.card, borderColor: VZ.line }}>{children}</div>;
const H = ({ children, sub }) => (<div className="mb-4"><h3 className="text-sm font-semibold">{children}</h3>{sub && <p className="text-xs mt-1 leading-relaxed" style={{ color: VZ.muted }}>{sub}</p>}</div>);
function Stat({ label, value, sub, color }) {
  return (
    <div className="rounded-xl p-3.5" style={{ background: VZ.bg }}>
      <div className="text-[11px] uppercase tracking-wider" style={{ color: VZ.muted }}>{label}</div>
      <div className="text-xl font-bold mt-1" style={{ color: color || VZ.text }}>{value}</div>
      {sub && <div className="text-xs mt-0.5" style={{ color: VZ.dim }}>{sub}</div>}
    </div>
  );
}

// =====================================================================================================
// 1. COMPTE D'EXPLOITATION D'UNE MARKETPLACE
export function MarketplacePL({ det, ch, y1, y0 }) {
  const M = det.mp[ch]; const a = M.y1, b = M.y0;
  const r = (x, base) => (x == null || !base ? null : x / base);
  const rows = [];
  const add = (lab, k, va, vb, o = {}) => rows.push({ lab, k, va, vb, ...o });
  add("Ventes brutes TTC", "g", a.gross, b.gross, { base: "gross" });
  if (M.ref_ok) add("Remboursements clients", "ref", -a.ref, -b.ref, { indent: 1, base: "gross", neg: true });
  add("Ventes nettes TTC", "ttc", a.ttc, b.ttc, { strong: true, base: "gross" });
  add("TVA (20 %)", "tva", -(a.ttc - a.ht), -(b.ttc - b.ht), { indent: 1, neg: true });
  add("Ventes nettes HT", "ht", a.ht, b.ht, { strong: true, key: true });
  if (M.comref_ok) {
    add("Commission brute", "cg", -a.com_g, -b.com_g, { indent: 1, neg: true });
    add("Commission remboursée sur retours", "cr", a.com_r, b.com_r, { indent: 1 });
  }
  add("Commission nette", "com", -a.com, -b.com, { neg: true, strong: !M.comref_ok ? false : true, color: POSTE.com.c });
  M.dev.forEach((dv) => add(`${dv.lab}`, "dev", -dv.s26, dv.s25 == null ? null : -dv.s25, { indent: 1, neg: true, est: dv.kind === "estimé", roas: dv.ca26 && dv.s26 ? dv.ca26 / dv.s26 : null }));
  add("Publicité totale", "pub", -(a.pub + a.pubnc), -(b.pub + b.pubnc), { neg: true, strong: true, color: POSTE.pub.c });
  add("Logistique marketplace (FBA, stockage, fulfilment)", "logmp", -a.logmp, -b.logmp, { neg: true, color: POSTE.logmp.c });
  add("Abonnements et autres frais", "oth", -a.oth, -b.oth, { neg: true });
  add("Total frais de vente", "fv", -a.fv, -b.fv, { strong: true, key: true, neg: true });
  add("Marge après frais de vente", "mfv", a.mfv, b.mfv, { strong: true });
  add("Transport et supply chain", "sc", a.sc == null ? null : -a.sc, null, { neg: true, color: POSTE.sc.c, note: a.sc_est ? `dont ${keu(a.sc_est)} prolongés` : null });
  add("Contribution", "contrib", a.contrib, null, { strong: true, key: true, hl: a.achat == null });
  if (a.achat != null) {
    add("Coût d’achat des produits vendus", "achat", -a.achat, b.achat == null ? null : -b.achat, { neg: true, color: "#9085e9", est: !!a.ach_est, note: a.ach_est ? `estimé : ${a.ach_est}` : "FOB + coût logistique d’approche, par ligne de commande" });
    add("Marge nette avant frais fixes", "mn", a.mn, null, { strong: true, key: true, hl: true });
  }
  const pctOf = (row, side) => {
    const v = side ? row.va : row.vb, base = row.base === "gross" ? (side ? a.gross : b.gross) : (side ? a.ht : b.ht);
    return v == null ? null : v / base;
  };
  const refR = M.ref_ok ? a.ref / a.gross : null, refR0 = M.ref_ok && b.gross ? b.ref / b.gross : null;
  const biggest = [["Commission", a.com], ["Publicité", a.pub + a.pubnc], ["Logistique marketplace", a.logmp + a.oth], ["Transport & supply chain", a.sc || 0]].sort((x, y) => y[1] - x[1])[0];
  return (
    <div className="space-y-6">
      <div className={`grid grid-cols-2 ${a.mn != null ? "lg:grid-cols-5" : "lg:grid-cols-4"} gap-3`}>
        <Stat label={`Ventes nettes HT ${y1}`} value={keu(a.ht)} sub={b.ht ? `${a.ht >= b.ht ? "+" : ""}${pc(a.ht / b.ht - 1)} vs ${y0}` : "nouveau canal"} />
        <Stat label="Remboursements" value={M.ref_ok ? pc(refR, 2) : "n.d."} sub={M.ref_ok ? `${keu(a.ref)} TTC · ${y0} : ${pc(refR0, 2)}` : "non suivis pour ce canal"} color={M.ref_ok && refR > 0.04 ? VZ.bad : undefined} />
        <Stat label="Frais de vente" value={pc(a.fv / a.ht)} sub={`${y0} : ${pc(b.fv / b.ht)} · premier poste : ${biggest[0].toLowerCase()}`} />
        <Stat label="Contribution" value={pc(a.contrib / a.ht)} sub={keu(a.contrib) + " après transport"} color={a.contrib < 0 ? VZ.bad : VZ.good} />
        {a.mn != null && <Stat label="Marge nette" value={pc(a.mn / a.ht)} sub={`${keu(a.mn)} après achats (${pc(a.achat / a.ht)})`} color={a.mn < 0 ? VZ.bad : VZ.good} />}
      </div>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wider" style={{ color: VZ.muted }}>
              <th className="py-2 px-3 text-left font-medium">Poste</th>
              <th className="py-2 px-3 text-right font-medium" style={{ color: ORANGE2 }}>{y1} à date</th>
              <th className="py-2 px-2 text-right font-medium">%</th>
              <th className="py-2 px-3 text-right font-medium">{y0} même période</th>
              <th className="py-2 px-2 text-right font-medium">%</th>
              <th className="py-2 px-2 text-right font-medium">Écart</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const p1 = pctOf(row, true), p0 = pctOf(row, false);
              const isPct = !["ttc", "ht", "g"].includes(row.k) || row.k === "ref";
              return (
                <tr key={i} className="border-t" style={{ borderColor: VZ.line, background: row.hl ? "rgba(61,214,140,.06)" : row.key ? "rgba(255,90,31,.05)" : "transparent" }}>
                  <td className={`py-2 px-3 ${row.strong ? "font-semibold" : ""}`} style={{ paddingLeft: 12 + (row.indent || 0) * 18, minWidth: 230 }}>
                    <span className="inline-flex items-center gap-2">
                      {row.color && <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: row.color }} />}
                      {row.lab}
                      {row.est && <span className="text-[10px] rounded-full px-1.5 py-0.5" style={{ color: "#FFB020", background: "rgba(255,176,32,.1)" }}>estimé</span>}
                      {row.roas && <span className="text-[10px] rounded-full px-1.5 py-0.5" style={{ color: VZ.muted, background: "rgba(255,255,255,.05)" }}>ROAS {row.roas.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}</span>}
                    </span>
                    {row.note && <div className="text-[11px]" style={{ color: VZ.dim }}>{row.note}</div>}
                  </td>
                  <td className={`py-2 px-3 text-right whitespace-nowrap ${row.strong ? "font-semibold" : ""}`} style={{ color: row.hl ? (row.va < 0 ? VZ.bad : VZ.good) : VZ.text }}>{row.va == null ? "n.d." : eur(row.va)}</td>
                  <td className="py-2 px-2 text-right whitespace-nowrap text-xs" style={{ color: VZ.muted }}>{isPct && p1 != null ? pc(row.k === "mn" ? p1 : Math.abs(p1)) : row.k === "ht" ? "100 %" : ""}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: VZ.muted }}>{row.vb == null ? (["sc", "contrib", "mn"].includes(row.k) ? "n.d." : "–") : eur(row.vb)}</td>
                  <td className="py-2 px-2 text-right whitespace-nowrap text-xs" style={{ color: VZ.dim }}>{isPct && p0 != null ? pc(Math.abs(p0)) : row.k === "ht" ? "100 %" : ""}</td>
                  <td className="py-2 px-2 text-right whitespace-nowrap text-xs" style={{ color: p1 != null && p0 != null ? ((Math.abs(p1) - Math.abs(p0)) * (row.neg ? 1 : -1) > 0.0005 ? VZ.bad : VZ.good) : VZ.dim }}>
                    {isPct && p1 != null && p0 != null && row.k !== "g" ? pts(Math.abs(p1) - Math.abs(p0)) : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[11px] leading-relaxed" style={{ color: VZ.dim }}>
        % : remboursements et ventes en % des ventes brutes TTC ; frais en % des ventes nettes HT. Écart en points ({y1} − {y0}) : rouge = le poste pèse plus lourd.
        {!M.comref_ok && " Commission nette des remboursements (non séparable dans la source)."} {!M.ref_ok && " Remboursements non suivis pour ce canal."}
      </p>
    </div>
  );
}

// =====================================================================================================
// 2. REMBOURSEMENTS
export function Refunds({ det }) {
  const y1 = det.y1, y0 = det.y0;
  const chans = Object.keys(det.mp).filter((c) => det.mp[c].ref_ok);
  const G1 = chans.reduce((t, c) => t + det.mp[c].y1.gross, 0), R1 = chans.reduce((t, c) => t + det.mp[c].y1.ref, 0);
  const G0 = chans.reduce((t, c) => t + det.mp[c].y0.gross, 0), R0 = chans.reduce((t, c) => t + det.mp[c].y0.ref, 0);
  const comR = chans.filter((c) => det.mp[c].comref_ok).reduce((t, c) => t + (det.mp[c].y1.com_r || 0), 0);
  const refHTcomOK = chans.filter((c) => det.mp[c].comref_ok).reduce((t, c) => t + det.mp[c].y1.ref / 1.2, 0);
  // décomposition du taux global : contribution de chaque canal (points de %)
  const decomp = chans.map((c, i) => ({ name: c, pt: det.mp[c].y1.ref / G1, rate: det.mp[c].y1.ref / det.mp[c].y1.gross, rate0: det.mp[c].y0.gross ? det.mp[c].y0.ref / det.mp[c].y0.gross : null, ref: det.mp[c].y1.ref, color: VZ.series[Object.keys(det.mp).indexOf(c) % 8] })).sort((a, b) => b.pt - a.pt);
  const [ch, setCh] = useState("Tous");
  const months = useMemo(() => {
    const src = ch === "Tous" ? chans : [ch];
    const byM = {};
    src.forEach((c) => (det.ref_m[c] || []).forEach((x) => { const o = (byM[x.m] = byM[x.m] || { g: 0, r: 0 }); o.g += x.g; o.r += x.r; }));
    return MOIS.map((lab, i) => {
      const o = { m: lab };
      [y0, y1].forEach((y) => { const v = byM[`${y}-${String(i + 1).padStart(2, "0")}`]; o[y] = v && v.g ? v.r / v.g : null; });
      return o;
    });
  }, [ch]);
  const cats = useMemo(() => {
    const by = {};
    det.ref_cat.forEach((x) => { const o = (by[x.cat] = by[x.cat] || { g: 0, r: 0 }); o.g += x.g; o.r += x.r; });
    return Object.entries(by).map(([k, v]) => ({ cat: k, ...v, rate: v.r / v.g })).sort((a, b) => b.rate - a.rate);
  }, []);
  return (
    <div className="space-y-6">
      <Box>
        <H sub={`Remboursements clients en % des ventes brutes TTC, ${y1} à date vs ${y0} même période. Site bestherm.fr non suivi (pas de donnée de retour).`}>Taux de remboursement</H>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <Stat label={`Taux ${y1}`} value={pc(R1 / G1, 2)} sub={`${keu(R1)} remboursés sur ${keu(G1)}`} color={R1 / G1 > R0 / G0 ? VZ.bad : VZ.good} />
          <Stat label={`Taux ${y0}`} value={pc(R0 / G0, 2)} sub={`évolution ${pts(R1 / G1 - R0 / G0)}`} />
          <Stat label="Commission récupérée" value={pc(comR / refHTcomOK)} sub={`des remboursements HT : ${keu(comR)} de commission reversés (Mirakl, Cdiscount)`} />
          <Stat label="Coût net des retours" value={keu(R1 / 1.2 - comR)} sub="ventes HT perdues moins commission récupérée" />
        </div>
        <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: VZ.muted }}>Décomposition du taux global ({pc(R1 / G1, 2)}) par canal</h4>
        <div className="flex h-8 w-full rounded-lg overflow-hidden" role="img" aria-label="Décomposition du taux de remboursement par canal">
          {decomp.map((x) => (
            <div key={x.name} title={`${x.name} : ${pts(x.pt)}`} style={{ width: `${(x.pt / (R1 / G1)) * 100}%`, background: x.color, borderRight: `2px solid ${VZ.card}` }}
              className="flex items-center justify-center text-[10.5px] font-semibold text-white overflow-hidden whitespace-nowrap">{x.pt / (R1 / G1) > 0.09 ? pts(x.pt).replace("+", "") : ""}</div>
          ))}
        </div>
        <div className="overflow-x-auto mt-4">
          <table className="w-full text-sm">
            <thead><tr className="text-xs uppercase tracking-wider" style={{ color: VZ.muted }}>
              {["Canal", "Remboursé TTC", `Taux ${y1}`, `Taux ${y0}`, "Évolution", "Poids dans le taux global"].map((h, i) => <th key={h} className={`py-2 px-3 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>)}
            </tr></thead>
            <tbody>
              {decomp.map((x) => (
                <tr key={x.name} className="border-t" style={{ borderColor: VZ.line }}>
                  <td className="py-2 px-3"><span className="inline-flex items-center gap-2"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: x.color }} />{x.name}</span></td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">{keu(x.ref)}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap font-semibold" style={{ color: x.rate > 0.04 ? VZ.bad : VZ.text }}>{pc(x.rate, 2)}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: VZ.muted }}>{pc(x.rate0, 2)}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: x.rate0 != null && x.rate > x.rate0 ? VZ.bad : VZ.good }}>{x.rate0 != null ? pts(x.rate - x.rate0) : "–"}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">{pts(x.pt).replace("+", "")} <span style={{ color: VZ.dim }}>({pc(x.pt / (R1 / G1), 0)})</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Box>
      <div className="grid xl:grid-cols-2 gap-6">
        <Box>
          <div className="flex flex-col gap-3 mb-3">
            <H sub={`Remboursements / ventes brutes, par mois, ${y0} vs ${y1}.`}>Mois par mois</H>
            <Chips items={["Tous", ...chans]} value={ch} onChange={setCh} label="Canal" />
          </div>
          <div style={{ height: 240 }}>
            <ResponsiveContainer>
              <LineChart data={months} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <CartesianGrid stroke={VZ.line} vertical={false} />
                <XAxis dataKey="m" tick={axisTick} axisLine={false} tickLine={false} />
                <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => pc(v, 0)} width={44} domain={[0, "auto"]} />
                <Tooltip contentStyle={tip} formatter={(v, n) => [pc(v, 2), n]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line dataKey={y0} stroke={VZ.dim} strokeWidth={2} dot={{ r: 3, fill: VZ.dim, strokeWidth: 0 }} connectNulls />
                <Line dataKey={y1} stroke={ORANGE} strokeWidth={2} dot={{ r: 3, fill: ORANGE, strokeWidth: 0 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Box>
        <Box>
          <H sub={`Leroy Merlin et enseignes Mirakl (lignes de commande), ${y1} à date.`}>Par catégorie et par pays Leroy Merlin</H>
          <table className="w-full text-sm mb-4">
            <tbody>
              {cats.map((x) => (
                <tr key={x.cat} className="border-t" style={{ borderColor: VZ.line }}>
                  <td className="py-2 pr-3">{x.cat}</td>
                  <td className="py-2 px-2 w-1/2"><div className="h-2 rounded-full" style={{ background: VZ.bg }}><div className="h-2 rounded-full" style={{ width: `${Math.min(x.rate / 0.08, 1) * 100}%`, background: x.rate > 0.04 ? VZ.bad : ORANGE2 }} /></div></td>
                  <td className="py-2 pl-2 text-right whitespace-nowrap font-semibold">{pc(x.rate, 2)}</td>
                  <td className="py-2 pl-3 text-right whitespace-nowrap text-xs" style={{ color: VZ.dim }}>{keu(x.r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex flex-wrap gap-2">
            {det.ref_pays.sort((a, b) => b.g - a.g).map((x) => (
              <span key={x.pays} className="text-xs rounded-full px-2.5 py-1" style={{ background: VZ.bg, color: VZ.muted }}>LM {x.pays} <b style={{ color: x.r / x.g > 0.04 ? VZ.bad : VZ.text }}>{pc(x.r / x.g, 1)}</b></span>
            ))}
          </div>
        </Box>
      </div>
      <Box>
        <H sub={`Produits les plus remboursés en ${y1} (Leroy Merlin et enseignes Mirakl, ventes ≥ 1 500 €).`}>Produits les plus remboursés</H>
        <div className="overflow-x-auto max-h-[420px]">
          <table className="w-full text-sm">
            <thead className="sticky top-0" style={{ background: VZ.card }}><tr className="text-xs uppercase tracking-wider" style={{ color: VZ.muted }}>
              {["Produit", "Canal", "Ventes brutes", "Remboursé", "Taux"].map((h, i) => <th key={h} className={`py-2 px-3 font-medium ${i > 1 ? "text-right" : "text-left"}`}>{h}</th>)}
            </tr></thead>
            <tbody>
              {det.ref_prod.map((x, i) => (
                <tr key={i} className="border-t" style={{ borderColor: VZ.line }}>
                  <td className="py-2 px-3"><div className="line-clamp-2 max-w-[380px] min-w-[200px]" title={x.nom}>{x.nom || x.sku}</div><div className="text-xs" style={{ color: VZ.dim }}>{x.sku}</div></td>
                  <td className="py-2 px-3" style={{ color: VZ.muted }}>{x.canal}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">{keu(x.g)}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">{keu(x.r)}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap font-semibold" style={{ color: x.r / x.g > 0.06 ? VZ.bad : VZ.text }}>{pc(x.r / x.g, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Box>
    </div>
  );
}

// =====================================================================================================
// 3. PUBLICITÉ PAR MARKETPLACE ET PAR PRODUIT (avec les autres frais)
export function AdsDetail({ d }) {
  const det = d.det, y1 = det.y1, y0 = det.y0;
  const mps = ["Leroy Merlin", "Amazon", "Cdiscount", "Castorama", "Site bestherm.fr"].filter((c) => det.mp[c]);
  const [mp, setMp] = useState("Leroy Merlin");
  const [q, setQ] = useState(""); const [sort, setSort] = useState("pub");
  const M = det.mp[mp];
  const ht1 = M.y1.ht, ht0 = M.y0.ht;
  const totPub1 = M.dev.reduce((t, x) => t + x.s26, 0), totPub0 = M.dev.reduce((t, x) => t + (x.s25 || 0), 0);
  const monthly = det.ads_m.map((x) => ({ m: moisFR(x.m), v: x[mp] || 0, roas: mp === "Leroy Merlin" ? x.lm_roas : null })).filter((x, i, arr) => arr.slice(i).some((y) => y.v));
  // produits : pub + commission + autres frais
  const prods = useMemo(() => {
    let rows = [];
    if (mp === "Leroy Merlin") rows = (d.lm_products || []).map((p) => ({ nom: p.nom, sku: p.sku, sub: p.pays, v: p.v, q: p.q, pub: p.ptot ?? p.pub, com: p.com, oth: 0, roas: p.roas }));
    if (mp === "Amazon") rows = (d.amz_products || []).map((p) => ({ nom: p.nom, sku: p.sku, sub: "FBA", v: p.v, q: p.q, pub: p.pub, com: p.com, oth: p.fba, roas: p.roas }));
    if (mp === "Cdiscount") rows = (d.cd_products || []).map((p) => ({ nom: p.nom, sku: p.sku, sub: "", v: p.v, q: p.q, pub: p.pub, com: p.com, oth: 0, roas: null, est: true }));
    rows = rows.filter((p) => p.v > 0 && (!q || `${p.nom} ${p.sku}`.toLowerCase().includes(q.toLowerCase())));
    rows.forEach((p) => { p.ht = p.v / 1.2; p.tot = (p.pub || 0) + (p.com || 0) + (p.oth || 0); p.pct = p.tot / p.ht; p.pubPct = (p.pub || 0) / p.ht; });
    const key = { pub: (p) => -(p.pub || 0), pct: (p) => -p.pct, v: (p) => -p.v, roas: (p) => (p.roas == null ? 1e9 : p.roas) }[sort];
    return rows.sort((a, b) => key(a) - key(b));
  }, [mp, q, sort]);
  const heat = (v) => (v >= 0.35 ? VZ.bad : v >= 0.2 ? "#FFB020" : VZ.good);
  const prodNote = { "Leroy Merlin": "Pub Sponsored Products imputée au produit + quote-part Video/Display, commission nette (lignes Mirakl), depuis sept. 2025.", Amazon: "Pub Sponsored Products France réelle par produit (rapport Amazon Ads), commission et FBA imputés, 1er août – 28 oct. 2026.", Cdiscount: "Commission et pub estimées au taux moyen du canal (Octopia ne donne pas la pub par produit), juil.–sept. 2026." }[mp];
  return (
    <div className="space-y-6">
      <Box>
        <div className="flex flex-col gap-3 mb-4">
          <H sub={`Chaque dispositif payant, ${y1} à date vs ${y0} même période, en % des ventes nettes HT du canal.`}>Publicité par marketplace</H>
          <Chips items={mps} value={mp} onChange={setMp} label="Marketplace" />
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
          <Stat label={`Pub ${y1}`} value={keu(totPub1)} sub={`${pc(totPub1 / ht1)} des ventes HT`} />
          <Stat label={`Pub ${y0}`} value={totPub0 ? keu(totPub0) : "–"} sub={totPub0 ? `${pc(totPub0 / ht0)} des ventes HT` : "non suivie"} />
          <Stat label="Commission" value={pc(M.y1.com / ht1)} sub={keu(M.y1.com)} />
          <Stat label="Logistique + autres frais" value={pc((M.y1.logmp + M.y1.oth) / ht1)} sub={keu(M.y1.logmp + M.y1.oth)} />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-xs uppercase tracking-wider" style={{ color: VZ.muted }}>
              {["Dispositif", y1, "% HT", y0, "% HT", "CA attribué", "ROAS"].map((h, i) => <th key={h + i} className={`py-2 px-3 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>)}
            </tr></thead>
            <tbody>
              {M.dev.map((x, i) => (
                <tr key={i} className="border-t" style={{ borderColor: VZ.line }}>
                  <td className="py-2 px-3">{x.lab}{x.kind === "estimé" && <span className="ml-2 text-[10px] rounded-full px-1.5 py-0.5" style={{ color: "#FFB020", background: "rgba(255,176,32,.1)" }}>estimé</span>}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap font-semibold">{eur(x.s26)}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap text-xs" style={{ color: VZ.muted }}>{pc(x.s26 / ht1, 2)}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: VZ.muted }}>{x.s25 == null ? "–" : eur(x.s25)}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap text-xs" style={{ color: VZ.dim }}>{x.s25 == null || !ht0 ? "" : pc(x.s25 / ht0, 2)}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap">{x.ca26 ? keu(x.ca26) : "–"}</td>
                  <td className="py-2 px-3 text-right whitespace-nowrap font-semibold" style={{ color: x.ca26 && x.ca26 / x.s26 < 4 ? VZ.bad : VZ.text }}>{x.ca26 ? (x.ca26 / x.s26).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) : "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {monthly.some((x) => x.v) && (
          <div className="mt-6">
            <h4 className="text-xs font-semibold uppercase tracking-wider mb-2" style={{ color: VZ.muted }}>Dépense publicitaire mensuelle (HT)</h4>
            <div style={{ height: 220 }}>
              <ResponsiveContainer>
                <BarChart data={monthly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke={VZ.line} vertical={false} />
                  <XAxis dataKey="m" tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={keu} width={56} />
                  <Tooltip cursor={{ fill: "rgba(255,255,255,.04)" }} contentStyle={tip} formatter={(v, n, it) => [`${eur(v)}${it.payload.roas ? ` · ROAS ${it.payload.roas.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}` : ""}`, "Pub"]} />
                  <Bar dataKey="v" fill={POSTE.pub.c} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </Box>
      {["Leroy Merlin", "Amazon", "Cdiscount"].includes(mp) && (
        <Box>
          <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-3 mb-4">
            <H sub={prodNote}>{`Pub et autres frais par produit · ${mp}`}</H>
            <div className="flex flex-wrap items-center gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un produit" className="rounded-xl px-3 py-1.5 text-xs outline-none" style={{ background: VZ.bg, color: VZ.text, border: `1px solid ${VZ.line}` }} />
              <Chips items={[["pub", "Pub"], ["pct", "% frais"], ["v", "Ventes"], ["roas", "ROAS"]]} value={sort} onChange={setSort} label="Tri" color={VZ.series[0]} />
            </div>
          </div>
          <div className="overflow-x-auto max-h-[520px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-[1]" style={{ background: VZ.card }}><tr className="text-xs uppercase tracking-wider" style={{ color: VZ.muted }}>
                {["Produit", "Ventes TTC", "Unités", "Pub", "ROAS", "Commission", mp === "Amazon" ? "FBA" : "Autres", "Total frais", "% ventes HT"].map((h, i) => <th key={h} className={`py-2 px-3 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {prods.map((p, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: VZ.line }}>
                    <td className="py-2 px-3"><div className="line-clamp-2 max-w-[380px] min-w-[200px]" title={p.nom}>{p.nom}</div><div className="text-xs" style={{ color: VZ.dim }}>{p.sku}{p.sub ? ` · ${p.sub}` : ""}</div></td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">{eur(p.v)}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: VZ.muted }}>{p.q ?? "–"}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">{eur(p.pub)}{p.est && <span style={{ color: "#FFB020" }}> *</span>}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: p.roas != null && p.roas < 4 ? VZ.bad : VZ.text }}>{p.roas == null ? "–" : p.roas.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">{eur(p.com)}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">{p.oth ? eur(p.oth) : "–"}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">{eur(p.tot)}</td>
                    <td className="py-2 px-3 text-right whitespace-nowrap">
                      <span className="inline-flex items-center gap-2 justify-end">
                        <span className="hidden sm:block w-16 h-1.5 rounded-full" style={{ background: VZ.bg }}><span className="block h-1.5 rounded-full" style={{ width: `${Math.min(p.pct / 0.5, 1) * 100}%`, background: heat(p.pct) }} /></span>
                        <b style={{ color: heat(p.pct) }}>{pc(p.pct)}</b>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] mt-3" style={{ color: VZ.dim }}>{prods.length} produits · couleur : vert &lt; 20 %, orange 20–35 %, rouge ≥ 35 % de frais (pub + commission + autres) sur les ventes HT.{mp === "Cdiscount" && " * estimé."}</p>
        </Box>
      )}
    </div>
  );
}

// =====================================================================================================
// 4. TRANSPORT : EXPLICATION DÉTAILLÉE
export function TransportExplain({ det, log }) {
  const T = det.tr; const y1 = det.y1;
  const mois = (m) => moisFR(m);
  const rows = T.alloc.filter((x) => x.ht > 0).map((x) => ({ ...x, tot: x.real + x.est, ppp: x.pieces ? x.tr / x.pieces : null })).sort((a, b) => b.tot - a.tot);
  const hors = T.hors.reduce((t, x) => t + x.tr, 0);
  const steps = [
    ["1", "Ce qu’on paie", `${keu(T.sup_tot)} HT de supply chain de ${mois(T.sup_m[1])} à ${mois(T.sup_m[2])} : livraison (${pc(T.liv_sh, 0)}), logistique entrepôt et stockage. Source : coûts supply mensuels de l’app logistique.`],
    ["2", "Les factures transporteurs", `${keu(T.tr_tot)} HT facturés par DPD, Chronopost, Géodis et ManoMano, rapprochés à plus de 99 % d’une commande. Le coût de chaque colis est réparti entre les produits au prorata de leur volume.`],
    ["3", "La part de chaque canal", `Chaque canal reçoit une part de la supply chain égale à sa part du transport facturé (${mois(T.periode[0])} – ${mois(T.periode[1])}). ${keu(hors)} de transport concernent des canaux hors analyse (ManoMano, Darty, Bricoman…).`],
    ["4", "Les mois sans données", `Après ${mois(T.sup_m[2])}, le coût est prolongé au même % des ventes pour chaque canal : ${keu(T.est_tot)} estimés au total.`],
    ["5", "Ce qui n’est pas ici", "Les envois Amazon FBA sont dans « Logistique marketplace » (facturés par Amazon), pas dans le transport. Le prix d’achat des produits n’est pas compté."],
  ];
  return (
    <div className="space-y-6">
      <Box>
        <H sub="Comment le coût « Transport et supply chain » du compte d’exploitation est calculé, étape par étape.">Le transport, expliqué</H>
        <ol className="grid md:grid-cols-2 xl:grid-cols-5 gap-3">
          {steps.map(([n, t, x]) => (
            <li key={n} className="rounded-xl p-4" style={{ background: VZ.bg }}>
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold mb-2" style={{ background: "rgba(201,133,0,.2)", color: POSTE.sc.c }}>{n}</div>
              <div className="text-sm font-semibold mb-1">{t}</div>
              <p className="text-xs leading-relaxed" style={{ color: VZ.muted }}>{x}</p>
            </li>
          ))}
        </ol>
      </Box>
      <div className="grid xl:grid-cols-2 gap-6">
        <Box>
          <H sub={`Coût transport et supply chain affecté à chaque canal, ${y1} à date.`}>Répartition par canal</H>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-xs uppercase tracking-wider" style={{ color: VZ.muted }}>
                {["Canal", "Part", "Réel", "Prolongé", "Total", "% HT", "€ / pièce"].map((h, i) => <th key={h} className={`py-2 px-2 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.name} className="border-t" style={{ borderColor: VZ.line }}>
                    <td className="py-2 px-2">{x.name}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap" style={{ color: VZ.muted }}>{pc(x.share, 1)}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap">{keu(x.real)}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap" style={{ color: "#FFB020" }}>{keu(x.est)}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap font-semibold">{keu(x.tot)}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap" style={{ color: x.tot / x.ht > 0.3 ? VZ.bad : VZ.text }}>{pc(x.tot / x.ht)}</td>
                    <td className="py-2 px-2 text-right whitespace-nowrap" style={{ color: VZ.muted }}>{x.ppp ? eur(x.ppp, 2) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] mt-3" style={{ color: VZ.dim }}>€ / pièce : transport facturé seul (hors entrepôt et stockage) divisé par les pièces expédiées.</p>
        </Box>
        <Box>
          <H sub="Coût par pièce et poids des incidents (casse, retours, réexpéditions) par transporteur.">Par transporteur</H>
          <div style={{ height: 200 }}>
            <ResponsiveContainer>
              <BarChart data={Object.entries(T.ppp).map(([k, v]) => ({ t: k, v }))} layout="vertical" margin={{ top: 0, right: 40, left: 0, bottom: 0 }}>
                <XAxis type="number" hide domain={[0, "auto"]} />
                <YAxis type="category" dataKey="t" width={90} tick={{ fill: VZ.text, fontSize: 12 }} axisLine={false} tickLine={false} />
                <Tooltip cursor={{ fill: "rgba(255,255,255,.03)" }} contentStyle={tip} formatter={(v) => [eur(v, 2), "par pièce"]} />
                <Bar dataKey="v" radius={[0, 4, 4, 0]} barSize={18}>
                  {Object.keys(T.ppp).map((k) => <Cell key={k} fill={k === "Geodis" ? VZ.good : POSTE.sc.c} />)}
                  <LabelList dataKey="v" position="right" formatter={(v) => eur(v, 2)} style={{ fill: VZ.text, fontSize: 11 }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <table className="w-full text-sm mt-3">
            <tbody>
              {(log?.trp || []).map((x) => (
                <tr key={x.t} className="border-t" style={{ borderColor: VZ.line }}>
                  <td className="py-2 pr-2">{x.t}</td>
                  <td className="py-2 px-2 text-right whitespace-nowrap" style={{ color: VZ.muted }}>{x.exp.toLocaleString("fr-FR")} exp.</td>
                  <td className="py-2 px-2 text-right whitespace-nowrap">{keu(x.cout)}</td>
                  <td className="py-2 pl-2 text-right whitespace-nowrap" style={{ color: x.inc / x.cout > 0.08 ? VZ.bad : VZ.muted }}>incidents {pc(x.inc / x.cout)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs mt-3 leading-relaxed" style={{ color: VZ.muted }}>
            Levier : basculer {pc(T.switch, 0)} des envois DPD ({pc(T.dpd_sh, 0)} du transport) vers Géodis et diviser les incidents ({pc(T.inc_sh)} du coût) par deux réduirait la supply chain d’environ <b style={{ color: VZ.good }}>{pc(T.gain_rate)}</b>.
          </p>
        </Box>
      </div>
    </div>
  );
}

// =====================================================================================================
// 5. MARGE PAR PRODUIT (coût d'achat réel par référence)
export function ProductMargin({ det, pl }) {
  const [q, setQ] = useState(""); const [sort, setSort] = useState("ht"); const [n, setN] = useState(15);
  const scRate = pl && pl.t26 && pl.t26.sc != null ? -pl.t26.sc / pl.t26.ht : 0;
  const rows = useMemo(() => {
    const r = (det.marg_prod || []).filter((p) => !q || `${p.nom} ${p.sku}`.toLowerCase().includes(q.toLowerCase())).map((p) => ({
      ...p, pa: p.achat / p.ht, pf: p.frais / p.ht, pm: p.m / p.ht, pn: p.m / p.ht - scRate, pu: p.achat / Math.max(p.q, 1), pv: p.ht / Math.max(p.q, 1),
    }));
    const key = { ht: (p) => -p.ht, pm: (p) => p.pn, m: (p) => -p.m }[sort];
    return r.sort((a, b) => key(a) - key(b));
  }, [q, sort, det]);
  const tot = rows.reduce((t, p) => ({ ht: t.ht + p.ht, a: t.a + p.achat, f: t.f + p.frais, m: t.m + p.m }), { ht: 0, a: 0, f: 0, m: 0 });
  const losers = rows.filter((p) => p.pn < 0);
  const heat = (v) => (v < 0 ? VZ.bad : v < 0.05 ? "#FFB020" : VZ.good);
  const Bar3 = ({ p }) => (
    <div className="flex h-2 w-full rounded-full overflow-hidden" style={{ background: VZ.bg }} title="achat · frais marketplace · transport moyen · marge">
      <span style={{ width: `${Math.min(p.pa, 1) * 100}%`, background: "#9085e9" }} />
      <span style={{ width: `${Math.min(p.pf, 1) * 100}%`, background: POSTE.com.c }} />
      <span style={{ width: `${scRate * 100}%`, background: POSTE.sc.c }} />
      <span style={{ width: `${Math.max(p.pn, 0) * 100}%`, background: VZ.good }} />
    </div>
  );
  return (
    <Box>
      <H sub={`${det.y1} à date, toutes marketplaces avec détail produit (Leroy Merlin, enseignes Mirakl, Amazon). Coût d’achat = ${det.ach_src || "prix FOB + approche"}. Frais marketplace directs = commission (et FBA pour Amazon). Transport et supply chain imputés au taux moyen (${pc(scRate)} des ventes HT) ; la publicité n’est pas déduite ici.`}>Marge par produit</H>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat label="Ventes HT analysées" value={keu(tot.ht)} sub={`${rows.length} références`} />
        <Stat label="Coût d’achat" value={pc(tot.a / tot.ht)} sub={keu(tot.a)} />
        <Stat label="Marge après achat et commission" value={pc(tot.m / tot.ht)} sub={keu(tot.m) + " avant pub et transport"} />
        <Stat label="Références sous l’eau" value={String(losers.length)} sub={losers.length ? `après transport moyen · ${keu(losers.reduce((t, p) => t + p.ht, 0))} de ventes` : "aucune"} color={losers.length ? VZ.bad : VZ.good} />
      </div>
      <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between mb-3">
        <Chips items={[["ht", "Plus gros CA"], ["pm", "Marge la plus faible"], ["m", "Plus forte marge €"]]} value={sort} onChange={setSort} label="Tri" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chercher un produit ou un SKU" className="rounded-xl px-3 py-2 text-sm outline-none w-full sm:w-64" style={{ background: VZ.bg, border: `1px solid ${VZ.line}`, color: VZ.text }} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] mb-3" style={{ color: VZ.muted }}>
        {[["Achat", "#9085e9"], ["Frais marketplace", POSTE.com.c], ["Transport moyen", POSTE.sc.c], ["Marge restante", VZ.good]].map(([l, c]) => <span key={l} className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: c }} />{l}</span>)}
      </div>
      {/* mobile : cartes */}
      <div className="sm:hidden space-y-2">
        {rows.slice(0, n).map((p) => (
          <div key={p.sku} className="rounded-xl p-3" style={{ background: VZ.bg }}>
            <div className="flex justify-between gap-3"><div className="text-sm font-medium">{p.nom}</div><b style={{ color: heat(p.pn) }}>{pc(p.pn)}</b></div>
            <div className="text-[11px] mb-2" style={{ color: VZ.dim }}>{p.sku} · {p.q.toLocaleString("fr-FR")} u. · {keu(p.ht)} HT · achat {eur(p.pu, 2)} / prix moyen {eur(p.pv, 2)}</div>
            <Bar3 p={p} />
          </div>
        ))}
      </div>
      {/* ordinateur : tableau */}
      <div className="hidden sm:block overflow-x-auto -mx-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wider" style={{ color: VZ.muted }}>
              <th className="py-2 px-3 text-left font-medium">Produit</th>
              <th className="py-2 px-2 text-right font-medium">Unités</th>
              <th className="py-2 px-2 text-right font-medium">Ventes HT</th>
              <th className="py-2 px-2 text-right font-medium">Prix moyen HT</th>
              <th className="py-2 px-2 text-right font-medium">Coût achat u.</th>
              <th className="py-2 px-2 text-right font-medium">Achat</th>
              <th className="py-2 px-2 text-right font-medium">Frais mkp</th>
              <th className="py-2 px-2 text-right font-medium">Marge avant pub/transp.</th>
              <th className="py-2 px-3 text-left font-medium w-40">Décomposition</th>
              <th className="py-2 px-2 text-right font-medium">Après transport</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, n).map((p) => (
              <tr key={p.sku} className="border-t" style={{ borderColor: VZ.line }}>
                <td className="py-2 px-3"><div className="line-clamp-1">{p.nom}</div><div className="text-[11px]" style={{ color: VZ.dim }}>{p.sku} · {p.canaux.join(", ")}</div></td>
                <td className="py-2 px-2 text-right">{p.q.toLocaleString("fr-FR")}</td>
                <td className="py-2 px-2 text-right whitespace-nowrap">{keu(p.ht)}</td>
                <td className="py-2 px-2 text-right whitespace-nowrap">{eur(p.pv, 2)}</td>
                <td className="py-2 px-2 text-right whitespace-nowrap">{eur(p.pu, 2)}</td>
                <td className="py-2 px-2 text-right whitespace-nowrap" style={{ color: VZ.muted }}>{pc(p.pa)}</td>
                <td className="py-2 px-2 text-right whitespace-nowrap" style={{ color: VZ.muted }}>{pc(p.pf)}</td>
                <td className="py-2 px-2 text-right whitespace-nowrap">{keu(p.m)} <span className="text-xs" style={{ color: VZ.muted }}>({pc(p.pm)})</span></td>
                <td className="py-2 px-3"><Bar3 p={p} /></td>
                <td className="py-2 px-2 text-right font-semibold whitespace-nowrap" style={{ color: heat(p.pn) }}>{pc(p.pn)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > n && <button onClick={() => setN(n + 25)} className="mt-3 text-xs rounded-lg px-3 py-1.5" style={{ color: ORANGE2, background: "rgba(255,90,31,.08)" }}>Afficher plus ({rows.length - n} restantes)</button>}
      <p className="text-[11px] mt-3 leading-relaxed" style={{ color: VZ.dim }}>Prix d’achat 2026 de la base produits de la supply chain. Les produits vendus en promotion (ex. ARIA à 59,90–69,90 € TTC) laissent peu de marge une fois le transport payé ; c’est cohérent avec le fichier de calcul tarifaire, qui prévoit une marge négative sur plusieurs versions « PROMO ».</p>
    </Box>
  );
}

// =====================================================================================================
// 6. L'ESSENTIEL : 3 messages clés, alertes budget / plafonds de frais, fraîcheur des données
export function Essentiel({ d, onGo }) {
  const P = d.pl, T = P.t26, O = P.t25, det = d.det || {};
  const ch = P.ch.map((c) => ({ c, ...P.p26[c] })).filter((x) => x.ht > 50000);
  const worst = ch.filter((x) => x.mnpct != null).sort((a, b) => a.mnpct - b.mnpct)[0];
  const best = ch.filter((x) => x.mnpct != null).sort((a, b) => b.mnpct - a.mnpct)[0];
  const scR = T.sc != null ? -T.sc / T.ht : 0;
  const losers = (det.marg_prod || []).filter((p) => p.ht >= 20000 && p.m / p.ht - scR < 0);
  const ax = d.axes && d.axes.glob ? [...d.axes.glob].sort((a, b) => b.gain - a.gain)[0] : null;
  const msgs = [];
  if (T.mn != null) msgs.push({ tone: T.mnpct < 0.05 ? "bad" : "good", t: `Marge nette ${pc(T.mnpct)} des ventes HT`, s: `${keu(T.mn)} après frais de vente, transport et achats (${pc(-T.achat / T.ht)}). ${best ? `Meilleur canal : ${best.c} (${pc(best.mnpct)})` : ""}${worst && worst.mnpct < 0 ? ` · ${worst.c} perd de l’argent (${pc(worst.mnpct)}, ${keu(worst.mn)})` : ""}.`, go: "pl" });
  msgs.push({ tone: -T.fv / T.ht > -O.fv / O.ht ? "bad" : "good", t: `Frais de vente ${pc(-T.fv / T.ht)} (${pts(-T.fv / T.ht + O.fv / O.ht)} sur un an)`, s: ax ? `Premier levier : ${ax.poste.toLowerCase()}, ${pc(ax.r26)} contre ${pc(ax.r25)} en ${P.y0} – retour à la cible = ${keu(ax.gain)} à date (${keu(ax.gain_an)} sur un an).` : "", go: "plan" });
  if (losers.length) msgs.push({ tone: "bad", t: `${losers.length} grosses références vendues à perte après transport`, s: `Parmi celles à plus de 20 k€ de ventes : ${losers.slice(0, 3).map((p) => p.nom).join(", ")}… soit ${keu(losers.reduce((t, p) => t + p.ht, 0))} de ventes HT à revoir (prix, promos ou achat).`, go: "pl" });
  // alertes
  const al = [];
  (d.disp || []).forEach((x) => { if (x.budget_ytd > 0 && x.reel > x.budget_ytd * 1.1) al.push(`${x.canal} · ${x.disp} : ${keu(x.reel)} dépensés pour ${keu(x.budget_ytd)} de budget à date (+${Math.round((x.reel / x.budget_ytd - 1) * 100)} %)`); });
  P.ch.forEach((c) => { const a = P.p26[c], b = O && d.det && d.det.mp[c] ? d.det.mp[c].y0 : null; if (a.ht > 50000 && b && b.ht && (-a.fv / a.ht) - (b.fv / b.ht) > 0.03) al.push(`${c} : frais de vente ${pc(-a.fv / a.ht)} contre ${pc(b.fv / b.ht)} en ${P.y0}`); });
  // fraîcheur
  const fresh = [
    ["Leroy Merlin + enseignes Mirakl", `API · au ${d.cutoff}`, "ok"],
    ["Amazon", "navigateur · figé au 28/10", "warn"],
    ["Cdiscount", "navigateur · figé au 28/10", "warn"],
    ["Site bestherm.fr", `app de pilotage · au ${d.cutoff}`, "ok"],
    ["Transport & supply chain", `réel jusqu’à ${P.sup_last ? moisFR(P.sup_last) : "?"}, prolongé ensuite`, "warn"],
    ["Prix d’achat", "base produits supply chain · 27/10", "ok"],
  ];
  const col = { good: VZ.good, bad: VZ.bad, ok: VZ.good, warn: "#FFB020" };
  return (
    <Box>
      <H sub={`Ce qu’il faut retenir au ${d.cutoff}, recalculé à chaque mise à jour.`}>L’essentiel</H>
      <div className="grid md:grid-cols-3 gap-3">
        {msgs.slice(0, 3).map((m, i) => (
          <button key={i} onClick={() => onGo && onGo(m.go)} className="text-left rounded-xl p-4 transition hover:brightness-110" style={{ background: VZ.bg, borderLeft: `3px solid ${col[m.tone]}` }}>
            <div className="text-sm font-semibold" style={{ color: col[m.tone] }}>{m.t}</div>
            <div className="text-xs mt-1.5 leading-relaxed" style={{ color: VZ.muted }}>{m.s}</div>
          </button>
        ))}
      </div>
      {al.length > 0 && (
        <div className="mt-4 rounded-xl p-3" style={{ background: "rgba(240,68,56,.06)", border: "1px solid rgba(240,68,56,.25)" }}>
          <div className="text-xs font-semibold mb-1.5" style={{ color: VZ.bad }}>Alertes ({al.length})</div>
          <ul className="text-xs space-y-1" style={{ color: VZ.text }}>{al.slice(0, 6).map((a, i) => <li key={i}>• {a}</li>)}</ul>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {fresh.map(([k, v, s]) => (
          <span key={k} className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px]" style={{ background: VZ.bg, color: VZ.muted }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: col[s] }} /><b style={{ color: VZ.text, fontWeight: 500 }}>{k}</b> {v}
          </span>
        ))}
      </div>
    </Box>
  );
}
