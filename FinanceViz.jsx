// Visualisations de l'onglet « Analyse financière » : cascade du compte d'exploitation, structure de coût par canal,
// carte ventes × contribution, évolution mensuelle (ventes et poids des frais, sans double axe).
// Palette catégorielle validée pour le fond sombre (ordre fixe, une couleur par entité, jamais réattribuée).
import React, { useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, LabelList, ReferenceLine,
  ScatterChart, Scatter, ZAxis, LineChart, Line, Legend,
} from "recharts";

export const VZ = {
  card: "#16140F", line: "#26221B", text: "#F5F1EA", muted: "#948C7E", dim: "#6B6459", bg: "#0A0908",
  series: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"],
  neutral: "#4A453D", good: "#3DD68C", bad: "#FF4D4F",
};
// postes de coût : couleur fixe par poste (mêmes 4 premiers slots, ordre validé)
export const POSTE = {
  com: { lab: "Commission", c: VZ.series[0] },
  pub: { lab: "Publicité", c: VZ.series[1] },
  logmp: { lab: "Logistique marketplace", c: VZ.series[2] },
  sc: { lab: "Transport & supply chain", c: VZ.series[3] },
};
const keu = (v) => (Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " M€" : Math.round(v / 1000).toLocaleString("fr-FR") + " k€");
const pc = (v, d = 1) => (v == null || !isFinite(v) ? "–" : (v * 100).toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d }) + " %");
function useNarrow(bp = 640) {
  const [n, setN] = React.useState(() => (typeof window !== "undefined" ? window.innerWidth < bp : false));
  React.useEffect(() => { const f = () => setN(window.innerWidth < bp); window.addEventListener("resize", f); return () => window.removeEventListener("resize", f); }, [bp]);
  return n;
}
const short = (v) => (Math.abs(v) >= 1e6 ? (v / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 1 }) + "M" : Math.round(v / 1000) + "k");
const tip = { background: "#1E1B15", border: `1px solid ${VZ.line}`, borderRadius: 12, color: VZ.text, fontSize: 12, padding: "8px 10px" };
const axisTick = { fill: VZ.muted, fontSize: 11 };

function Chips({ items, value, onChange, label }) {
  return (
    <div className="flex gap-1 overflow-x-auto rounded-xl p-1 text-xs" style={{ background: VZ.bg }} role="tablist" aria-label={label}>
      {items.map((k) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)} className="px-3 py-1.5 rounded-lg whitespace-nowrap transition"
          style={{ background: value === k ? "#FF5A1F" : "transparent", color: value === k ? "#fff" : VZ.muted, fontWeight: value === k ? 600 : 400 }}>{k}</button>
      ))}
    </div>
  );
}
function Legendes({ items }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]" style={{ color: VZ.muted }}>
      {items.map(([l, c]) => <span key={l} className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm" style={{ background: c }} />{l}</span>)}
    </div>
  );
}

// ---------- 1. Cascade : des ventes HT à la contribution
export function Waterfall({ pl }) {
  const [ch, setCh] = useState("Total");
  const narrow = useNarrow();
  const p = ch === "Total" ? pl.t26 : pl.p26[ch];
  const steps = [
    [narrow ? "Ventes" : "Ventes HT", p.ht, "total"],
    [narrow ? "Com." : "Commission", p.com, "com"],
    [narrow ? "Pub" : "Publicité", (p.pub || 0) + (p.pubnc || 0), "pub"],
    [narrow ? "Log." : "Logistique mkp", p.logmp, "logmp"],
    [narrow ? "Transp." : "Transport & SC", p.sc, "sc"],
    [narrow ? "Contrib." : "Contribution", p.contrib, "contrib"],
  ];
  let run = 0;
  const data = steps.map(([name, v, k]) => {
    if (k === "total") { run = v; return { name, base: 0, val: v, k, raw: v }; }
    if (k === "contrib") return { name, base: 0, val: v, k, raw: v };
    const top = run; run += v; return { name, base: run, val: top - run, k, raw: v };
  });
  const col = (k) => (k === "total" ? "#8A8378" : k === "contrib" ? VZ.good : POSTE[k].c);
  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold">Des ventes à la contribution</h3>
          <p className="text-xs mt-0.5" style={{ color: VZ.muted }}>Chaque marche = ce qu’un poste retire des ventes HT ({pl.y1} à date).</p>
        </div>
        <Chips items={["Total", ...pl.ch]} value={ch} onChange={setCh} label="Canal" />
      </div>
      <div style={{ height: 290 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 22, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid stroke={VZ.line} vertical={false} />
            <XAxis dataKey="name" tick={axisTick} axisLine={false} tickLine={false} interval={0} />
            <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => (narrow ? short(v) : keu(v))} width={narrow ? 36 : 64} />
            <Tooltip cursor={{ fill: "rgba(255,255,255,.03)" }} contentStyle={tip}
              formatter={(v, n, it) => (n === "base" ? [null, null] : [`${keu(it.payload.raw)} · ${pc(Math.abs(it.payload.raw) / p.ht)} des ventes HT`, it.payload.name])} />
            <Bar dataKey="base" stackId="w" fill="transparent" isAnimationActive={false} />
            <Bar dataKey="val" stackId="w" radius={[4, 4, 4, 4]}>
              {data.map((r) => <Cell key={r.name} fill={col(r.k)} />)}
              <LabelList dataKey="raw" position="top" formatter={(v) => (narrow ? (v >= 0 ? short(v) : "−" + short(-v)) : (v >= 0 ? keu(v) : "−" + keu(-v)))} style={{ fill: VZ.text, fontSize: narrow ? 10 : 11 }} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="text-xs mt-2" style={{ color: VZ.muted }}>
        Contribution : <b style={{ color: VZ.good }}>{pc(p.contrib / p.ht)}</b> des ventes HT · frais de vente {pc(-p.fv / p.ht)} · transport et supply chain {pc(-p.sc / p.ht)}
      </p>
    </div>
  );
}

// ---------- 2. Structure de coût par canal (100 % des ventes HT)
export function CostStructure({ pl }) {
  const narrow = useNarrow();
  const row = (name, p) => {
    const ht = p.ht || 1;
    const com = -p.com / ht, pub = -((p.pub || 0) + (p.pubnc || 0)) / ht, logmp = -p.logmp / ht, sc = -(p.sc || 0) / ht;
    return { name, com, pub, logmp, sc, contrib: Math.max(1 - com - pub - logmp - sc, 0), neg: 1 - com - pub - logmp - sc < 0 ? 1 - com - pub - logmp - sc : 0, ht: p.ht };
  };
  const data = [row("Total", pl.t26), ...pl.ch.map((c) => row(c, pl.p26[c])).sort((a, b) => b.contrib - a.contrib)];
  const keys = [["com", POSTE.com], ["pub", POSTE.pub], ["logmp", POSTE.logmp], ["sc", POSTE.sc], ["contrib", { lab: "Contribution", c: VZ.neutral }]];
  const lab = () => (v) => (v >= (narrow ? 0.12 : 0.06) ? pc(v, 0) : "");
  return (
    <div>
      <div className="mb-3">
        <h3 className="text-sm font-semibold">Où partent 100 € de ventes, par canal</h3>
        <p className="text-xs mt-0.5" style={{ color: VZ.muted }}>Part de chaque poste dans les ventes HT {pl.y1} à date ; canaux classés par contribution.</p>
      </div>
      <Legendes items={keys.map(([, v]) => [v.lab, v.c])} />
      <div style={{ height: 44 + data.length * 34 }} className="mt-3">
        <ResponsiveContainer>
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }} barCategoryGap={8} stackOffset="none">
            <XAxis type="number" domain={[0, 1]} allowDataOverflow ticks={[0, 0.25, 0.5, 0.75, 1]} tick={axisTick} tickFormatter={(v) => pc(v, 0)} axisLine={false} tickLine={false} />
            <YAxis type="category" dataKey="name" width={112} tick={({ x, y, payload }) => (
              <text x={x - 6} y={y} dy={4} textAnchor="end" fontSize={12} fill={payload.value === "Total" ? "#FF8A50" : VZ.text} fontWeight={payload.value === "Total" ? 600 : 400}>{payload.value}</text>
            )} axisLine={false} tickLine={false} />
            <Tooltip cursor={{ fill: "rgba(255,255,255,.03)" }} contentStyle={tip} formatter={(v, n) => [pc(v), keys.find((x) => x[0] === n)?.[1].lab]} labelFormatter={(l, pl_) => `${l} · ${keu(pl_?.[0]?.payload.ht || 0)} HT`} />
            {keys.map(([k, v], i) => (
              <Bar key={k} dataKey={k} stackId="s" fill={v.c} stroke={VZ.card} strokeWidth={2} radius={i === 0 ? [4, 0, 0, 4] : i === keys.length - 1 ? [0, 4, 4, 0] : 0}>
                <LabelList dataKey={k} position="center" formatter={lab(k)} style={{ fill: k === "logmp" || k === "sc" ? "#0A0908" : "#fff", fontSize: 10.5, fontWeight: 600 }} />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {data.some((r) => r.neg < 0) && <p className="text-[11px] mt-2" style={{ color: VZ.bad }}>Canal à contribution négative (barre coupée à 100 %) : {data.filter((r) => r.neg < 0).map((r) => `${r.name}, les frais dépassent les ventes de ${pc(-r.neg)}`).join(", ")}.</p>}
    </div>
  );
}

// ---------- 3. Carte : poids du canal × contribution, taille = gain potentiel
export function ChannelMap({ pl, axes }) {
  const gain = {};
  (axes?.rows || []).forEach((r) => (gain[r.canal] = (gain[r.canal] || 0) + r.gain));
  const data = pl.ch.map((c) => ({ name: c, x: pl.p26[c].ht, y: pl.p26[c].contrib / pl.p26[c].ht, z: Math.max(gain[c] || 0, 1), g: gain[c] || 0 }));
  const avg = pl.t26.contrib / pl.t26.ht;
  return (
    <div>
      <div className="mb-3">
        <h3 className="text-sm font-semibold">Taille, rentabilité et marge de progrès</h3>
        <p className="text-xs mt-0.5" style={{ color: VZ.muted }}>Horizontal : ventes HT (échelle log) · vertical : contribution en % · taille du point : gain potentiel des axes d’amélioration.</p>
      </div>
      <div style={{ height: 320 }}>
        <ResponsiveContainer>
          <ScatterChart margin={{ top: 18, right: 24, left: 0, bottom: 4 }}>
            <CartesianGrid stroke={VZ.line} />
            <XAxis type="number" dataKey="x" scale="log" domain={["auto", "auto"]} tick={axisTick} tickFormatter={(v) => keu(v)} axisLine={false} tickLine={false} name="Ventes HT" />
            <ReferenceLine y={0} stroke={VZ.dim} />
            <YAxis type="number" dataKey="y" tick={axisTick} tickFormatter={(v) => pc(v, 0)} axisLine={false} tickLine={false} width={48} domain={[-0.5, 1]} ticks={[-0.5, -0.25, 0, 0.25, 0.5, 0.75, 1]} name="Contribution" />
            <ZAxis type="number" dataKey="z" range={[60, 900]} />
            <ReferenceLine y={avg} stroke={VZ.muted} strokeDasharray="4 4" label={{ value: `moyenne ${pc(avg, 0)}`, fill: VZ.muted, fontSize: 10, position: "insideBottomLeft" }} />
            <Tooltip cursor={{ strokeDasharray: "3 3", stroke: VZ.dim }} contentStyle={tip}
              content={({ active, payload }) => active && payload?.length ? (
                <div style={tip}><b>{payload[0].payload.name}</b><br />Ventes HT {keu(payload[0].payload.x)}<br />Contribution {pc(payload[0].payload.y)}<br />Gain potentiel {keu(payload[0].payload.g)}</div>) : null} />
            <Scatter data={data} fill="#FF5A1F" fillOpacity={0.75} stroke="#FF8A50" strokeWidth={1.5}>
              <LabelList dataKey="name" position="top" offset={10} style={{ fill: VZ.text, fontSize: 11 }} />
            </Scatter>
          </ScatterChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ---------- 4. Évolution : ventes par canal (barres empilées) + poids des frais par mois, N vs N-1 (graphique séparé, un seul axe chacun)
const MOIS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export function MonthlyViz({ d }) {
  const chans = d.channels;
  const [sel, setSel] = useState("Tous");
  const sales = d.monthly.map((m) => {
    const [y, mo] = m.m.split("-"); const o = { m: MOIS[+mo - 1] + " " + y.slice(2) };
    chans.forEach((c) => (o[c] = m.ch[c]?.v || 0)); return o;
  });
  const years = [...new Set(d.monthly.map((m) => m.m.slice(0, 4)))].sort();
  const fr = MOIS.map((lab, i) => {
    const o = { m: lab };
    years.forEach((y) => {
      const r = d.monthly.find((x) => x.m === `${y}-${String(i + 1).padStart(2, "0")}`);
      if (!r) return;
      if (sel === "Tous") { const t = r.tot; o[y] = t.v ? (t.c + t.p + t.o) / t.v : null; }
      else { const c = r.ch[sel]; o[y] = c && c.v ? c.f / c.v : null; }
    });
    return o;
  });
  const yc = { [years[0]]: VZ.dim, [years[years.length - 1]]: "#FF5A1F" };
  return (
    <div className="space-y-8">
      <div>
        <h3 className="text-sm font-semibold">Ventes mensuelles par canal</h3>
        <p className="text-xs mt-0.5 mb-3" style={{ color: VZ.muted }}>Ventes nettes TTC. Dernier mois partiel.</p>
        <Legendes items={chans.map((c, i) => [c, VZ.series[i % VZ.series.length]])} />
        <div style={{ height: 300 }} className="mt-3">
          <ResponsiveContainer>
            <BarChart data={sales} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={VZ.line} vertical={false} />
              <XAxis dataKey="m" tick={axisTick} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => keu(v)} width={60} />
              <Tooltip cursor={{ fill: "rgba(255,255,255,.04)" }} contentStyle={tip} formatter={(v, n) => [keu(v), n]}
                itemSorter={(it) => -it.value} />
              {chans.map((c, i) => <Bar key={c} dataKey={c} stackId="a" fill={VZ.series[i % VZ.series.length]} stroke={VZ.card} strokeWidth={1} radius={i === chans.length - 1 ? [4, 4, 0, 0] : 0} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <div>
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-3">
          <div>
            <h3 className="text-sm font-semibold">Poids des frais variables, mois par mois</h3>
            <p className="text-xs mt-0.5" style={{ color: VZ.muted }}>Commission + pub + logistique marketplace, en % des ventes TTC ; {years.join(" vs ")} au même mois.</p>
          </div>
          <Chips items={["Tous", ...chans]} value={sel} onChange={setSel} label="Canal" />
        </div>
        <div style={{ height: 240 }}>
          <ResponsiveContainer>
            <LineChart data={fr} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid stroke={VZ.line} vertical={false} />
              <XAxis dataKey="m" tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} tickFormatter={(v) => pc(v, 0)} width={48} domain={[0, "auto"]} />
              <Tooltip contentStyle={tip} formatter={(v, n) => [pc(v), n]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {years.map((y) => <Line key={y} dataKey={y} stroke={yc[y] || VZ.muted} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: yc[y] }} activeDot={{ r: 5 }} connectNulls />)}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
