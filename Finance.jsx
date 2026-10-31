// Page « Analyse financière » — accès réservé par code, données chiffrées (AES-256-GCM).
// Les données (public/finance-data.json) ne sont lisibles qu'avec le code : la clé de données est
// emballée par une clé dérivée du code (PBKDF2-SHA256, 600 000 itérations). Rien n'est envoyé à un serveur.
import React, { useMemo, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Bar, Line, XAxis, YAxis, Tooltip, CartesianGrid, Legend,
  BarChart, PieChart, Pie, Cell,
} from "recharts";
import { Download, Lock, TrendingUp, TrendingDown, AlertTriangle, Percent, Megaphone, Truck, Store, LogOut, Search, Wallet } from "lucide-react";

const C = {
  bg: "#0A0908", card: "#16140F", line: "#26221B", text: "#F5F1EA", muted: "#948C7E", dim: "#6B6459",
  orange: "#FF5A1F", orange2: "#FF8A50", blue: "#4A9EFF", amber: "#FFB020", green: "#3DD68C", red: "#FF4D4F",
};
import { Waterfall, CostStructure, ChannelMap, MonthlyViz, VZ } from "./FinanceViz.jsx";
import { MarketplacePL, Refunds, AdsDetail, TransportExplain, ProductMargin, Chips as DChips } from "./FinanceDetail.jsx";
const CH_COLORS = VZ.series;

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (h) => Uint8Array.from(h.match(/../g).map((x) => parseInt(x, 16)));
const getBlob = () => fetch("/finance-data.json", { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error("absent"); return r.json(); });
async function openData(blob, raw) {
  const key = await crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["decrypt"]);
  const gz = await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(blob.data.iv) }, key, b64(blob.data.ct));
  const txt = await new Response(new Blob([gz]).stream().pipeThrough(new DecompressionStream("gzip"))).text();
  return JSON.parse(txt);
}
// Code d'accès → clé de données (hex). Lève une erreur si le code est faux.
export async function unlockFinance(code) {
  const blob = await getBlob();
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(code.normalize("NFC")), "PBKDF2", false, ["deriveKey"]);
  const kek = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: b64(blob.kdf.salt), iterations: blob.kdf.iter, hash: "SHA-256" },
    base, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  const raw = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: b64(blob.wrap.iv) }, kek, b64(blob.wrap.ct)));
  await openData(blob, raw);
  return hex(raw);
}
// Mémorisation de la clé sur l'appareil (même durée que « se souvenir de moi », sinon la session de l'onglet)
const FK = "homy_fin_k", FK_UNTIL = "homy_fin_until";
export function storeFinanceKey(k, days) {
  try {
    if (days) { localStorage.setItem(FK, k); localStorage.setItem(FK_UNTIL, String(Date.now() + days * 86400000)); }
    else sessionStorage.setItem(FK, k);
  } catch { /* stockage indisponible */ }
}
export function getFinanceKey() {
  try {
    const s = sessionStorage.getItem(FK); if (s) return s;
    const l = localStorage.getItem(FK), u = Number(localStorage.getItem(FK_UNTIL));
    if (l && u > Date.now()) return l;
    localStorage.removeItem(FK); localStorage.removeItem(FK_UNTIL);
  } catch { /* stockage indisponible */ }
  return null;
}
export function clearFinanceKey() {
  try { sessionStorage.removeItem(FK); localStorage.removeItem(FK); localStorage.removeItem(FK_UNTIL); } catch { /* ignoré */ }
}

const eur = (v, d = 0) => (v == null ? "–" : v.toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d }) + " €");
const keur = (v) => (v == null ? "–" : Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " M€" : Math.round(v / 1000).toLocaleString("fr-FR") + " k€");
const pct = (v, d = 1) => (v == null || !isFinite(v) ? "–" : (v * 100).toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d }) + " %");
const pts = (v) => (v == null || !isFinite(v) ? "–" : (v >= 0 ? "+" : "") + (v * 100).toLocaleString("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + " pt");
const moisFR = (m) => { const [y, mo] = m.split("-"); return ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."][+mo - 1] + " " + y.slice(2); };

function Card({ children, className = "" }) {
  return <div className={`rounded-2xl border p-5 ${className}`} style={{ background: C.card, borderColor: C.line }}>{children}</div>;
}
function Title({ children, sub }) {
  return (
    <div className="mb-4">
      <h2 className="text-base font-semibold tracking-tight" style={{ color: C.text }}>{children}</h2>
      {sub && <p className="text-xs mt-1" style={{ color: C.muted }}>{sub}</p>}
    </div>
  );
}
function Kpi({ icon: Icon, label, value, delta, deltaGood, sub }) {
  const good = deltaGood;
  return (
    <Card>
      <div className="flex items-center gap-2 text-xs uppercase tracking-wider" style={{ color: C.muted }}>
        <Icon size={14} /> {label}
      </div>
      <div className="mt-3 text-2xl sm:text-3xl font-bold" style={{ color: C.text, fontFamily: "'Archivo Black', sans-serif" }}>{value}</div>
      {delta && (
        <div className="mt-2 inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-full"
          style={{ background: good ? "rgba(61,214,140,.12)" : "rgba(255,77,79,.12)", color: good ? C.green : C.red }}>
          {good ? <TrendingUp size={12} /> : <TrendingDown size={12} />} {delta}
        </div>
      )}
      {sub && <div className="mt-2 text-xs" style={{ color: C.dim }}>{sub}</div>}
    </Card>
  );
}
const tipStyle = { background: "#1E1B15", border: `1px solid ${C.line}`, borderRadius: 12, color: C.text, fontSize: 12 };

function Login({ onOk, inline, note }) {
  const [code, setCode] = useState(""); const [err, setErr] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr("");
    try {
      const k = await unlockFinance(code); storeFinanceKey(k, 0); onOk(k);
    } catch { setErr("Code incorrect."); }
    setBusy(false);
  };
  return (
    <div className={`${inline ? "py-16" : "min-h-screen"} flex items-center justify-center px-4`} style={{ background: inline ? "transparent" : C.bg }}>
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl border p-8" style={{ background: C.card, borderColor: C.line }}>
        <div className="w-12 h-12 rounded-2xl flex items-center justify-center mb-6" style={{ background: "rgba(255,90,31,.12)" }}>
          <Lock size={22} color={C.orange} />
        </div>
        <h1 className="text-xl font-bold" style={{ color: C.text, fontFamily: "'Archivo Black', sans-serif" }}>Analyse financière</h1>
        <p className="text-sm mt-1 mb-6" style={{ color: C.muted }}>Espace réservé. Saisis ton code d’accès.</p>
        <input type="password" autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="Code d’accès"
          className="w-full rounded-xl px-4 py-3 outline-none text-sm" style={{ background: C.bg, border: `1px solid ${C.line}`, color: C.text }} />
        {note && !err && <p className="text-xs mt-2" style={{ color: C.amber }}>{note}</p>}
        {err && <p className="text-xs mt-2" style={{ color: C.red }}>{err}</p>}
        <button disabled={busy || !code} className="w-full mt-5 rounded-xl py-3 text-sm font-semibold transition disabled:opacity-50"
          style={{ background: C.orange, color: "#fff" }}>{busy ? "Déchiffrement…" : "Accéder"}</button>
        <p className="text-[11px] mt-5 leading-relaxed" style={{ color: C.dim }}>Les données sont chiffrées et déchiffrées uniquement dans ton navigateur.</p>
      </form>
    </div>
  );
}

function Dashboard({ d, onLogout, embedded }) {
  const pers = [...new Set(d.synth.map((s) => s.per))];
  const [period, setPeriod] = useState(pers[pers.length - 1]);
  const dm = d.cutoff.slice(0, 5);
  const dLong = new Date(d.cutoff.split("/").reverse().join("-")).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  const [prodTab, setProdTab] = useState("lm");
  const [q, setQ] = useState("");
  const chans = d.channels;
  const tot = d.glob.find((g) => g.name === "TOTAL");
  const rowsG = d.glob.filter((g) => g.name !== "TOTAL");
  const f26 = tot ? (tot.c26 + tot.p26 + tot.o26) / tot.v26 : 0;
  const monthly = d.monthly.map((m) => {
    const o = { m: moisFR(m.m) };
    chans.forEach((c) => (o[c] = m.ch[c]?.v || 0));
    o.pf = m.tot.v ? (m.tot.c + m.tot.p + m.tot.o) / m.tot.v : null;
    return o;
  });
  const [cat, setCat] = useState("Toutes");
  const SECTIONS = [["pl", "Compte d’exploitation"], ["plan", "Plan d’action"], ["frais", "Canaux et catégories"], ["ref", "Remboursements"], ["pub", "Publicité et produits"], ["log", "Transport et logistique"], ["evo", "Évolution"]];
  const [plv, setPlv] = useState("Consolidé");
  const [sec, setSec] = useState(() => { try { const v = sessionStorage.getItem("homy_fin_sec"); if (v && SECTIONS.some((x) => x[0] === v)) return v; } catch { /* ignoré */ } return "pl"; });
  React.useEffect(() => { try { sessionStorage.setItem("homy_fin_sec", sec); } catch { /* ignoré */ } }, [sec]);
  const [xl, setXl] = useState("");
  const exportXlsx = async () => {
    setXl("…");
    try {
      const k = getFinanceKey(); if (!k) throw new Error("clé");
      const buf = new Uint8Array(await fetch("/finance-workbook.enc", { cache: "no-store" }).then((r) => { if (!r.ok) throw new Error("absent"); return r.arrayBuffer(); }));
      const key = await crypto.subtle.importKey("raw", unhex(k), "AES-GCM", false, ["decrypt"]);
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: buf.slice(0, 12) }, key, buf.slice(12));
      const url = URL.createObjectURL(new Blob([plain], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
      const a = document.createElement("a"); a.href = url; a.download = `Analyse_financiere_HOMY_${d.cutoff.split("/").reverse().join("-")}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000); setXl("");
    } catch { setXl("Export indisponible"); setTimeout(() => setXl(""), 3000); }
  };
  const ExportBtn = () => (
    <button onClick={exportXlsx} disabled={xl === "…"} className="rounded-xl px-3 py-2 text-xs font-semibold flex items-center gap-2 whitespace-nowrap shrink-0 transition disabled:opacity-60" style={{ background: C.orange, color: "#fff" }}>
      <Download size={14} /> {xl || "Exporter Excel"}
    </button>
  );
  const [diagTab, setDiagTab] = useState("ok");
  const [mp, setMp] = useState("Global");
  const MPS = ["Global", ...((d.pl && d.pl.ch) || [])];
  const GLOBAL_TAGS = ["Global", "Données", "Publicité", "Logistique", "Canaux", "Catégories"];
  const matchMp = (canal) => mp === "Global" || (canal || "").includes(mp) || GLOBAL_TAGS.includes(canal);
  const CATS = ["Toutes", ...[...new Set((d.cats || []).map((x) => x.cat))].filter((x) => x !== "Non ventilé")];
  const nm = (n) => (n.startsWith("Leroy Merlin") ? "Leroy Merlin" : n);
  const estSet = new Set((d.est || []).map(nm));
  const aggCat = (p) => {
    const by = {};
    (d.cats || []).filter((x) => x.cat === cat && x.per === p).forEach((x) => {
      const k = nm(x.name); const a = (by[k] = by[k] || { name: k, v: 0, c: 0, p: 0, o: 0, est: x.est });
      a.v += x.v; a.c += x.c; a.p += x.p; a.o += x.o;
    });
    return Object.values(by).sort((a, b) => b.v - a.v);
  };
  const sumRows = (rows, label) => rows.reduce((t, r) => ({ ...t, v: t.v + r.v, c: t.c + r.c, p: t.p + r.p, o: t.o + r.o }), { name: label, v: 0, c: 0, p: 0, o: 0 });
  const per = cat === "Toutes" ? d.synth.filter((s) => s.per === period && !s.sub && !s.name.startsWith("TOTAL")).map((s) => ({ ...s, est: false })) : aggCat(period);
  const perTot = cat === "Toutes" ? d.synth.find((s) => s.per === period && s.name.startsWith("TOTAL")) : sumRows(per, "Total");
  const fr = (r) => (r && r.v ? (r.c + r.p + r.o) / r.v : 0);
  const costBars = cat === "Toutes"
    ? rowsG.map((g) => ({ name: g.name, "2025": g.f25, "2026": g.v26 ? (g.c26 + g.p26 + g.o26) / g.v26 : 0 }))
    : (() => { const a = aggCat(pers[1]), b = aggCat(pers[2]); return b.map((r) => ({ name: r.name, "2025": fr(a.find((x) => x.name === r.name)), "2026": fr(r) })); })();
  const mix = perTot ? [
    { name: "Commission", v: perTot.c, c: C.orange }, { name: "Publicité", v: perTot.p, c: C.blue }, { name: "Logistique marketplace", v: perTot.o, c: C.amber },
  ] : [];
  const prods = (prodTab === "lm" ? d.lm_products : d.amz_products).filter((p) => !q || (p.nom + " " + p.sku).toLowerCase().includes(q.toLowerCase()));
  const prioColor = { "Élevée": C.red, "Moyenne": C.amber, "Faible": C.muted, "Info": C.blue };
  const heat = (v) => (v == null ? C.muted : v >= 0.35 ? C.red : v >= 0.2 ? C.amber : C.green);

  return (
    <div className={embedded ? "" : "min-h-screen"} style={{ background: embedded ? "transparent" : C.bg, color: C.text, fontFamily: "'Inter', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Archivo+Black&family=Inter:wght@400;500;600;700&display=swap');`}</style>
      {embedded ? (
        <div className="flex flex-wrap items-end justify-between gap-2 mb-2">
          <div>
            <div className="text-xs uppercase tracking-[0.2em]" style={{ color: C.orange }}>Accès réservé</div>
            <h2 className="text-xl font-bold" style={{ fontFamily: "'Archivo Black', sans-serif" }}>Analyse financière des canaux</h2>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[11px] sm:text-xs" style={{ color: C.muted }}>Données au {d.cutoff} · mise à jour {new Date(d.generated).toLocaleDateString("fr-FR")}</span>
            <ExportBtn />
          </div>
        </div>
      ) : <header className="sticky top-0 z-10 border-b backdrop-blur" style={{ background: "rgba(10,9,8,.85)", borderColor: C.line }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.2em]" style={{ color: C.orange }}>hom'y · pilotage</div>
            <h1 className="text-lg sm:text-xl font-bold" style={{ fontFamily: "'Archivo Black', sans-serif" }}>Analyse financière des canaux</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-xs" style={{ color: C.muted }}>Données au {d.cutoff} · mise à jour {new Date(d.generated).toLocaleDateString("fr-FR")}</span>
            <ExportBtn />
            <button onClick={onLogout} className="rounded-xl px-3 py-2 text-xs flex items-center gap-2 border" style={{ borderColor: C.line, color: C.muted }}>
              <LogOut size={14} /> Quitter
            </button>
          </div>
        </div>
      </header>}

      <main className={embedded ? "space-y-6" : "max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6"}>
        {d.pl && (() => {
          const T = d.pl.t26, O = d.pl.t25;
          return (
            <section className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1 snap-x lg:grid lg:grid-cols-3 xl:grid-cols-6 lg:gap-4 lg:overflow-visible [&>*]:min-w-[200px] [&>*]:shrink-0 [&>*]:snap-start lg:[&>*]:min-w-0">
              <Kpi icon={Store} label={`Ventes HT ${d.pl.y1} à date`} value={keur(T.ht)} delta={pct(T.ht / O.ht - 1) + " vs " + d.pl.y0} deltaGood={T.ht >= O.ht} sub={`1er janv. – ${dLong}`} />
              <Kpi icon={Percent} label="Frais de vente" value={pct(-T.fv / T.ht)} delta={pts(-T.fv / T.ht + O.fv / O.ht) + " vs " + d.pl.y0} deltaGood={-T.fv / T.ht <= -O.fv / O.ht} sub={`${keur(-T.fv)} · commission, pub, logistique marketplace`} />
              <Kpi icon={Truck} label="Transport & supply chain" value={pct(-T.sc / T.ht)} sub={`${keur(-T.sc)} · livraison, entrepôt, stockage`} />
              <Kpi icon={Megaphone} label="Publicité totale" value={pct(-(T.pub + T.pubnc) / T.ht)} sub={`${keur(-(T.pub + T.pubnc))} dont ${keur(-T.pubnc)} hors relevé`} />
              <Kpi icon={TrendingUp} label="Contribution" value={keur(T.contrib)} sub={`${pct(T.pct)} des ventes HT, avant achats produits`} />
              {T.mn != null && <Kpi icon={Wallet} label="Marge nette" value={keur(T.mn)} sub={`${pct(T.mnpct)} des ventes HT · achats ${pct(-T.achat / T.ht)}, avant frais fixes`} />}
            </section>
          );
        })()}
        {!d.pl && tot && (
          <section className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            <Kpi icon={Store} label="Ventes 2026 à date" value={keur(tot.v26)} delta={pct(tot.v26 / tot.v25 - 1) + " vs 2025"} deltaGood={tot.v26 >= tot.v25} sub={`1er janv. – ${dLong}, TTC net`} />
            <Kpi icon={Percent} label="Coût des canaux" value={pct(f26)} delta={pts(f26 - tot.f25) + " vs 2025"} deltaGood={f26 <= tot.f25} sub="commission + pub + logistique" />
            <Kpi icon={Percent} label="Commissions" value={keur(tot.c26)} sub={pct(tot.c26 / tot.v26) + " des ventes"} />
            <Kpi icon={Megaphone} label="Publicité" value={keur(tot.p26)} sub={pct(tot.p26 / tot.v26) + " des ventes"} />
            <Kpi icon={Truck} label="Logistique marketplace" value={keur(tot.o26)} sub={pct(tot.o26 / tot.v26) + " des ventes"} />
          </section>
        )}

        <div className="sticky z-[5] -mx-1 px-1 py-2" style={{ top: embedded ? 0 : 72, background: embedded ? "rgba(10,9,8,.94)" : C.bg }}>
          <div className="flex gap-1 overflow-x-auto rounded-xl p-1 text-sm" style={{ background: C.card, border: `1px solid ${C.line}` }} role="tablist" aria-label="Sections">
            {SECTIONS.map(([k, l]) => (
              <button key={k} role="tab" aria-selected={sec === k} onClick={() => setSec(k)} className="px-4 py-2 rounded-lg whitespace-nowrap transition" style={{ background: sec === k ? C.orange : "transparent", color: sec === k ? "#fff" : C.muted, fontWeight: sec === k ? 600 : 400 }}>{l}</button>
            ))}
          </div>
        </div>

        {sec === "pl" && (<>
        {d.pl && d.det && (
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <span className="text-xs uppercase tracking-wider" style={{ color: C.muted }}>Vue</span>
            <DChips items={["Consolidé", ...d.pl.ch]} value={plv} onChange={setPlv} label="Marketplace" />
          </div>
        )}
        {d.pl && d.det && plv !== "Consolidé" && (
          <Card>
            <div className="mb-5"><Waterfall pl={d.pl} ch={plv} /></div>
            <h3 className="text-sm font-semibold mb-3">Compte d’exploitation · {plv}</h3>
            <MarketplacePL det={d.det} ch={plv} y1={d.det.y1} y0={d.det.y0} />
          </Card>
        )}
        {d.pl && (plv === "Consolidé" || !d.det) && (
          <>
            <Card><Waterfall pl={d.pl} /></Card>
            <div className="grid xl:grid-cols-2 gap-6">
              <Card><CostStructure pl={d.pl} /></Card>
              <Card><ChannelMap pl={d.pl} axes={d.axes} /></Card>
            </div>
          </>
        )}
        {(plv === "Consolidé" || !d.det) && d.pl && (() => {
          const P = d.pl; const cols = P.ch;
          const fmtv = (k, v) => (v == null ? "n.d." : k === "pct" || k === "mnpct" ? pct(v) : eur(v));
          const key = new Set(["ht", "fv", "mfv", "tfv", "contrib", "mn"]);
          const neg = (k) => !["ttc", "ht", "mfv", "contrib", "pct", "mn", "mnpct"].includes(k);
          const share = (t, k) => (t[k] != null && t.ht && !["ttc", "tva", "pct", "mnpct"].includes(k) ? pct(t[k] / t.ht) : "");
          return (
            <Card>
              <Title sub={`Du chiffre d’affaires à la contribution, 1er janv. – ${dLong} ${P.y1}. Montants HT, frais en négatif. Transport et supply chain réels jusqu’à ${moisFR(P.sup_last)}, prolongés au même ratio ensuite ; pub hors relevé estimée sur budget.`}>Compte d’exploitation des canaux</Title>
              <div className="overflow-x-auto -mx-1">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wider" style={{ color: C.muted }}>
                      <th className="py-2 px-3 text-left font-medium sticky left-0 z-[1]" style={{ background: C.card }}>Poste</th>
                      <th className="py-2 px-3 text-right font-medium whitespace-nowrap" style={{ color: C.orange2 }}>Total {P.y1}</th>
                      <th className="py-2 px-2 text-right font-medium">% HT</th>
                      <th className="py-2 px-3 text-right font-medium whitespace-nowrap">Total {P.y0}</th>
                      <th className="py-2 px-2 text-right font-medium">% HT</th>
                      {cols.map((c) => <th key={c} className="py-2 px-3 text-right font-medium whitespace-nowrap">{c}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {P.lines.map(([lab, k]) => {
                      const strong = key.has(k);
                      return (
                        <tr key={k} className="border-t" style={{ borderColor: C.line, background: strong ? "rgba(255,90,31,.05)" : "transparent" }}>
                          <td className={`py-2 px-3 sticky left-0 z-[1] ${strong ? "font-semibold" : ""} ${neg(k) ? "pl-6" : ""}`} style={{ background: strong ? "#1d1812" : C.card, color: k === "contrib" || k === "mn" ? C.orange2 : C.text, minWidth: 220 }}>{lab}</td>
                          <td className="py-2 px-3 text-right whitespace-nowrap font-semibold" style={{ color: ["contrib", "pct", "mn", "mnpct"].includes(k) ? C.orange2 : C.text }}>{fmtv(k, P.t26[k])}</td>
                          <td className="py-2 px-2 text-right whitespace-nowrap text-xs" style={{ color: C.muted }}>{share(P.t26, k)}</td>
                          <td className="py-2 px-3 text-right whitespace-nowrap" style={{ color: C.muted }}>{fmtv(k, P.t25[k])}</td>
                          <td className="py-2 px-2 text-right whitespace-nowrap text-xs" style={{ color: C.dim }}>{share(P.t25, k)}</td>
                          {cols.map((c) => {
                            const v = P.p26[c][k];
                            return <td key={c} className={`py-2 px-3 text-right whitespace-nowrap ${strong ? "font-semibold" : ""}`} style={{ color: k === "pct" ? heat(0.75 - (v || 0)) : k === "mnpct" ? heat(0.12 - (v || 0)) : v === 0 ? C.dim : C.text }}>{v === 0 ? "–" : fmtv(k, v)}</td>;
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[11px] mt-3 leading-relaxed" style={{ color: C.dim }}>
                Pub non comptée estimée : {Object.entries(P.nc).map(([k, v]) => `${k} ${keur(v)}`).join(", ")}. {P.y0} : pas de données de transport, contribution non calculée. ManoMano non inclus (non connecté). Coût d’achat : prix FOB 2026 + coût logistique d’approche par référence (Base produits ONLINE de la supply chain), exact par ligne de commande pour Leroy Merlin et les enseignes Mirakl{P.ach_est ? " ; " + Object.entries(P.ach_est).map(([k, v]) => `${k} : ${v}`).join(" ; ") : ""}. Les prix 2026 sont aussi appliqués à {P.y0}. Marge nette = avant frais fixes (salaires, loyers, SAV).
              </p>
            </Card>
          );
        })()}
        {d.det && d.det.marg_prod && d.det.marg_prod.length > 0 && <ProductMargin det={d.det} pl={d.pl} />}
        </>)}

        {sec === "plan" && (<>
        {d.axes && (() => {
          const A = d.axes;
          const rows = mp === "Global" ? A.glob.map((g) => ({ ...g, canal: "Tous canaux" })) : A.rows.filter((r) => r.canal === mp);
          const tops = mp === "Global" ? A.rows.filter((r) => r.gain > 500).slice(0, 6) : rows.filter((r) => r.gain > 0);
          const g = rows.reduce((t, r) => t + r.gain, 0), gan = rows.reduce((t, r) => t + r.gain_an, 0);
          const mx = Math.max(0.05, ...rows.map((r) => Math.max(r.r26 || 0, r.r25 || 0)));
          const colK = { com: C.orange, pub: C.blue, logmp: C.amber, sc: "#B57BFF" };
          return (
            <Card>
              <div className="flex flex-col gap-3 mb-5">
                <Title sub="Chaque poste de frais en % des ventes HT, comparé à sa cible (taux de l’an dernier quand il était plus bas, sinon cible opérationnelle). Le gain est l’écart appliqué aux ventes.">Axes d’amélioration</Title>
                <div className="flex gap-1 overflow-x-auto rounded-xl p-1 text-xs" style={{ background: C.bg }} role="tablist" aria-label="Marketplace">
                  {MPS.map((k) => (
                    <button key={k} onClick={() => setMp(k)} className="px-3 py-1.5 rounded-lg whitespace-nowrap transition"
                      style={{ background: mp === k ? C.orange : "transparent", color: mp === k ? "#fff" : C.muted, fontWeight: mp === k ? 600 : 400 }}>{k}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-5">
                <div className="rounded-xl p-4" style={{ background: "rgba(61,214,140,.06)", border: "1px solid rgba(61,214,140,.2)" }}>
                  <div className="text-[11px] uppercase tracking-wider" style={{ color: C.muted }}>Gain potentiel à date</div>
                  <div className="text-2xl font-bold mt-1" style={{ color: C.green, fontFamily: "'Archivo Black', sans-serif" }}>{keur(g)}</div>
                  <div className="text-xs" style={{ color: C.dim }}>{d.pl ? pct(g / (mp === "Global" ? d.pl.t26.ht : d.pl.p26[mp].ht)) + " des ventes HT" : ""}</div>
                </div>
                <div className="rounded-xl p-4" style={{ background: C.bg }}>
                  <div className="text-[11px] uppercase tracking-wider" style={{ color: C.muted }}>En année pleine</div>
                  <div className="text-2xl font-bold mt-1" style={{ fontFamily: "'Archivo Black', sans-serif" }}>{keur(gan)}</div>
                  <div className="text-xs" style={{ color: C.dim }}>saisonnalité de l’an dernier (×{String(A.f_an).replace(".", ",")})</div>
                </div>
              </div>
              <div className="space-y-4">
                {rows.map((r) => (
                  <div key={r.k}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
                      <span className="font-medium">{r.poste}</span>
                      <span className="whitespace-nowrap"><span style={{ color: C.muted }}>{r.r25 != null ? pct(r.r25) + " → " : ""}</span><b>{pct(r.r26)}</b> <span style={{ color: C.dim }}>· cible {pct(r.tgt)}</span> <span className="ml-2 font-semibold" style={{ color: r.gain > 0 ? C.green : C.dim }}>{r.gain > 0 ? "+" + keur(r.gain) : "à niveau"}</span></span>
                    </div>
                    <div className="relative h-2.5 rounded-full mt-2" style={{ background: C.bg }}>
                      <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${(r.r26 / mx) * 100}%`, background: colK[r.k], opacity: 0.9 }} />
                      <div className="absolute -top-1 -bottom-1 w-0.5 rounded" style={{ left: `${(r.tgt / mx) * 100}%`, background: C.green }} title="cible" />
                      {r.r25 != null && <div className="absolute -top-1 -bottom-1 w-0.5 rounded" style={{ left: `${(r.r25 / mx) * 100}%`, background: C.text, opacity: 0.5 }} title="an dernier" />}
                    </div>
                    {mp === "Global" ? (r.top && <p className="text-xs mt-1.5" style={{ color: C.dim }}>Principaux gisements : {r.top}</p>)
                      : <p className="text-xs mt-1.5" style={{ color: C.dim }}>{r.base}</p>}
                  </div>
                ))}
                <div className="flex flex-wrap gap-4 text-[11px]" style={{ color: C.dim }}>
                  <span className="flex items-center gap-1.5"><span className="w-0.5 h-3" style={{ background: C.green }} />cible</span>
                  <span className="flex items-center gap-1.5"><span className="w-0.5 h-3" style={{ background: C.text, opacity: 0.5 }} />an dernier</span>
                </div>
              </div>
              {tops.length > 0 && (
                <div className="mt-6">
                  <h3 className="text-sm font-semibold mb-3">{mp === "Global" ? "Les 6 leviers les plus importants" : "Actions pour " + mp}</h3>
                  <div className="grid md:grid-cols-2 gap-3">
                    {tops.map((r, i) => (
                      <div key={i} className="rounded-xl p-4 border-l-2" style={{ background: C.bg, borderColor: colK[r.k] }}>
                        <div className="flex items-center justify-between gap-2 text-xs mb-1.5">
                          <span style={{ color: C.muted }}>{r.canal} · {r.poste}</span>
                          <span className="font-semibold whitespace-nowrap" style={{ color: C.green }}>+{keur(r.gain)}</span>
                        </div>
                        <p className="text-sm leading-relaxed">{r.action}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-[11px] mt-4 leading-relaxed" style={{ color: C.dim }}>Gains avant effet sur les ventes : réduire la publicité peut aussi réduire une partie du chiffre d’affaires. Transport : Géodis sur la moitié des envois DPD et incidents divisés par deux (−{pct(A.sc_rate)} du coût).</p>
            </Card>
          );
        })()}

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <Title sub={mp === "Global" ? "Constats chiffrés tirés des données, avec l’action proposée." : `Constats concernant ${mp} et constats globaux (filtre « Axes d’amélioration »).`}>Diagnostic{mp !== "Global" ? " · " + mp : ""}</Title>
            <div className="flex rounded-xl p-1 text-xs" style={{ background: C.bg }} role="tablist">
              {[["ok", `Ce qui fonctionne (${(d.good || []).filter((x) => matchMp(x.canal)).length})`, C.green], ["ko", `Ce qui ne va pas (${d.diag.filter((x) => matchMp(x.canal)).length})`, C.red]].map(([k, l, col]) => (
                <button key={k} onClick={() => setDiagTab(k)} className="px-3 py-1.5 rounded-lg transition" style={{ background: diagTab === k ? col : "transparent", color: diagTab === k ? "#0A0908" : C.muted, fontWeight: diagTab === k ? 600 : 400 }}>{l}</button>
              ))}
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {diagTab === "ok" ? (d.good || []).filter((x) => matchMp(x.canal)).map((x, i) => (
              <div key={i} className="rounded-2xl border p-5" style={{ borderColor: "rgba(61,214,140,.25)", background: "rgba(61,214,140,.04)" }}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs uppercase tracking-wider" style={{ color: C.muted }}>{x.canal}</span>
                  <TrendingUp size={14} color={C.green} />
                </div>
                <h3 className="font-semibold mb-2" style={{ color: C.green }}>{x.titre}</h3>
                <p className="text-sm leading-relaxed" style={{ color: C.muted }}>{x.constat}</p>
                <p className="text-sm mt-3 pl-3 border-l-2 leading-relaxed" style={{ borderColor: C.green, color: C.text }}>{x.action}</p>
              </div>
            )) : d.diag.filter((x) => matchMp(x.canal)).map((x, i) => (
              <div key={i} className="rounded-2xl border p-5" style={{ borderColor: "rgba(255,77,79,.2)", background: "rgba(255,77,79,.03)" }}>
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="text-xs uppercase tracking-wider" style={{ color: C.muted }}>{x.canal}</span>
                  <span className="text-[11px] font-semibold rounded-full px-2 py-0.5" style={{ color: prioColor[x.prio] || C.muted, background: "rgba(255,255,255,.04)" }}>{x.prio}</span>
                </div>
                <h3 className="font-semibold mb-2">{x.titre}</h3>
                <p className="text-sm leading-relaxed" style={{ color: C.muted }}>{x.constat}</p>
                <p className="text-sm mt-3 pl-3 border-l-2 leading-relaxed" style={{ borderColor: C.orange, color: C.text }}>{x.action}</p>
              </div>
            ))}
          </div>
        </Card>
        </>)}

        {sec === "frais" && (<>
        <Card className="!py-4">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Répartition des frais variables</h2>
              <p className="text-xs mt-1" style={{ color: C.muted }}>Filtre par grande catégorie et période : s’applique au coût par canal, à la répartition des frais et à la synthèse.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex flex-wrap rounded-xl p-1 text-xs gap-0.5" style={{ background: C.bg }} role="tablist" aria-label="Catégorie">
                {CATS.map((k) => (
                  <button key={k} onClick={() => setCat(k)} className="px-3 py-1.5 rounded-lg transition"
                    style={{ background: cat === k ? C.orange : "transparent", color: cat === k ? "#fff" : C.muted }}>{k}</button>
                ))}
              </div>
              <div className="flex flex-wrap rounded-xl p-1 text-xs gap-0.5" style={{ background: C.bg }} role="tablist" aria-label="Période">
                {pers.map((p) => (
                  <button key={p} onClick={() => setPeriod(p)} className="px-3 py-1.5 rounded-lg transition"
                    style={{ background: period === p ? C.blue : "transparent", color: period === p ? "#fff" : C.muted }}>{p}</button>
                ))}
              </div>
            </div>
          </div>
          {cat !== "Toutes" && (
            <p className="text-[11px] mt-3 leading-relaxed" style={{ color: C.dim }}>
              Exact pour Leroy Merlin, Castorama, Boulanger, Bricomarché et Maxeda (lignes de commande). Estimation pour Amazon (parts annuelles par produit) et Cdiscount (seulement juil.–sept. 2026, seuls mois avec le détail produit). Le site bestherm.fr et le reste de Cdiscount n’ont pas de détail par produit et n’apparaissent pas ici.
            </p>
          )}
        </Card>

        <div className="grid lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <Title sub={`Commission + pub + logistique, en % des ventes nettes, à période égale (1er janv. – ${dLong}).`}>{`Coût par canal : 2025 vs 2026${cat !== "Toutes" ? " · " + cat : ""}`}</Title>
            <div style={{ height: 300 }}>
              <ResponsiveContainer>
                <BarChart data={costBars} layout="vertical" margin={{ left: 10, right: 20 }}>
                  <CartesianGrid stroke={C.line} horizontal={false} />
                  <XAxis type="number" tick={{ fill: C.muted, fontSize: 11 }} tickFormatter={(v) => Math.round(v * 100) + "%"} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" tick={{ fill: C.text, fontSize: 12 }} width={110} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tipStyle} formatter={(v) => pct(v)} cursor={{ fill: "rgba(255,255,255,.03)" }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar dataKey="2025" fill={C.dim} radius={[0, 4, 4, 0]} barSize={10} />
                  <Bar dataKey="2026" fill={C.orange} radius={[0, 4, 4, 0]} barSize={10} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>
          <Card>
            <Title sub={`Répartition des frais – ${period}${cat !== "Toutes" ? " · " + cat : ""}`}>Où part l’argent</Title>
            <div style={{ height: 220 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={mix} dataKey="v" nameKey="name" innerRadius={60} outerRadius={90} paddingAngle={2} stroke="none">
                    {mix.map((m) => <Cell key={m.name} fill={m.c} />)}
                  </Pie>
                  <Tooltip contentStyle={tipStyle} formatter={(v) => eur(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-2 mt-2">
              {mix.map((m) => (
                <div key={m.name} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2" style={{ color: C.muted }}><span className="w-2.5 h-2.5 rounded-full" style={{ background: m.c }} />{m.name}</span>
                  <span>{keur(m.v)} <span style={{ color: C.dim }}>· {pct(perTot ? m.v / perTot.v : 0)}</span></span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <Title sub={`Ventes nettes TTC, frais HT et poids des frais par canal – ${period}${cat !== "Toutes" ? " · " + cat : ""}.`}>Synthèse par canal</Title>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ color: C.muted }} className="text-xs uppercase tracking-wider">
                  {["Canal", "Ventes", "Part", "Commission", "Pub", "Logistique", "% frais"].map((h, i) => <th key={h} className={`py-2 px-3 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {per.map((s) => {
                  const f = s.v ? (s.c + s.p + s.o) / s.v : 0;
                  return (
                    <tr key={s.name} className="border-t" style={{ borderColor: C.line }}>
                      <td className="py-2.5 px-3 font-medium">{s.name}{cat !== "Toutes" && s.est && <span className="ml-2 text-[10px] font-normal rounded-full px-1.5 py-0.5" style={{ color: C.amber, background: "rgba(255,176,32,.1)" }}>estimation</span>}</td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">{keur(s.v)}</td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap" style={{ color: C.muted }}>{pct(perTot ? s.v / perTot.v : 0)}</td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">{keur(s.c)}</td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">{s.p ? keur(s.p) : "–"}</td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">{s.o ? keur(s.o) : "–"}</td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        <span className="inline-block min-w-[64px] text-center rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: "rgba(255,255,255,.04)", color: heat(f) }}>{pct(f)}</span>
                      </td>
                    </tr>
                  );
                })}
                {perTot && (
                  <tr className="border-t font-semibold" style={{ borderColor: C.line, color: C.orange2 }}>
                    <td className="py-2.5 px-3">Total</td><td className="py-2.5 px-3 text-right whitespace-nowrap">{keur(perTot.v)}</td><td className="py-2.5 px-3 text-right whitespace-nowrap">100 %</td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">{keur(perTot.c)}</td><td className="py-2.5 px-3 text-right whitespace-nowrap">{keur(perTot.p)}</td><td className="py-2.5 px-3 text-right whitespace-nowrap">{keur(perTot.o)}</td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">{pct((perTot.c + perTot.p + perTot.o) / perTot.v)}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        </>)}

        {sec === "evo" && (<>
        <Card><MonthlyViz d={d} /></Card>
        </>)}

        {sec === "log" && (<>
        {d.det && <TransportExplain det={d.det} log={d.log} />}
        {d.log && (() => {
          const L = d.log; const supT = L.sup.reduce((t, x) => t + x.tot, 0);
          const rows = (cat === "Toutes" ? L.ch : L.cat.filter((x) => x.cat === cat)).slice().sort((a, b) => b.cout - a.cout);
          const trT = rows.reduce((t, x) => t + x.cout, 0), trQ = rows.reduce((t, x) => t + x.q, 0);
          const mo = (m) => moisFR(m);
          const sup = L.sup.map((x) => ({ m: mo(x.m), Livraison: x.liv, "Logistique entrepôt": x.log, Stockage: x.stock }));
          const chV = Object.fromEntries(L.ch.map((x) => [x.name, x.v]));
          return (
            <Card>
              <Title sub={`Coûts hors frais marketplace : livraison, entrepôt et stockage (${mo(L.sup[0].m)} – ${mo(L.sup[L.sup.length - 1].m)}), transport facturé par DPD, Chronopost, Géodis et ManoMano rapproché aux commandes (${mo(L.periode[0])} – ${mo(L.periode[1])}).`}>Logistique et transport{cat !== "Toutes" ? " · " + cat : ""}</Title>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                {[["Supply chain", keur(supT), pct(supT / L.v_sup) + " des ventes"], ["Transport", keur(trT), cat === "Toutes" ? "tous canaux" : cat], ["Coût moyen / pièce", eur(trQ ? trT / trQ : 0, 2), trQ.toLocaleString("fr-FR") + " pièces"], ["Incidents transport", keur(L.trp.reduce((t, x) => t + x.inc, 0)), pct(L.trp.reduce((t, x) => t + x.inc, 0) / L.trp.reduce((t, x) => t + x.cout, 0)) + " du transport"]].map(([l, v, sub]) => (
                  <div key={l} className="rounded-xl p-3" style={{ background: C.bg }}>
                    <div className="text-[11px] uppercase tracking-wider" style={{ color: C.muted }}>{l}</div>
                    <div className="text-lg font-bold mt-1">{v}</div>
                    <div className="text-xs" style={{ color: C.dim }}>{sub}</div>
                  </div>
                ))}
              </div>
              <div className="grid lg:grid-cols-2 gap-6">
                <div style={{ height: 260 }}>
                  <ResponsiveContainer>
                    <BarChart data={sup} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid stroke={C.line} vertical={false} />
                      <XAxis dataKey="m" tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => Math.round(v / 1000) + "k"} width={44} />
                      <Tooltip contentStyle={tipStyle} formatter={(v) => eur(v)} cursor={{ fill: "rgba(255,255,255,.03)" }} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="Livraison" stackId="s" fill={C.orange} />
                      <Bar dataKey="Logistique entrepôt" stackId="s" fill={C.blue} />
                      <Bar dataKey="Stockage" stackId="s" fill={C.amber} radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="overflow-x-auto max-h-[260px]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0" style={{ background: C.card }}>
                      <tr style={{ color: C.muted }} className="text-xs uppercase tracking-wider">
                        {["Canal", "Transport", "Pièces", "€ / pièce", cat === "Toutes" ? "% ventes" : ""].map((h, i) => <th key={i} className={`py-2 px-2 font-medium ${i ? "text-right" : "text-left"}`}>{h}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((x) => (
                        <tr key={x.name} className="border-t" style={{ borderColor: C.line }}>
                          <td className="py-2 px-2">{x.name}</td>
                          <td className="py-2 px-2 text-right whitespace-nowrap">{keur(x.cout)}</td>
                          <td className="py-2 px-2 text-right whitespace-nowrap" style={{ color: C.muted }}>{x.q.toLocaleString("fr-FR")}</td>
                          <td className="py-2 px-2 text-right whitespace-nowrap">{eur(x.q ? x.cout / x.q : 0, 2)}</td>
                          <td className="py-2 px-2 text-right whitespace-nowrap">{cat === "Toutes" ? (chV[x.name] ? <span style={{ color: heat(x.cout / chV[x.name] * 2) }}>{pct(x.cout / chV[x.name])}</span> : <span style={{ color: C.dim }}>hors classeur</span>) : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>
          );
        })()}
        </>)}

        {sec === "ref" && d.det && (<>
        <Refunds det={d.det} />
        </>)}

        {sec === "pub" && (<>
        {d.det && <AdsDetail d={d} />}
        {(d.disp || []).length > 0 && (
          <Card>
            <Title sub="Tous les dispositifs payants repérés (contrats, budgets et échanges e-mail) et leur prise en compte dans les chiffres ci-dessus. Budget en TTC, réel en HT.">Dispositifs publicitaires par canal</Title>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ color: C.muted }} className="text-xs uppercase tracking-wider">
                    {["Canal", "Dispositif", "Budget 2026", "Budget à date", "Réel à date", "Statut"].map((h, i) => <th key={h} className={`py-2 px-3 font-medium ${i > 1 && i < 5 ? "text-right" : "text-left"}`}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {d.disp.map((x, i) => {
                    const col = x.statut.startsWith("Inclus") ? C.green : x.statut.includes("Non inclus") ? C.red : C.amber;
                    return (
                      <tr key={i} className="border-t align-top" style={{ borderColor: C.line }}>
                        <td className="py-2.5 px-3 font-medium whitespace-nowrap">{x.canal}</td>
                        <td className="py-2.5 px-3 min-w-[260px]"><div>{x.disp}</div><div className="text-xs mt-0.5" style={{ color: C.dim }}>{x.gest}</div></td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">{x.budget ? keur(x.budget) : "–"}</td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">{x.budget_ytd ? keur(x.budget_ytd) : "–"}</td>
                        <td className="py-2.5 px-3 text-right whitespace-nowrap">{x.reel ? keur(x.reel) : "–"}</td>
                        <td className="py-2.5 px-3"><span className="text-[11px] font-semibold rounded-full px-2 py-0.5 whitespace-nowrap" style={{ color: col, background: "rgba(255,255,255,.04)" }}>{x.statut}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        </>)}



        <p className="text-[11px] leading-relaxed pb-8" style={{ color: C.dim }}>
          Sources : API Mirakl (Leroy Merlin/ADEO, Castorama, Boulanger, Bricomarché, Maxeda), rapports retail media Leroy Merlin, Octopia (Cdiscount) et C.A.R.S.,
          Amazon Seller Central et Amazon Ads, ventes du site issues de l’app de pilotage (frais forfaitaires 3 %). Montants de frais HT, ventes TTC nettes de remboursements.
          Détail complet : bouton « Exporter Excel » en haut de page.
        </p>
      </main>
    </div>
  );
}

// Onglet intégré à l'app : lit la clé mémorisée ; si elle manque ou ne correspond plus, redemande le code.
export function FinanceTab() {
  const [d, setD] = useState(null); const [err, setErr] = useState(false); const [k, setK] = useState(() => getFinanceKey());
  React.useEffect(() => {
    if (!k) return; let ok = true;
    getBlob().then((b) => openData(b, unhex(k))).then((x) => ok && setD(x)).catch(() => { clearFinanceKey(); ok && setErr(true); ok && setK(null); });
    return () => { ok = false; };
  }, [k]);
  if (!k) return <div className="rounded-3xl overflow-hidden"><Login onOk={(nk) => { setErr(false); setK(nk); }} inline note={err ? "Les données ont été mises à jour : saisis à nouveau ton code." : null} /></div>;
  if (!d) return <div className="py-24 text-center text-sm" style={{ color: C.muted }}>Déchiffrement des données…</div>;
  return <Dashboard d={d} embedded />;
}

export default function Finance() {
  const [k, setK] = useState(() => getFinanceKey());
  const [d, setD] = useState(null);
  React.useEffect(() => { if (k) getBlob().then((b) => openData(b, unhex(k))).then(setD).catch(() => { clearFinanceKey(); setK(null); }); }, [k]);
  if (!k) return <Login onOk={setK} />;
  if (!d) return null;
  return <Dashboard d={d} onLogout={() => { clearFinanceKey(); setK(null); setD(null); }} />;
}
