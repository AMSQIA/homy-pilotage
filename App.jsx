import React, { useState, useMemo, useEffect, useRef, useLayoutEffect, useContext, createContext } from "react";
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, BarChart, Bar, Line,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar as RadarSeries,
  PieChart, Pie, Cell, ScatterChart, Scatter, ZAxis, ReferenceLine
} from "recharts";
import {
  TrendingUp, TrendingDown, ChevronRight,
  X, Package, Store, Megaphone, LayoutGrid, Info, Minus, AlertTriangle, Lock, Tag, Search, CalendarDays, Sparkles, Radar, ExternalLink, ShieldAlert, ShieldCheck, ShieldQuestion, Truck, Snowflake, Flame, EyeOff
} from "lucide-react";

/* ============================================================================ DONNÉES (réelles, HT) */
const DATA = {};
;





// ELASTICITE_DATA — élasticité-prix par produit x marketplace, régression
// log-log (ln(qté) ~ ln(prix)) sur les semaines 2026 où qté>0 et CA>0 (un prix
// nul — avoir/geste commercial — rendrait le log indéfini). Seuils avant tout
// calcul : au moins 8 semaines de données ET au moins 3% de variation relative
// de prix (sans variation de prix, aucune élasticité n'est mesurable). HT et
// TTC donnent la même élasticité par construction (la TVA est un facteur
// multiplicatif constant, qui ne déplace que l'ordonnée à l'origine en
// log-log, jamais la pente) — un seul calcul sert donc pour les deux.
// [produit, marketplace, elasticite, r2, nb_semaines, cv_prix_pct, prix_moyen, fiable]
// fiable = R² >= 0.3 ; en dessous, l'estimation existe mais le prix n'explique
// pas assez la variation de quantité pour qu'on s'y fie.
const ELASTICITE_DATA = [];
;




// SIMULATION_PRIX — simulation d'une hausse de prix de +5%, dérivée de
// ELASTICITE_DATA. "opportunites" = élasticité entre -1 et 0 (le prix affecte
// peu ou pas le volume), TOUS les cas retenus même à R² faible : ici, l'absence
// de signal fort EST l'information utile ("rien ne prouve qu'augmenter le prix
// ferait fuir du volume"), pas une preuve à exiger comme pour un risque.
// "risques" = élasticité ≤ -1 ET fiable (R²≥0.3) uniquement : une alerte forte
// exige une preuve statistique forte. Triées par CA réel en jeu (le plus gros
// d'abord), 20 lignes chacune.
// [produit, marketplace, elasticite, r2, delta_volume_pct, delta_ca_pct, ca_reel, fiable]
const SIMULATION_PRIX = {};
;








/* ============================================================================ TOKENS */
const BG = "#0A0908", PANEL = "rgba(255,255,255,0.035)", PANEL_QUIET = "rgba(255,255,255,0.018)";
const PANEL_BORDER = "rgba(255,255,255,0.09)", PANEL_BORDER_QUIET = "rgba(255,255,255,0.05)";
const INK = "#F5F1EA", MUTED = "#948C7E", FAINT = "#5E5850";
const ORANGE = "#FF5A1F", ORANGE_SOFT = "#FF8A50", AMBER = "#FFB020", GREEN = "#34D399", RED = "#F87171";
// couleur d'accent active — orange Bestherm par défaut (utilisé par tout ce qui
// est rendu hors du Provider, ex. l'écran de connexion), remplacée par la
// couleur de la marketplace sélectionnée une fois dans le tableau de bord
const AccentContext = createContext({ primary: "#FF5A1F", soft: "#FF8A50", text: "#0A0908" });
const THOMSON_RED = "#D50032";
const HOMY_COLOR = "#8B5CF6";
// le clavier mobile remplace souvent "<3" par un cœur ❤ à la frappe — on
// reconvertit ces variantes avant d'envoyer au serveur, pour ne jamais
// bloquer quelqu'un qui a tapé le bon mot de passe mais dont le clavier
// l'a réécrit. La vérification elle-même se fait côté serveur (/api/login) —
// aucun mot de passe n'est plus comparé ni stocké dans le code client.
function normalizePwd(s) {
  return s.trim().replace(/[\u2764\uFE0F\u2665\uFE0E💕💗💓💞🩷]/g, "<3");
}

// repeuple en PLACE les constantes de données (déclarées vides, cf. plus bas)
// avec le JSON reçu de /api/data après connexion réussie — mutation plutôt que
// réaffectation pour que les centaines de références "const XXX" existantes
// dans le reste du fichier continuent de fonctionner sans aucun changement
function populateData(json) {
  for (const [nom, valeur] of Object.entries(json)) {
    const cible = window.__APP_DATA__[nom];
    if (Array.isArray(cible)) { cible.length = 0; cible.push(...valeur); }
    else if (cible && typeof cible === "object") { Object.assign(cible, valeur); }
  }
}

// mode démo — un facteur multiplicatif appliqué aux valeurs absolues avant
// formatage, pour fausser tous les chiffres affichés (CA, quantités) sans
// toucher aux ~96 points d'appel de ces fonctions dans toute l'app. Variable
// de module plutôt qu'un Context : réassignée en tout début du rendu de
// DashboardApp (voir plus bas), lue ici de façon purement synchrone — aucun
// risque d'ordre puisque JS exécute un rendu de composant du haut vers le bas
// en une seule passe. Les pourcentages (fmtPct) ne sont volontairement PAS
// affectés : ce sont des rapports déjà calculés, les fausser romprait la
// cohérence logique du tableau de bord (ex. un % d'objectif qui ne
// correspondrait plus à rien).
let demoFactor = 1;
const fmtEUR = (n) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n * demoFactor)) + " € HT";
const fmtEURplain = (n) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(n * demoFactor)) + " €";
const fmtEURk = (n) => { const v = n * demoFactor; return v >= 1000 ? `${(v/1000).toFixed(0)}k€` : `${Math.round(v)}€`; };
const fmtPct = (n) => n === null || n === undefined ? "N/A" : `${n > 0 ? "+" : ""}${n.toFixed(1)} %`;
const fmtNum = (n) => new Intl.NumberFormat("fr-FR").format(Math.round(n * demoFactor));
// numéro de semaine ISO -> plage de dates (lundi-dimanche), année 2026 implicite
// (seule année couverte par les données hebdomadaires) — permet d'afficher
// "4-10 août" plutôt qu'un numéro de semaine sec
function isoWeekToRange(week, year = 2026) {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4); week1Monday.setUTCDate(jan4.getUTCDate() - jan4Day + 1);
  const monday = new Date(week1Monday); monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
  const fmt = (d) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${fmt(monday)} – ${fmt(sunday)}`;
}
// garantit qu'une couleur reste lisible en texte sur le fond sombre de l'app —
// l'éclaircit si besoin plutôt que d'afficher du texte invisible ; la charte
// couleur de chaque marketplace n'est donc pas toujours respectée à la lettre,
// délibérément, la lisibilité passe avant
function ensureReadable(hex, minLuminance = 0.35) {
  const r = parseInt(hex.slice(1,3), 16), g = parseInt(hex.slice(3,5), 16), b = parseInt(hex.slice(5,7), 16);
  const luminance = (0.299*r + 0.587*g + 0.114*b) / 255;
  if (luminance >= minLuminance) return hex;
  const mix = (c) => Math.round(c + (255 - c) * 0.6).toString(16).padStart(2, "0");
  return `#${mix(r)}${mix(g)}${mix(b)}`;
}
const DMIN = "2024-01-01", DMAX = "2026-09-12";

/* ============================================================================ PARTICULES D'AMBIANCE (braises) */
function Embers({ count = 14 }) {
  const particles = useMemo(() => Array.from({ length: count }, (_, i) => ({
    left: Math.round(Math.random() * 100), delay: (Math.random() * 6).toFixed(2),
    duration: (5 + Math.random() * 5).toFixed(2), size: (2 + Math.random() * 2.5).toFixed(1),
    hue: Math.random() > 0.5 ? ORANGE : AMBER,
  })), [count]);
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      {particles.map((p, i) => (
        <span key={i} className="ember" style={{
          left: `${p.left}%`, width: p.size, height: p.size, background: p.hue,
          animationDelay: `${p.delay}s`, animationDuration: `${p.duration}s`,
        }} />
      ))}
    </div>
  );
}

/* ============================================================================ LOGOS */
function HomyLogo({ size = 26, color = INK, animated = false }) {
  return (
    <span className={`inline-flex items-center ${animated ? "logo-reveal" : ""}`}
      style={{ fontFamily: "'Baloo 2', sans-serif", fontWeight: 700, fontSize: size, color, letterSpacing: "-0.01em", lineHeight: 1 }}>
      hom<span style={{ position: "relative", top: -size * 0.18, fontSize: size * 0.65 }}>’</span>y
    </span>
  );
}
function BesthermMark({ size = 18, color = INK }) {
  return (
    <svg width={size * 0.7} height={size} viewBox="0 0 20 28" style={{ display: "block" }}>
      <rect x="0" y="0" width="20" height="12" fill={color} /><rect x="0" y="16" width="20" height="12" fill={color} />
    </svg>
  );
}
function BesthermLogo({ size = 16, color = INK, showMark = true }) {
  return (
    <span className="inline-flex items-center" style={{ gap: size * 0.28 }}>
      {showMark && <BesthermMark size={size * 1.4} color={color} />}
      <span style={{ fontFamily: "'Quicksand', sans-serif", fontWeight: 700, fontSize: size, color, letterSpacing: "-0.01em" }}>
        Bestherm<span style={{ fontSize: size * 0.5, verticalAlign: "super" }}>®</span>
      </span>
    </span>
  );
}
function ThomsonLogo({ size = 15, color = THOMSON_RED }) {
  return (
    <span style={{ fontFamily: "'Archivo Black', sans-serif", fontWeight: 900, fontSize: size, color, letterSpacing: "-0.02em", fontStyle: "italic", transform: "skewX(-6deg)", display: "inline-block" }}>
      THOMSON
    </span>
  );
}

/* ============================================================================ ICÔNES PRODUITS ANIMÉES */
function IconFan({ style }) {
  return (
    <svg viewBox="0 0 120 120" width="72" height="72" style={style}>
      <circle cx="60" cy="60" r="10" fill={INK} />
      <g style={{ transformOrigin: "60px 60px", animation: "spin 2.6s linear infinite" }}>
        {[0, 120, 240].map((r) => <path key={r} d="M60 60 Q100 50 108 68 Q92 78 60 60 Z" fill={ORANGE_SOFT} opacity="0.9" transform={`rotate(${r} 60 60)`} />)}
      </g>
    </svg>
  );
}
function IconTowelWarmer({ style }) {
  return (
    <svg viewBox="0 0 80 120" width="52" height="78" style={style}>
      <rect x="6" y="4" width="68" height="112" rx="6" fill="none" stroke={INK} strokeWidth="2.5" opacity="0.5" />
      {[0,1,2,3,4,5].map((i) => <rect key={i} x="14" y={16 + i * 16} width="52" height="8" rx="3" fill={ORANGE} className="warm-bar" style={{ animationDelay: `${i * 0.12}s` }} />)}
    </svg>
  );
}
function IconDehumidifier({ style }) {
  return (
    <svg viewBox="0 0 90 120" width="58" height="78" style={style}>
      <rect x="10" y="10" width="70" height="100" rx="30" fill="none" stroke={INK} strokeWidth="2.5" opacity="0.5" />
      <rect x="10" y="70" width="70" height="40" rx="16" fill="none" stroke={ORANGE_SOFT} strokeWidth="2.5" opacity="0.7" />
      <rect x="22" y="76" width="10" height="0" rx="3" fill={ORANGE} className="water-rise" />
      {[0,1,2].map((i) => <circle key={i} cx={50+i*8} cy={30-i*6} r="2.4" fill={AMBER} className="steam" style={{ animationDelay: `${i*0.4}s` }} />)}
    </svg>
  );
}
function IconRadiatorPanel({ style, dark = false }) {
  return (
    <svg viewBox="0 0 100 76" width="66" height="50" style={style}>
      <rect x="4" y="4" width="92" height="68" rx="6" fill={dark ? "#161310" : "none"} stroke={INK} strokeWidth="2.5" opacity={dark ? 1 : 0.5} />
      <rect x="82" y="10" width="10" height="8" rx="2" fill={ORANGE} className="panel-led" />
      <rect x="10" y="60" width="8" height="8" rx="2" fill={dark ? ORANGE_SOFT : INK} opacity="0.4" />
    </svg>
  );
}

/* ============================================================================ CLÉ D'ENTRÉE + INTRO CHORÉGRAPHIÉE */
function EntryGate({ onUnlock }) {
  const [pwd, setPwd] = useState("");
  const [error, setError] = useState(false);
  const [serverError, setServerError] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [checking, setChecking] = useState(false);
  const [show, setShow] = useState(false);
  // EntryGate précède le montage de DashboardApp : "lang" n'existe pas encore
  // à ce stade (même contrainte qu'ErrorBoundary) — détection autonome via le
  // navigateur pour cet écran précis, indépendante du sélecteur de langue in-app.
  const browserLang = (typeof navigator !== "undefined" && navigator.language || "fr").slice(0, 2);
  const et = I18N[browserLang] && I18N[browserLang].entry_acces_restreint ? I18N[browserLang] : I18N.fr;

  useEffect(() => {
    const t = setTimeout(() => setShow(true), 40);
    return () => clearTimeout(t);
  }, []);

  const tryUnlock = async () => {
    setChecking(true); setServerError(false);
    try {
      const res = await fetch("/api/login", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: normalizePwd(pwd) }),
      });
      if (!res.ok) {
        setChecking(false); setError(true); setTimeout(() => setError(false), 500);
        return;
      }
      // connexion acceptée côté serveur — on récupère maintenant les vraies
      // données (jamais présentes dans le bundle avant cette étape)
      const dataRes = await fetch("/api/data");
      if (!dataRes.ok) throw new Error("data fetch failed");
      const json = await dataRes.json();
      populateData(json);
      setChecking(false); setUnlocking(true);
      setTimeout(onUnlock, 500);
    } catch (e) {
      setChecking(false); setServerError(true);
    }
  };

  const icons = [
    <IconRadiatorPanel dark />, <IconTowelWarmer />, <IconFan />, <IconDehumidifier />, <IconRadiatorPanel />,
  ];

  return (
    <div className="fixed inset-0 flex items-center justify-center overflow-hidden" style={{ background: BG }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700&family=Inter:wght@400;500;600;700&display=swap');
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes warmPulse { 0%,100%{opacity:0.35} 50%{opacity:1} }
        @keyframes riseWater { from{height:0} to{height:22px} }
        @keyframes steamFloat { 0%{transform:translateY(0); opacity:0} 30%{opacity:0.8} 100%{transform:translateY(-16px); opacity:0} }
        @keyframes ledBlink { 0%,100%{opacity:0.4} 50%{opacity:1} }
        @keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-8px)} 75%{transform:translateX(8px)} }
        @keyframes driftSlow { 0%,100%{transform:translate(0,0)} 50%{transform:translate(24px,-16px)} }
        @keyframes floatUp { from{opacity:0; transform:translateY(12px)} to{opacity:1; transform:translateY(0)} }
        @keyframes scaleFade { from{opacity:0; transform:scale(0.85)} to{opacity:1; transform:scale(1)} }
        @keyframes unlockOut { from{opacity:1; transform:scale(1)} to{opacity:0; transform:scale(1.04)} }
        .warm-bar { animation: warmPulse 1.8s ease-in-out infinite; }
        .water-rise { animation: riseWater 2.2s ease-out infinite alternate; }
        .steam { animation: steamFloat 1.8s ease-out infinite; }
        .panel-led { animation: ledBlink 1.4s ease-in-out infinite; }
        .shake { animation: shake 0.4s; }
        .gate-orb1 { animation: driftSlow 12s ease-in-out infinite; }
        .gate-orb2 { animation: driftSlow 15s ease-in-out infinite reverse; }
        .icon-pop { animation: scaleFade 0.5s cubic-bezier(.34,1.56,.64,1) backwards; }
        .float-up { animation: floatUp 0.5s cubic-bezier(.22,1,.36,1) backwards; }
        .gate-out { animation: unlockOut 0.5s ease-in forwards; }
        .grain-overlay { opacity: 0.05; mix-blend-mode: overlay; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
        .btn-lift { transition: transform 0.18s cubic-bezier(.22,1,.36,1), filter 0.18s; }
        .btn-lift:hover { transform: translateY(-1px); filter: brightness(1.08); }
        .btn-lift:active { transform: translateY(0px) scale(0.98); }
      `}</style>

      {/* fond : mêmes halos dégradés que le dashboard (positionnement explicite,
          contrairement à la version précédente qui a causé le blocage) */}
      <div className="gate-orb1 pointer-events-none absolute" style={{ top: "-8%", left: "8%", width: 480, height: 380, background: `radial-gradient(ellipse, ${ORANGE}1c, transparent 65%)`, filter: "blur(14px)" }} />
      <div className="gate-orb2 pointer-events-none absolute" style={{ bottom: "-8%", right: "6%", width: 420, height: 380, background: `radial-gradient(ellipse, ${AMBER}14, transparent 65%)`, filter: "blur(14px)" }} />
      <div className="grain-overlay pointer-events-none fixed inset-0" />
      <Embers count={12} />

      <div className={`relative flex flex-col items-center px-6 text-center ${unlocking ? "gate-out" : ""}`}>
        {show && (
          <>
            {/* rangée d'icônes en flexbox — pas de position absolute/rotation orbitale */}
            <div className="flex items-center gap-3 sm:gap-5 mb-7">
              {icons.map((ic, i) => (
                <div key={i} className="icon-pop" style={{ animationDelay: `${i * 90}ms`, opacity: 0.9 }}>{ic}</div>
              ))}
            </div>

            <div className="float-up flex flex-col items-center mb-8" style={{ animationDelay: "480ms" }}>
              <HomyLogo size={40} />
              <div className="flex items-center gap-2 mt-2 text-[11px]" style={{ color: MUTED }}>
                <BesthermLogo size={11} color={MUTED} showMark={false} /><span>×</span><ThomsonLogo size={10} color={MUTED} />
              </div>
            </div>

            <div className={`float-up flex flex-col items-center gap-3 ${error ? "shake" : ""}`} style={{ animationDelay: "620ms" }}>
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em]" style={{ color: FAINT }}><Lock size={12} /> {et.entry_acces_restreint}</div>
              <input
                type="password" value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") tryUnlock(); }}
                autoFocus placeholder={et.entry_placeholder}
                className="text-center text-[14px] tabular-nums rounded-xl px-4 py-2.5 outline-none"
                style={{ background: PANEL, border: `1px solid ${error ? RED : PANEL_BORDER}`, color: INK, width: 220, colorScheme: "dark" }}
              />
              <button
                type="button" onClick={tryUnlock} disabled={checking || unlocking}
                className="btn-lift text-[12px] font-semibold px-5 py-2 rounded-full"
                style={{ background: `linear-gradient(135deg, ${ORANGE}, ${ORANGE_SOFT})`, color: "#0A0908", opacity: checking ? 0.7 : 1 }}
              >
                {unlocking || checking ? "..." : et.entry_entrer}
              </button>
              {error && <span className="text-[11px]" style={{ color: RED }}>{et.entry_erreur}</span>}
              {serverError && <span className="text-[11px]" style={{ color: RED }}>{et.entry_erreur_serveur}</span>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ============================================================================ MOTION + 3D */
function TiltCard({ children, className = "", glow = false, glowColor, quiet = false, style = {}, index = 0, scrollReveal = false }) {
  const accent = useContext(AccentContext);
  const effectiveGlow = glowColor || accent.primary;
  const ref = useRef(null);
  const [revealRef, isVisible] = useScrollReveal();
  const setRefs = (node) => { ref.current = node; revealRef.current = node; };
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const onMove = (e) => {
    const r = ref.current.getBoundingClientRect();
    const px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height;
    setTilt({ x: (py - 0.5) * -7, y: (px - 0.5) * 7 });
  };
  const onLeave = () => setTilt({ x: 0, y: 0 });
  return (
    <div ref={scrollReveal ? setRefs : ref} onMouseMove={onMove} onMouseLeave={onLeave}
      className={`relative rounded-2xl backdrop-blur-xl tilt-card ${scrollReveal ? `scroll-reveal ${isVisible ? "is-visible" : ""}` : "card-reveal"} ${className}`}
      style={{
        background: quiet ? PANEL_QUIET : PANEL, border: `1px solid ${quiet ? PANEL_BORDER_QUIET : PANEL_BORDER}`,
        boxShadow: glow
          ? `inset 0 1px 0 rgba(255,255,255,0.06), 0 0 60px -12px ${effectiveGlow}33, 0 ${14 + Math.abs(tilt.x)}px 34px -12px rgba(0,0,0,0.55)`
          : quiet ? "inset 0 1px 0 rgba(255,255,255,0.02)" : `inset 0 1px 0 rgba(255,255,255,0.05), 0 ${10 + Math.abs(tilt.x)}px 28px -12px rgba(0,0,0,0.5)`,
        transform: `perspective(800px) rotateX(${tilt.x}deg) rotateY(${tilt.y}deg) translateZ(0)`,
        transition: tilt.x === 0 && tilt.y === 0 ? "transform 0.5s cubic-bezier(.22,1,.36,1), box-shadow 0.4s ease" : "transform 0.08s linear",
        animationDelay: scrollReveal ? undefined : `${index * 60}ms`, ...style,
      }}>
      {children}
    </div>
  );
}
function GlassCard({ children, className = "", glow = false, glowColor, quiet = false, style = {}, scrollReveal = false }) {
  const accent = useContext(AccentContext);
  const effectiveGlow = glowColor || accent.primary;
  const [revealRef, isVisible] = useScrollReveal();
  return (
    <div ref={scrollReveal ? revealRef : undefined} className={`relative rounded-2xl backdrop-blur-xl ${scrollReveal ? `scroll-reveal ${isVisible ? "is-visible" : ""}` : ""} ${className}`}
      style={{ background: quiet ? PANEL_QUIET : PANEL, border: `1px solid ${quiet ? PANEL_BORDER_QUIET : PANEL_BORDER}`,
        boxShadow: glow
          ? `inset 0 1px 0 rgba(255,255,255,0.05), 0 0 60px -12px ${effectiveGlow}33, 0 8px 30px -10px rgba(0,0,0,0.5)`
          : quiet ? "inset 0 1px 0 rgba(255,255,255,0.02)" : "inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 30px -10px rgba(0,0,0,0.5)",
        transition: "box-shadow 0.4s ease",
        ...style }}>
      {children}
    </div>
  );
}
function useCountUp(target, duration = 1100, trigger = 0) {
  const [val, setVal] = useState(0);
  const [punch, setPunch] = useState(false);
  const startRef = useRef(null);
  useEffect(() => {
    startRef.current = null; let raf;
    const step = (ts) => {
      if (!startRef.current) startRef.current = ts;
      const p = Math.min(1, (ts - startRef.current) / duration);
      setVal(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) raf = requestAnimationFrame(step);
      else { setPunch(true); setTimeout(() => setPunch(false), 260); }
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, duration, trigger]);
  return [val, punch];
}
// useScrollReveal — détecte quand un élément entre dans le champ de vision et ne
// se déclenche qu'une seule fois (pas de ré-animation en remontant/redescendant).
// Repli sûr : si IntersectionObserver n'existe pas (environnement inhabituel),
// l'élément reste visible immédiatement plutôt que de rester caché.
function useScrollReveal() {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const el = ref.current;
    if (!el) return;
    // filet de sécurité : si l'élément est déjà dans la fenêtre visible au moment
    // du montage (typiquement tout ce qui est visible sans scroller), on l'affiche
    // immédiatement plutôt que de dépendre uniquement du premier déclenchement de
    // l'observateur, qui peut être retardé par une mise en page encore instable
    // (chiffres qui comptent, polices qui chargent) — évite qu'une carte reste
    // bloquée invisible si ce premier événement est manqué.
    const rect = el.getBoundingClientRect();
    const winH = typeof window !== "undefined" ? window.innerHeight : 800;
    if (rect.top < winH && rect.bottom > 0) { setVisible(true); return; }
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  return [ref, visible];
}
// MiniRing — anneau de progression compact, pour intégration inline
function MiniRing({ pct, color = ORANGE, size = 64 }) {
  const clamped = Math.max(0, Math.min(pct, 100));
  const r = (size - 8) / 2, circumference = 2 * Math.PI * r;
  const [animPct, setAnimPct] = useState(0);
  useEffect(() => { const id = requestAnimationFrame(() => setAnimPct(clamped)); return () => cancelAnimationFrame(id); }, [clamped]);
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={5} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={5} strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - animPct / 100)}
        style={{ transition: "stroke-dashoffset 1.1s cubic-bezier(.22,1,.36,1)" }} />
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central" fontSize={size * 0.2} fontWeight="700" fill={INK} style={{ transform: "rotate(90deg)", transformOrigin: "center" }}>{Math.round(clamped)}%</text>
    </svg>
  );
}
// MarketplaceDonut — anneau segmenté avec espacement entre parts (façon
// anneaux Apple Watch), couleurs de marque réelles, révélation animée au
// montage, centre mettant en valeur le total plutôt qu'une simple légende
// à côté. segments = [{ label, value, color }], déjà triés à l'entrée.
function MarketplaceDonut({ segments, size = 168, centerValue, centerLabel }) {
  const strokeWidth = size * 0.135;
  const r = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * r;
  const gapPct = (2.4 / 360) * 100; // espace fixe entre segments, en % du cercle
  const total = segments.reduce((s, seg) => s + seg.value, 0);
  const [progress, setProgress] = useState(0);
  useEffect(() => { const id = requestAnimationFrame(() => setProgress(1)); return () => cancelAnimationFrame(id); }, [segments]);
  let cumul = 0;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={strokeWidth} />
        {total > 0 && segments.map((seg, i) => {
          const pct = (seg.value / total) * 100;
          const effPct = Math.max(pct > 0 ? 0.6 : 0, pct - gapPct) * progress;
          const segLen = (effPct / 100) * circumference;
          const offset = -(cumul / 100) * circumference;
          cumul += pct;
          return (
            <circle key={seg.label} cx={size/2} cy={size/2} r={r} fill="none" stroke={seg.color} strokeWidth={strokeWidth} strokeLinecap="round"
              strokeDasharray={`${segLen} ${circumference - segLen}`} strokeDashoffset={offset}
              style={{ transition: `stroke-dasharray 1s cubic-bezier(.22,1,.36,1) ${i * 60}ms` }} />
          );
        })}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular-nums font-bold" style={{ fontSize: size * 0.135, color: INK, lineHeight: 1 }}>{centerValue}</span>
        <span className="uppercase font-semibold mt-1" style={{ fontSize: size * 0.052, color: FAINT, letterSpacing: "0.08em" }}>{centerLabel}</span>
      </div>
    </div>
  );
}
function Eyebrow({ children, tone = "primary", hint }) {
  const accent = useContext(AccentContext);
  return (
    <div className="mb-2">
      <div className="flex items-center gap-1.5">
        <span className="w-3 h-[1.5px]" style={{ background: tone === "primary" ? accent.primary : FAINT }} />
        <span className="text-[10px] tracking-[0.16em] uppercase font-semibold" style={{ color: tone === "primary" ? accent.primary : MUTED }}>{children}</span>
      </div>
      {hint && <div className="text-[9.5px] mt-0.5 pl-[18px] opacity-75" style={{ color: FAINT }}>{hint}</div>}
    </div>
  );
}
/* SectionHeader — réservé aux titres qui introduisent tout un bloc de la page
   (plusieurs cartes en dessous), nettement plus affirmé que les Eyebrow internes
   aux cartes, pour que l'œil distingue "nouveau chapitre" de "sous-titre de carte" */
/* ZoneLabel — regroupe visuellement plusieurs cartes liées sous un même thème
   (ex. "Marque", "Produits") avec un espacement plus marqué avant qu'entre
   les blocs qui suivent. Purement présentation, aucun état. */
function ZoneLabel({ children, first = false }) {
  const accent = useContext(AccentContext);
  return (
    <div className={`flex items-center gap-3 ${first ? "mb-4" : "mt-10 mb-4"}`}>
      <span className="text-[10px] uppercase tracking-[0.22em] font-bold shrink-0" style={{ color: accent.primary }}>{children}</span>
      <span className="h-px flex-1" style={{ background: `linear-gradient(90deg, ${PANEL_BORDER}, transparent)` }} />
    </div>
  );
}
function SectionHeader({ children, hint }) {
  const accent = useContext(AccentContext);
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2.5">
        <span className="w-6 h-[3px] rounded-full transition-colors duration-300" style={{ background: `linear-gradient(90deg, ${accent.primary}, ${accent.primary}bb)` }} />
        <h2 className="text-[14.5px] tracking-[0.02em] font-bold" style={{ color: INK }}>{children}</h2>
      </div>
      {hint && <div className="text-[11.5px] mt-1 pl-[34px]" style={{ color: MUTED }}>{hint}</div>}
    </div>
  );
}
/* Effet machine à écrire — révèle le texte caractère par caractère, puis
   prévient le parent (onDone) pour enchaîner sur la puce suivante */
function TypewriterText({ text, speed = 14, onDone }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    setN(0);
    let i = 0;
    const id = setInterval(() => {
      i++;
      setN(i);
      if (i >= text.length) { clearInterval(id); onDone && onDone(); }
    }, speed);
    return () => clearInterval(id);
  }, [text]);
  const done = n >= text.length;
  return <>{text.slice(0, n)}{!done && <span className="typing-cursor">▍</span>}</>;
}
/* PeriodSummaryCard — synthèse en 3 puces titrées, visible uniquement quand
   une marketplace ET une période précises sont choisies (vue "Toutes" par
   défaut n'affiche rien ici). Chaque puce s'écrit à l'écran l'une après
   l'autre, comme si elle était rédigée en direct — la clé passée par
   l'appelant (marketplace+période) fait remonter le composant à zéro et
   relance l'animation à chaque nouveau filtre. */
function PeriodSummaryCard({ items, t = I18N.fr }) {
  const accent = useContext(AccentContext);
  const [activeIndex, setActiveIndex] = useState(0);
  const [closing, setClosing] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // fermeture automatique 2 minutes après l'apparition de la carte
  useEffect(() => {
    const timer = setTimeout(() => setClosing(true), 120000);
    return () => clearTimeout(timer);
  }, []);
  // laisse le temps au fondu de jouer avant de retirer la carte pour de bon
  useEffect(() => {
    if (!closing) return;
    const t = setTimeout(() => setDismissed(true), 280);
    return () => clearTimeout(t);
  }, [closing]);

  if (!items || items.length === 0 || dismissed) return null;
  return (
    <div className="card-reveal relative rounded-2xl mb-5 overflow-hidden" style={{ background: `linear-gradient(135deg, ${accent.primary}0d, ${accent.primary}03)`, border: `1px solid ${accent.primary}2a`, opacity: closing ? 0 : 1, transform: closing ? "scale(0.98)" : "scale(1)", transition: "opacity 0.28s ease-out, transform 0.28s ease-out, background 0.4s ease, border-color 0.4s ease" }}>
      <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: `linear-gradient(180deg, ${accent.primary}, transparent)` }} />
      <div className="pl-5 pr-4 py-3.5">
        <div className="flex items-center justify-between mb-2.5">
          <div className="flex items-center gap-1.5">
            <Sparkles size={11} color={accent.primary} />
            <span className="text-[9.5px] uppercase tracking-[0.16em] font-semibold" style={{ color: accent.primary }}>{t.summary_synthese}</span>
          </div>
          <button onClick={() => setClosing(true)} aria-label={t.summary_fermer} className="btn-lift -mt-1 -mr-1 p-1 rounded-full" style={{ color: FAINT }}>
            <X size={12} />
          </button>
        </div>
        <ul className="space-y-2.5">
          {items.map((item, i) => i > activeIndex ? null : (
            <li key={i} className="flex gap-2">
              <span className="shrink-0 mt-[3px] w-1 h-1 rounded-full" style={{ background: accent.primary }} />
              <div>
                <span className="text-[11.5px] font-semibold" style={{ color: accent.primary }}>{item.title} — </span>
                <span className="text-[12.5px] leading-relaxed" style={{ color: MUTED }}>
                  {i < activeIndex ? item.text : <TypewriterText text={item.text} onDone={() => setActiveIndex((v) => v + 1)} />}
                </span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
function YoyBadge({ pct, size = "normal", naLabel = "non comparable", lang = "fr" }) {
  if (pct === null || pct === undefined) return <span className="inline-flex items-center gap-1 text-[11px]" style={{ color: FAINT }}><Minus size={11} /> {naLabel}</span>;
  const up = pct >= 0, Icon = up ? TrendingUp : TrendingDown, color = up ? GREEN : RED;
  // au-delà de +150%, la variation vient presque toujours d'une base de comparaison
  // très faible plutôt que d'une vraie explosion — on le signale plutôt que de
  // laisser un chiffre spectaculaire sans contexte induire en erreur
  const baseFaible = pct > 150;
  const tt = I18N[lang] || I18N.fr;
  return (
    <span className="inline-flex items-center gap-1 tabular-nums font-semibold" style={{ color, fontSize: size === "big" ? 15 : 12 }} title={baseFaible ? tt.yoy_variation_forte : undefined}>
      <Icon size={size === "big" ? 15 : 12} /> {fmtPct(pct)}{baseFaible && <span style={{ color: AMBER, fontSize: "0.85em" }}>*</span>}
    </span>
  );
}
/* ligne de liste avec entrée en cascade (rejoue à chaque montage, donc à chaque changement d'onglet) */
function StaggerRow({ children, index, style = {}, className = "" }) {
  return <div className={`stagger-row ${className}`} style={{ animationDelay: `${index * 35}ms`, ...style }}>{children}</div>;
}

// correspondance entre les noms canoniques (ventes) et les noms utilisés côté ads,
// pour que le filtre global sache aussi filtrer l'onglet Campagnes Ads
// dictionnaire de traduction complet — app entière, FR/EN/中文
// ============================================================================
// DONNÉES LIVE — connexion aux 3 Google Sheets publiés en CSV.
// Remplace les 3 URLs ci-dessous par les tiennes une fois publiées
// (Fichier → Partager → Publier sur le web → onglet précis → format CSV).
// Tant que ces URLs ne sont pas renseignées (ou que le fetch échoue), l'app
// continue de fonctionner normalement sur les données statiques ci-dessus —
// aucun risque de casser l'existant.
// ============================================================================
const SHEET_URLS = {
  ventes: "REMPLACE_PAR_TON_URL_VENTES",
  objectifs: "REMPLACE_PAR_TON_URL_OBJECTIFS",
  ads: "REMPLACE_PAR_TON_URL_ADS",
};

function parseCsv(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    const values = line.split(",");
    const row = {};
    headers.forEach((h, i) => { row[h] = values[i] !== undefined ? values[i].trim() : ""; });
    return row;
  });
}

// ============================================================================
// Correspondance des marketplaces — construite à partir de ton onglet
// "MAPPING MARKETPLACES" (nom brut -> marque de base) et croisée avec les
// couples (marque, pays) réellement présents dans OBJECTIFS. Vérifiée sur
// l'intégralité de tes 100 368 lignes réelles : 98,5% de correspondance,
// le reste étant des combinaisons marque×pays pour lesquelles aucun
// objectif n'a été défini (ex. ManoMano B2B, ventes web hors France) —
// pas des erreurs de mapping, l'absence d'objectif y est correcte.
// ============================================================================
const RAW_TO_BASE = {
  "Amazon": "AMAZON", "bol": "BOL", "Boulanger": "BOULANGER", "BricoBravo": "BRICO BRAVO",
  "bricodepotes": "BRICO DEPOT", "bricomarche": "BRICOMARCHE", "but": "BUT",
  "Carrefour": "CARREFOUR", "carrefourfr": "CARREFOUR", "castoramafr": "CASTORAMA",
  "CDiscount": "CDISCOUNT", "dartybomp": "DARTY", "Fnac": "FNAC", "leclerc": "LECLERC",
  "leroymerlin": "LEROY MERLIN", "ManoMano": "MANO MANO B2C", "ManoManopro": "MANO MANO B2B",
  "maxeda": "MAXEDA", "Monechelle": "MANO MANO B2C", "PriceMinister": "RAKUTEN",
  "Site internet": "BESTHERM.FR", "worten": "WORTEN",
};
const ISO_TO_PAYS = {
  "FR": "FRANCE", "ES": "SPAIN", "BE": "BELGIUM", "NL": "NETHERLANDS",
  "DE": "GERMANY", "IT": "ITALY", "PL": "POLAND", "PT": "PORTUGAL", "GB": "UK",
};
const BASE_PAYS_TO_OBJECTIF = {
  "AMAZON||FRANCE": "AMAZON FR", "AMAZON||UK": "AMAZON UK", "AMAZON||GERMANY": "AMAZON DE",
  "AMAZON||SPAIN": "AMAZON ES", "AMAZON||ITALY": "AMAZON IT", "AMAZON||BELGIUM": "AMAZON l BE",
  "LEROY MERLIN||FRANCE": "LEROY MERLIN / BRICOMAN", "LEROY MERLIN||SPAIN": "LEROY MERLIN SPAIN",
  "LEROY MERLIN||PORTUGAL": "LEROY MERLIN PORTUGAL", "LEROY MERLIN||POLAND": "LEROY MERLIN POLAND",
  "LEROY MERLIN||ITALY": "LEROY MERLIN ITALY",
  "MANO MANO B2C||FRANCE": "MANOMANO", "MANO MANO B2C||GERMANY": "MANOMANO DE",
  "MANO MANO B2C||SPAIN": "MANOMANO ES", "MANO MANO B2C||ITALY": "MANOMANO IT", "MANO MANO B2C||UK": "MANOMANO UK",
  "CASTORAMA||FRANCE": "CASTORAMA", "CASTORAMA||POLAND": "CASTORAMA PL",
  "BESTHERM.FR||FRANCE": "WEBSITE", "CDISCOUNT||FRANCE": "CDISCOUNT",
  "MAXEDA||BELGIUM": "MAXEDA | BRICO.BE", "MAXEDA||NETHERLANDS": "MAXEDA | PRAXIS",
  "BRICOMARCHE||FRANCE": "BRICOMARCHÉ",
  "BOL||BELGIUM": "BOL.COM | BE", "BOL||NETHERLANDS": "BOL.COM | NL",
  "FNAC||FRANCE": "FNAC / DARTY FRANCE", "FNAC||SPAIN": "FNAC / DARTY SPAIN",
  "DARTY||FRANCE": "FNAC / DARTY FRANCE", // inférence : même ligne budgétaire que Fnac France
  "WORTEN||PORTUGAL": "WORTEN PORTUGAL", "WORTEN||SPAIN": "WORTEN SPAIN",
  "BOULANGER||FRANCE": "BOULANGER",
  "CARREFOUR||FRANCE": "CARREFOUR FR", "CARREFOUR||SPAIN": "CARREFOUR ES",
  "BRICO DEPOT||SPAIN": "BRICO DEPOT ES", "LECLERC||FRANCE": "LECLERC",
  "BRICO BRAVO||ITALY": "BRICO BRAVO ITALY", "BUT||FRANCE": "BUT", "RAKUTEN||FRANCE": "RAKUTEN",
};
function resolveMpKey(rawMp, iso) {
  const base = RAW_TO_BASE[rawMp] || rawMp;
  const pays = ISO_TO_PAYS[iso] || null;
  if (pays && BASE_PAYS_TO_OBJECTIF[`${base}||${pays}`]) return BASE_PAYS_TO_OBJECTIF[`${base}||${pays}`];
  return pays ? `${base} (${pays}, objectif non défini)` : `${base} (pays non identifié)`;
}

function computeLiveKpis(ventes, objectifs) {
  const num = (v) => parseFloat(v) || 0;
  let caTotal = 0, qteTotal = 0;
  const monthlyTotal = {};
  const mpTotals = {};
  const brandTotals = {};
  const productTotals = {};

  for (const row of ventes) {
    const annee = row["Année"], mois = parseInt(row["Mois"], 10);
    const ca = num(row["CA HT"]), qte = num(row["Quantité"]);
    caTotal += ca; qteTotal += qte;
    if (!monthlyTotal[annee]) monthlyTotal[annee] = Array(12).fill(0);
    if (mois >= 1 && mois <= 12) monthlyTotal[annee][mois - 1] += ca;
    const mp = resolveMpKey(row["Marketplace"], row["pays (livraison)"]);
    mpTotals[mp] = (mpTotals[mp] || 0) + ca;
    const marque = row["Marque"]; brandTotals[marque] = (brandTotals[marque] || 0) + ca;
    const produit = row["Produit"]; productTotals[produit] = (productTotals[produit] || 0) + ca;
  }

  // panier moyen = CA total ÷ nombre de lignes de vente (une ligne VENTES = une commande/ligne),
  // conforme au calcul actuel — utilise "Nombre de lignes" si la colonne existe (agrégats
  // pré-calculés), sinon le nombre de lignes brutes lui-même (export détaillé comme le tien)
  const hasNbLignesCol = ventes.length > 0 && ventes[0]["Nombre de lignes"] !== undefined;
  const nbLignesTotal = hasNbLignesCol ? ventes.reduce((s, r) => s + num(r["Nombre de lignes"]), 0) : ventes.length;
  const panierMoyen = nbLignesTotal ? caTotal / nbLignesTotal : null;
  const bestSellerEntry = Object.entries(productTotals).sort((a, b) => b[1] - a[1])[0];

  const objectifMap = {};
  for (const row of objectifs) objectifMap[row["Marketplace"]] = num(row["Objectif annuel HT"]);
  const objectifTotal = Object.values(objectifMap).reduce((a, b) => a + b, 0);
  const pctObjectif = objectifTotal ? (caTotal / objectifTotal) * 100 : null;

  const mpVsObjectif = Object.entries(mpTotals).map(([mp, ca]) => ({
    marketplace: mp, ca: Math.round(ca),
    objectif: objectifMap[mp] ?? null,
    pct: objectifMap[mp] ? Math.round((ca / objectifMap[mp]) * 1000) / 10 : null,
  })).sort((a, b) => b.ca - a.ca);

  return {
    kpi: {
      ca_total: Math.round(caTotal * 100) / 100, qte_total: qteTotal,
      panier_moyen: panierMoyen !== null ? Math.round(panierMoyen * 100) / 100 : null,
      objectif_annuel_total: objectifTotal,
      pct_objectif_atteint: pctObjectif !== null ? Math.round(pctObjectif * 100) / 100 : null,
    },
    best_seller: bestSellerEntry ? { produit: bestSellerEntry[0], ca: Math.round(bestSellerEntry[1] * 100) / 100 } : null,
    monthly_total: monthlyTotal, mp_vs_objectif: mpVsObjectif, brand_totals: brandTotals,
    nb_lignes_ventes: ventes.length,
  };
}

// hook : tente la connexion live, ne touche à rien si ça échoue ou si les URLs
// ne sont pas encore renseignées — l'app reste 100% fonctionnelle sur DATA statique
function useLiveData() {
  const [state, setState] = useState({ status: "idle", data: null, error: null, syncedAt: null });
  useEffect(() => {
    if (SHEET_URLS.ventes.startsWith("REMPLACE_PAR")) { setState({ status: "not_configured", data: null, error: null, syncedAt: null }); return; }
    let cancelled = false;
    setState((s) => ({ ...s, status: "loading" }));
    Promise.all([
      fetch(SHEET_URLS.ventes).then((r) => r.text()),
      fetch(SHEET_URLS.objectifs).then((r) => r.text()),
    ]).then(([ventesTxt, objectifsTxt]) => {
      if (cancelled) return;
      const ventes = parseCsv(ventesTxt), objectifs = parseCsv(objectifsTxt);
      const computed = computeLiveKpis(ventes, objectifs);
      setState({ status: "connected", data: computed, error: null, syncedAt: new Date() });
    }).catch((err) => {
      if (cancelled) return;
      setState({ status: "error", data: null, error: err.message, syncedAt: null });
    });
    return () => { cancelled = true; };
  }, []);
  return state;
}

const I18N = {
  fr: {
    nav_apercu: "Vue d'ensemble", nav_marketplaces: "Marketplaces", nav_marques: "Marques & Produits", nav_prix: "Suivi Prix", nav_ads: "Campagnes Ads", nav_concurrence: "Concurrence", nav_supply: "Supply",
    pilotage: "Pilotage", marketplace_label: "Marketplace :", toutes_mp: "Toutes marketplaces", mode_presentation: "Mode présentation", reset: "réinitialiser",
    analyser_periode: "Analyser la période :", vs_an_dernier: "l'an dernier", ht_suffix: "Tous montants HT",
    ca_cumule: "CA HT cumulé YTD", ca_cumule_hint: "Somme du CA HT de toutes les commandes depuis le 1er janvier 2026",
    toutes_marketplaces_suffix: "toutes marketplaces", objectif_2026: "sur", objectif_non_defini: "objectif non défini",
    panier_moyen: "Prix moyen HT", panier_moyen_hint: "CA HT total ÷ nombre de commandes, 2026", unites_vendues: "unités vendues",
    meilleure_vente: "Meilleure vente 2026", meilleure_vente_hint: "Produit au CA HT cumulé le plus élevé depuis janvier",
    vs_meilleure_n1: "Vs meilleure vente N-1", vs_meilleure_n1_hint: "Même produit, CA HT comparé à la même fenêtre 2025", en_2025: "en 2025",
    non_comparable: "non comparable", indispo_par_mp: "indisponible par marketplace", detail_non_conserve: "détail par marketplace non conservé pour 2025",
    tendance_titre: "Tendance CA HT — une courbe par année", tendance_hint: "Un graphique par année, même échelle verticale pour comparer honnêtement les courbes",
    ca_ht_total_titre: "CA HT total — toutes marketplaces, à date", ca_ht_total_hint: "Somme du CA HT 2026 de toutes les marketplaces suivies",
    au_rythme: "au rythme attendu", top3: "Top 3", top3_hint: "Les 3 marketplaces au CA HT cumulé 2026 le plus élevé", de_word: "de", nouveau: "nouveau",
    est_fin_annee: "Estimation fin d'année", objectif_non_defini_mp: "Objectif annuel non défini pour cette marketplace", legende_reel: "Réel", legende_anticipe: "Anticipé", reparti_saisonnier: "réparti selon le motif saisonnier réel, pas 1/12 uniforme",
    repartition_pays_titre: "Répartition par pays", repartition_pays_hint: "Vraies commandes par pays — pas une estimation ads. 2024 exclu (pas de détail pays cette année-là)", aucune_donnee_pays: "Aucune donnée pays sur cette sélection — vérifie que la période inclut 2025 ou 2026.", pub_par_pays: "Publicité par pays", depense_ads: "dépense ads", conc_titre: "Concurrence", conc_hint: "Veille collectée manuellement par recherche web — France. Aucun prix, classement ou volume inventé.", conc_position_heater: "Position Heater — ", conc_position_cooling: "Position Cooling — ", conc_radiateurs: "Radiateurs — ", conc_secheserviettes: "Sèche-serviettes — ", conc_produits_suivis: "Produits suivis", conc_produits_suivis_hint: "Sélection actuelle (segment/sous-catégorie/marketplace)", conc_prix_moyen: "Prix moyen", conc_prix_moyen_hint: "Sur les produits où le prix a pu être vérifié", conc_fourchette_prix: "Fourchette prix", conc_fourchette_prix_hint: "Du moins cher au plus cher, prix vérifiés uniquement", conc_en_promo: "En promotion", conc_en_promo_hint: "Produits affichant une remise vs prix de référence", conc_sources_qualite: "Sources et qualité", conc_sources_qualite_hint: "Fiabilité de la collecte par sous-catégorie et marketplace — méthodologie et limites propres à chaque source", conc_marques_visibles: "Marques les plus visibles", conc_marques_visibles_hint: "Marques les plus présentes dans la collecte, toutes marketplaces confondues (nombre d'apparitions, pas de part de marché réelle)", conc_aucun_produit: "Aucun produit pour cette sélection", conc_sponsorise: "Sponsorisé", conc_prix_nd: "Prix n/d", conc_comparatif_prix_mp: "Comparatif prix par marketplace", conc_comparatif_prix_mp_hint: "Prix vérifiés uniquement — les produits sans prix extrait de façon fiable n'apparaissent pas ici", conc_aucun_prix_verifie: "Aucun prix vérifié sur cette sélection", conc_moy: "moy.", conc_vs_marche: "Bestherm/Thomson vs marché", conc_vs_marche_hint: "Prix Bestherm/Thomson comparés à la moyenne des concurrents (Bestherm/Thomson exclus du calcul de cette moyenne) — uniquement où un vrai prix concurrent a pu être vérifié", conc_pas_de_comparaison: "Pas encore de prix concurrent vérifié dans la même sous-catégorie qu'un produit Bestherm/Thomson, sur cette sélection — comparaison impossible pour l'instant plutôt qu'approximative.", conc_exporter: "Exporter :", conc_nomme_date: "Nommé à la date du jour · reflète la sélection en cours (segment/sous-catégorie/marketplace)", zone_marque: "Marque", zone_produits_titre: "Produits", zone_normes: "Normes", zone_puissances: "Puissances", subnav_produit_ideal: "Produit idéal", subnav_normes_cat: "Normes & Catégories", topflop_titre: "Tops & Flops", topflop_hint: "Filtrable date + marketplace comme le reste de l'app · accessoires et pièces détachées exclus", top5_hint: "Meilleures performances sur la sélection actuelle", flop5_hint: "Performances les plus faibles sur la sélection actuelle, hors accessoires", aucune_donnee: "Aucune donnée", cycle_vie_titre: "Cycle de vie produit", cycle_vie_hint: "Compare juin-août 2026 à la même période 2025 (pas les mois précédents, pour ne pas confondre saisonnalité et vraie tendance) — respecte le filtre marketplace", panier_titre: "Souvent achetés ensemble", panier_hint: "Produits réellement achetés ensemble (même numéro de commande), 2025+2026 — donnée globale, pas encore filtrable par marketplace ou période", panier_croise_hint: "Radiateur + sèche-serviette dans la même commande — signal de rénovation salle de bain complète", panier_croise_titre: "Ventes croisées radiateur × sèche-serviette", panier_toutes_hint: "Toutes paires confondues, y compris même gamme à puissances différentes", panier_toutes_titre: "Toutes paires — top 8", prix_regulier_ideal: "Prix régulier idéal", prix_promo_ideal: "Prix promo idéal*", toutes_categories: "Toutes catégories", aucune_donnee_qte: "Aucune donnée de quantité sur cette sélection", puissances_vendues_titre: "Puissances les plus vendues", puissances_vendues_hint: "Quantité vendue par puissance, filtrable date + marketplace comme le reste de l'app", supply_titre: "Supply", supply_hint: "Construit uniquement sur des données réellement disponibles — classification ABC (2026), historique de ventes (2024-2026). Aucune donnée stock, transport ou fournisseur n'existe dans les fichiers fournis.", comparatif_prix_titre: "Comparatif par produit", comparatif_prix_hint: "Prix le plus haut et le plus bas entre marketplaces (2026), qui en vend le plus, écart en %, prix moyen pondéré. Marketplaces \"Non identifié\"/\"Autre\" exclues du comparatif — pas de vraie marketplace identifiable.", cp_vend_plus: "Vend le plus", cp_prix_moyen: "Prix moyen", signal_premium: "Positionnement premium", signal_sensible: "Sensible au prix", signal_neutre: "Signal neutre", radar_fiabilite_insuffisante: "Données insuffisantes pour un profil fiable", radar_plus_proche: "Le plus proche du profil idéal", radar_plus_loin: "Le plus éloigné du profil idéal", radar_score_hint: "Écart moyen entre les attributs du produit et le profil idéal — plus bas = plus proche. Descriptif, pas un jugement de qualité.", elasticite_titre: "Élasticité prix par référence", elasticite_hint: "Régression log-log quantité~prix, par semaine 2026 (HT ou TTC : même résultat, la TVA ne change pas la pente). Seuils : ≥8 semaines de données et ≥3% de variation de prix avant tout calcul.", elast_fiable_uniquement: "Fiables uniquement (R² ≥ 0,3)", elast_peu_fiable: "peu fiable", elast_semaines: "semaines de données", elast_variation_prix: "de variation de prix", elast_prix_moyen: "prix moyen", elast_cat_elastique: "Élastique (≤-1)", elast_cat_inelastique: "Inélastique", elast_cat_positif: "Positif (atypique)", simulation_titre: "Simulation — hausse de prix de 5%", simulation_hint: "Impact estimé sur le volume (élasticité mesurée) et sur le CA net, si le prix augmentait de 5% et que rien d'autre ne changeait. Une simulation, pas une prédiction garantie.", marge_manoeuvre_titre: "Marge de manœuvre", marge_manoeuvre_sub: "Le prix influence peu ces volumes", prudence_titre: "Prudence prix", prudence_sub: "Une hausse ferait fuir des volumes importants", sim_ca_actuel: "CA en jeu", sim_volume: "volume", sim_pas_de_signal: "aucun signal fort détecté", sim_titre: "Simulateur prix → quantité", sim_hint: "Choisissez un produit et une marketplace, proposez un prix : la quantité et le CA projetés se recalculent en direct, à partir de l'élasticité mesurée sur cette référence.", sim_choisir_produit: "Choisir un produit", sim_choisir_mp: "Marketplace", sim_prix_actuel: "Prix moyen observé", sim_prix_propose: "Prix proposé", sim_qte_actuelle: "Volume actuel (semaine)", sim_qte_projetee: "Volume projeté", sim_ca_semaine_actuel: "CA actuel (semaine)", sim_ca_semaine_projete: "CA projeté", sim_hors_plage: "Ce prix dépasse la plage observée historiquement — la projection devient une extrapolation, moins fiable.", sim_aucun_resultat: "Aucune donnée d'élasticité pour ce produit.", resultat: "résultat", resultats: "résultats", tous_produits_titre: "Tous les produits", tous_produits_hint: "CA et quantité vendue, année 2026 complète (year-to-date) — inclut le déstockage, contrairement aux Tops/Flops ci-dessus", ap_destockage_badge: "déstockage", zone_hebdo: "Vue hebdomadaire", zone_hebdo_hint: "Données réelles par semaine — chiffre d'affaires, quantité, répartition marketplace, transporteur, origine des expéditions et top produits", repartition_mp_semaine: "Répartition par marketplace", part_ca_pct: "Part dans le CA (%)", expeditions_titre: "Expéditions", expeditions_hint: "Transporteur réel utilisé pour les commandes expédiées cette semaine", entrepot_titre: "Origine des expéditions", entrepot_hint: "Entrepôt d'où sont parties les commandes cette semaine — un flux d'expédition, pas une photo du stock actuellement disponible", top_semaine_titre: "Top produits de la semaine", qte_semaine_courte: "sem.", tendance_4_semaines: "Tendance — 4 dernières semaines", zone_abc: "Classification ABC — 2026", sku_classes: "SKU classés", zone_saison: "Saisonnalité — indice 2024-2025", preset_mois_courant: "Mois en cours", preset_mois_precedent: "Mois précédent", preset_annee_courante: "Année en cours", preset_annee_passee: "Année passée", preset_personnalise: "Personnalisé", yoy_variation_forte: "Variation très forte — vérifier la valeur absolue N-1, souvent une base de comparaison faible plutôt qu'une vraie tendance",
    sum_ca_titre: "Chiffre d'affaires", sum_vs_mois_prec: "Vs mois précédent", sum_objectif_titre: "Objectif", sum_ytd_titre: "Year-to-date", sum_panier_moyen_titre: "Panier moyen", sum_repartition_marque_titre: "Répartition marque", sum_mp_leader: "Marketplace leader", sum_position: "Position", sum_evolution_bestherm: "Évolution Bestherm", sum_top5_produits: "Top 5 produits", sum_normes_titre: "Normes", sum_top_cat: "Top catégorie / sous-catégorie", sum_performance: "Performance", sum_budget_investi: "Budget investi", sum_periode_titre: "Période",
sum_en: "en", sum_sur: "sur", sum_soit_lower: "soit", sum_vs_meme_periode_an_dernier: "vs la même période l'an dernier", sum_comparatif_n1_indispo: "comparatif N-1 indisponible", sum_objectif_annuel_realise: "de l'objectif annuel", sum_deja_realise_periode: "déjà réalisé sur la période choisie.", sum_aucun_objectif_pour: "Aucun objectif annuel défini pour", sum_depuis_1er_janvier: "depuis le 1er janvier, soit", sum_objectif_annuel_point: "de l'objectif annuel.", sum_ytd_non_dispo: "Repère YTD non disponible sans objectif défini.", sum_annee_complete_pas_detail: "année 2026 complète, pas de détail par période disponible.", sum_non_disponible: "Non disponible.", sum_du_ca_periode: "du CA sur cette période.", sum_realise_cette_periode: "de l'objectif annuel réalisé sur cette période.", sum_aucun_objectif_point: "Aucun objectif annuel défini.", sum_depuis_1er_janvier_parenthese: "depuis le 1er janvier", sum_de_objectif_parenthese: "de l'objectif).", sum_sur_cette_periode_point: "sur cette période.", sum_non_calculable: "Non calculable.", sum_ere: "ère", sum_e: "e", sum_mp_sur: "marketplace sur", sum_pour_cette_periode: "pour cette période.", sum_rang_non_calculable: "Rang non calculable.", sum_vs_an_dernier_point: "vs l'an dernier.", sum_comparatif_n1_mp_indispo: "Comparatif N-1 non disponible par marketplace.", sum_qte_non_dispo_mp: "quantité non disponible par marketplace", sum_annee_complete: "année 2026 complète", sum_aucune_donnee_produit: "Aucune donnée produit disponible.", sum_du_ca_ce: "du CA en CE,", sum_en_nf_periode: "en NF sur cette période.", sum_annee_complete_non_filtrable: "année 2026 complète, non filtrable par période.", sum_roas_de: "ROAS de", sum_sur_annee_2026: "sur l'année 2026.", sum_depenses_pour: "dépensés pour", sum_generes_cumul: "générés — cumul year-to-date 2026 (seule donnée disponible, pas de détail par mois).", sum_donnee_annuelle_complete: "Donnée annuelle 2026 complète — le filtre de date ne s'applique pas à cet onglet.", conc_top_produits: "Top produits", conc_comparatif: "Comparatif", non_identifiee: "Non identifiée", marque_non_identifiee: "Marque non identifiée", lifecycle_croissance_desc: "+20% ou plus vs même période 2025", lifecycle_declin_desc: "-20% ou moins vs même période 2025", lifecycle_declin_lbl: "Déclin", donnees_statiques: "Données statiques", autres_lbl: "Autres", vs_semaine_prec: "vs semaine précédente", apercu_semaine_titre: "Aperçu de la semaine", voir_detail_supply: "Voir le détail dans Supply", voir_detail_prix: "Voir le détail dans Prix", demo_mode_tooltip: "Mode démo — fausse les chiffres affichés, sans toucher aux vraies données", demo_mode_actif: "Mode démo actif — les chiffres affichés sont faussés, pas les vraies données", repartition_mp_semaine_courte: "CETTE SEMAINE", sum_cette_semaine: "cette semaine", sum_du_ca_semaine: "du CA de la semaine", sum_meilleure_progression: "Meilleure progression", sum_vs_semaine_derniere: "vs la semaine précédente", pd_prix_titre: "Positionnement prix", pd_cycle_titre: "Cycle de vie", pd_panier_titre: "Souvent acheté avec", pd_prix_non_dispo: "Prix non disponible pour ce produit", pd_panier_non_dispo: "Aucune association fréquente identifiée", pd_repartition_titre: "Répartition des ventes par marketplace", pd_courbe_titre: "Courbe de ventes mensuelle", pd_fiche_titre: "Fiche produit", pd_fiche_non_dispo: "Fiche catalogue non disponible", pd_made_in_france: "Fabriqué en France", pd_connecte_wifi: "Connecté WiFi", pd_garantie_ans: "ans de garantie", ap_catalogue_badge: "catalogue, non vendu", ap_top_badge: "Top 5", ap_flop_badge: "Flop 5", note_homy_marque: "Le catalogue révèle une 4e marque, HOM'Y, avec de vraies ventes (ex. Orphée Connect, ~11k€ en 2026, 0,2% du CA) actuellement comptées dans Bestherm ci-dessus — pas encore isolée séparément, la structure de calcul existante ne distingue que 2 marques.", forte_croissance_objectif_bas: "Forte croissance mais objectif peu atteint — objectif potentiellement à recalibrer", lifecycle_lancement_lbl: "Lancement", lifecycle_lancement_desc: "Pas de vente comparable l'an dernier", lifecycle_croissance_lbl: "Croissance", lifecycle_mature_lbl: "Mature", lifecycle_mature_desc: "Stable, entre -20% et +20%", mois_dec_court: "Déc", mois_sep_court: "Sep", mois_oct_court: "Oct", mois_nov_court: "Nov", zone_anticipation: "Anticipation — octobre à décembre 2026", anticipation_mp_titre: "Anticipation par marketplace", anticipation_mp_hint: "Même méthode que l'anticipation globale, calculée séparément par marketplace — la répartition attendue du pic n'est pas forcément celle du poids actuel", zone_manquant: "Ce qui manque pour aller plus loin", manque_stock_titre: "Stocks & approvisionnement", manque_stock_texte: "Le fichier source donne l'entrepôt d'origine de chaque expédition (voir Vue hebdomadaire ci-dessus) — un flux, pas un stock actuel. Couverture, point de commande, stock de sécurité, rupture, surstock restent hors de portée : il faudrait un export stock (disponible/réservé/bloqué) à un instant T, qui n'existe pas dans les fichiers fournis.", manque_transport_titre: "Transport & livraison", manque_transport_texte: "Le transporteur réel par commande est maintenant visible (Vue hebdomadaire ci-dessus). Coûts transporteur, délais de livraison, taux de retard/casse restent hors de portée — ces informations n'existent pas dans les fichiers fournis.", radar_radiateurs: "Radiateurs", radar_secheserviettes: "Sèche-serviettes", axe_ceramique: "Céramique", axe_fonte: "Fonte", axe_film: "Film", axe_wifi: "WiFi", axe_vertical: "Vertical", axe_plinthe: "Plinthe", axe_soufflerie: "Soufflerie", entry_acces_restreint: "Accès restreint", entry_placeholder: "Clé d'entrée", entry_entrer: "Entrer", entry_erreur: "Clé incorrecte", entry_erreur_serveur: "Connexion impossible — réessayez", gauge_objectif: "OBJECTIF 2026", summary_synthese: "Synthèse", summary_fermer: "Fermer la synthèse", zone_international: "International", est_soit: "Soit", est_a: "à", est_de_objectif_annuel: "de l'objectif annuel", pub_par_pays_hint: "Distinct de la répartition ci-dessus : ceci mesure la performance des campagnes publicitaires par pays, pas le total des ventes réelles", conf_haute: "Confiance haute", conf_moyenne: "Confiance moyenne", conf_basse: "Confiance basse", conc_ref_identifiees_sur: "référence(s) Bestherm/Thomson identifiée(s) sur", conc_produits_recenses: "produits recensés.", conc_aucune_ref_heater: "Aucune référence Bestherm/Thomson identifiée dans la collecte actuelle.", conc_ref_sur: "référence(s) Bestherm/Thomson sur", conc_produits_point: "produits.", conc_aucune_ref_cooling: "Aucune référence Bestherm/Thomson — marché non adressé sur cette marketplace pour l'instant.", conc_reference_sing: "référence", conc_reference_plur: "références", conc_produit_sing: "produit", conc_produit_plur: "produits", conc_collecte_sing: "collecté", conc_collecte_plur: "collectés",
    autres_mp: "Autres marketplaces", autres_mp_hint: "Triées par CA HT décroissant", vue_detaillee: "Vue détaillée limitée à la marketplace sélectionnée en haut de page",
    aucune_donnee_mp: "Aucune donnée pour cette marketplace",
    repartition_geo: "Répartition géographique", repartition_geo_hint: "CA HT généré par les campagnes publicitaires, par pays — pas le CA total des ventes, qui n'a pas de détail pays fiable dans nos exports",
    filtrer_par_mp: "Filtrer par marketplace :", detail_mensuel_indispo: "2026 uniquement — pas de détail mensuel fiable disponible",
    positions_approx: "Positions approximatives (pas une projection géographique réelle) · échelle non-linéaire pour garder les petits pays visibles",
    detail_pays: "Détail par pays", detail_pays_hint: "Toujours les 14 marketplaces, cumul complet 2026",
    repartition_marque: "Répartition du CA HT 2026 par marque", repartition_marque_hint: "Part de chaque marque dans le CA HT cumulé 2026", bestherm_vs_n1: "Bestherm vs N-1",
    thomson_hint: "Thomson : 0€ sur cette fenêtre en 2025 — marque pas encore commercialisée en H1 2025",
    ca_mensuel_marque: "CA HT mensuel par marque", ca_mensuel_marque_hint: "CA HT par mois calendaire, année 2026 uniquement",
    marque_reconstituee: "Marque reconstituée par référence produit sur l'historique — couverture 2026 :",
    top_produits: "Top produits", top_produits_hint: "Les 3 produits au CA HT cumulé le plus élevé, période comparable vs N-1 (1 janv-18 juil)",
    qte_nd_mp: "qté n/d par mp", nd: "n/d", reste_top15: "Reste du Top 15", reste_top15_hint: "Rang 4 à 15",
    ca_mois_top6: "CA HT par mois — Top 6 produits, 2026", ca_mois_top6_hint: "Les 6 produits au CA HT cumulé le plus élevé · intensité = CA HT du mois",
    repartition_norme: "Répartition par norme (NF / CE)", repartition_norme_hint: "Part du CA HT par norme produit, mois par mois — année sélectionnée avec le filtre ci-dessous",
    evolution_mensuelle: "Évolution mensuelle", evolution_mensuelle_hint: "% du CA HT du mois relevant de chaque norme",
    repartition_categorie: "Répartition par catégorie", repartition_categorie_hint: "% du CA HT 2026 par catégorie et sous-catégorie — choisis une marketplace pour voir sa répartition propre",
    rattache_catalogue: "% du CA HT rattaché à une catégorie via le catalogue produit",
    categories: "Catégories", sous_categories: "Sous-catégories", sous_categories_hint: "Colonne « Sous catégorie » du catalogue (ex. 1er prix Céramique, Céramique + wifi…) — pas les gammes produit",
    suivi_prix: "Suivi des prix", suivi_prix_hint: "Prix de vente moyen HT (CA HT ÷ quantité) par produit, marketplace et mois — jeu de données complet",
    rechercher_produit: "Rechercher un produit…", affine_recherche: "40 premiers affichés, affine ta recherche pour voir le reste",
    non_dispo_2024: "2024 non disponible (pas de détail marketplace dans cet export)", aucun_resultat: "Aucun résultat — essaie un autre terme de recherche",
    produit_col: "Produit", marketplace_col: "Marketplace", prix_mode: "Prix", qte_mode: "Quantité",
    depense_totale: "Dépense totale HT", depense_totale_hint: "Somme des budgets ads consommés, cumul 2026",
    ca_genere_ht: "CA généré HT", ca_genere_ht_hint: "CA HT attribué aux campagnes ads, cumul 2026",
    roas_pondere: "ROAS moyen pondéré", roas_pondere_hint: "CA généré ÷ dépense, toutes marketplaces confondues",
    budget_pub_mp: "Budget publicitaire par marketplace", budget_pub_mp_hint: "Budget annuel, dépense engagée et enveloppe restante par marketplace — jauge circulaire pour une lecture immédiate",
    depense_lbl: "Dépensé", budget_lbl: "Budget", restant_lbl: "Restant",
    top3_ads: "Top 3 par CA généré", top3_ads_hint: "Les 3 marketplaces au CA généré par les ads le plus élevé, cumul 2026",
    a_surveiller: "À surveiller", a_surveiller_hint: "Dépense ads dont le retour (ROAS) est inférieur à 3x — seuil d'alerte", perte_nette: "dépense supérieure au CA généré · pour 100€ investis, ACOS de",
    reste_mp_ads: "Reste des marketplaces", reste_mp_ads_hint: "Triées par CA généré décroissant · barre = % du budget annuel déjà consommé",
    pas_budget_n1: "Pas de budget ads N-1 fourni — comparatif année sur année non disponible pour ce volet",
    tous_montants_ht: "Tous montants HT · données réelles 2024–2026",
    erreur_titre: "Un problème est survenu", erreur_msg: "L'application a rencontré une erreur inattendue. Recharger la page résout généralement le problème.", recharger: "Recharger",
    langue: "Langue",
  },
  en: {
    nav_apercu: "Overview", nav_marketplaces: "Marketplaces", nav_marques: "Brands & Products", nav_prix: "Price Tracking", nav_ads: "Ad Campaigns", nav_concurrence: "Competition", nav_supply: "Supply",
    pilotage: "Dashboard", marketplace_label: "Marketplace:", toutes_mp: "All marketplaces", mode_presentation: "Presentation mode", reset: "reset",
    analyser_periode: "Analyze period:", vs_an_dernier: "last year", ht_suffix: "All amounts excl. tax",
    ca_cumule: "Cumulative Revenue YTD", ca_cumule_hint: "Sum of revenue (excl. tax) for all orders since January 1, 2026",
    toutes_marketplaces_suffix: "all marketplaces", objectif_2026: "of", objectif_non_defini: "target not defined",
    panier_moyen: "Average Price", panier_moyen_hint: "Total revenue (excl. tax) ÷ number of orders, 2026", unites_vendues: "units sold",
    meilleure_vente: "Best Seller 2026", meilleure_vente_hint: "Product with the highest cumulative revenue since January",
    vs_meilleure_n1: "Vs Best Seller Last Year", vs_meilleure_n1_hint: "Same product, revenue compared to the same window in 2025", en_2025: "in 2025",
    non_comparable: "not comparable", indispo_par_mp: "unavailable by marketplace", detail_non_conserve: "per-marketplace detail not kept for 2025",
    tendance_titre: "Revenue Trend — One Curve per Year", tendance_hint: "One chart per year, same vertical scale, for a fair comparison of the curves",
    ca_ht_total_titre: "Total Revenue — all marketplaces, to date", ca_ht_total_hint: "Sum of 2026 revenue for all tracked marketplaces",
    au_rythme: "on track", top3: "Top 3", top3_hint: "The 3 marketplaces with the highest cumulative revenue in 2026", de_word: "of", nouveau: "new",
    est_fin_annee: "Year-end estimate", objectif_non_defini_mp: "No annual target set for this marketplace", legende_reel: "Actual", legende_anticipe: "Forecast", reparti_saisonnier: "distributed by real seasonal pattern, not a flat 1/12",
    repartition_pays_titre: "Breakdown by country", repartition_pays_hint: "Real orders by country — not an ads estimate. 2024 excluded (no country detail that year)", aucune_donnee_pays: "No country data for this selection — check that the period includes 2025 or 2026.", pub_par_pays: "Ads spend by country", depense_ads: "ads spend", conc_titre: "Competition", conc_hint: "Manually collected via web research — France. No invented price, rank or volume.", conc_position_heater: "Heater position — ", conc_position_cooling: "Cooling position — ", conc_radiateurs: "Radiators — ", conc_secheserviettes: "Towel warmers — ", conc_produits_suivis: "Tracked products", conc_produits_suivis_hint: "Current selection (segment/subcategory/marketplace)", conc_prix_moyen: "Average price", conc_prix_moyen_hint: "On products where the price could be verified", conc_fourchette_prix: "Price range", conc_fourchette_prix_hint: "Cheapest to most expensive, verified prices only", conc_en_promo: "On promotion", conc_en_promo_hint: "Products showing a discount vs reference price", conc_sources_qualite: "Sources & data quality", conc_sources_qualite_hint: "Collection reliability by subcategory and marketplace — methodology and limits specific to each source", conc_marques_visibles: "Most visible brands", conc_marques_visibles_hint: "Brands most present in the collection, all marketplaces combined (number of appearances, not real market share)", conc_aucun_produit: "No products for this selection", conc_sponsorise: "Sponsored", conc_prix_nd: "Price n/a", conc_comparatif_prix_mp: "Price comparison by marketplace", conc_comparatif_prix_mp_hint: "Verified prices only — products without a reliably extracted price don't appear here", conc_aucun_prix_verifie: "No verified price for this selection", conc_moy: "avg.", conc_vs_marche: "Bestherm/Thomson vs market", conc_vs_marche_hint: "Bestherm/Thomson prices compared to the competitor average (Bestherm/Thomson excluded from that average) — only where a real competitor price could be verified", conc_pas_de_comparaison: "No verified competitor price yet in the same subcategory as a Bestherm/Thomson product, for this selection — no comparison rather than an approximate one.", conc_exporter: "Export:", conc_nomme_date: "Named after today's date · reflects the current selection (segment/subcategory/marketplace)", zone_marque: "Brand", zone_produits_titre: "Products", zone_normes: "Standards", zone_puissances: "Wattage", subnav_produit_ideal: "Ideal product", subnav_normes_cat: "Standards & Categories", topflop_titre: "Tops & Flops", topflop_hint: "Filterable by date + marketplace like the rest of the app · accessories and spare parts excluded", top5_hint: "Best performers for the current selection", flop5_hint: "Weakest performers for the current selection, accessories excluded", aucune_donnee: "No data", cycle_vie_titre: "Product lifecycle", cycle_vie_hint: "Compares June-Aug 2026 to the same period in 2025 (not the preceding months, to avoid confusing seasonality with a real trend) — respects the marketplace filter", panier_titre: "Frequently bought together", panier_hint: "Products genuinely bought together (same order number), 2025+2026 — global data, not yet filterable by marketplace or period", panier_croise_hint: "Radiator + towel warmer in the same order — a bathroom renovation signal", panier_croise_titre: "Cross-sell: radiators × towel warmers", panier_toutes_hint: "All pairs combined, including same range at different wattages", panier_toutes_titre: "All pairs — top 8", prix_regulier_ideal: "Ideal regular price", prix_promo_ideal: "Ideal promo price*", toutes_categories: "All categories", aucune_donnee_qte: "No quantity data for this selection", puissances_vendues_titre: "Best-selling wattages", puissances_vendues_hint: "Quantity sold by wattage, filterable by date + marketplace like the rest of the app", supply_titre: "Supply", supply_hint: "Built only on genuinely available data — ABC classification (2026), sales history (2024-2026). No stock, transport or supplier data exists in the files provided.", comparatif_prix_titre: "Comparison by product", comparatif_prix_hint: "Highest and lowest price across marketplaces (2026), who sells the most, % spread, weighted average price. \"Unidentified\"/\"Other\" marketplaces excluded from the comparison — not a real identifiable marketplace.", cp_vend_plus: "Sells the most", cp_prix_moyen: "Average price", signal_premium: "Premium positioning", signal_sensible: "Price sensitive", signal_neutre: "Neutral signal", radar_fiabilite_insuffisante: "Insufficient data for a reliable profile", radar_plus_proche: "Closest to the ideal profile", radar_plus_loin: "Furthest from the ideal profile", radar_score_hint: "Average gap between the product attributes and the ideal profile — lower = closer. Descriptive, not a quality judgment.", elasticite_titre: "Price elasticity by reference", elasticite_hint: "Log-log regression of quantity on price, by 2026 week (HT or TTC: same result, VAT does not change the slope). Thresholds: >=8 weeks of data and >=3% price variation before any calculation.", elast_fiable_uniquement: "Reliable only (R2 >= 0.3)", elast_peu_fiable: "low reliability", elast_semaines: "weeks of data", elast_variation_prix: "price variation", elast_prix_moyen: "average price", elast_cat_elastique: "Elastic (<=-1)", elast_cat_inelastique: "Inelastic", elast_cat_positif: "Positive (atypical)", simulation_titre: "Simulation — 5% price increase", simulation_hint: "Estimated impact on volume (measured elasticity) and net revenue, if price rose 5% and nothing else changed. A simulation, not a guaranteed prediction.", marge_manoeuvre_titre: "Room to maneuver", marge_manoeuvre_sub: "Price has little influence on these volumes", prudence_titre: "Price caution", prudence_sub: "An increase would drive away significant volume", sim_ca_actuel: "revenue at stake", sim_volume: "volume", sim_pas_de_signal: "no strong signal detected", sim_titre: "Price -> quantity simulator", sim_hint: "Pick a product and a marketplace, propose a price: projected volume and revenue recompute live, based on the elasticity measured for that reference.", sim_choisir_produit: "Choose a product", sim_choisir_mp: "Marketplace", sim_prix_actuel: "Observed average price", sim_prix_propose: "Proposed price", sim_qte_actuelle: "Current volume (week)", sim_qte_projetee: "Projected volume", sim_ca_semaine_actuel: "Current revenue (week)", sim_ca_semaine_projete: "Projected revenue", sim_hors_plage: "This price is outside the historically observed range — the projection becomes an extrapolation, less reliable.", sim_aucun_resultat: "No elasticity data for this product.", resultat: "result", resultats: "results", tous_produits_titre: "All products", tous_produits_hint: "Revenue and quantity sold, full 2026 (year-to-date) — includes clearance stock, unlike the Tops/Flops above", ap_destockage_badge: "clearance", zone_hebdo: "Weekly view", zone_hebdo_hint: "Real weekly data — revenue, quantity, marketplace split, carrier, shipment origin and top products", repartition_mp_semaine: "Marketplace breakdown", part_ca_pct: "Share of revenue (%)", expeditions_titre: "Shipments", expeditions_hint: "Actual carrier used for orders shipped this week", entrepot_titre: "Shipment origin", entrepot_hint: "Warehouse orders shipped from this week — a shipment flow, not a snapshot of currently available stock", top_semaine_titre: "Top products this week", qte_semaine_courte: "wk", tendance_4_semaines: "Trend — last 4 weeks", zone_abc: "ABC classification — 2026", sku_classes: "Classified SKUs", zone_saison: "Seasonality — 2024-2025 index", preset_mois_courant: "Current month", preset_mois_precedent: "Previous month", preset_annee_courante: "Current year", preset_annee_passee: "Previous year", preset_personnalise: "Custom", yoy_variation_forte: "Very large change — check the absolute N-1 value, often a low comparison base rather than a real trend",
    sum_ca_titre: "Revenue", sum_vs_mois_prec: "Vs previous month", sum_objectif_titre: "Target", sum_ytd_titre: "Year-to-date", sum_panier_moyen_titre: "Average order value", sum_repartition_marque_titre: "Brand split", sum_mp_leader: "Leading marketplace", sum_position: "Position", sum_evolution_bestherm: "Bestherm trend", sum_top5_produits: "Top 5 products", sum_normes_titre: "Standards", sum_top_cat: "Top category / subcategory", sum_performance: "Performance", sum_budget_investi: "Budget spent", sum_periode_titre: "Period",
sum_en: "in", sum_sur: "for", sum_soit_lower: "i.e.", sum_vs_meme_periode_an_dernier: "vs the same period last year", sum_comparatif_n1_indispo: "N-1 comparison unavailable", sum_objectif_annuel_realise: "of the annual target", sum_deja_realise_periode: "already reached for the chosen period.", sum_aucun_objectif_pour: "No annual target set for", sum_depuis_1er_janvier: "since January 1st, i.e.", sum_objectif_annuel_point: "of the annual target.", sum_ytd_non_dispo: "YTD marker unavailable without a defined target.", sum_annee_complete_pas_detail: "full 2026, no detail available by period.", sum_non_disponible: "Not available.", sum_du_ca_periode: "of revenue for this period.", sum_realise_cette_periode: "of the annual target reached for this period.", sum_aucun_objectif_point: "No annual target defined.", sum_depuis_1er_janvier_parenthese: "since January 1st", sum_de_objectif_parenthese: "of target).", sum_sur_cette_periode_point: "for this period.", sum_non_calculable: "Not calculable.", sum_ere: "", sum_e: "", sum_mp_sur: "marketplace out of", sum_pour_cette_periode: "for this period.", sum_rang_non_calculable: "Rank not calculable.", sum_vs_an_dernier_point: "vs last year.", sum_comparatif_n1_mp_indispo: "N-1 comparison unavailable by marketplace.", sum_qte_non_dispo_mp: "quantity unavailable by marketplace", sum_annee_complete: "full 2026", sum_aucune_donnee_produit: "No product data available.", sum_du_ca_ce: "of revenue under CE,", sum_en_nf_periode: "under NF for this period.", sum_annee_complete_non_filtrable: "full 2026, not filterable by period.", sum_roas_de: "ROAS of", sum_sur_annee_2026: "for 2026.", sum_depenses_pour: "spent for", sum_generes_cumul: "generated — 2026 year-to-date total (only data available, no monthly detail).", sum_donnee_annuelle_complete: "Full 2026 data — the date filter doesn't apply to this tab.", conc_top_produits: "Top products", conc_comparatif: "Comparison", non_identifiee: "Unidentified", marque_non_identifiee: "Unidentified brand", lifecycle_croissance_desc: "+20% or more vs same period 2025", lifecycle_declin_desc: "-20% or less vs same period 2025", lifecycle_declin_lbl: "Decline", donnees_statiques: "Static data", autres_lbl: "Other", vs_semaine_prec: "vs previous week", apercu_semaine_titre: "Weekly snapshot", voir_detail_supply: "See full detail in Supply", voir_detail_prix: "See full detail in Prices", demo_mode_tooltip: "Demo mode — distorts the displayed figures, without touching the real data", demo_mode_actif: "Demo mode active — displayed figures are distorted, not the real data", repartition_mp_semaine_courte: "THIS WEEK", sum_cette_semaine: "this week", sum_du_ca_semaine: "of the week's revenue", sum_meilleure_progression: "Best improvement", sum_vs_semaine_derniere: "vs the previous week", pd_prix_titre: "Price positioning", pd_cycle_titre: "Lifecycle", pd_panier_titre: "Frequently bought with", pd_prix_non_dispo: "Price not available for this product", pd_panier_non_dispo: "No frequent pairing identified", pd_repartition_titre: "Sales breakdown by marketplace", pd_courbe_titre: "Monthly sales curve", pd_fiche_titre: "Product sheet", pd_fiche_non_dispo: "Catalog sheet not available", pd_made_in_france: "Made in France", pd_connecte_wifi: "WiFi connected", pd_garantie_ans: "year warranty", ap_catalogue_badge: "catalog, not sold", ap_top_badge: "Top 5", ap_flop_badge: "Flop 5", note_homy_marque: "The catalog reveals a 4th brand, HOM'Y, with real sales (e.g. Orphée Connect, ~11k€ in 2026, 0.2% of revenue) currently counted under Bestherm above — not yet isolated separately, since the existing calculation only distinguishes 2 brands.", forte_croissance_objectif_bas: "Strong growth but low target achievement — target potentially needs recalibrating", lifecycle_lancement_lbl: "Launch", lifecycle_lancement_desc: "No comparable sale last year", lifecycle_croissance_lbl: "Growth", lifecycle_mature_lbl: "Mature", lifecycle_mature_desc: "Stable, between -20% and +20%", mois_dec_court: "Dec", mois_sep_court: "Sep", mois_oct_court: "Oct", mois_nov_court: "Nov", zone_anticipation: "Forecast — October to December 2026", anticipation_mp_titre: "Forecast by marketplace", anticipation_mp_hint: "Same method as the overall forecast, computed separately per marketplace — the expected peak split isn't necessarily the current one", zone_manquant: "What's missing to go further", manque_stock_titre: "Stock & replenishment", manque_stock_texte: "The source file gives the origin warehouse for each shipment (see Weekly view above) — a flow, not a current stock level. Coverage, reorder point, safety stock, stockouts, overstock remain out of reach: that would need a point-in-time stock export (available/reserved/blocked), which doesn't exist in the files provided.", manque_transport_titre: "Shipping & delivery", manque_transport_texte: "The actual carrier per order is now visible (Weekly view above). Carrier costs, delivery lead times, delay/damage rates remain out of reach — this information doesn't exist in the files provided.", radar_radiateurs: "Radiators", radar_secheserviettes: "Towel warmers", axe_ceramique: "Ceramic", axe_fonte: "Cast iron", axe_film: "Film", axe_wifi: "WiFi", axe_vertical: "Vertical", axe_plinthe: "Baseboard", axe_soufflerie: "Fan-assist", entry_acces_restreint: "Restricted access", entry_placeholder: "Access key", entry_entrer: "Enter", entry_erreur: "Incorrect key", entry_erreur_serveur: "Could not connect — try again", gauge_objectif: "2026 TARGET", summary_synthese: "Summary", summary_fermer: "Close summary", zone_international: "International", est_soit: "That's", est_a: "to", est_de_objectif_annuel: "of the annual target", pub_par_pays_hint: "Distinct from the breakdown above: this measures ad campaign performance by country, not total real sales", conf_haute: "High confidence", conf_moyenne: "Medium confidence", conf_basse: "Low confidence", conc_ref_identifiees_sur: "Bestherm/Thomson reference(s) identified out of", conc_produits_recenses: "products tracked.", conc_aucune_ref_heater: "No Bestherm/Thomson reference identified in the current collection.", conc_ref_sur: "Bestherm/Thomson reference(s) out of", conc_produits_point: "products.", conc_aucune_ref_cooling: "No Bestherm/Thomson reference — market not yet addressed on this marketplace.", conc_reference_sing: "reference", conc_reference_plur: "references", conc_produit_sing: "product", conc_produit_plur: "products", conc_collecte_sing: "collected", conc_collecte_plur: "collected",
    autres_mp: "Other Marketplaces", autres_mp_hint: "Sorted by revenue, descending", vue_detaillee: "Detailed view limited to the marketplace selected at the top of the page",
    aucune_donnee_mp: "No data for this marketplace",
    repartition_geo: "Geographic Breakdown", repartition_geo_hint: "Revenue generated by ad campaigns, by country — not total sales revenue, which has no reliable country detail in our exports",
    filtrer_par_mp: "Filter by marketplace:", detail_mensuel_indispo: "2026 only — no reliable monthly detail available",
    positions_approx: "Approximate positions (not a real geographic projection) · non-linear scale to keep smaller countries visible",
    detail_pays: "Country Detail", detail_pays_hint: "Always all 14 marketplaces, full 2026 total",
    repartition_marque: "2026 Revenue Breakdown by Brand", repartition_marque_hint: "Share of each brand in cumulative 2026 revenue", bestherm_vs_n1: "Bestherm vs Last Year",
    thomson_hint: "Thomson: €0 in this window in 2025 — brand not yet marketed in H1 2025",
    ca_mensuel_marque: "Monthly Revenue by Brand", ca_mensuel_marque_hint: "Revenue by calendar month, 2026 only",
    marque_reconstituee: "Brand reconstructed from product reference on historical data — 2026 coverage:",
    top_produits: "Top Products", top_produits_hint: "The 3 products with the highest cumulative revenue, comparable period vs last year (Jan 1–Jul 18)",
    qte_nd_mp: "qty n/a by mp", nd: "n/a", reste_top15: "Rest of Top 15", reste_top15_hint: "Rank 4 to 15",
    ca_mois_top6: "Monthly Revenue — Top 6 Products, 2026", ca_mois_top6_hint: "The 6 products with the highest cumulative revenue · intensity = monthly revenue",
    repartition_norme: "Breakdown by Standard (NF / CE)", repartition_norme_hint: "Share of revenue by product standard, month by month — year selected via the filter below",
    evolution_mensuelle: "Monthly Trend", evolution_mensuelle_hint: "% of the month's revenue under each standard",
    repartition_categorie: "Breakdown by Category", repartition_categorie_hint: "% of 2026 revenue by category and sub-category — pick a marketplace to see its own breakdown",
    rattache_catalogue: "% of revenue linked to a category via the product catalog",
    categories: "Categories", sous_categories: "Sub-categories", sous_categories_hint: "\"Sub-category\" column from the catalog (e.g. Entry-level Ceramic, Ceramic + wifi…) — not product ranges",
    suivi_prix: "Price Tracking", suivi_prix_hint: "Average selling price excl. tax (revenue ÷ quantity) by product, marketplace and month — full dataset",
    rechercher_produit: "Search a product…", affine_recherche: "first 40 shown, refine your search to see the rest",
    non_dispo_2024: "2024 not available (no marketplace detail in this export)", aucun_resultat: "No results — try a different search term",
    produit_col: "Product", marketplace_col: "Marketplace", prix_mode: "Price", qte_mode: "Quantity",
    depense_totale: "Total Spend (excl. tax)", depense_totale_hint: "Sum of ad budgets spent, 2026 cumulative",
    ca_genere_ht: "Ad-Generated Revenue", ca_genere_ht_hint: "Revenue (excl. tax) attributed to ad campaigns, 2026 cumulative",
    roas_pondere: "Weighted Average ROAS", roas_pondere_hint: "Generated revenue ÷ spend, all marketplaces combined",
    budget_pub_mp: "Ad Budget by Marketplace", budget_pub_mp_hint: "Annual budget, spend committed and remaining balance by marketplace — circular gauge for an instant read",
    depense_lbl: "Spent", budget_lbl: "Budget", restant_lbl: "Remaining",
    top3_ads: "Top 3 by Generated Revenue", top3_ads_hint: "The 3 marketplaces with the highest ad-generated revenue, 2026 cumulative",
    a_surveiller: "Needs Attention", a_surveiller_hint: "Ad spend with a return (ROAS) below 3x — alert threshold", perte_nette: "spend exceeds generated revenue · for €100 invested, ACOS of",
    reste_mp_ads: "Other Marketplaces", reste_mp_ads_hint: "Sorted by generated revenue, descending · bar = % of annual budget already spent",
    pas_budget_n1: "No 2025 ad budget provided — year-over-year comparison unavailable for this section",
    tous_montants_ht: "All amounts excl. tax · real data 2024–2026",
    erreur_titre: "Something went wrong", erreur_msg: "The application encountered an unexpected error. Reloading the page usually fixes it.", recharger: "Reload",
    langue: "Language",
  },
  zh: {
    nav_apercu: "总览", nav_marketplaces: "电商平台", nav_marques: "品牌与产品", nav_prix: "价格追踪", nav_ads: "广告活动", nav_concurrence: "竞争分析", nav_supply: "供应链",
    pilotage: "管理面板", marketplace_label: "电商平台：", toutes_mp: "所有平台", mode_presentation: "演示模式", reset: "重置",
    analyser_periode: "分析时间段：", vs_an_dernier: "同比去年", ht_suffix: "所有金额均为不含税价",
    ca_cumule: "累计营业额（年初至今）", ca_cumule_hint: "2026年1月1日以来所有订单的不含税营业额总和",
    toutes_marketplaces_suffix: "所有平台", objectif_2026: "占", objectif_non_defini: "目标未设定",
    panier_moyen: "平均价格", panier_moyen_hint: "不含税总营业额 ÷ 订单数，2026年", unites_vendues: "件已售",
    meilleure_vente: "2026年畅销产品", meilleure_vente_hint: "自1月以来累计营业额最高的产品",
    vs_meilleure_n1: "同比畅销产品", vs_meilleure_n1_hint: "同一产品，与2025年同期营业额对比", en_2025: "2025年",
    non_comparable: "无法比较", indispo_par_mp: "该平台数据不可用", detail_non_conserve: "2025年未保留分平台明细",
    tendance_titre: "营业额趋势 — 按年度分列", tendance_hint: "每年一张图，纵轴比例相同，便于公平比较各年曲线",
    ca_ht_total_titre: "不含税总营业额 — 所有平台，截至目前", ca_ht_total_hint: "所有跟踪平台2026年营业额总和",
    au_rythme: "符合预期进度", top3: "前三名", top3_hint: "2026年累计营业额最高的3个平台", de_word: "占", nouveau: "新",
    est_fin_annee: "年底预估", objectif_non_defini_mp: "该平台未设定年度目标", legende_reel: "实际", legende_anticipe: "预测", reparti_saisonnier: "按真实季节性模式分配，非均匀的1/12",
    repartition_pays_titre: "按国家分布", repartition_pays_hint: "真实订单数据，非广告估算 · 不含2024年（该年无国家明细）", aucune_donnee_pays: "此筛选条件下无国家数据 — 请确认时间范围包含2025或2026年", pub_par_pays: "按国家广告支出", depense_ads: "广告支出", conc_titre: "竞争分析", conc_hint: "通过网络调研人工收集 — 法国。不虚构任何价格、排名或销量。", conc_position_heater: "取暖器地位 — ", conc_position_cooling: "制冷产品地位 — ", conc_radiateurs: "散热器 — ", conc_secheserviettes: "毛巾架 — ", conc_produits_suivis: "已追踪产品", conc_produits_suivis_hint: "当前筛选（细分/子类别/平台）", conc_prix_moyen: "平均价格", conc_prix_moyen_hint: "仅统计价格已核实的产品", conc_fourchette_prix: "价格区间", conc_fourchette_prix_hint: "从最低到最高，仅核实价格", conc_en_promo: "促销中", conc_en_promo_hint: "相对参考价有折扣的产品", conc_sources_qualite: "数据来源与质量", conc_sources_qualite_hint: "按子类别和平台划分的采集可靠性 — 每个来源的方法与局限性", conc_marques_visibles: "最常见品牌", conc_marques_visibles_hint: "采集数据中出现最多的品牌，涵盖所有平台（出现次数，非真实市场份额）", conc_aucun_produit: "此筛选条件下无产品", conc_sponsorise: "推广", conc_prix_nd: "价格未知", conc_comparatif_prix_mp: "按平台价格对比", conc_comparatif_prix_mp_hint: "仅核实价格 — 未能可靠提取价格的产品不在此显示", conc_aucun_prix_verifie: "此筛选条件下无核实价格", conc_moy: "均", conc_vs_marche: "Bestherm/Thomson 对比市场", conc_vs_marche_hint: "Bestherm/Thomson价格与竞品平均价对比（该平均价不含Bestherm/Thomson）— 仅限已核实竞品真实价格的情况", conc_pas_de_comparaison: "此筛选条件下，与Bestherm/Thomson产品同子类别尚无已核实的竞品价格 — 暂不比较，而非给出近似值。", conc_exporter: "导出：", conc_nomme_date: "以当天日期命名 · 反映当前筛选（细分/子类别/平台）", zone_marque: "品牌", zone_produits_titre: "产品", zone_normes: "认证标准", zone_puissances: "功率", subnav_produit_ideal: "理想产品", subnav_normes_cat: "认证与品类", topflop_titre: "排行榜", topflop_hint: "可按日期+平台筛选，与应用其余部分一致 · 不含配件与零件", top5_hint: "当前筛选下表现最好的产品", flop5_hint: "当前筛选下表现最弱的产品（不含配件）", aucune_donnee: "暂无数据", cycle_vie_titre: "产品生命周期", cycle_vie_hint: "对比2026年6-8月与2025年同期（非紧邻月份，以避免将季节性误判为真实趋势）— 遵循平台筛选", panier_titre: "常一起购买", panier_hint: "同一订单号下真实一起购买的产品，2025+2026年 — 全局数据，暂不支持按平台或时间筛选", panier_croise_hint: "同一订单中的散热器+毛巾架 — 卫浴翻新信号", panier_croise_titre: "交叉销售：散热器×毛巾架", panier_toutes_hint: "包含所有组合，含同系列不同功率", panier_toutes_titre: "所有组合 — 前8名", prix_regulier_ideal: "理想常规价", prix_promo_ideal: "理想促销价*", toutes_categories: "所有品类", aucune_donnee_qte: "此筛选条件下无数量数据", puissances_vendues_titre: "最畅销功率", puissances_vendues_hint: "按功率统计的销售数量，可按日期+平台筛选，与应用其余部分一致", supply_titre: "供应链", supply_hint: "仅基于真实可用数据构建 — ABC分类（2026年）、销售历史（2024-2026年）。所提供文件中不存在库存、物流或供应商数据。", comparatif_prix_titre: "按产品对比", comparatif_prix_hint: "各平台间最高与最低价格（2026年）、销量最高平台、价差百分比、加权平均价。「未识别」/「其他」平台不参与对比 — 非真实可识别平台。", cp_vend_plus: "销量最高", cp_prix_moyen: "平均价", signal_premium: "高端定位", signal_sensible: "价格敏感", signal_neutre: "中性信号", radar_fiabilite_insuffisante: "数据不足，无法形成可靠画像", radar_plus_proche: "最接近理想画像", radar_plus_loin: "最偏离理想画像", radar_score_hint: "产品属性与理想画像之间的平均差距 — 越低越接近。仅为描述性指标，非质量判断。", elasticite_titre: "各参考产品价格弹性", elasticite_hint: "2026年按周的数量~价格对数回归（含税或不含税结果相同，增值税不改变斜率）。门槛：至少8周数据且价格变动至少3%才计算。", elast_fiable_uniquement: "仅显示可靠数据（R² ≥ 0.3）", elast_peu_fiable: "可靠性较低", elast_semaines: "周数据", elast_variation_prix: "价格变动", elast_prix_moyen: "平均价格", elast_cat_elastique: "弹性 (≤-1)", elast_cat_inelastique: "非弹性", elast_cat_positif: "正向（非典型）", simulation_titre: "模拟 — 提价5%", simulation_hint: "若价格上涨5%且其他条件不变，对销量（基于测得的弹性）和净营业额的估计影响。这是模拟，非保证性预测。", marge_manoeuvre_titre: "调价空间", marge_manoeuvre_sub: "价格对这些销量影响较小", prudence_titre: "价格谨慎", prudence_sub: "提价将导致大量销量流失", sim_ca_actuel: "涉及营业额", sim_volume: "销量", sim_pas_de_signal: "未检测到明显信号", sim_titre: "价格→销量模拟器", sim_hint: "选择一个产品和一个平台，提出一个价格：预计销量和营业额会根据该产品测得的弹性实时重新计算。", sim_choisir_produit: "选择产品", sim_choisir_mp: "平台", sim_prix_actuel: "观察到的平均价格", sim_prix_propose: "提议价格", sim_qte_actuelle: "当前销量（周）", sim_qte_projetee: "预计销量", sim_ca_semaine_actuel: "当前营业额（周）", sim_ca_semaine_projete: "预计营业额", sim_hors_plage: "该价格超出历史观察范围 — 预测变为外推，可靠性较低。", sim_aucun_resultat: "该产品无弹性数据。", resultat: "条结果", resultats: "条结果", tous_produits_titre: "所有产品", tous_produits_hint: "营业额与销量，完整2026年（年初至今）— 含清仓产品，与上方排行榜不同", ap_destockage_badge: "清仓", zone_hebdo: "周视图", zone_hebdo_hint: "真实每周数据 — 营业额、数量、平台分布、承运商、发货来源与热销产品", repartition_mp_semaine: "按平台分布", part_ca_pct: "营业额占比（%）", expeditions_titre: "发货", expeditions_hint: "本周订单实际使用的承运商", entrepot_titre: "发货来源", entrepot_hint: "本周订单发出的仓库 — 反映发货流向，非当前库存快照", top_semaine_titre: "本周热销产品", qte_semaine_courte: "周", tendance_4_semaines: "趋势 — 最近4周", zone_abc: "ABC分类 — 2026年", sku_classes: "已分类SKU", zone_saison: "季节性 — 2024-2025年指数", preset_mois_courant: "本月", preset_mois_precedent: "上月", preset_annee_courante: "今年", preset_annee_passee: "去年", preset_personnalise: "自定义", yoy_variation_forte: "变化幅度极大 — 请核实去年同期绝对值，通常是基数过低而非真实趋势",
    sum_ca_titre: "营业额", sum_vs_mois_prec: "对比上月", sum_objectif_titre: "目标", sum_ytd_titre: "年初至今", sum_panier_moyen_titre: "平均客单价", sum_repartition_marque_titre: "品牌分布", sum_mp_leader: "领先平台", sum_position: "排名", sum_evolution_bestherm: "Bestherm趋势", sum_top5_produits: "热销产品前5", sum_normes_titre: "认证标准", sum_top_cat: "热门品类/子品类", sum_performance: "效果表现", sum_budget_investi: "已投入预算", sum_periode_titre: "周期",
sum_en: "于", sum_sur: "，共", sum_soit_lower: "即", sum_vs_meme_periode_an_dernier: "对比去年同期", sum_comparatif_n1_indispo: "去年同期数据不可用", sum_objectif_annuel_realise: "年度目标", sum_deja_realise_periode: "已在所选周期内达成。", sum_aucun_objectif_pour: "未为以下对象设定年度目标：", sum_depuis_1er_janvier: "自1月1日起，即", sum_objectif_annuel_point: "年度目标。", sum_ytd_non_dispo: "未设定目标，无法显示年初至今指标。", sum_annee_complete_pas_detail: "完整2026年数据，暂无按周期细分。", sum_non_disponible: "暂无数据。", sum_du_ca_periode: "本周期营业额。", sum_realise_cette_periode: "本周期已达成的年度目标。", sum_aucun_objectif_point: "未设定年度目标。", sum_depuis_1er_janvier_parenthese: "自1月1日起", sum_de_objectif_parenthese: "目标）。", sum_sur_cette_periode_point: "本周期。", sum_non_calculable: "无法计算。", sum_ere: "", sum_e: "", sum_mp_sur: "平台，共", sum_pour_cette_periode: "（本周期）。", sum_rang_non_calculable: "排名无法计算。", sum_vs_an_dernier_point: "对比去年。", sum_comparatif_n1_mp_indispo: "按平台的去年同期数据不可用。", sum_qte_non_dispo_mp: "按平台的数量数据不可用", sum_annee_complete: "完整2026年", sum_aucune_donnee_produit: "暂无产品数据。", sum_du_ca_ce: "营业额为CE认证，", sum_en_nf_periode: "为NF认证（本周期）。", sum_annee_complete_non_filtrable: "完整2026年数据，不可按周期筛选。", sum_roas_de: "ROAS为", sum_sur_annee_2026: "（2026年）。", sum_depenses_pour: "已花费，带来", sum_generes_cumul: "营业额 — 2026年初至今累计（唯一可用数据，无月度细分）。", sum_donnee_annuelle_complete: "完整2026年年度数据 — 日期筛选不适用于此标签页。", conc_top_produits: "热销产品", conc_comparatif: "对比", non_identifiee: "未识别", marque_non_identifiee: "未识别品牌", lifecycle_croissance_desc: "对比2025年同期+20%或以上", lifecycle_declin_desc: "对比2025年同期-20%或以下", lifecycle_declin_lbl: "下滑", donnees_statiques: "静态数据", autres_lbl: "其他", vs_semaine_prec: "对比上周", apercu_semaine_titre: "本周概览", voir_detail_supply: "在Supply中查看详情", voir_detail_prix: "在价格页查看详情", demo_mode_tooltip: "演示模式 — 使显示数字失真，不影响真实数据", demo_mode_actif: "演示模式已启用 — 显示数字已失真，非真实数据", repartition_mp_semaine_courte: "本周", sum_cette_semaine: "本周", sum_du_ca_semaine: "占本周营业额", sum_meilleure_progression: "最佳增长", sum_vs_semaine_derniere: "对比上周", pd_prix_titre: "价格定位", pd_cycle_titre: "生命周期", pd_panier_titre: "常与以下产品一起购买", pd_prix_non_dispo: "该产品暂无价格数据", pd_panier_non_dispo: "未发现常见搭配", pd_repartition_titre: "各平台销售分布", pd_courbe_titre: "月度销售曲线", pd_fiche_titre: "产品资料", pd_fiche_non_dispo: "暂无产品目录资料", pd_made_in_france: "法国制造", pd_connecte_wifi: "WiFi连接", pd_garantie_ans: "年保修", ap_catalogue_badge: "目录中，未售出", ap_top_badge: "前5名", ap_flop_badge: "后5名", note_homy_marque: "产品目录揭示了第4个品牌HOM'Y，有真实销售记录（如Orphée Connect，2026年约1.1万欧元，占营业额0.2%），目前计入上方Bestherm — 尚未单独区分，现有计算结构仅区分2个品牌。", forte_croissance_objectif_bas: "增长强劲但目标达成率低 — 目标可能需要重新校准", lifecycle_lancement_lbl: "新品期", lifecycle_lancement_desc: "去年同期无可比销售", lifecycle_croissance_lbl: "增长期", lifecycle_mature_lbl: "成熟期", lifecycle_mature_desc: "稳定，介于-20%至+20%之间", mois_dec_court: "12月", mois_sep_court: "9月", mois_oct_court: "10月", mois_nov_court: "11月", zone_anticipation: "预测 — 2026年10月至12月", anticipation_mp_titre: "按平台预测", anticipation_mp_hint: "与总体预测同一方法，按平台单独计算 — 预期高峰的分布未必与当前分布相同", zone_manquant: "进一步分析所缺内容", manque_stock_titre: "库存与补货", manque_stock_texte: "源文件给出了每笔发货的来源仓库（见上方周视图）— 这是流量，非当前库存水平。覆盖率、再订货点、安全库存、缺货、超储仍无法实现：需要某一时点的库存导出数据（可用/预留/锁定），所提供文件中不存在此类数据。", manque_transport_titre: "物流与配送", manque_transport_texte: "每笔订单的实际承运商现已可见（见上方周视图）。承运商成本、配送时效、延误/破损率仍无法实现 — 所提供文件中不存在此类信息。", radar_radiateurs: "散热器", radar_secheserviettes: "毛巾架", axe_ceramique: "陶瓷", axe_fonte: "铸铁", axe_film: "发热膜", axe_wifi: "WiFi", axe_vertical: "立式", axe_plinthe: "踢脚线", axe_soufflerie: "带风扇", entry_acces_restreint: "访问受限", entry_placeholder: "访问密钥", entry_entrer: "进入", entry_erreur: "密钥错误", entry_erreur_serveur: "无法连接，请重试", gauge_objectif: "2026年目标", summary_synthese: "摘要", summary_fermer: "关闭摘要", zone_international: "国际", est_soit: "即", est_a: "至", est_de_objectif_annuel: "年度目标", pub_par_pays_hint: "与上方分布不同：此处衡量广告投放表现，非真实销售总额", conf_haute: "高可信度", conf_moyenne: "中等可信度", conf_basse: "低可信度", conc_ref_identifiees_sur: "个Bestherm/Thomson参考产品，已识别，共", conc_produits_recenses: "个已统计产品。", conc_aucune_ref_heater: "当前采集数据中未识别到Bestherm/Thomson产品。", conc_ref_sur: "个Bestherm/Thomson参考产品，共", conc_produits_point: "个产品。", conc_aucune_ref_cooling: "未发现Bestherm/Thomson产品 — 该平台暂未布局此市场。", conc_reference_sing: "个产品", conc_reference_plur: "个产品", conc_produit_sing: "个产品", conc_produit_plur: "个产品", conc_collecte_sing: "已采集", conc_collecte_plur: "已采集",
    autres_mp: "其他平台", autres_mp_hint: "按营业额降序排列", vue_detaillee: "仅显示页面顶部所选平台的详细信息",
    aucune_donnee_mp: "该平台暂无数据",
    repartition_geo: "地理分布", repartition_geo_hint: "广告活动产生的营业额，按国家分列 — 并非总销售额，销售数据中没有可靠的国家明细",
    filtrer_par_mp: "按平台筛选：", detail_mensuel_indispo: "仅限2026年 — 暂无可靠的月度明细",
    positions_approx: "位置为示意性排布（非真实地理投影）· 采用非线性比例以保证小国家可见",
    detail_pays: "国家明细", detail_pays_hint: "始终显示全部14个平台，2026年完整累计",
    repartition_marque: "2026年营业额按品牌分布", repartition_marque_hint: "各品牌占2026年累计营业额的比例", bestherm_vs_n1: "Bestherm 同比",
    thomson_hint: "Thomson：2025年同期为0欧元 — 该品牌2025年上半年尚未上市销售",
    ca_mensuel_marque: "各品牌月度营业额", ca_mensuel_marque_hint: "按自然月统计，仅限2026年",
    marque_reconstituee: "历史数据中的品牌信息通过产品参考编号还原 — 2026年覆盖率：",
    top_produits: "热销产品", top_produits_hint: "累计营业额最高的3款产品，与去年同期对比（1月1日至7月18日）",
    qte_nd_mp: "该平台数量数据不可用", nd: "不可用", reste_top15: "第4至15名", reste_top15_hint: "排名第4至15位",
    ca_mois_top6: "月度营业额 — 2026年热销产品Top 6", ca_mois_top6_hint: "累计营业额最高的6款产品 · 颜色深浅代表当月营业额",
    repartition_norme: "认证标准分布（NF / CE）", repartition_norme_hint: "各认证标准营业额占比，按月统计 — 年份由下方筛选器选择",
    evolution_mensuelle: "月度变化趋势", evolution_mensuelle_hint: "当月各认证标准营业额占比",
    repartition_categorie: "品类分布", repartition_categorie_hint: "2026年营业额按品类及子品类占比 — 选择一个平台查看其专属分布",
    rattache_catalogue: "已通过产品目录关联品类的营业额占比",
    categories: "品类", sous_categories: "子品类", sous_categories_hint: "产品目录中的「子品类」列（例如：入门级陶瓷款、陶瓷+wifi款…）— 并非产品系列名称",
    suivi_prix: "价格追踪", suivi_prix_hint: "按产品、平台及月份统计的平均不含税售价（营业额 ÷ 数量）— 完整数据集",
    rechercher_produit: "搜索产品…", affine_recherche: "已显示前40条，请缩小搜索范围查看更多",
    non_dispo_2024: "2024年数据不可用（该导出文件无平台明细）", aucun_resultat: "无匹配结果 — 请尝试其他搜索词",
    produit_col: "产品", marketplace_col: "平台", prix_mode: "价格", qte_mode: "数量",
    depense_totale: "总支出（不含税）", depense_totale_hint: "2026年累计广告预算支出总和",
    ca_genere_ht: "广告产生营业额", ca_genere_ht_hint: "2026年累计广告活动带来的不含税营业额",
    roas_pondere: "加权平均广告投资回报率", roas_pondere_hint: "产生营业额 ÷ 支出，所有平台合计",
    budget_pub_mp: "各平台广告预算", budget_pub_mp_hint: "各平台年度预算、已投入支出与剩余额度 — 圆环图一目了然",
    depense_lbl: "已花费", budget_lbl: "预算", restant_lbl: "剩余",
    top3_ads: "产生营业额最高的前三名", top3_ads_hint: "2026年累计广告产生营业额最高的3个平台",
    a_surveiller: "需要关注", a_surveiller_hint: "广告投资回报率（ROAS）低于3倍的支出 — 预警阈值", perte_nette: "支出超过产生的营业额 · 每投入100欧元，ACOS为",
    reste_mp_ads: "其他平台", reste_mp_ads_hint: "按产生营业额降序排列 · 进度条 = 年度预算已消耗比例",
    pas_budget_n1: "未提供2025年广告预算数据 — 该部分暂无法进行同比分析",
    tous_montants_ht: "所有金额均为不含税价 · 2024–2026年真实数据",
    erreur_titre: "出现了一些问题", erreur_msg: "应用程序遇到意外错误，刷新页面通常可以解决此问题。", recharger: "刷新页面",
    langue: "语言",
  },
  es: {
    nav_apercu: "Resumen", nav_marketplaces: "Marketplaces", nav_marques: "Marcas y Productos", nav_prix: "Seguimiento de Precios", nav_ads: "Campañas Ads", nav_concurrence: "Competencia", nav_supply: "Supply", pilotage: "Panel de control", marketplace_label: "Marketplace:", toutes_mp: "Todas las marketplaces", mode_presentation: "Modo presentación", reset: "reiniciar", analyser_periode: "Analizar el período:", vs_an_dernier: "el año pasado", ht_suffix: "Todos los importes sin IVA", ca_cumule: "Facturación HT acumulada YTD", ca_cumule_hint: "Suma de la facturación HT de todos los pedidos desde el 1 de enero de 2026", toutes_marketplaces_suffix: "todas las marketplaces", objectif_2026: "de", objectif_non_defini: "objetivo no definido", panier_moyen: "Precio medio HT", panier_moyen_hint: "Facturación HT total ÷ número de pedidos, 2026", unites_vendues: "unidades vendidas", meilleure_vente: "Mejor venta 2026", meilleure_vente_hint: "Producto con mayor facturación HT acumulada desde enero", vs_meilleure_n1: "Vs mejor venta N-1", vs_meilleure_n1_hint: "Mismo producto, facturación HT comparada con la misma ventana 2025", en_2025: "en 2025", non_comparable: "no comparable", indispo_par_mp: "no disponible por marketplace", detail_non_conserve: "detalle por marketplace no conservado para 2025", tendance_titre: "Tendencia de facturación HT — una curva por año", tendance_hint: "Un gráfico por año, misma escala vertical para comparar las curvas honestamente", ca_ht_total_titre: "Facturación HT total — todas las marketplaces, a la fecha", ca_ht_total_hint: "Suma de la facturación HT 2026 de todas las marketplaces monitorizadas", au_rythme: "según lo previsto", top3: "Top 3", top3_hint: "Las 3 marketplaces con mayor facturación HT acumulada 2026", de_word: "de", nouveau: "nuevo", est_fin_annee: "Previsión fin de año", objectif_non_defini_mp: "Objetivo anual no definido para esta marketplace", legende_reel: "Real", legende_anticipe: "Previsto", reparti_saisonnier: "repartido según el patrón estacional real, no un 1/12 uniforme", repartition_pays_titre: "Reparto por país", repartition_pays_hint: "Pedidos reales por país — no una estimación de ads. 2024 excluido (sin detalle de país ese año)", aucune_donnee_pays: "Sin datos de país para esta selección — verifica que el período incluya 2025 o 2026.", pub_par_pays: "Publicidad por país", depense_ads: "gasto en ads", conc_titre: "Competencia", conc_hint: "Datos recopilados manualmente mediante búsqueda web — Francia. Ningún precio, ranking o volumen inventado.", conc_position_heater: "Posición Heater — ", conc_position_cooling: "Posición Cooling — ", conc_radiateurs: "Radiadores — ", conc_secheserviettes: "Toalleros — ", conc_produits_suivis: "Productos monitorizados", conc_produits_suivis_hint: "Selección actual (segmento/subcategoría/marketplace)", conc_prix_moyen: "Precio medio", conc_prix_moyen_hint: "Sobre los productos cuyo precio pudo verificarse", conc_fourchette_prix: "Rango de precios", conc_fourchette_prix_hint: "Del más barato al más caro, solo precios verificados", conc_en_promo: "En promoción", conc_en_promo_hint: "Productos que muestran un descuento vs precio de referencia", conc_sources_qualite: "Fuentes y calidad", conc_sources_qualite_hint: "Fiabilidad de la recopilación por subcategoría y marketplace — metodología y límites propios de cada fuente", conc_marques_visibles: "Marcas más visibles", conc_marques_visibles_hint: "Marcas más presentes en la recopilación, todas las marketplaces combinadas (número de apariciones, no cuota de mercado real)", conc_aucun_produit: "Ningún producto para esta selección", conc_sponsorise: "Patrocinado", conc_prix_nd: "Precio n/d", conc_comparatif_prix_mp: "Comparativa de precios por marketplace", conc_comparatif_prix_mp_hint: "Solo precios verificados — los productos sin un precio extraído de forma fiable no aparecen aquí", conc_aucun_prix_verifie: "Ningún precio verificado para esta selección", conc_moy: "prom.", conc_vs_marche: "Bestherm/Thomson vs mercado", conc_vs_marche_hint: "Precios Bestherm/Thomson comparados con la media de los competidores (Bestherm/Thomson excluidos del cálculo de esa media) — solo donde se pudo verificar un precio real de la competencia", conc_pas_de_comparaison: "Aún no hay precio de competidor verificado en la misma subcategoría que un producto Bestherm/Thomson, para esta selección — comparación imposible por ahora en lugar de aproximada.", conc_exporter: "Exportar:", conc_nomme_date: "Nombrado con la fecha del día · refleja la selección actual (segmento/subcategoría/marketplace)", zone_marque: "Marca", zone_produits_titre: "Productos", zone_normes: "Normas", zone_puissances: "Potencias", subnav_produit_ideal: "Producto ideal", subnav_normes_cat: "Normas y Categorías", topflop_titre: "Tops y Flops", topflop_hint: "Filtrable por fecha + marketplace como el resto de la app · accesorios y piezas de repuesto excluidos", top5_hint: "Mejores resultados en la selección actual", flop5_hint: "Peores resultados en la selección actual, accesorios excluidos", aucune_donnee: "Sin datos", cycle_vie_titre: "Ciclo de vida del producto", cycle_vie_hint: "Compara junio-agosto 2026 con el mismo período de 2025 (no los meses anteriores, para no confundir estacionalidad con tendencia real) — respeta el filtro de marketplace", panier_titre: "Comprados frecuentemente juntos", panier_hint: "Productos realmente comprados juntos (mismo número de pedido), 2025+2026 — dato global, aún no filtrable por marketplace o período", panier_croise_hint: "Radiador + toallero en el mismo pedido — señal de reforma completa de baño", panier_croise_titre: "Ventas cruzadas radiador × toallero", panier_toutes_hint: "Todos los pares combinados, incluida la misma gama en distintas potencias", panier_toutes_titre: "Todos los pares — top 8", prix_regulier_ideal: "Precio regular ideal", prix_promo_ideal: "Precio promo ideal*", toutes_categories: "Todas las categorías", aucune_donnee_qte: "Sin datos de cantidad para esta selección", puissances_vendues_titre: "Potencias más vendidas", puissances_vendues_hint: "Cantidad vendida por potencia, filtrable por fecha + marketplace como el resto de la app", supply_titre: "Supply", supply_hint: "Construido solo con datos realmente disponibles — clasificación ABC (2026), histórico de ventas (2024-2026). No existe ningún dato de stock, transporte o proveedor en los archivos proporcionados.", comparatif_prix_titre: "Comparativa por producto", comparatif_prix_hint: "Precio más alto y más bajo entre marketplaces (2026), quién vende más, diferencia en %, precio medio ponderado. Marketplaces \"No identificada\"/\"Otra\" excluidas de la comparativa — no son marketplaces reales identificables.", cp_vend_plus: "Vende más", cp_prix_moyen: "Precio medio", signal_premium: "Posicionamiento premium", signal_sensible: "Sensible al precio", signal_neutre: "Señal neutra", radar_fiabilite_insuffisante: "Datos insuficientes para un perfil fiable", radar_plus_proche: "Mas cercano al perfil ideal", radar_plus_loin: "Mas alejado del perfil ideal", radar_score_hint: "Diferencia media entre los atributos del producto y el perfil ideal — mas bajo = mas cercano. Descriptivo, no un juicio de calidad.", elasticite_titre: "Elasticidad precio por referencia", elasticite_hint: "Regresion log-log cantidad~precio, por semana 2026 (HT o TTC: mismo resultado, el IVA no cambia la pendiente). Umbrales: >=8 semanas de datos y >=3% de variacion de precio antes de calcular.", elast_fiable_uniquement: "Solo fiables (R2 >= 0.3)", elast_peu_fiable: "poco fiable", elast_semaines: "semanas de datos", elast_variation_prix: "variacion de precio", elast_prix_moyen: "precio medio", elast_cat_elastique: "Elastico (<=-1)", elast_cat_inelastique: "Inelastico", elast_cat_positif: "Positivo (atipico)", simulation_titre: "Simulacion — subida de precio del 5%", simulation_hint: "Impacto estimado en el volumen (elasticidad medida) y en la facturacion neta, si el precio subiera un 5% y nada mas cambiara. Una simulacion, no una prediccion garantizada.", marge_manoeuvre_titre: "Margen de maniobra", marge_manoeuvre_sub: "El precio influye poco en estos volumenes", prudence_titre: "Precaucion de precio", prudence_sub: "Una subida haria huir volumenes importantes", sim_ca_actuel: "facturacion en juego", sim_volume: "volumen", sim_pas_de_signal: "ninguna senal fuerte detectada", sim_titre: "Simulador precio -> cantidad", sim_hint: "Elija un producto y un marketplace, proponga un precio: el volumen y la facturacion proyectados se recalculan en vivo, a partir de la elasticidad medida para esa referencia.", sim_choisir_produit: "Elegir un producto", sim_choisir_mp: "Marketplace", sim_prix_actuel: "Precio medio observado", sim_prix_propose: "Precio propuesto", sim_qte_actuelle: "Volumen actual (semana)", sim_qte_projetee: "Volumen proyectado", sim_ca_semaine_actuel: "Facturacion actual (semana)", sim_ca_semaine_projete: "Facturacion proyectada", sim_hors_plage: "Este precio supera el rango observado historicamente — la proyeccion se convierte en una extrapolacion, menos fiable.", sim_aucun_resultat: "Sin datos de elasticidad para este producto.", resultat: "resultado", resultats: "resultados", tous_produits_titre: "Todos los productos", tous_produits_hint: "Facturación y cantidad vendida, año 2026 completo (year-to-date) — incluye liquidación de stock, a diferencia de los Tops/Flops de arriba", ap_destockage_badge: "liquidación", zone_hebdo: "Vista semanal", zone_hebdo_hint: "Datos reales semanales — facturación, cantidad, reparto por marketplace, transportista, origen de envíos y productos top", repartition_mp_semaine: "Reparto por marketplace", part_ca_pct: "Parte de la facturación (%)", expeditions_titre: "Envíos", expeditions_hint: "Transportista real usado para los pedidos enviados esta semana", entrepot_titre: "Origen de los envíos", entrepot_hint: "Almacén desde donde salieron los pedidos esta semana — un flujo de envío, no una foto del stock actualmente disponible", top_semaine_titre: "Productos top de la semana", qte_semaine_courte: "sem.", tendance_4_semaines: "Tendencia — últimas 4 semanas", zone_abc: "Clasificación ABC — 2026", sku_classes: "SKU clasificados", zone_saison: "Estacionalidad — índice 2024-2025", preset_mois_courant: "Mes en curso", preset_mois_precedent: "Mes anterior", preset_annee_courante: "Año en curso", preset_annee_passee: "Año anterior", preset_personnalise: "Personalizado", yoy_variation_forte: "Variación muy fuerte — verifica el valor absoluto N-1, a menudo una base de comparación baja más que una tendencia real",
    sum_ca_titre: "Facturación", sum_vs_mois_prec: "Vs mes anterior", sum_objectif_titre: "Objetivo", sum_ytd_titre: "Year-to-date", sum_panier_moyen_titre: "Ticket medio", sum_repartition_marque_titre: "Reparto por marca", sum_mp_leader: "Marketplace líder", sum_position: "Posición", sum_evolution_bestherm: "Evolución Bestherm", sum_top5_produits: "Top 5 productos", sum_normes_titre: "Normas", sum_top_cat: "Categoría / subcategoría top", sum_performance: "Rendimiento", sum_budget_investi: "Presupuesto invertido", sum_periode_titre: "Período",
sum_en: "en", sum_sur: "en", sum_soit_lower: "es decir", sum_vs_meme_periode_an_dernier: "vs el mismo período del año pasado", sum_comparatif_n1_indispo: "comparativa N-1 no disponible", sum_objectif_annuel_realise: "del objetivo anual", sum_deja_realise_periode: "ya alcanzado para el período elegido.", sum_aucun_objectif_pour: "Sin objetivo anual definido para", sum_depuis_1er_janvier: "desde el 1 de enero, es decir", sum_objectif_annuel_point: "del objetivo anual.", sum_ytd_non_dispo: "Indicador YTD no disponible sin objetivo definido.", sum_annee_complete_pas_detail: "año 2026 completo, sin detalle disponible por período.", sum_non_disponible: "No disponible.", sum_du_ca_periode: "de la facturación en este período.", sum_realise_cette_periode: "del objetivo anual alcanzado en este período.", sum_aucun_objectif_point: "Sin objetivo anual definido.", sum_depuis_1er_janvier_parenthese: "desde el 1 de enero", sum_de_objectif_parenthese: "del objetivo).", sum_sur_cette_periode_point: "en este período.", sum_non_calculable: "No calculable.", sum_ere: "ª", sum_e: "ª", sum_mp_sur: "marketplace de", sum_pour_cette_periode: "para este período.", sum_rang_non_calculable: "Puesto no calculable.", sum_vs_an_dernier_point: "vs el año pasado.", sum_comparatif_n1_mp_indispo: "Comparativa N-1 no disponible por marketplace.", sum_qte_non_dispo_mp: "cantidad no disponible por marketplace", sum_annee_complete: "año 2026 completo", sum_aucune_donnee_produit: "Sin datos de producto disponibles.", sum_du_ca_ce: "de la facturación en CE,", sum_en_nf_periode: "en NF en este período.", sum_annee_complete_non_filtrable: "año 2026 completo, no filtrable por período.", sum_roas_de: "ROAS de", sum_sur_annee_2026: "en el año 2026.", sum_depenses_pour: "gastados para", sum_generes_cumul: "generados — total year-to-date 2026 (único dato disponible, sin detalle mensual).", sum_donnee_annuelle_complete: "Dato anual 2026 completo — el filtro de fecha no se aplica a esta pestaña.", conc_top_produits: "Productos top", conc_comparatif: "Comparativa", non_identifiee: "No identificada", marque_non_identifiee: "Marca no identificada", lifecycle_croissance_desc: "+20% o más vs mismo período 2025", lifecycle_declin_desc: "-20% o menos vs mismo período 2025", lifecycle_declin_lbl: "Declive", donnees_statiques: "Datos estáticos", autres_lbl: "Otras", vs_semaine_prec: "vs semana anterior", apercu_semaine_titre: "Resumen semanal", voir_detail_supply: "Ver detalle completo en Supply", voir_detail_prix: "Ver detalle completo en Precios", demo_mode_tooltip: "Modo demo — distorsiona las cifras mostradas, sin tocar los datos reales", demo_mode_actif: "Modo demo activo — las cifras mostradas están distorsionadas, no son los datos reales", repartition_mp_semaine_courte: "ESTA SEMANA", sum_cette_semaine: "esta semana", sum_du_ca_semaine: "de la facturación de la semana", sum_meilleure_progression: "Mejor progresión", sum_vs_semaine_derniere: "vs la semana anterior", pd_prix_titre: "Posicionamiento de precio", pd_cycle_titre: "Ciclo de vida", pd_panier_titre: "Comprado frecuentemente con", pd_prix_non_dispo: "Precio no disponible para este producto", pd_panier_non_dispo: "Ninguna asociación frecuente identificada", pd_repartition_titre: "Reparto de ventas por marketplace", pd_courbe_titre: "Curva de ventas mensual", pd_fiche_titre: "Ficha de producto", pd_fiche_non_dispo: "Ficha de catálogo no disponible", pd_made_in_france: "Fabricado en Francia", pd_connecte_wifi: "Conectado WiFi", pd_garantie_ans: "años de garantía", ap_catalogue_badge: "catálogo, no vendido", ap_top_badge: "Top 5", ap_flop_badge: "Flop 5", note_homy_marque: "El catálogo revela una 4ª marca, HOM'Y, con ventas reales (ej. Orphée Connect, ~11k€ en 2026, 0,2% de la facturación) actualmente contabilizada en Bestherm arriba — aún no aislada por separado, ya que la estructura de cálculo existente solo distingue 2 marcas.", forte_croissance_objectif_bas: "Fuerte crecimiento pero objetivo poco alcanzado — objetivo posiblemente a recalibrar", lifecycle_lancement_lbl: "Lanzamiento", lifecycle_lancement_desc: "Sin venta comparable el año pasado", lifecycle_croissance_lbl: "Crecimiento", lifecycle_mature_lbl: "Maduro", lifecycle_mature_desc: "Estable, entre -20% y +20%", mois_dec_court: "Dic", mois_sep_court: "Sep", mois_oct_court: "Oct", mois_nov_court: "Nov", zone_anticipation: "Previsión — octubre a diciembre 2026", anticipation_mp_titre: "Previsión por marketplace", anticipation_mp_hint: "Mismo método que la previsión global, calculado por separado por marketplace — el reparto esperado del pico no es necesariamente el actual", zone_manquant: "Qué falta para ir más lejos", manque_stock_titre: "Stock y aprovisionamiento", manque_stock_texte: "El archivo fuente da el almacén de origen de cada envío (ver Vista semanal arriba) — un flujo, no un nivel de stock actual. Cobertura, punto de pedido, stock de seguridad, roturas, exceso de stock siguen fuera de alcance: haría falta una exportación de stock en un momento dado (disponible/reservado/bloqueado), que no existe en los archivos proporcionados.", manque_transport_titre: "Transporte y entrega", manque_transport_texte: "El transportista real por pedido ahora es visible (Vista semanal arriba). Costes de transporte, plazos de entrega, tasas de retraso/daños siguen fuera de alcance — esta información no existe en los archivos proporcionados.", radar_radiateurs: "Radiadores", radar_secheserviettes: "Toalleros", axe_ceramique: "Cerámica", axe_fonte: "Fundición", axe_film: "Film", axe_wifi: "WiFi", axe_vertical: "Vertical", axe_plinthe: "Rodapié", axe_soufflerie: "Con ventilador", entry_acces_restreint: "Acceso restringido", entry_placeholder: "Clave de acceso", entry_entrer: "Entrar", entry_erreur: "Clave incorrecta", entry_erreur_serveur: "No se pudo conectar — intentalo de nuevo", gauge_objectif: "OBJETIVO 2026", summary_synthese: "Resumen", summary_fermer: "Cerrar el resumen", zone_international: "Internacional", est_soit: "Es decir", est_a: "a", est_de_objectif_annuel: "del objetivo anual", pub_par_pays_hint: "Distinto del reparto anterior: esto mide el rendimiento de las campañas publicitarias por país, no el total de ventas reales", conf_haute: "Confianza alta", conf_moyenne: "Confianza media", conf_basse: "Confianza baja", conc_ref_identifiees_sur: "referencia(s) Bestherm/Thomson identificada(s) de", conc_produits_recenses: "productos registrados.", conc_aucune_ref_heater: "Ninguna referencia Bestherm/Thomson identificada en la recopilación actual.", conc_ref_sur: "referencia(s) Bestherm/Thomson de", conc_produits_point: "productos.", conc_aucune_ref_cooling: "Ninguna referencia Bestherm/Thomson — mercado aún no abordado en esta marketplace.", conc_reference_sing: "referencia", conc_reference_plur: "referencias", conc_produit_sing: "producto", conc_produit_plur: "productos", conc_collecte_sing: "recopilado", conc_collecte_plur: "recopilados", autres_mp: "Otras marketplaces", autres_mp_hint: "Ordenadas por facturación HT decreciente", vue_detaillee: "Vista detallada limitada a la marketplace seleccionada arriba", aucune_donnee_mp: "Sin datos para esta marketplace", repartition_geo: "Reparto geográfico", repartition_geo_hint: "Facturación HT generada por las campañas publicitarias, por país — no la facturación total de ventas, que no tiene detalle de país fiable en nuestras exportaciones", filtrer_par_mp: "Filtrar por marketplace:", detail_mensuel_indispo: "Solo 2026 — sin detalle mensual fiable disponible", positions_approx: "Posiciones aproximadas (no una proyección geográfica real) · escala no lineal para mantener visibles los países pequeños", detail_pays: "Detalle por país", detail_pays_hint: "Siempre las 14 marketplaces, acumulado completo 2026", repartition_marque: "Reparto de la facturación HT 2026 por marca", repartition_marque_hint: "Parte de cada marca en la facturación HT acumulada 2026", bestherm_vs_n1: "Bestherm vs N-1", thomson_hint: "Thomson: 0€ en esta ventana en 2025 — marca aún no comercializada en el primer semestre de 2025", ca_mensuel_marque: "Facturación HT mensual por marca", ca_mensuel_marque_hint: "Facturación HT por mes natural, solo año 2026", marque_reconstituee: "Marca reconstruida por referencia de producto sobre el histórico — cobertura 2026:", top_produits: "Productos top", top_produits_hint: "Los 3 productos con mayor facturación HT acumulada, período comparable vs N-1 (1 ene-18 jul)", qte_nd_mp: "cant. n/d por mp", nd: "n/d", reste_top15: "Resto del Top 15", reste_top15_hint: "Puesto 4 a 15", ca_mois_top6: "Facturación HT por mes — Top 6 productos, 2026", ca_mois_top6_hint: "Los 6 productos con mayor facturación HT acumulada · intensidad = facturación HT del mes", repartition_norme: "Reparto por norma (NF / CE)", repartition_norme_hint: "Parte de la facturación HT por norma de producto, mes a mes — año seleccionado con el filtro de abajo", evolution_mensuelle: "Evolución mensual", evolution_mensuelle_hint: "% de la facturación HT del mes según cada norma", repartition_categorie: "Reparto por categoría", repartition_categorie_hint: "% de la facturación HT 2026 por categoría y subcategoría — elige una marketplace para ver su propio reparto", rattache_catalogue: "% de la facturación HT vinculada a una categoría vía el catálogo de productos", categories: "Categorías", sous_categories: "Subcategorías", sous_categories_hint: "Columna «Subcategoría» del catálogo (ej. Cerámica gama básica, Cerámica + wifi…) — no las gamas de producto", suivi_prix: "Seguimiento de precios", suivi_prix_hint: "Precio de venta medio HT (facturación HT ÷ cantidad) por producto, marketplace y mes — conjunto de datos completo", rechercher_produit: "Buscar un producto…", affine_recherche: "Se muestran los primeros 40, afina tu búsqueda para ver el resto", non_dispo_2024: "2024 no disponible (sin detalle de marketplace en esta exportación)", aucun_resultat: "Sin resultados — prueba otro término de búsqueda", produit_col: "Producto", marketplace_col: "Marketplace", prix_mode: "Precio", qte_mode: "Cantidad", depense_totale: "Gasto total HT", depense_totale_hint: "Suma de los presupuestos ads consumidos, acumulado 2026", ca_genere_ht: "Facturación generada HT", ca_genere_ht_hint: "Facturación HT atribuida a las campañas ads, acumulado 2026", roas_pondere: "ROAS medio ponderado", roas_pondere_hint: "Facturación generada ÷ gasto, todas las marketplaces combinadas", budget_pub_mp: "Presupuesto publicitario por marketplace", budget_pub_mp_hint: "Presupuesto anual, gasto comprometido y saldo restante por marketplace — indicador circular para una lectura inmediata", depense_lbl: "Gastado", budget_lbl: "Presupuesto", restant_lbl: "Restante", top3_ads: "Top 3 por facturación generada", top3_ads_hint: "Las 3 marketplaces con mayor facturación generada por ads, acumulado 2026", a_surveiller: "A vigilar", a_surveiller_hint: "Gasto en ads cuyo retorno (ROAS) es inferior a 3x — umbral de alerta", perte_nette: "gasto superior a la facturación generada · por cada 100€ invertidos, ACOS de", reste_mp_ads: "Resto de marketplaces", reste_mp_ads_hint: "Ordenadas por facturación generada decreciente · barra = % del presupuesto anual ya consumido", pas_budget_n1: "Sin presupuesto ads N-1 proporcionado — comparativa interanual no disponible para este apartado", tous_montants_ht: "Todos los importes sin IVA · datos reales 2024–2026", erreur_titre: "Se produjo un problema", erreur_msg: "La aplicación encontró un error inesperado. Recargar la página normalmente resuelve el problema.", recharger: "Recargar", langue: "Idioma",
  },
};

// ============================================================================
// CONCURRENCE — veille concurrentielle, collectée manuellement via recherche
// web. Phase 1 : France uniquement, catégorie Ventilateurs. Chaque source a
// son propre niveau de confiance et sa méthodologie affichée — jamais de
// prix, classement ou volume inventé quand la donnée n'a pas pu être
// vérifiée (ex. Amazon : rang confirmé, prix non extrait de façon fiable).
// ============================================================================
const COMPETITION_DATA = {};
;


// couleurs de marque vérifiées par recherche web (pas de hex deviné) —
// seules les marketplaces confirmées par plusieurs sources indépendantes
// figurent ici ; les autres restent sur l'orange Bestherm par défaut
// ============================================================================
// SKU_PRODUIT : noms canoniques du catalogue. SKU_MONTHLY : [indexProduit, indexMp, année,
// mois, ca, qte]. Jointure ventes<->catalogue hybride : SKU en priorité, repli sur le nom
// produit si le SKU de la ligne de vente ne correspond à aucune entrée catalogue (un même
// produit peut avoir plusieurs codes SKU historiques) — 97,1% de couverture vérifiée, contre
// 62% en SKU seul. SKU_DESTOCKAGE/SKU_FAMILLE/SKU_WIFI/SKU_PLINTHE/SKU_VERTICAL/
// SKU_SOUS_FAMILLE/SKU_SOUS_SOUS_FAMILLE : tableaux parallèles à SKU_PRODUIT (même index).
const SKU_PRODUIT = [];
;




const SKU_MPS = [];
;

const SKU_MONTHLY = [];
;






const SKU_DESTOCKAGE = [];
;



const SKU_FAMILLE = [];
;



const SKU_WIFI = [];
;



const SKU_PLINTHE = [];
;



const SKU_VERTICAL = [];
;



const SKU_SOUS_FAMILLE = [];
;



const SKU_SOUS_SOUS_FAMILLE = [];
;







const PRODUCT_TO_CATEGORY = {};
;


// ============================================================================
// SUPPLY — classification ABC réelle (LIGNE ODP 2026, seule année avec cette
// colonne), indice de saisonnalité calculé sur 2024+2025 (années complètes),
// projection sept-déc 2026 = valeur réelle du même mois 2025 x taux de
// croissance récent (juin-août 2026 vs 2025). Méthodologie explicite, pas
// une boîte noire — voir hints affichés dans l'app.
// ============================================================================
const ABC_BY_SKU = [];
;






const SEASONALITY_INDEX = [];
;


// PAYS_MONTHLY — vraie donnée pays par commande, 2025+2026 uniquement (2024 n'a
// pas cette colonne). [pays, marketplace, année, mois, ca]. PAYS_OBJECTIF :
// objectifs annuels par pays (Target MKTP, tous marketplaces confondus).
const PAYS_MONTHLY = [];
;






const PAYS_OBJECTIF = {};
;

// BASKET_PAIRS — paires de produits réellement achetés ensemble (même numéro
// de commande), 2026 UNIQUEMENT — le détail commande par commande de 2025
// n'est plus disponible dans le pipeline actuel (seuls des agrégats mensuels
// ont été conservés), donc impossible d'inclure 2025 ici sans le fichier brut
// d'origine. Comptage au niveau commande×produit dédupliqué (pas ligne brute),
// pour ne pas gonfler artificiellement les paires avec des doublons d'export.
const BASKET_PAIRS = [];
;

// PRODUCT_CATALOG — fiches produit issues du catalogue Shopify (export du 7
// septembre 2026), réconciliées avec les noms de vente existants par extraction
// de motif depuis les titres longs (marque + wattage + couleur). 74 produits sur
// les 120 actuels ont une correspondance fiable avec fiche complète (image,
// couleur, matière, poids, dimensions, garantie, connectivité) ; les autres
// n'ont pas de spec exploitable dans l'export ou pas de correspondance certaine
// (le catalogue référence des variantes plus récentes non encore vendues).
const PRODUCT_CATALOG = {};
;

// CATALOGUE_NON_VENDU — produits actifs du catalogue Shopify sans correspondance
// dans l'historique des ventes (aucune ligne de commande trouvée). Peut être un
// lancement récent, une variante WiFi qui remplace une référence existante sous
// un autre nom, ou un produit listé mais jamais réellement mis en avant. [nom, marque].
const CATALOGUE_NON_VENDU = [];
;


// Données hebdomadaires réelles — colonnes "semaines", "Entrepôt", "Expédition 2.0"
// du fichier source, jamais extraites avant cette version. WEEKLY_BY_ENT reflète
// les expéditions PARTIES de chaque entrepôt sur la semaine (flux), pas un stock
// actuel — cette nuance est explicite dans l'interface, pas juste ce commentaire.
const WEEKLY_TOTALS = [];
;







const WEEKLY_BY_MP = [];
;







const WEEKLY_BY_EXP = [];
;







const WEEKLY_BY_ENT = [];
;







const WEEKLY_BY_PROD = [];

// registre des constantes de données protégées, repeuplées après connexion —
// permet à populateData() de muter la bonne référence par son nom sans 27
// blocs if/else répétés. window car ces const vivent au scope module, hors
// de portée d'un composant React classique.
window.__APP_DATA__ = {
  DATA, ELASTICITE_DATA, SIMULATION_PRIX, COMPETITION_DATA,
  SKU_PRODUIT, SKU_MPS, SKU_MONTHLY, SKU_DESTOCKAGE, SKU_FAMILLE, SKU_WIFI, SKU_PLINTHE,
  SKU_VERTICAL, SKU_SOUS_FAMILLE, SKU_SOUS_SOUS_FAMILLE, PRODUCT_TO_CATEGORY, ABC_BY_SKU,
  SEASONALITY_INDEX, PAYS_MONTHLY, PAYS_OBJECTIF, BASKET_PAIRS, PRODUCT_CATALOG,
  CATALOGUE_NON_VENDU, WEEKLY_TOTALS, WEEKLY_BY_MP, WEEKLY_BY_EXP, WEEKLY_BY_ENT, WEEKLY_BY_PROD,
};
;








// CAT_I18N — traduction des noms de catégories/sous-catégories qui viennent
// directement des données (category_by_mp, COMPETITION_DATA), pas de l'UI.
// Ces noms français restent la clé de correspondance interne (filtres, matching) ;
// seul l'AFFICHAGE passe par translateCat() ci-dessous.
const CAT_I18N = {"1er prix Céramique":{"en":"Entry-level ceramic","zh":"入门级陶瓷款","es":"Cerámica gama básica"},"1er prix Déshumidificateur":{"en":"Entry-level dehumidifier","zh":"入门级除湿机","es":"Deshumidificador gama básica"},"1er prix format plinthe":{"en":"Entry-level baseboard","zh":"入门级踢脚线款","es":"Rodapié gama básica"},"1er prix sèche-seviettes":{"en":"Entry-level towel warmer","zh":"入门级毛巾架","es":"Toallero gama básica"},"1er prix vertical":{"en":"Entry-level vertical","zh":"入门级立式款","es":"Vertical gama básica"},"2e prix Céramique":{"en":"Mid-range ceramic","zh":"中端陶瓷款","es":"Cerámica gama media"},"3e prix Céramique":{"en":"Premium ceramic","zh":"高端陶瓷款","es":"Cerámica gama alta"},"Climatisation":{"en":"Air conditioning","zh":"空调","es":"Aire acondicionado"},"Céramique  + PIR":{"en":"Ceramic + PIR sensor","zh":"陶瓷+人体感应","es":"Cerámica + sensor PIR"},"Céramique + Film":{"en":"Ceramic + film","zh":"陶瓷+发热膜","es":"Cerámica + film"},"Céramique + P&P":{"en":"Ceramic + plug & play","zh":"陶瓷+即插即用","es":"Cerámica + plug & play"},"Céramique + film + p&p":{"en":"Ceramic + film + plug & play","zh":"陶瓷+发热膜+即插即用","es":"Cerámica + film + plug & play"},"Céramique + p&p":{"en":"Ceramic + plug & play","zh":"陶瓷+即插即用","es":"Cerámica + plug & play"},"Céramique + verre":{"en":"Ceramic + glass","zh":"陶瓷+玻璃","es":"Cerámica + cristal"},"Céramique + wifi":{"en":"Ceramic + wifi","zh":"陶瓷+wifi","es":"Cerámica + wifi"},"Céramique p&p":{"en":"Ceramic plug & play","zh":"陶瓷即插即用","es":"Cerámica plug & play"},"Déshumidificateur":{"en":"Dehumidifier","zh":"除湿机","es":"Deshumidificador"},"Déshumidificateur + wifi":{"en":"Dehumidifier + wifi","zh":"除湿机+wifi","es":"Deshumidificador + wifi"},"Fonte":{"en":"Cast iron","zh":"铸铁款","es":"Fundición"},"Fonte + film":{"en":"Cast iron + film","zh":"铸铁+发热膜","es":"Fundición + film"},"Fonte + film + p&p":{"en":"Cast iron + film + plug & play","zh":"铸铁+发热膜+即插即用","es":"Fundición + film + plug & play"},"Mobile + Bain d'huile":{"en":"Portable + oil bath","zh":"移动式+油汀","es":"Portátil + baño de aceite"},"Mobile + Céramique":{"en":"Portable + ceramic","zh":"移动式+陶瓷","es":"Portátil + cerámica"},"Pas de sous catégorie":{"en":"No subcategory","zh":"无子类别","es":"Sin subcategoría"},"Radiateur fixe":{"en":"Fixed radiator","zh":"固定式散热器","es":"Radiador fijo"},"Radiateur mobile":{"en":"Portable radiator","zh":"移动式散热器","es":"Radiador portátil"},"Radiateur soufflant":{"en":"Fan heater","zh":"暖风机","es":"Calefactor de aire"},"Radiateur électrique fixe":{"en":"Fixed electric radiator","zh":"固定式电散热器","es":"Radiador eléctrico fijo"},"Radiateur électrique mobile":{"en":"Portable electric radiator","zh":"移动式电散热器","es":"Radiador eléctrico portátil"},"Rayonnant":{"en":"Radiant","zh":"辐射式","es":"Radiante"},"Sèche-serviette connecté":{"en":"Connected towel warmer","zh":"智能毛巾架","es":"Toallero conectado"},"Sèche-serviette soufflant":{"en":"Fan-assisted towel warmer","zh":"带风扇毛巾架","es":"Toallero con ventilador"},"Sèche-serviette électrique":{"en":"Electric towel warmer","zh":"电毛巾架","es":"Toallero eléctrico"},"Sèche-serviettes électrique":{"en":"Electric towel warmer","zh":"电毛巾架","es":"Toallero eléctrico"},"Sèche-seviette":{"en":"Towel warmer","zh":"毛巾架","es":"Toallero"},"Sèche-seviette + soufflerie":{"en":"Towel warmer + fan","zh":"毛巾架+风扇","es":"Toallero + ventilador"},"Sèche-seviette + wifi":{"en":"Towel warmer + wifi","zh":"毛巾架+wifi","es":"Toallero + wifi"},"Sèche-seviette + wifi + Soufflerie":{"en":"Towel warmer + wifi + fan","zh":"毛巾架+wifi+风扇","es":"Toallero + wifi + ventilador"},"Sèche-seviettes + soufflerie":{"en":"Towel warmer + fan","zh":"毛巾架+风扇","es":"Toallero + ventilador"},"Séche serviettes + gain de place":{"en":"Space-saving towel warmer","zh":"省空间毛巾架","es":"Toallero ahorra espacio"},"Ventil. De plafond + 3 pales bois FSC":{"en":"Ceiling fan + 3 FSC wood blades","zh":"吊扇+3片FSC木叶片","es":"Ventilador de techo + 3 aspas madera FSC"},"Ventilateur de plafond":{"en":"Ceiling fan","zh":"吊扇","es":"Ventilador de techo"},"Ventilateur sur pied":{"en":"Standing fan","zh":"落地扇","es":"Ventilador de pie"}};

function translateCat(nomFr, lang) {
  if (lang === "fr" || !nomFr) return nomFr;
  const entry = CAT_I18N[nomFr];
  return entry ? (entry[lang] || nomFr) : nomFr;
}

// PAYS_I18N — traduction des noms de pays affichés (International, ads par pays).
// Même principe que CAT_I18N : la donnée reste en français pour le matching interne.
const PAYS_I18N = {"France":{"en":"France","zh":"法国","es":"Francia"},"Allemagne":{"en":"Germany","zh":"德国","es":"Alemania"},"Autriche":{"en":"Austria","zh":"奥地利","es":"Austria"},"Belgique":{"en":"Belgium","zh":"比利时","es":"Bélgica"},"Bulgarie":{"en":"Bulgaria","zh":"保加利亚","es":"Bulgaria"},"Espagne":{"en":"Spain","zh":"西班牙","es":"España"},"Grèce":{"en":"Greece","zh":"希腊","es":"Grecia"},"Irlande":{"en":"Ireland","zh":"爱尔兰","es":"Irlanda"},"Italie":{"en":"Italy","zh":"意大利","es":"Italia"},"Lettonie":{"en":"Latvia","zh":"拉脱维亚","es":"Letonia"},"Luxembourg":{"en":"Luxembourg","zh":"卢森堡","es":"Luxemburgo"},"Monaco":{"en":"Monaco","zh":"摩纳哥","es":"Mónaco"},"Pays-Bas":{"en":"Netherlands","zh":"荷兰","es":"Países Bajos"},"Pologne":{"en":"Poland","zh":"波兰","es":"Polonia"},"Portugal":{"en":"Portugal","zh":"葡萄牙","es":"Portugal"},"Royaume-Uni":{"en":"United Kingdom","zh":"英国","es":"Reino Unido"},"Suisse":{"en":"Switzerland","zh":"瑞士","es":"Suiza"},"Belgique/Pays-Bas":{"en":"Belgium/Netherlands","zh":"比利时/荷兰","es":"Bélgica/Países Bajos"}};

function translatePays(nomFr, lang) {
  if (lang === "fr" || !nomFr) return nomFr;
  const entry = PAYS_I18N[nomFr];
  return entry ? (entry[lang] || nomFr) : nomFr;
}

const MARKETPLACE_COLORS = {
  "Amazon FR": { primary: "#FF9900", soft: "#232F3E", text: "#232F3E" },
  "Autre": { primary: "#64748B", soft: "#E2E8F0", text: "#FFFFFF" },
  "Bol.com": { primary: "#0000A3", soft: "#E6F4FF", text: "#FFFFFF" },
  "Boulanger": { primary: "#F1650A", soft: "#CAC9F6", text: "#1B1D29" },
  "Brico Bravo": { primary: "#7436A5", soft: "#F04F8B", text: "#FFFFFF" },
  "Bricomarché": { primary: "#FE0000", soft: "#965A3A", text: "#FFFFFF" },
  "Bricoman": { primary: "#C8102E", soft: "#1A1A1A", text: "#FFFFFF" },
  "But": { primary: "#E3001B", soft: "#38373C", text: "#FFFFFF" },
  "Carrefour": { primary: "#004E9F", soft: "#E3000D", text: "#FFFFFF" },
  "Castorama": { primary: "#0078D7", soft: "#FFDD00", text: "#FFFFFF" },
  "Cdiscount": { primary: "#3732FF", soft: "#FD5272", text: "#FFFFFF" },
  "Darty": { primary: "#E30613", soft: "#000000", text: "#FFFFFF" },
  "Leroy Merlin": { primary: "#78BE20", soft: "#000000", text: "#000000" },
  "ManoMano": { primary: "#29B9AD", soft: "#0C193A", text: "#0C193A" },
  "Maxeda": { primary: "#AE1C28", soft: "#FEF485", text: "#FFFFFF" },
  "Non identifié": { primary: "#94A3B8", soft: "#E2E8F0", text: "#111827" },
  "Site Web": { primary: "#ED780A", soft: "#010101", text: "#010101" },
  "Worten": { primary: "#EB0000", soft: "#FFFFFF", text: "#FFFFFF" },
};

// contexte partagé par les composants transverses (SectionHeader, Eyebrow…) —
// évite de modifier individuellement chacun de leurs dizaines d'usages dans
// toute l'app ; repli sur l'orange Bestherm par défaut si aucun Provider
// n'englobe le composant (garde tout ce qui existait avant fonctionnel)

const GF_TO_ADS = {
  "Leroy Merlin": ["LEROY MERLIN FR", "LEROY MERLIN ES", "LEROY MERLIN IT", "LEROY MERLIN PL"],
  "Amazon FR": ["AMAZON FR"], "Site Web": ["SITE WEB"], "ManoMano": ["MANO MANO"],
  "Cdiscount": ["CDISCOUNT"], "Castorama": ["CASTORAMA"], "Darty": ["DARTY"], "Bol.com": ["BOL"],
};

const NAV = [
  { id: "apercu", labelKey: "nav_apercu", icon: LayoutGrid },
  { id: "marketplaces", labelKey: "nav_marketplaces", icon: Store },
  { id: "marques", labelKey: "nav_marques", icon: Package },
  { id: "prix", labelKey: "nav_prix", icon: Tag },
  { id: "ads", labelKey: "nav_ads", icon: Megaphone },
  { id: "concurrence", labelKey: "nav_concurrence", icon: Radar },
  { id: "supply", labelKey: "nav_supply", icon: Truck },
];

function shiftYear(iso, delta) { const d = new Date(iso); d.setFullYear(d.getFullYear() + delta); return d.toISOString().slice(0, 10); }

// périodes prédéfinies du filtre de date global — calculées à partir de DMAX
// (dernier jour de données réel, 2026-07-18), pas de la date du navigateur
const pad2 = (n) => String(n).padStart(2, "0");
function getPresetRange(key) {
  const [ty, tm] = DMAX.split("-").map(Number);
  if (key === "mois_courant") return { from: `${ty}-${pad2(tm)}-01`, to: DMAX };
  if (key === "mois_precedent") {
    const py = tm === 1 ? ty - 1 : ty, pm = tm === 1 ? 12 : tm - 1;
    const lastDay = new Date(py, pm, 0).getDate();
    return { from: `${py}-${pad2(pm)}-01`, to: `${py}-${pad2(pm)}-${pad2(lastDay)}` };
  }
  if (key === "annee_courante") return { from: `${ty}-01-01`, to: DMAX };
  if (key === "annee_passee") return { from: `${ty - 1}-01-01`, to: `${ty - 1}-12-31` };
  return null; // "personnalise" -> gérée séparément via customFrom/customTo
}
const DATE_PRESETS = [
  { id: "mois_courant", label: "Mois en cours" },
  { id: "mois_precedent", label: "Mois précédent" },
  { id: "annee_courante", label: "Année en cours" },
  { id: "annee_passee", label: "Année passée" },
  { id: "personnalise", label: "Personnalisé" },
];
// mécanisme unique de sommation, aligné sur les frontières de mois — utilisé pour
// TOUTES les comparaisons de période (préréglages ET sélection libre), vue globale
// et par marketplace. Choix délibéré : l'ancienne DATA.daily_ca (jour par jour,
// retirée depuis — elle n'était plus consommée nulle part) n'était en
// réalité complète que pour 2026 — janvier seul pour 2024/2025 — donc l'utiliser
// pour une comparaison N-1 produisait un chiffre faux la plupart du temps
// (vérifié à l'époque : une comparaison "Année en cours" calculée en jour-par-jour
// donnait +409% au lieu du vrai chiffre, en ne comptant que janvier 2025 côté N-1).
// monthly_total (mensuel, fiable et complet sur les 3 années) est donc la seule
// base sûre, quitte à perdre la précision jour-par-jour sur la sélection libre.
function sumMonthSnapped(monthlySource, dateFrom, dateTo) {
  if (!monthlySource) return 0;
  let total = 0;
  const d0 = new Date(dateFrom), d1 = new Date(dateTo);
  for (let d = new Date(d0.getFullYear(), d0.getMonth(), 1); d <= d1; d.setMonth(d.getMonth() + 1)) {
    total += monthlySource[d.getFullYear()]?.[d.getMonth()] || 0;
  }
  return total;
}
function sumRangeForMp(mp, dateFrom, dateTo) { return sumMonthSnapped(DATA.gf.monthly_total_by_mp[mp], dateFrom, dateTo); }

// puissance extraite du nom produit (ex. "ARIA 1000W" -> "1000W", "HESTIA 500+1000W" -> "500+1000W")
// — 84% des 168 produits distincts de price_tracking sont couverts, le reste
// étant des accessoires légitimement sans puissance (thermostats, attaches, filtres)
const WATTAGE_RE = /(\d+(?:\+\d+)?W)/;
function sumQteRange(qte2025, qte2026, dateFrom, dateTo) {
  let total = 0;
  const d0 = new Date(dateFrom), d1 = new Date(dateTo);
  for (let d = new Date(d0.getFullYear(), d0.getMonth(), 1); d <= d1; d.setMonth(d.getMonth() + 1)) {
    const y = d.getFullYear(), m = d.getMonth();
    const arr = y === 2025 ? qte2025 : y === 2026 ? qte2026 : null;
    if (arr && arr[m] != null) total += arr[m];
  }
  return total;
}
// mois calendaire complet précédant immédiatement une date donnée — gère
// correctement la bascule d'année (janvier -> décembre N-1)
function getMonthBefore(dateStr) {
  const d = new Date(dateStr);
  const y = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear();
  const m = d.getMonth() === 0 ? 11 : d.getMonth() - 1;
  const lastDay = new Date(y, m + 1, 0).getDate();
  return { from: `${y}-${pad2(m+1)}-01`, to: `${y}-${pad2(m+1)}-${pad2(lastDay)}`, label: `${MOIS_FR[m]} ${y}` };
}
const MOIS_FR = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];

/* ============================================================================ NAV avec indicateur glissant */
function SlidingNav({ tab, onChange, t }) {
  const accent = useContext(AccentContext);
  const containerRef = useRef(null);
  const btnRefs = useRef({});
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const btn = btnRefs.current[tab];
    const container = containerRef.current;
    if (btn && container) {
      const cRect = container.getBoundingClientRect(), bRect = btn.getBoundingClientRect();
      setIndicator({ left: bRect.left - cRect.left, width: bRect.width });
    }
  }, [tab]);

  return (
    <nav ref={containerRef} className="hidden md:flex items-center gap-1 relative">
      <div className="absolute top-0 bottom-0 rounded-full" style={{
        left: indicator.left, width: indicator.width, background: `linear-gradient(135deg, ${accent.primary}, ${accent.primary}cc)`,
        boxShadow: `0 4px 14px -4px ${accent.primary}88`, transition: "left 0.4s cubic-bezier(.22,1,.36,1), width 0.4s cubic-bezier(.22,1,.36,1), background 0.4s ease", zIndex: 0,
      }} />
      {NAV.map((n) => (
        <button key={n.id} ref={(el) => (btnRefs.current[n.id] = el)} onClick={() => onChange(n.id)}
          className="btn-lift relative flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-[13px] font-medium transition-colors duration-200"
          style={{ color: tab === n.id ? accent.text : MUTED, zIndex: 1 }}>
          <n.icon size={14} strokeWidth={2} /> {t[n.labelKey]}
        </button>
      ))}
    </nav>
  );
}

// BottomTabBar — barre fixe mobile, remplace le menu hamburger. Indicateur
// glissant identique dans l'esprit à SlidingNav (mesure des positions par ref),
// icône + libellé compact sur chaque onglet plutôt qu'une liste qu'il faut
// ouvrir pour voir les choix — toujours visible, un seul geste pour changer.
function BottomTabBar({ tab, onChange, t }) {
  const accent = useContext(AccentContext);
  const containerRef = useRef(null);
  const btnRefs = useRef({});
  const [indicator, setIndicator] = useState({ left: 0, width: 0 });

  useLayoutEffect(() => {
    const btn = btnRefs.current[tab];
    const container = containerRef.current;
    if (btn && container) {
      const cRect = container.getBoundingClientRect(), bRect = btn.getBoundingClientRect();
      setIndicator({ left: bRect.left - cRect.left, width: bRect.width });
    }
  }, [tab]);

  return (
    <nav ref={containerRef} className="no-print md:hidden fixed bottom-0 left-0 right-0 z-30 flex items-stretch backdrop-blur-xl"
      style={{ background: "rgba(10,9,8,0.92)", borderTop: `1px solid ${PANEL_BORDER}`, paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <div className="absolute top-0 rounded-b-full" style={{
        left: indicator.left, width: indicator.width, height: 2.5, background: accent.primary,
        boxShadow: `0 1px 8px ${accent.primary}aa`, transition: "left 0.35s cubic-bezier(.22,1,.36,1), width 0.35s cubic-bezier(.22,1,.36,1), background 0.35s ease",
      }} />
      {NAV.map((n) => {
        const active = tab === n.id;
        return (
          <button key={n.id} ref={(el) => (btnRefs.current[n.id] = el)} onClick={() => onChange(n.id)} aria-label={t[n.labelKey]} title={t[n.labelKey]}
            className="btn-lift flex-1 flex items-center justify-center py-3.5 min-w-0"
            style={{ color: active ? accent.primary : FAINT }}>
            <n.icon size={22} strokeWidth={active ? 2.3 : 1.8} />
          </button>
        );
      })}
    </nav>
  );
}

function DashboardApp() {
  const [tab, setTab] = useState("apercu");
  const [demoMode, setDemoMode] = useState(false);
  const [demoFactorValue, setDemoFactorValue] = useState(1);
  // réassignation synchrone de la variable de module fmtEUR/fmtNum lisent —
  // se produit en tout début du rendu, donc déjà à jour pour tout le JSX qui
  // suit dans cette même passe (voir commentaire près de la déclaration)
  demoFactor = demoMode ? demoFactorValue : 1;
  const toggleDemoMode = () => {
    setDemoMode((prev) => {
      const next = !prev;
      if (next) setDemoFactorValue(0.55 + Math.random() * 1.4); // facteur entre 0.55x et 1.95x
      return next;
    });
  };
  const [prevIndex, setPrevIndex] = useState(0);
  const [datePreset, setDatePreset] = useState("annee_courante");
  const [customFrom, setCustomFrom] = useState("2026-01-01");
  const [customTo, setCustomTo] = useState(DMAX);
  const [fading, setFading] = useState(false);
  const [slideDir, setSlideDir] = useState(1);
  // filtre marketplace initialisé depuis l'URL si présent (lien de présentation
  // direct, ex. ?marketplace=Leroy+Merlin), sinon "Toutes" par défaut
  const [globalMp, setGlobalMp] = useState(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("marketplace");
      return fromUrl && DATA.gf.monthly_total_by_mp[fromUrl] ? fromUrl : "Toutes";
    } catch { return "Toutes"; }
  });
  // garde l'URL synchronisée avec le filtre actif — copier le lien depuis la
  // barre d'adresse suffit ensuite pour rouvrir l'app déjà filtrée
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      if (globalMp === "Toutes") url.searchParams.delete("marketplace");
      else url.searchParams.set("marketplace", globalMp);
      window.history.replaceState({}, "", url.toString());
    } catch {}
  }, [globalMp]);
  const [lang, setLang] = useState("fr");
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [visibleYears, setVisibleYears] = useState({ 2024: true, 2025: true, 2026: true });
  const [concTab, setConcTab] = useState("synthese");
  const [concMpFilter, setConcMpFilter] = useState("Toutes");
  const liveConnection = useLiveData();
  const t = I18N[lang];
  const [catMpFilter, setCatMpFilter] = useState("Toutes");
  const [priceSearch, setPriceSearch] = useState("");
  const [simProduit, setSimProduit] = useState(null);
  const [simMp, setSimMp] = useState(null);
  const [simPrix, setSimPrix] = useState(null);
  const [simRecherche, setSimRecherche] = useState("");
  const [apSearch, setApSearch] = useState("");
  const [apExpanded, setApExpanded] = useState(() => new Set());
  const [apSort, setApSort] = useState("ca"); // "ca" | "qte" | "produit"
  const [selectedWeek, setSelectedWeek] = useState(() => Math.max(...WEEKLY_TOTALS.map((w) => w[0])));
  const [priceMpFilter, setPriceMpFilter] = useState("Toutes");
  const [priceYear, setPriceYear] = useState(2026);
  const [priceMode, setPriceMode] = useState("prix");

  // les filtres locaux (catégorie, prix, carte) suivent le filtre global par défaut,
  // mais restent modifiables indépendamment ensuite sans que le global les écrase à nouveau
  useEffect(() => {
    setCatMpFilter(globalMp);
    setPriceMpFilter(globalMp);
  }, [globalMp]);

  const changeTab = (id) => {
    if (id === tab) return;
    const newIndex = NAV.findIndex((n) => n.id === id), oldIndex = NAV.findIndex((n) => n.id === tab);
    setSlideDir(newIndex > oldIndex ? 1 : -1);
    setFading(true);
    setTimeout(() => { setTab(id); setPrevIndex(newIndex); setFading(false); }, 180);
  };

  const moisLabels = DATA.mois_labels;
  // résolution du filtre de date global — {from, to} calculé depuis le préréglage
  // choisi, ou depuis la sélection libre si "Personnalisé" est actif
  const dateRange = datePreset === "personnalise" ? { from: customFrom, to: customTo } : getPresetRange(datePreset);
  const dateRangeLabel = DATE_PRESETS.find((p) => p.id === datePreset)?.label || "";

  // comparatif de la période sélectionnée vs la même période l'année précédente —
  // précision mensuelle partout (voir note sur sumMonthSnapped ci-dessus)
  const periodStats = useMemo(() => {
    const { from, to } = dateRange;
    // cas particulier "Année en cours" + vue globale : on a une donnée déjà
    // calculée au jour près (total_yoy_comparable), plus précise que
    // l'approximation par mois entiers utilisée pour les autres cas
    if (datePreset === "annee_courante" && globalMp === "Toutes") {
      const current = DATA.total_yoy_comparable["2026"], n1 = DATA.total_yoy_comparable["2025"];
      return { current, n1, yoy: n1 ? ((current - n1) / n1) * 100 : null, from, to, n1From: shiftYear(from, -1), n1To: shiftYear(to, -1) };
    }
    const current = globalMp === "Toutes" ? sumMonthSnapped(DATA.monthly_total, from, to) : sumRangeForMp(globalMp, from, to);
    const n1From = shiftYear(from, -1), n1To = shiftYear(to, -1);
    const n1From_ok = n1From >= DMIN;
    const n1 = n1From_ok ? (globalMp === "Toutes" ? sumMonthSnapped(DATA.monthly_total, n1From, n1To) : sumRangeForMp(globalMp, n1From, n1To)) : null;
    return { current, n1, yoy: n1 ? ((current - n1) / n1) * 100 : null, from, to, n1From, n1To };
  }, [dateRange.from, dateRange.to, globalMp, datePreset]);

  // ===== valeurs sensibles au filtre marketplace ET au filtre de date =====
  const mpObjectifRow = DATA.mp_vs_objectif.find((m) => m.marketplace === globalMp);
  const filteredCaTotal = periodStats.current;
  const filteredObjectif = globalMp === "Toutes" ? DATA.kpi.objectif_annuel_total : (mpObjectifRow?.objectif ?? null);
  const filteredPct = filteredObjectif ? (filteredCaTotal / filteredObjectif) * 100 : 0;

  // ===== rythme réel vs objectif — compare le % d'objectif atteint au vrai poids
  // saisonnier écoulé (indice Supply, sur jours exacts), pas une simple règle de
  // 3 sur le nombre de mois. Remplace l'ancien seuil fixe à 33%, qui n'avait de
  // sens que pour "Année en cours" précisément à mi-année. =====
  const seasonalPace = useMemo(() => {
    if (!filteredObjectif || datePreset !== "annee_courante") return null;
    const to = new Date(dateRange.to);
    const monthIdx = to.getMonth(), dayOfMonth = to.getDate();
    const daysInMonth = new Date(to.getFullYear(), monthIdx + 1, 0).getDate();
    const totalWeight = SEASONALITY_INDEX.reduce((a, b) => a + b, 0);
    const elapsedWeight = SEASONALITY_INDEX.slice(0, monthIdx).reduce((a, b) => a + b, 0) + SEASONALITY_INDEX[monthIdx] * (dayOfMonth / daysInMonth);
    const pctPoidsEcoule = (elapsedWeight / totalWeight) * 100;
    const ecart = filteredPct - pctPoidsEcoule;
    return { pctPoidsEcoule, ecart, statut: ecart > 2 ? "avance" : ecart < -2 ? "retard" : "pile" };
  }, [filteredObjectif, filteredPct, datePreset, dateRange.to]);

  // pas de détail mensuel disponible pour panier moyen / quantité / meilleure vente —
  // ces 3 restent sur l'année complète quel que soit le filtre de date (voir libellés à l'écran)
  const filteredPanierMoyen = globalMp === "Toutes" ? DATA.kpi.panier_moyen_2026 : (DATA.gf.panier_moyen_mp[globalMp] ?? null);
  const filteredQte = globalMp === "Toutes" ? DATA.kpi.qte_total_2026 : (DATA.gf.qte_by_mp[globalMp] ?? 0);
  const filteredBestSeller = globalMp === "Toutes" ? DATA.best_seller_2026 : (DATA.gf.best_by_mp[globalMp] || { produit: "N/A", ca: 0 });

  const [caAnimated, caPunch] = useCountUp(filteredCaTotal);
  // la synthèse par onglet n'apparaît que si marketplace ET période sont
  // toutes les deux affinées (pas les valeurs par défaut "Toutes" / "Année en cours")
  // "plus smart" : l'un OU l'autre suffit désormais (avant : les deux
  // étaient obligatoires) — un utilisateur qui affine juste la période, sans
  // toucher à la marketplace, voit déjà une synthèse utile
  const showSummary = globalMp !== "Toutes" || datePreset !== "annee_courante";
  const mpLabel = globalMp === "Toutes" ? t.toutes_mp : globalMp;
  // couleur d'accent de la barre de filtre — celle de la marketplace si vérifiée,
  // sinon repli sur l'orange Bestherm habituel (jamais de couleur devinée)
  const mpAccent = useMemo(() => {
    const c = MARKETPLACE_COLORS[globalMp] || { primary: ORANGE, soft: ORANGE_SOFT, text: "#0A0908" };
    return { ...c, soft: ensureReadable(c.soft) };
  }, [globalMp]);
  const periodLabelLower = dateRangeLabel.toLowerCase();
  const [pctAnimated] = useCountUp(filteredPct);

  // international réel — vraie donnée de vente par pays (PAYS_MONTHLY),
  // filtrable date + marketplace comme le reste de l'app. 2024 exclu : cette
  // année n'a pas de détail pays dans les exports source.
  const internationalData = useMemo(() => {
    const { from, to } = dateRange;
    const d0 = new Date(from), d1 = new Date(to);
    const totals = {};
    PAYS_MONTHLY.forEach(([pays, mp, annee, mois, ca]) => {
      if (globalMp !== "Toutes" && mp !== globalMp) return;
      const d = new Date(annee, mois - 1, 1);
      if (d < new Date(d0.getFullYear(), d0.getMonth(), 1) || d > d1) return;
      totals[pays] = (totals[pays] || 0) + ca;
    });
    const totalCa = Object.values(totals).reduce((a, b) => a + b, 0);
    const rows = Object.entries(totals)
      .map(([pays, ca]) => ({ pays, ca, pct: totalCa ? (ca / totalCa) * 100 : 0, objectif: PAYS_OBJECTIF[pays] || null, pctObjectif: PAYS_OBJECTIF[pays] ? (ca / PAYS_OBJECTIF[pays]) * 100 : null }))
      .filter((r) => r.ca > 0)
      .sort((a, b) => b.ca - a.ca);
    return { rows, totalCa, nbPays: rows.length, maxCa: Math.max(...rows.map((r) => r.ca), 1) };
  }, [dateRange.from, dateRange.to, globalMp]);

  // même logique appliquée au split par marque (Bestherm/Thomson/HOM'Y) — mensuel uniquement
  const brandPeriodStats = useMemo(() => {
    const { from, to } = dateRange;
    if (globalMp === "Toutes") {
      // DATA.monthly_by_brand[marque][année][mois] — imbriqué par année, sumMonthSnapped s'applique tel quel
      const bestherm = sumMonthSnapped(DATA.monthly_by_brand.Bestherm, from, to);
      const thomson = sumMonthSnapped(DATA.monthly_by_brand.Thomson, from, to);
      const homy = sumMonthSnapped(DATA.monthly_by_brand["HOM'Y"], from, to);
      const n1From = shiftYear(from, -1), n1To = shiftYear(to, -1);
      const besthermN1 = n1From >= DMIN ? sumMonthSnapped(DATA.monthly_by_brand.Bestherm, n1From, n1To) : null;
      const thomsonN1 = n1From >= DMIN ? sumMonthSnapped(DATA.monthly_by_brand.Thomson, n1From, n1To) : null;
      return {
        bestherm, thomson, homy,
        besthermYoy: besthermN1 ? ((bestherm - besthermN1) / besthermN1) * 100 : null,
        thomsonYoy: thomsonN1 ? ((thomson - thomsonN1) / thomsonN1) * 100 : null,
      };
    }
    // DATA.gf.brand_by_mp_month[marketplace][marque] — tableau plat de 12 mois, 2026 uniquement.
    // Pas de comparatif N-1 possible ici : cette dimension ne couvre aucune autre année.
    const flat = DATA.gf.brand_by_mp_month[globalMp] || {};
    const sumFlat = (arr, f, t) => {
      if (!arr) return 0;
      let total = 0;
      const d0 = new Date(f), d1 = new Date(t);
      for (let d = new Date(d0.getFullYear(), d0.getMonth(), 1); d <= d1; d.setMonth(d.getMonth() + 1)) {
        if (d.getFullYear() === 2026) total += arr[d.getMonth()] || 0;
      }
      return total;
    };
    return {
      bestherm: sumFlat(flat.Bestherm, from, to), thomson: sumFlat(flat.Thomson, from, to), homy: sumFlat(flat["HOM'Y"], from, to),
      besthermYoy: null, thomsonYoy: null,
    };
  }, [dateRange.from, dateRange.to, globalMp]);

  const brandTrend = useMemo(() => {
    const src = globalMp === "Toutes" ? DATA.monthly_by_brand : (DATA.gf.brand_by_mp_month[globalMp] || {});
    return moisLabels.map((m, i) => ({ mois: m, Bestherm: src.Bestherm?.["2026"]?.[i] ?? src.Bestherm?.[i] ?? 0, Thomson: src.Thomson?.["2026"]?.[i] ?? src.Thomson?.[i] ?? 0, "HOM'Y": src["HOM'Y"]?.["2026"]?.[i] ?? src["HOM'Y"]?.[i] ?? 0 }));
  }, [globalMp]);
  const maxYearlyMonth = globalMp === "Toutes"
    ? Math.max(...[2024,2025,2026].flatMap((y) => DATA.monthly_total[y]))
    : Math.max(...[2024,2025,2026].flatMap((y) => DATA.gf.monthly_total_by_mp[globalMp]?.[y] || [0]), 1);

  // données fusionnées pour le graphique tendance à années activables/désactivables —
  // une seule échelle Y partagée, donc comparaison honnête garantie par construction
  const trendCombined = useMemo(() => moisLabels.map((m, i) => {
    const row = { mois: m.slice(0,1), monthIndex: i };
    [2024, 2025, 2026].forEach((y) => {
      const series = globalMp === "Toutes" ? DATA.monthly_total[y] : (DATA.gf.monthly_total_by_mp[globalMp]?.[y] || Array(12).fill(0));
      row[y] = series[i] || null;
    });
    return row;
  }), [globalMp, moisLabels]);

  // objectif mensuel — l'objectif annuel n'existe qu'à l'année dans les données
  // sources ; on le répartit selon le vrai motif saisonnier observé (indice
  // Supply, voir onglet Supply) plutôt qu'une simple division par 12, plus
  // honnête pour un produit de chauffage très saisonnier
  const monthlyObjectif = useMemo(() => {
    if (!filteredObjectif) return null;
    const now = new Date();
    const curMonthIdx = dateRange.to ? new Date(dateRange.to).getMonth() : now.getMonth();
    const idxSum = SEASONALITY_INDEX.reduce((a,b) => a+b, 0);
    const monthShare = SEASONALITY_INDEX[curMonthIdx] / idxSum;
    const target = filteredObjectif * monthShare;
    const curCa = globalMp === "Toutes" ? (DATA.monthly_total[2026]?.[curMonthIdx] || 0) : (DATA.gf.monthly_total_by_mp[globalMp]?.["2026"]?.[curMonthIdx] || 0);
    return { target, curCa, pct: target ? (curCa/target)*100 : 0, monthLabel: moisLabels[curMonthIdx], monthIdx: curMonthIdx };
  }, [filteredObjectif, globalMp, dateRange.to, moisLabels]);

  // liste marketplaces recalculée pour la période sélectionnée (filtre de date global) —
  // objectif annuel inchangé (il n'existe qu'à l'année), CA et YoY recalculés sur la période
  const sortedMp = useMemo(() => {
    const { from, to } = dateRange;
    const n1From = shiftYear(from, -1), n1To = shiftYear(to, -1);
    const n1Ok = n1From >= DMIN;
    return DATA.mp_vs_objectif
      .map((m) => {
        const ca = sumRangeForMp(m.marketplace, from, to);
        const ca_n1 = n1Ok ? sumRangeForMp(m.marketplace, n1From, n1To) : null;
        return {
          ...m, ca,
          yoy_pct: ca_n1 ? ((ca - ca_n1) / ca_n1) * 100 : null,
          pct_objectif: m.objectif ? (ca / m.objectif) * 100 : null,
        };
      })
      .sort((a, b) => b.ca - a.ca);
  }, [dateRange.from, dateRange.to]);
  const top3Mp = sortedMp.slice(0, 3), restMp = sortedMp.slice(3);
  const maxMpCa = Math.max(...sortedMp.map((m) => m.ca), 1);
  const totalCaAllMp = sortedMp.reduce((s, m) => s + m.ca, 0);

  const bestVsN1Pct = globalMp === "Toutes" ? ((DATA.best_seller_2026.ca - DATA.best_seller_2025.ca) / DATA.best_seller_2025.ca) * 100 : null;
  const bestherm26 = brandPeriodStats.bestherm;
  const thomson26 = brandPeriodStats.thomson;
  const homy26 = brandPeriodStats.homy;
  const totalMarques = bestherm26 + thomson26 + homy26;
  const bestPct = totalMarques > 0 ? (bestherm26 / totalMarques) * 100 : 0;
  const thomsonPct = totalMarques > 0 ? (thomson26 / totalMarques) * 100 : 0;
  const homyPct = totalMarques > 0 ? (homy26 / totalMarques) * 100 : 0;
  const besthermYoy = brandPeriodStats.besthermYoy;

  const adsForFilter = globalMp === "Toutes" ? DATA.ads : DATA.ads.filter((a) => (GF_TO_ADS[globalMp] || []).includes(a.marketplace));
  const adsSorted = [...adsForFilter].sort((a,b) => (b.ca_genere||0) - (a.ca_genere||0));
  const top3Ads = adsSorted.slice(0, 3);
  const atRiskAds = adsForFilter.filter((a) => a.roas !== null && a.roas < 3);
  const restAdsList = adsSorted.slice(3).filter((a) => !atRiskAds.includes(a));
  const totalSpend = adsSorted.reduce((s,a) => s + a.spend, 0);
  const totalAdsCa = adsSorted.reduce((s,a) => s + a.ca_genere, 0);
  const blendedRoas = totalSpend ? totalAdsCa / totalSpend : 0;
  const globalYoy = useMemo(() => {
    if (globalMp === "Toutes") return ((DATA.total_yoy_comparable["2026"] - DATA.total_yoy_comparable["2025"]) / DATA.total_yoy_comparable["2025"]) * 100;
    const cur = (DATA.gf.monthly_total_by_mp[globalMp]?.["2026"] || []).slice(0,7).reduce((a,b)=>a+b,0);
    const prev = (DATA.gf.monthly_total_by_mp[globalMp]?.["2025"] || []).slice(0,7).reduce((a,b)=>a+b,0);
    return prev ? ((cur - prev) / prev) * 100 : null;
  }, [globalMp]);

  const productsSource = globalMp === "Toutes" ? DATA.products_top15 : (DATA.gf.top_products_by_mp[globalMp] || []).map((p) => ({ ...p, qte: null, yoy_pct: null }));
  const top3Prod = productsSource.slice(0, 3), restProd = productsSource.slice(3);
  const maxProdCa = Math.max(...productsSource.map((p) => p.ca), 1);
  const heatmapMax = Math.max(...Object.values(DATA.products_monthly_top6).flatMap((p) => p.ca));
  const catMpList = ["Toutes", ...Object.keys(DATA.category_by_mp.categories).filter((m) => m !== "Toutes").sort()];

  const priceMpList = useMemo(() => ["Toutes", ...Array.from(new Set(DATA.price_tracking.map((r) => r[1]))).sort()], []);
  // ===== comparaison prix par produit, toutes marketplaces confondues — prix le
  // plus haut/bas (avec la marketplace concernée), qui vend le plus en volume,
  // écart en %, prix moyen pondéré. "Non identifié"/"Autre" exclus des comparatifs
  // (pas de vraie marketplace) mais gardés dans la moyenne. Seuil de fiabilité :
  // une marketplace doit peser au moins 3% du volume du produit (ou 3 unités) pour
  // entrer dans le prix le plus haut/bas — sinon une vente isolée à prix aberrant
  // fausserait le résultat. =====
  const EXCLUDE_MP_PRICE = useMemo(() => new Set(["Non identifié", "Autre"]), []);
  const productPriceStats = useMemo(() => {
    const byProduct = {};
    DATA.price_tracking.forEach((r) => { const p = r[0].trim(); (byProduct[p] = byProduct[p] || []).push(r); });
    const out = {};
    Object.entries(byProduct).forEach(([produit, rows]) => {
      const mpStats = [];
      rows.forEach(([, mp, prix25, prix26, qte25, qte26]) => {
        if (EXCLUDE_MP_PRICE.has(mp)) return;
        const totalQty = qte26.reduce((s, q) => s + (q || 0), 0);
        if (totalQty <= 0) return;
        let totalVal = 0;
        for (let i = 0; i < 12; i++) { if (prix26[i] && qte26[i]) totalVal += prix26[i] * qte26[i]; }
        const avgPrice = totalQty > 0 ? totalVal / totalQty : null;
        if (!avgPrice || avgPrice <= 0) return;
        let ca25 = 0;
        for (let i = 0; i < 12; i++) { if (prix25[i] && qte25[i]) ca25 += prix25[i] * qte25[i]; }
        const yoyPct = ca25 > 0 ? ((totalVal - ca25) / ca25) * 100 : null;
        mpStats.push({ mp, qty: totalQty, avgPrice, ca: totalVal, ca25, yoyPct });
      });
      if (!mpStats.length) return;
      const totalQtyAll = mpStats.reduce((s, m) => s + m.qty, 0);
      const totalCaAll = mpStats.reduce((s, m) => s + m.ca, 0);
      const threshold = Math.max(3, totalQtyAll * 0.03);
      let reliable = mpStats.filter((m) => m.qty >= threshold);
      if (!reliable.length) reliable = mpStats;
      const maxMp = reliable.reduce((a, b) => (b.avgPrice > a.avgPrice ? b : a));
      const minMp = reliable.reduce((a, b) => (b.avgPrice < a.avgPrice ? b : a));
      const volLeader = mpStats.reduce((a, b) => (b.qty > a.qty ? b : a));
      const caLeader = mpStats.reduce((a, b) => (b.ca > a.ca ? b : a));
      const overallAvg = mpStats.reduce((s, m) => s + m.avgPrice * m.qty, 0) / totalQtyAll;
      const spreadPct = minMp.avgPrice > 0 ? ((maxMp.avgPrice - minMp.avgPrice) / minMp.avgPrice) * 100 : null;
      const signal = volLeader.mp === maxMp.mp ? "premium" : volLeader.mp === minMp.mp ? "sensible" : "neutre";
      out[produit] = { max: maxMp, min: minMp, volLeader, caLeader, avg: overallAvg, spreadPct, totalQty: totalQtyAll, totalCa: totalCaAll, signal, allMp: mpStats.sort((a, b) => b.avgPrice - a.avgPrice), fiable: totalQtyAll >= 3 };
    });
    return out;
  }, [EXCLUDE_MP_PRICE]);
  const priceResults = useMemo(() => {
    const q = priceSearch.trim().toLowerCase();
    return DATA.price_tracking
      .filter((r) => (q === "" || r[0].toLowerCase().includes(q)) && (priceMpFilter === "Toutes" || r[1] === priceMpFilter))
      .slice(0, 40);
  }, [priceSearch, priceMpFilter]);
  const priceTotalMatches = useMemo(() => {
    const q = priceSearch.trim().toLowerCase();
    return DATA.price_tracking.filter((r) => (q === "" || r[0].toLowerCase().includes(q)) && (priceMpFilter === "Toutes" || r[1] === priceMpFilter)).length;
  }, [priceSearch, priceMpFilter]);

  // ===== Simulateur prix -> quantité, interactif. Contrairement à
  // SIMULATION_PRIX (fixe, +5%), ici l'utilisateur choisit son propre prix
  // proposé pour un couple produit x marketplace. Bornage du curseur sur la
  // plage de prix réellement observée (prix_min/prix_max) : au-delà, on
  // extrapole hors du domaine mesuré, la prédiction devient peu fiable. =====
  const simProduitsDisponibles = useMemo(() => {
    const q = simRecherche.trim().toLowerCase();
    const noms = [...new Set(ELASTICITE_DATA.map((r) => r[0]))].sort();
    return (q === "" ? noms : noms.filter((n) => n.toLowerCase().includes(q))).slice(0, 30);
  }, [simRecherche]);
  const simMpDisponibles = useMemo(() => {
    if (!simProduit) return [];
    return ELASTICITE_DATA.filter((r) => r[0] === simProduit).sort((a, b) => b[8] - a[8]);
  }, [simProduit]);
  const simDonnee = useMemo(() => {
    if (!simProduit || !simMp) return null;
    return ELASTICITE_DATA.find((r) => r[0] === simProduit && r[1] === simMp) || null;
  }, [simProduit, simMp]);
  const simResultat = useMemo(() => {
    if (!simDonnee || simPrix === null) return null;
    const [, , elast, r2, , , prixMoyen, fiable, qteMoy, prixMin, prixMax] = simDonnee;
    const deltaPrixPct = ((simPrix - prixMoyen) / prixMoyen) * 100;
    const deltaVolPct = elast * deltaPrixPct;
    const qteProjetee = Math.max(0, qteMoy * (1 + deltaVolPct / 100));
    const caActuel = prixMoyen * qteMoy;
    const caProjete = simPrix * qteProjetee;
    const deltaCaPct = caActuel > 0 ? ((caProjete - caActuel) / caActuel) * 100 : 0;
    const horsPlage = simPrix < prixMin || simPrix > prixMax;
    return { deltaPrixPct, deltaVolPct, qteProjetee, caActuel, caProjete, deltaCaPct, horsPlage, elast, r2, fiable, prixMoyen, qteMoy, prixMin, prixMax };
  }, [simDonnee, simPrix]);

  const YEAR_COLORS = { 2024: FAINT, 2025: AMBER, 2026: ORANGE };

  // ===== normes NF/CE par mois, année sélectionnée =====
  const normesTrend = useMemo(() => moisLabels.map((m, i) => {
    const nf = DATA.normes_month.NF?.[priceYear]?.[i] || 0;
    const ce = DATA.normes_month.CE?.[priceYear]?.[i] || 0;
    const total = nf + ce;
    return { mois: m, nfPct: total ? Math.round((nf/total)*100) : null, cePct: total ? Math.round((ce/total)*100) : null };
  }), [priceYear]);
  const normesTotal = useMemo(() => {
    const { from, to } = dateRange;
    const nf = sumMonthSnapped(DATA.normes_month.NF, from, to);
    const ce = sumMonthSnapped(DATA.normes_month.CE, from, to);
    const total = nf + ce;
    return { nfPct: total ? (nf/total*100) : 0, cePct: total ? (ce/total*100) : 0 };
  }, [dateRange.from, dateRange.to]);

  // ===== synthèses textuelles par onglet — exactement 3 puces titrées par
  // onglet, uniquement à partir de données réellement recalculées pour la
  // période/marketplace choisie ; ce qui reste annuel (Ads) le dit
  // explicitement plutôt que de laisser croire à un filtrage qui n'existe pas =====
  const mpRank = useMemo(() => sortedMp.findIndex((m) => m.marketplace === globalMp) + 1, [sortedMp, globalMp]);
  // comparaison vs le mois calendaire précédant le début de la période choisie —
  // distincte du comparatif N-1 (même période, année d'avant) déjà dans periodStats ;
  // s'applique à tous les préréglages, y compris "Personnalisé"
  const momStats = useMemo(() => {
    const mb = getMonthBefore(dateRange.from);
    if (mb.from < DMIN) return null;
    const ca = globalMp === "Toutes" ? sumMonthSnapped(DATA.monthly_total, mb.from, mb.to) : sumRangeForMp(globalMp, mb.from, mb.to);
    return { ...mb, ca, pct: ca ? ((filteredCaTotal - ca) / ca) * 100 : null };
  }, [dateRange.from, globalMp, filteredCaTotal]);
  const monthBeforeItem = momStats ? [{ title: t.sum_vs_mois_prec, text: `${fmtEUR(momStats.ca)} ${t.sum_en} ${momStats.label}${momStats.pct !== null ? ` (${momStats.pct >= 0 ? "+" : ""}${momStats.pct.toFixed(1)}%)` : ""}.` }] : [];
  // référence Year-to-date (1er janvier → aujourd'hui), toujours calculée en plus
  // de la période choisie, quel que soit le préréglage actif
  const ytdStats = useMemo(() => {
    const { from, to } = getPresetRange("annee_courante");
    const ca = globalMp === "Toutes" ? DATA.total_yoy_comparable["2026"] : sumRangeForMp(globalMp, from, to);
    const pct = filteredObjectif ? (ca / filteredObjectif) * 100 : null;
    return { ca, pct, from, to };
  }, [globalMp, filteredObjectif]);
  const summaryApercu = !showSummary ? [] : [
    { title: t.sum_ca_titre, text: `${mpLabel} : ${fmtEUR(filteredCaTotal)} ${t.sum_sur} "${periodLabelLower}" (${periodStats.from} → ${periodStats.to})${periodStats.yoy !== null ? `, ${t.sum_soit_lower} ${periodStats.yoy >= 0 ? "+" : ""}${periodStats.yoy.toFixed(1)}% ${t.sum_vs_meme_periode_an_dernier}` : `, ${t.sum_comparatif_n1_indispo}`}.` },
    ...monthBeforeItem,
    { title: t.sum_objectif_titre, text: filteredObjectif ? `${filteredPct.toFixed(1)}% ${t.sum_objectif_annuel_realise} (${fmtEUR(filteredObjectif)}) ${t.sum_deja_realise_periode}` : `${t.sum_aucun_objectif_pour} ${mpLabel}.` },
    { title: t.sum_ytd_titre, text: filteredObjectif ? `${fmtEUR(ytdStats.ca)} ${t.sum_depuis_1er_janvier} ${ytdStats.pct.toFixed(1)}% ${t.sum_objectif_annuel_point}` : t.sum_ytd_non_dispo },
    { title: t.sum_panier_moyen_titre, text: filteredPanierMoyen !== null ? `${fmtEUR(filteredPanierMoyen)} — ${t.sum_annee_complete_pas_detail}` : t.sum_non_disponible },
    { title: t.sum_repartition_marque_titre, text: `Bestherm ${bestPct.toFixed(0)}% / Thomson ${thomsonPct.toFixed(0)}% / HOM'Y ${homyPct.toFixed(0)}% ${t.sum_du_ca_periode}` },
  ];
  const summaryMarketplaces = !showSummary ? [] : [
    { title: t.sum_ca_titre, text: `${mpLabel} : ${fmtEUR(filteredCaTotal)} ${t.sum_sur} "${periodLabelLower}"${periodStats.yoy !== null ? ` (${periodStats.yoy >= 0 ? "+" : ""}${periodStats.yoy.toFixed(1)}% ${t.sum_vs_an_dernier_point.replace(/\.$/,'')})` : ""}.` },
    ...monthBeforeItem,
    { title: t.sum_objectif_titre, text: filteredObjectif ? `${filteredPct.toFixed(1)}% ${t.sum_realise_cette_periode}` : t.sum_aucun_objectif_point },
    { title: t.sum_ytd_titre, text: filteredObjectif ? `${fmtEUR(ytdStats.ca)} ${t.sum_depuis_1er_janvier_parenthese} (${ytdStats.pct.toFixed(1)}% ${t.sum_de_objectif_parenthese}` : t.sum_ytd_non_dispo },
    globalMp === "Toutes"
      ? { title: t.sum_mp_leader, text: sortedMp[0] ? `${sortedMp[0].marketplace}, ${fmtEURk(sortedMp[0].ca)} ${t.sum_sur_cette_periode_point}` : t.sum_non_calculable }
      : { title: t.sum_position, text: mpRank > 0 ? `${mpRank}${mpRank === 1 ? t.sum_ere : t.sum_e} ${t.sum_mp_sur} ${sortedMp.length} ${t.sum_pour_cette_periode}` : t.sum_rang_non_calculable },
  ];
  const catMp = DATA.category_by_mp.categories[globalMp]?.[0];
  const sousCatMp = DATA.category_by_mp.souscategories[globalMp]?.[0];
  const summaryMarques = !showSummary ? [] : [
    { title: t.sum_repartition_marque_titre, text: `Bestherm ${bestPct.toFixed(0)}% (${fmtEURplain(bestherm26)}) / Thomson ${thomsonPct.toFixed(0)}% (${fmtEURplain(thomson26)}) / HOM'Y ${homyPct.toFixed(0)}% (${fmtEURplain(homy26)}) ${t.sum_sur_cette_periode_point}` },
    { title: t.sum_evolution_bestherm, text: besthermYoy !== null ? `${besthermYoy >= 0 ? "+" : ""}${besthermYoy.toFixed(1)}% ${t.sum_vs_an_dernier_point}` : t.sum_comparatif_n1_mp_indispo },
    { title: t.sum_top5_produits, text: productsSource.length ? `${productsSource.slice(0,5).map((p) => `${p.produit} (${fmtEURk(p.ca)}${p.qte !== null && p.qte !== undefined ? `, ${fmtNum(p.qte)} u.` : ""})`).join(", ")} — ${t.sum_annee_complete}${globalMp !== "Toutes" ? `, ${t.sum_qte_non_dispo_mp}` : ""}.` : t.sum_aucune_donnee_produit },
    { title: t.sum_normes_titre, text: `${normesTotal.cePct.toFixed(0)}% ${t.sum_du_ca_ce} ${normesTotal.nfPct.toFixed(0)}% ${t.sum_en_nf_periode}` },
    { title: t.sum_top_cat, text: catMp ? `${translateCat(catMp.nom, lang)} (${catMp.pct}%) / ${sousCatMp ? translateCat(sousCatMp.nom, lang) : "N/A"} (${sousCatMp?.pct ?? "N/A"}%) — ${t.sum_annee_complete_non_filtrable}` : t.sum_non_disponible },
  ];
  const summaryAds = !showSummary || totalSpend === 0 ? [] : [
    { title: t.sum_performance, text: `${t.sum_roas_de} ${blendedRoas.toFixed(1)}x ${t.sum_sur_annee_2026}` },
    { title: t.sum_budget_investi, text: `${fmtEUR(totalSpend)} ${t.sum_depenses_pour} ${fmtEUR(totalAdsCa)} ${t.sum_generes_cumul}` },
    { title: t.sum_periode_titre, text: t.sum_donnee_annuelle_complete },
  ];

  // ===== Concurrence — veille collectée manuellement, cf. COMPETITION_DATA =====
  // structure : segments (Heater/Cooling) -> sous-catégories -> marketplaces -> produits
  const [concSegment, setConcSegment] = useState("Heater");
  const [weeklyPreviewOpen, setWeeklyPreviewOpen] = useState(true);
  const [marquesTab, setMarquesTab] = useState("marque");
  const [wattageCat, setWattageCat] = useState("Toutes");
  const [concSousCat, setConcSousCat] = useState(null); // null = toutes les sous-catégories du segment
  const CONF_STYLE = { haute: { icon: ShieldCheck, color: GREEN, label: t.conf_haute }, moyenne: { icon: ShieldQuestion, color: AMBER, label: t.conf_moyenne }, basse: { icon: ShieldAlert, color: RED, label: t.conf_basse } };

  const concSousCatsDuSegment = Object.keys(COMPETITION_DATA.segments[concSegment].sous_categories);
  // aplati tous les produits du segment (ou d'une seule sous-catégorie si sélectionnée), toutes marketplaces confondues
  const concAllProducts = useMemo(() => {
    const rows = [];
    const scList = concSousCat ? [concSousCat] : concSousCatsDuSegment;
    scList.forEach((sc) => {
      const scData = COMPETITION_DATA.segments[concSegment].sous_categories[sc];
      if (!scData) return;
      Object.entries(scData).forEach(([mp, mpData]) => {
        if (concMpFilter !== "Toutes" && mp !== concMpFilter) return;
        mpData.produits.forEach((p) => rows.push({ ...p, marketplace: mp, sous_categorie: sc, confiance: mpData.confiance }));
      });
    });
    return rows;
  }, [concSegment, concSousCat, concMpFilter]);
  // liste des marketplaces réellement présentes dans le segment actif (pour le filtre)
  const concMarketplacesDuSegment = useMemo(() => {
    const set = new Set();
    concSousCatsDuSegment.forEach((sc) => Object.keys(COMPETITION_DATA.segments[concSegment].sous_categories[sc]).forEach((mp) => set.add(mp)));
    return Array.from(set).sort();
  }, [concSegment]);
  const concNbProduits = concAllProducts.length;
  const concNbAvecPrix = concAllProducts.filter((p) => p.prix != null).length;
  const concPrixMoyen = concNbAvecPrix ? concAllProducts.filter((p) => p.prix != null).reduce((s,p) => s + p.prix, 0) / concNbAvecPrix : null;
  const concPrixMin = concNbAvecPrix ? Math.min(...concAllProducts.filter((p) => p.prix != null).map((p) => p.prix)) : null;
  const concPrixMax = concNbAvecPrix ? Math.max(...concAllProducts.filter((p) => p.prix != null).map((p) => p.prix)) : null;
  const concPromoCount = concAllProducts.filter((p) => p.remise).length;
  const concBesthermCount = concAllProducts.filter((p) => p.est_bestherm).length;
  const concMarquesCount = useMemo(() => {
    const counts = {};
    concAllProducts.forEach((p) => { const m = p.marque || t.non_identifiee; counts[m] = (counts[m] || 0) + 1; });
    return Object.entries(counts).sort((a,b) => b[1]-a[1]);
  }, [concAllProducts]);
  // qualité des sources réellement utilisées dans la sélection actuelle (segment + sous-catégorie)
  const concSourcesQualite = useMemo(() => {
    const rows = [];
    const scList = concSousCat ? [concSousCat] : concSousCatsDuSegment;
    scList.forEach((sc) => {
      Object.entries(COMPETITION_DATA.segments[concSegment].sous_categories[sc]).forEach(([mp, mpData]) => {
        rows.push({ sousCategorie: sc, marketplace: mp, ...mpData });
      });
    });
    return rows;
  }, [concSegment, concSousCat]);

  // ===== export du rapport concurrence — Markdown + CSV, sans dépendance
  // externe (Blob natif du navigateur), nommés à la date du jour =====
  const todayStr = new Date().toISOString().slice(0, 10);
  const triggerDownload = (content, filename, mime) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const downloadConcReportMd = () => {
    const scope = `${concSegment}${concSousCat ? ` — ${concSousCat}` : ""}${concMpFilter !== "Toutes" ? ` — ${concMpFilter}` : ""}`;
    let md = `# Rapport Concurrence — ${scope}\n\nCollecte : ${COMPETITION_DATA.collecte_date} · Généré le ${todayStr}\n\n`;
    md += `## Synthèse\n\n- Produits suivis : ${concNbProduits}\n- Prix moyen : ${concPrixMoyen !== null ? fmtEUR(concPrixMoyen) : "n/d"}\n- Fourchette : ${concPrixMin !== null ? `${fmtEURplain(concPrixMin)} – ${fmtEURplain(concPrixMax)}` : "n/d"}\n- En promotion : ${concPromoCount}/${concNbProduits}\n- Références Bestherm/Thomson identifiées : ${concBesthermCount}\n\n`;
    md += `## Produits\n\n`;
    concAllProducts.forEach((p) => {
      md += `- **${p.produit}**${p.est_bestherm ? " 🔶 (Bestherm/Thomson)" : ""} — ${p.marque || "marque n/d"} · ${p.marketplace} · ${p.sous_categorie}${p.prix != null ? ` · ${fmtEURplain(p.prix)}` : ""}${p.remise ? ` (-${p.remise}%)` : ""}${p.rang ? ` · rang #${p.rang}` : ""}\n`;
    });
    md += `\n## Sources et méthodologie\n\n`;
    concSourcesQualite.forEach((d) => { md += `- **${d.marketplace}** (${d.sousCategorie}) — confiance ${d.confiance} — ${d.methodologie}\n`; });
    md += `\n---\n_Veille collectée manuellement par recherche web. Aucun prix, classement ou volume inventé — données manquantes indiquées comme telles._\n`;
    triggerDownload(md, `concurrence-${concSegment.toLowerCase()}-${todayStr}.md`, "text/markdown;charset=utf-8");
  };
  const downloadConcReportCsv = () => {
    const esc = (v) => v == null ? "" : `"${String(v).replace(/"/g,'""')}"`;
    const headers = ["rang","produit","marque","marketplace","sous_categorie","prix","prix_avant","remise_pct","note","avis","sponsorise","est_bestherm","confiance"];
    const lines = [headers.join(",")];
    concAllProducts.forEach((p) => {
      lines.push([p.rang ?? "", esc(p.produit), esc(p.marque), esc(p.marketplace), esc(p.sous_categorie), p.prix ?? "", p.prix_avant ?? "", p.remise ?? "", p.note ?? "", p.avis ?? "", p.sponsorise ? "oui" : "non", p.est_bestherm ? "oui" : "non", p.confiance].join(","));
    });
    triggerDownload(lines.join("\n"), `concurrence-${concSegment.toLowerCase()}-${todayStr}.csv`, "text/csv;charset=utf-8");
  };

  // ===== comparatif prix Bestherm/Thomson vs moyenne concurrents — par
  // sous-catégorie, en excluant explicitement Bestherm/Thomson du calcul de
  // la moyenne (sinon la comparaison se fausse elle-même) =====
  // ===== analyse des puissances les plus vendues — filtrable date + marketplace,
  // à partir de price_tracking (quantité mensuelle réelle par produit×marketplace) =====
  // ===== vue hebdomadaire — totaux, répartition marketplace, expéditions (vrai
  // transporteur), entrepôt d'origine (flux d'expédition, pas un stock actuel),
  // top produits, pour la semaine sélectionnée. Données réelles issues des
  // colonnes "semaines"/"Entrepôt"/"Expédition 2.0" du fichier source. =====
  const weeklyStats = useMemo(() => {
    const totalRow = WEEKLY_TOTALS.find((w) => w[0] === selectedWeek);
    const ca = totalRow ? totalRow[1] : 0, qte = totalRow ? totalRow[2] : 0;
    const mpRows = WEEKLY_BY_MP.filter((r) => r[0] === selectedWeek).map(([, mp, ca, qte]) => ({ mp, ca, qte, prixMoyen: qte > 0 ? ca / qte : null })).sort((a, b) => b.ca - a.ca);
    const mpTotalCa = mpRows.reduce((s, r) => s + r.ca, 0);
    const expRows = WEEKLY_BY_EXP.filter((r) => r[0] === selectedWeek).map(([, exp, qte]) => ({ exp, qte })).sort((a, b) => b.qte - a.qte);
    const expTotalQte = expRows.reduce((s, r) => s + r.qte, 0);
    const entRows = WEEKLY_BY_ENT.filter((r) => r[0] === selectedWeek).map(([, ent, qte]) => ({ ent, qte })).sort((a, b) => b.qte - a.qte);
    const entTotalQte = entRows.reduce((s, r) => s + r.qte, 0);
    const topProducts = WEEKLY_BY_PROD.filter((r) => r[0] === selectedWeek).map(([, produit, ca, qte]) => ({ produit, ca, qte })).sort((a, b) => b.qte - a.qte).slice(0, 10);
    return { ca, qte, prixMoyen: qte > 0 ? ca / qte : null, mpRows, mpTotalCa, expRows, expTotalQte, entRows, entTotalQte, topProducts };
  }, [selectedWeek]);
  // compteur animé sur les 3 chiffres de la carte semaine — se redéclenche tout
  // seul à chaque changement de semaine puisque target fait partie des deps du
  // hook ; rend la navigation prev/next perceptible plutôt qu'un simple saut
  const [weekCaAnimated, weekCaPunch] = useCountUp(weeklyStats.ca);
  const [weekQteAnimated, weekQtePunch] = useCountUp(weeklyStats.qte);
  const [weekPrixAnimated, weekPrixPunch] = useCountUp(weeklyStats.prixMoyen || 0);
  // aperçu semaine la plus récente pour la Vue d'ensemble — indépendant de
  // selectedWeek (qui appartient à l'exploration libre dans Supply) pour que
  // ce résumé reste toujours sur la dernière semaine, même si l'utilisateur a
  // navigué ailleurs dans Supply entre-temps
  const latestWeek = useMemo(() => Math.max(...WEEKLY_TOTALS.map((w) => w[0])), []);
  const latestWeekStats = useMemo(() => {
    const totalRow = WEEKLY_TOTALS.find((w) => w[0] === latestWeek);
    const ca = totalRow ? totalRow[1] : 0, qte = totalRow ? totalRow[2] : 0;
    const prevRow = WEEKLY_TOTALS.find((w) => w[0] === latestWeek - 1);
    const trend = prevRow && prevRow[1] > 0 ? ((ca - prevRow[1]) / prevRow[1]) * 100 : null;
    const allMp = WEEKLY_BY_MP.filter((r) => r[0] === latestWeek).map(([, mp, ca, qte]) => ({ mp, ca, qte })).sort((a, b) => b.ca - a.ca);
    const mpRows = allMp.slice(0, 3);
    const mpMaxCa = mpRows.length ? mpRows[0].ca : 0;
    // top 6 + "Autres" pour le donut — même logique que weeklyPieData plus bas,
    // dupliquée volontairement ici plutôt que partagée : latestWeekStats doit
    // rester sur la dernière semaine indépendamment de selectedWeek (voir plus haut)
    const top6 = allMp.slice(0, 6);
    const autresCa = allMp.slice(6).reduce((s, r) => s + r.ca, 0);
    const donutSegments = [...top6, ...(autresCa > 0 ? [{ mp: t.autres_lbl, ca: autresCa }] : [])]
      .map((r) => ({ label: r.mp, value: r.ca, color: (MARKETPLACE_COLORS[r.mp] && MARKETPLACE_COLORS[r.mp].primary) || FAINT }));
    return { ca, qte, prixMoyen: qte > 0 ? ca / qte : null, trend, mpRows, mpMaxCa, donutSegments };
  }, [latestWeek, t.autres_lbl]);
  // résumé texte de la semaine — même composant et même style que les résumés
  // de période ailleurs dans l'app (PeriodSummaryCard), pas de jauge séparée
  // à maintenir en parallèle. Toujours généré (pas de condition showSummary) :
  // contrairement aux autres onglets, cette carte est déjà par nature une vue
  // ciblée sur une semaine précise, jamais une vue "tout confondu" par défaut.
  const summaryWeekly = useMemo(() => {
    const top = latestWeekStats.donutSegments[0];
    // meilleure progression marketplace vs semaine précédente — seuil de 3% du
    // CA total de la semaine (ou 1500€ mini) pour écarter les hausses en %
    // spectaculaires mais tirées d'un volume marginal (ex. 183€ -> 1621€ =
    // +784%, réel mais pas un signal utile) ; même logique de prudence que
    // yoy_variation_forte ailleurs dans l'app pour les bases de comparaison faibles
    const prevWeekMp = {};
    WEEKLY_BY_MP.filter((r) => r[0] === latestWeek - 1).forEach(([, mp, ca]) => { prevWeekMp[mp] = ca; });
    const totalCaWeek = latestWeekStats.ca;
    const threshold = Math.max(1500, totalCaWeek * 0.03);
    const progressions = WEEKLY_BY_MP.filter((r) => r[0] === latestWeek)
      .map(([, mp, ca]) => ({ mp, ca, prev: prevWeekMp[mp] }))
      .filter((r) => r.prev && r.prev > 0 && r.ca >= threshold)
      .map((r) => ({ ...r, pct: ((r.ca - r.prev) / r.prev) * 100 }));
    const bestProgression = progressions.length ? progressions.reduce((a, b) => (b.pct > a.pct ? b : a)) : null;
    return [
      { title: t.sum_ca_titre, text: `${fmtEUR(latestWeekStats.ca)} ${t.sum_cette_semaine}${latestWeekStats.trend !== null ? `, ${latestWeekStats.trend >= 0 ? "+" : ""}${latestWeekStats.trend.toFixed(1)}% ${t.vs_semaine_prec}` : ""}.` },
      { title: t.sum_mp_leader, text: top ? `${top.label}, ${fmtEURk(top.value)} (${((top.value / latestWeekStats.ca) * 100).toFixed(0)}%) ${t.sum_du_ca_semaine}.` : t.sum_non_calculable },
      { title: t.sum_meilleure_progression, text: bestProgression ? `${bestProgression.mp}, ${bestProgression.pct >= 0 ? "+" : ""}${bestProgression.pct.toFixed(1)}% ${t.sum_vs_semaine_derniere} (${fmtEURk(bestProgression.prev)} → ${fmtEURk(bestProgression.ca)}).` : t.sum_non_calculable },
      { title: t.sum_ytd_titre, text: `${fmtEUR(DATA.kpi.ca_total_2026)} ${t.sum_depuis_1er_janvier} ${DATA.kpi.pct_objectif_atteint.toFixed(1)}% ${t.sum_objectif_annuel_point}` },
    ];
  }, [latestWeekStats, latestWeek, t]);
  // camembert limité au top 7 + "Autres" agrégé — jusqu'à 14 marketplaces actives
  // certaines semaines, un camembert complet serait illisible (tranches minuscules,
  // étiquettes qui se chevauchent)
  const weeklyPieData = useMemo(() => {
    const rows = weeklyStats.mpRows;
    if (rows.length <= 8) return rows;
    const top7 = rows.slice(0, 7);
    const autresCa = rows.slice(7).reduce((s, r) => s + r.ca, 0);
    const autresQte = rows.slice(7).reduce((s, r) => s + r.qte, 0);
    return [...top7, { mp: t.autres_lbl, ca: autresCa, qte: autresQte, prixMoyen: autresQte > 0 ? autresCa / autresQte : null }];
  }, [weeklyStats.mpRows, t.autres_lbl]);
  const weeklyTrend = useMemo(() => WEEKLY_TOTALS.filter((w) => w[0] > selectedWeek - 4 && w[0] <= selectedWeek), [selectedWeek]);
  const weekOptions = useMemo(() => WEEKLY_TOTALS.map((w) => w[0]), []);
  // tendance semaine vs semaine précédente (par CA) — alimente le point coloré
  // sur chaque bouton de la liste, pour un repère au coup d'œil sans avoir à
  // cliquer sur chaque semaine une par une
  const weekTrends = useMemo(() => {
    const sorted = [...WEEKLY_TOTALS].sort((a, b) => a[0] - b[0]);
    const map = {};
    sorted.forEach((w, i) => {
      if (i === 0) { map[w[0]] = null; return; }
      const prevCa = sorted[i - 1][1];
      map[w[0]] = prevCa > 0 ? ((w[1] - prevCa) / prevCa) * 100 : null;
    });
    return map;
  }, []);
  const weekButtonsRef = useRef(null);
  useEffect(() => {
    const container = weekButtonsRef.current;
    if (!container) return;
    const btn = container.querySelector(`[data-week="${selectedWeek}"]`);
    if (btn) btn.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [selectedWeek]);

  // ===== vue exhaustive tous produits — CA + quantité, année 2026 complète
  // (year-to-date), toutes marketplaces ou une seule si globalMp filtré.
  // Inclut le déstockage (contrairement à Tops/Flops) car l'objectif ici est
  // la visibilité complète, pas la performance "propre" — badge dédié pour
  // signaler les références concernées plutôt que les cacher. =====
  // préfixes de pièces détachées/accessoires — distinct de WATTAGE_RE (Tops/Flops) :
  // ici on veut garder les ventilateurs et déshumidificateurs (pas de "W" dans
  // leur nom), donc exclusion ciblée par préfixe plutôt que par présence de puissance
  const ACCESSOIRE_RE = /^(ATTACHES-|Filtre|GDM-5R|HJEE-ATTACHES|MOTOR -|TELECOMMANDE|THERMOSTAT)/i;
  const allProductsYTD = useMemo(() => {
    const agg = {};
    SKU_MONTHLY.forEach(([pi, mi, an, , ca, qte]) => {
      if (an !== 2026) return;
      if (globalMp !== "Toutes" && SKU_MPS[mi] !== globalMp) return;
      if (!agg[pi]) agg[pi] = { ca: 0, qte: 0 };
      agg[pi].ca += ca;
      agg[pi].qte += qte;
    });
    const vendus = Object.entries(agg)
      .map(([pi, d]) => ({ produit: SKU_PRODUIT[Number(pi)], ca: d.ca, qte: d.qte, destockage: SKU_DESTOCKAGE[Number(pi)], catalogue: false }))
      .filter((p) => !ACCESSOIRE_RE.test(p.produit));
    const nonVendus = CATALOGUE_NON_VENDU.map(([nom, marque]) => ({ produit: nom, ca: 0, qte: 0, destockage: false, catalogue: true, marqueCatalogue: marque }));
    return [...vendus, ...nonVendus];
  }, [globalMp]);
  const allProductsYTDFiltered = useMemo(() => {
    const q = apSearch.trim().toLowerCase();
    const filtered = q === "" ? allProductsYTD : allProductsYTD.filter((p) => p.produit.toLowerCase().includes(q));
    return [...filtered].sort((a, b) => apSort === "ca" ? b.ca - a.ca : apSort === "qte" ? b.qte - a.qte : a.produit.localeCompare(b.produit));
  }, [allProductsYTD, apSearch, apSort]);
  // ===== Top 5 / Flop 5 fusionnés dans "Tous les produits" (badge sur la ligne,
  // pas une section séparée) — évite la redondance avec une liste déjà triable.
  // Basé sur le même critère que le tri actuel (CA ou Qté, "produit" -> repli sur
  // CA), calculé sur les vraies ventes uniquement (le catalogue non vendu est
  // structurellement à 0, l'inclure dans Flop n'aurait aucun sens). =====
  const topFlopBadges = useMemo(() => {
    const critere = apSort === "qte" ? "qte" : "ca";
    const vendus = allProductsYTD.filter((p) => !p.catalogue && (p.ca > 0 || p.qte > 0));
    const sorted = [...vendus].sort((a, b) => b[critere] - a[critere]);
    const badges = {};
    sorted.slice(0, 5).forEach((p) => { badges[p.produit] = "top"; });
    sorted.slice(-5).forEach((p) => { badges[p.produit] = "flop"; });
    return badges;
  }, [allProductsYTD, apSort]);

  // ===== Cycle de vie produit — compare juin-août 2026 à la même période 2025
  // (pas les mois qui précèdent immédiatement, sinon la comparaison capte la
  // saisonnalité elle-même plutôt qu'une vraie tendance — un produit qui recule
  // de l'été au pic de novembre "décline" toujours mécaniquement, ce n'est pas
  // le signal recherché). Respecte le filtre marketplace global. =====
  // ===== courbe mensuelle par produit (toutes marketplaces), 2025 vs 2026,
  // pour la fiche produit détaillée — agrège SKU_MONTHLY par nom de produit =====
  const monthlyCaByProduct = useMemo(() => {
    const map = {};
    SKU_MONTHLY.forEach(([pi, mi, an, mois, ca]) => {
      const produit = SKU_PRODUIT[pi];
      if (!map[produit]) map[produit] = { 2025: Array(12).fill(0), 2026: Array(12).fill(0) };
      if (an === 2025 || an === 2026) map[produit][an][mois - 1] += ca;
    });
    return map;
  }, []);

  const lifecycleData = useMemo(() => {
    const caByProduit = {}; // index -> {c25:[12], c26:[12]}
    SKU_MONTHLY.forEach(([pi, mi, an, mo, ca, qte]) => {
      if (SKU_DESTOCKAGE[pi]) return;
      if (globalMp !== "Toutes" && SKU_MPS[mi] !== globalMp) return;
      if (!caByProduit[pi]) caByProduit[pi] = { c25: Array(12).fill(0), c26: Array(12).fill(0) };
      caByProduit[pi][an === 2025 ? "c25" : "c26"][mo - 1] += ca;
    });
    const buckets = { lancement: [], croissance: [], mature: [], declin: [] };
    Object.entries(caByProduit).forEach(([piStr, s]) => {
      const pi = Number(piStr);
      const produit = SKU_PRODUIT[pi];
      if (!WATTAGE_RE.test(produit)) return; // exclut accessoires
      const recent = s.c26[5] + s.c26[6] + s.c26[7]; // juin-juil-août 2026
      const sameLastYear = s.c25[5] + s.c25[6] + s.c25[7];
      const totalMoisActifs = [...s.c25, ...s.c26].filter((v) => v > 0).length;
      if (recent <= 0) return;
      let stage, variation = null;
      if (totalMoisActifs <= 4 || sameLastYear === 0) stage = "lancement";
      else {
        variation = ((recent - sameLastYear) / sameLastYear) * 100;
        stage = variation > 20 ? "croissance" : variation < -20 ? "declin" : "mature";
      }
      buckets[stage].push({ produit, ca: recent, variation });
    });
    Object.keys(buckets).forEach((k) => buckets[k].sort((a, b) => b.ca - a.ca));
    return buckets;
  }, [globalMp]);
  // table de correspondance produit -> stade de cycle de vie, dérivée des mêmes
  // buckets ci-dessus (pas de recalcul), pour un accès direct depuis "Tous les
  // produits" sans reparcourir les 4 listes à chaque clic
  const lifecycleByProduct = useMemo(() => {
    const map = {};
    Object.entries(lifecycleData).forEach(([stage, items]) => {
      items.forEach((it) => { map[it.produit] = { stage, variation: it.variation }; });
    });
    return map;
  }, [lifecycleData]);

  const wattageCats = useMemo(() => Array.from(new Set(Object.values(PRODUCT_TO_CATEGORY))).sort(), []);

  // ===== Panier — paires réellement achetées ensemble (BASKET_PAIRS), avec
  // détection des paires croisées radiateur x sèche-serviette via le catalogue
  // déjà en place. Donnée globale (pas filtrable par marketplace/date — le
  // numéro de commande ne porte pas ces deux dimensions dans l'extraction). =====
  const familleParProduit = useMemo(() => {
    const map = {};
    SKU_PRODUIT.forEach((p, i) => { map[p] = SKU_FAMILLE[i]; });
    return map;
  }, []);
  const basketDisplay = useMemo(() => {
    const isRad = (f) => f === "Fixe heater" || f === "Mobile";
    const isSav = (f) => f === "Sèche-serviettes";
    return BASKET_PAIRS.map(([a, b, n]) => {
      const fa = familleParProduit[a], fb = familleParProduit[b];
      const croise = (isRad(fa) && isSav(fb)) || (isRad(fb) && isSav(fa));
      return { a, b, n, croise };
    });
  }, [familleParProduit]);
  const basketCroises = basketDisplay.filter((p) => p.croise).slice(0, 6);
  const basketTop = basketDisplay.slice(0, 8);
  // table de correspondance produit -> ses partenaires panier les plus fréquents,
  // dans les deux sens (le produit peut être en position a ou b dans la paire)
  const basketByProduct = useMemo(() => {
    const map = {};
    BASKET_PAIRS.forEach(([a, b, n]) => {
      (map[a] = map[a] || []).push({ partner: b, n });
      (map[b] = map[b] || []).push({ partner: a, n });
    });
    Object.values(map).forEach((arr) => arr.sort((x, y) => y.n - x.n));
    return map;
  }, []);

  // ===== Radar produit idéal — profil pondéré par CA réel des références qui
  // se vendent sur la marketplace sélectionnée. Prix régulier = CA/qté hors
  // déstockage. Prix promo = CA/qté sur les seules références en déstockage
  // (proxy explicite, pas une vraie distinction promo ponctuelle — voir note
  // affichée dans l'app). Déstockage exclu du calcul des % d'attributs pour
  // ne pas fausser le profil avec du stock bradé à écouler. =====
  const RADAR_MIN_REF = 5; // en dessous, le profil reflèterait 1-4 produits
  // spécifiques plutôt qu'un vrai motif statistique — on préfère le dire
  // clairement plutôt que tracer un radar aussi "sûr de lui" avec 2 produits qu'avec 40
  const radarProfiles = useMemo(() => {
    if (globalMp === "Toutes") return null;
    const buildFamilyProfile = (famillesInclues) => {
      const totals = {}; // index produit -> { ca, qte, ca_destock, qte_destock }
      SKU_MONTHLY.forEach(([pi, mi, an, mo, ca, qte]) => {
        if (SKU_MPS[mi] !== globalMp) return;
        if (!famillesInclues.includes(SKU_FAMILLE[pi])) return;
        if (!totals[pi]) totals[pi] = { ca: 0, qte: 0, ca_destock: 0, qte_destock: 0 };
        if (SKU_DESTOCKAGE[pi]) { totals[pi].ca_destock += ca; totals[pi].qte_destock += qte; }
        else { totals[pi].ca += ca; totals[pi].qte += qte; }
      });
      let totalCa = 0, wifiCa = 0, verticalCa = 0, plintheCa = 0, ceramiqueCa = 0, fonteCa = 0, filmCa = 0, souffleCa = 0;
      let priceW = 0, priceQ = 0, promoW = 0, promoQ = 0;
      const puissanceCa = {};
      const parProduit = []; // détail par référence, nécessaire au score de distance
      Object.entries(totals).forEach(([piStr, t]) => {
        const pi = Number(piStr);
        totalCa += t.ca;
        const attrs = {
          wifi: SKU_WIFI[pi] ? 100 : 0, vertical: SKU_VERTICAL[pi] ? 100 : 0, plinthe: SKU_PLINTHE[pi] ? 100 : 0,
          ceramique: SKU_SOUS_FAMILLE[pi].includes("éramique") ? 100 : 0, fonte: SKU_SOUS_FAMILLE[pi].includes("Fonte") ? 100 : 0,
          film: SKU_SOUS_SOUS_FAMILLE[pi].toLowerCase().includes("film") ? 100 : 0,
          soufflerie: SKU_SOUS_SOUS_FAMILLE[pi].toLowerCase().includes("soufflerie") ? 100 : 0,
        };
        if (attrs.wifi) wifiCa += t.ca;
        if (attrs.vertical) verticalCa += t.ca;
        if (attrs.plinthe) plintheCa += t.ca;
        if (attrs.ceramique) ceramiqueCa += t.ca;
        if (attrs.fonte) fonteCa += t.ca;
        if (attrs.film) filmCa += t.ca;
        if (attrs.soufflerie) souffleCa += t.ca;
        const m = SKU_PRODUIT[pi].match(WATTAGE_RE);
        if (m && t.ca > 0) puissanceCa[m[1]] = (puissanceCa[m[1]] || 0) + t.ca;
        if (t.qte > 0) { priceW += t.ca; priceQ += t.qte; }
        if (t.qte_destock > 0) { promoW += t.ca_destock; promoQ += t.qte_destock; }
        if (t.ca > 0 && t.qte > 0) parProduit.push({ produit: SKU_PRODUIT[pi], ca: t.ca, prix: t.ca / t.qte, attrs });
      });
      if (!totalCa) return null;
      const puissanceDominante = Object.entries(puissanceCa).sort((a,b) => b[1]-a[1])[0];
      const nbRef = Object.keys(totals).length;
      return {
        nbRef, totalCa, fiable: nbRef >= RADAR_MIN_REF,
        wifi: wifiCa/totalCa*100, vertical: verticalCa/totalCa*100, plinthe: plintheCa/totalCa*100,
        ceramique: ceramiqueCa/totalCa*100, fonte: fonteCa/totalCa*100, film: filmCa/totalCa*100,
        soufflerie: souffleCa/totalCa*100,
        puissanceDominante: puissanceDominante ? puissanceDominante[0] : null,
        prixRegulier: priceQ ? priceW/priceQ : null,
        prixPromo: promoQ ? promoW/promoQ : null,
        parProduit,
      };
    };
    const radiateur = buildFamilyProfile(["Fixe heater", "Mobile"]);
    const secheServiette = buildFamilyProfile(["Sèche-serviettes"]);
    return { radiateur, secheServiette };
  }, [globalMp]);

  // ===== Score de distance à l'idéal — pour chaque produit du profil, écart
  // moyen (valeur absolue) entre ses propres attributs et le profil idéal
  // pondéré CA, sur les 7 dimensions binaires + le prix (normalisé en % d'écart
  // relatif). Plus le score est bas, plus le produit "ressemble" au profil qui
  // génère le plus de CA sur cette marketplace — descriptif, pas causal : un
  // produit loin de l'idéal n'est pas nécessairement un mauvais produit, juste
  // un profil différent de la moyenne pondérée. =====
  const computeDistances = (profile) => {
    if (!profile || !profile.fiable) return [];
    const dims = ["wifi", "vertical", "plinthe", "ceramique", "fonte", "film", "soufflerie"];
    return profile.parProduit.map((p) => {
      const attrDist = dims.reduce((s, d) => s + Math.abs(p.attrs[d] - profile[d]), 0) / dims.length;
      const priceDist = profile.prixRegulier ? Math.abs(p.prix - profile.prixRegulier) / profile.prixRegulier * 100 : 0;
      const score = (attrDist + priceDist) / 2;
      return { produit: p.produit, ca: p.ca, prix: p.prix, score };
    }).sort((a, b) => a.score - b.score);
  };
  const radarDistancesRadiateur = useMemo(() => computeDistances(radarProfiles?.radiateur), [radarProfiles]);
  const radarDistancesSecheServiette = useMemo(() => computeDistances(radarProfiles?.secheServiette), [radarProfiles]);

  // ===== Supply — classification ABC (2026, seule année disponible), indice
  // de saisonnalité (2024+2025), anticipation sept-déc 2026 =====
  const abcSummary = useMemo(() => {
    const byClass = { A: { nb: 0, ca: 0 }, B: { nb: 0, ca: 0 }, C: { nb: 0, ca: 0 }, D: { nb: 0, ca: 0 } };
    let totalCa = 0;
    ABC_BY_SKU.forEach(([sku, produit, ca, qte, abc]) => {
      if (!byClass[abc]) return;
      byClass[abc].nb++; byClass[abc].ca += ca; totalCa += ca;
    });
    return { byClass, totalCa, nbSku: ABC_BY_SKU.length };
  }, []);
  const seasonalityRows = useMemo(() => moisLabels.map((m, i) => ({ mois: m, index: SEASONALITY_INDEX[i] })), [moisLabels]);
  const peakMonth = seasonalityRows.reduce((max, r) => r.index > max.index ? r : max, seasonalityRows[0]);
  const troughMonth = seasonalityRows.reduce((min, r) => r.index < min.index ? r : min, seasonalityRows[0]);

  // ===== anticipation avec fourchette basse/haute, pas un chiffre unique —
  // la croissance mois par mois 2026 vs 2025 est très volatile (de +7% à +138%
  // selon le mois, jusqu'à -13% en août), un seul taux appliqué donnerait une
  // fausse précision. Basse = croissance YTD complète (jan-août, plus stable
  // car lissée sur 8 mois). Haute = croissance récente (juin-août, plus
  // réactive mais plus bruitée). Les deux sont de vraies méthodes, pas une
  // fourchette arbitraire — voir le détail affiché dans l'app. =====
  const computeAnticipation = (m26, m25) => {
    // le taux de croissance reste calculé sur les 8 mois COMPLETS (jan-août) —
    // inclure septembre partiel fausserait la comparaison (mois à 12/30e vs
    // mois complet l'an dernier, ferait croire à une chute artificielle)
    const ytd26 = m26.slice(0, 8).reduce((a, b) => a + b, 0), ytd25 = m25.slice(0, 8).reduce((a, b) => a + b, 0);
    const growthYtd = ytd25 ? (ytd26 - ytd25) / ytd25 : 0;
    const recentMonths = [5, 6, 7].filter((i) => m25[i] > 0).map((i) => (m26[i] - m25[i]) / m25[i]);
    const growthRecent = recentMonths.length ? recentMonths.reduce((a, b) => a + b, 0) / recentMonths.length : growthYtd;
    const growthBas = Math.min(growthYtd, growthRecent), growthHaut = Math.max(growthYtd, growthRecent);
    // septembre (index 8) a maintenant de vraies données partielles (12/30j) —
    // seuls octobre à décembre restent à anticiper
    const base = [9, 10, 11].reduce((s, i) => s + m25[i], 0);
    const parMois = [9, 10, 11].map((i) => ({ bas: m25[i] * (1 + growthBas), haut: m25[i] * (1 + growthHaut) }));
    const bas = parMois.reduce((s, x) => s + x.bas, 0), haut = parMois.reduce((s, x) => s + x.haut, 0);
    return { base, bas, haut, growthYtd, growthRecent, milieu: (bas + haut) / 2, parMois };
  };
  const anticipation = useMemo(() => computeAnticipation(DATA.monthly_total["2026"], DATA.monthly_total["2025"]), []);
  // estimation fin d'année complète = YTD réel (connu, jan-sept) + fourchette
  // anticipée (oct-déc) — répond directement à "vais-je atteindre l'objectif ?"
  const estimationAnnuelle = useMemo(() => {
    // s'adapte à la marketplace sélectionnée — recalcule directement via
    // computeAnticipation plutôt que de dépendre d'anticipationByMp (défini
    // plus bas dans le fichier), pour éviter tout risque d'ordre de déclaration
    const m26Source = globalMp === "Toutes" ? DATA.monthly_total["2026"] : (DATA.gf.monthly_total_by_mp[globalMp]?.["2026"] || Array(12).fill(0));
    const m25Source = globalMp === "Toutes" ? DATA.monthly_total["2025"] : (DATA.gf.monthly_total_by_mp[globalMp]?.["2025"] || Array(12).fill(0));
    const anticipationMp = computeAnticipation(m26Source, m25Source);
    const ytdReel = m26Source.slice(0, 9).reduce((a, b) => a + b, 0);
    const mpObjectifEntry = globalMp !== "Toutes" ? DATA.mp_vs_objectif.find((m) => m.marketplace === globalMp) : null;
    const objectifRef = globalMp === "Toutes" ? DATA.kpi.objectif_annuel_total : (mpObjectifEntry?.objectif_fiable ? mpObjectifEntry.objectif : null);
    // décomposition mois par mois — jan-sept réel connu (sept partiel, 12/30j),
    // oct-déc fourchette anticipée
    const parMois = moisLabels.map((label, i) => {
      if (i < 9) return { mois: label, reel: m26Source[i], bas: null, haut: null };
      return { mois: label, reel: null, bas: anticipationMp.parMois[i - 9].bas, haut: anticipationMp.parMois[i - 9].haut };
    });
    return {
      bas: ytdReel + anticipationMp.bas, haut: ytdReel + anticipationMp.haut,
      pctObjectifBas: objectifRef ? (ytdReel + anticipationMp.bas) / objectifRef * 100 : null,
      pctObjectifHaut: objectifRef ? (ytdReel + anticipationMp.haut) / objectifRef * 100 : null,
      objectifRef, parMois,
      maxMois: Math.max(...parMois.map((m) => Math.max(m.reel || 0, m.haut || 0))),
    };
  }, [anticipation, moisLabels, globalMp]);
  const anticipationTotal = anticipation.milieu;

  // ===== courbe étendue avec fourchette anticipée oct-déc, fusionnée après
  // coup plutôt que de modifier trendCombined directement — évite de réordonner
  // du code existant qui fonctionne. Le dernier mois réel (septembre, partiel
  // 12/30j) sert de point de jonction pour que la zone anticipée démarre
  // visuellement sans coupure. =====
  const trendWithForecast = useMemo(() => {
    return trendCombined.map((row, i) => {
      if (i < 8) return { ...row, bas: null, haut: null };
      if (i === 8) return { ...row, bas: row[2026], haut: row[2026] }; // jonction sur le dernier point réel
      const est = estimationAnnuelle.parMois[i];
      return { ...row, bas: est?.bas ?? null, haut: est?.haut ?? null };
    });
  }, [trendCombined, estimationAnnuelle]);
  // l'axe Y doit aussi couvrir la fourchette haute anticipée, sinon la zone se
  // fait couper en haut du graphique quand l'estimation dépasse l'historique
  const maxYearlyMonthWithForecast = Math.max(maxYearlyMonth, estimationAnnuelle.maxMois);

  // ===== anticipation éclatée par marketplace — même méthode à fourchette,
  // calculée séparément pour chaque marketplace plutôt qu'une seule masse =====
  const anticipationByMp = useMemo(() => {
    const mps = Object.keys(DATA.gf.monthly_total_by_mp).sort();
    return mps.map((mp) => {
      const m26 = DATA.gf.monthly_total_by_mp[mp]["2026"] || Array(12).fill(0);
      const m25 = DATA.gf.monthly_total_by_mp[mp]["2025"] || Array(12).fill(0);
      const r = computeAnticipation(m26, m25);
      return { mp, ...r, total: r.milieu };
    }).filter((r) => r.base > 0).sort((a, b) => b.total - a.total);
  }, []);

  const wattageAnalysis = useMemo(() => {
    const { from, to } = dateRange;
    const buckets = {};
    let totalAvecPuissance = 0, totalSansPuissance = 0;
    DATA.price_tracking.forEach(([produit, mp, , , qte2025, qte2026]) => {
      if (globalMp !== "Toutes" && mp !== globalMp) return;
      if (wattageCat !== "Toutes" && PRODUCT_TO_CATEGORY[produit] !== wattageCat) return;
      const qte = sumQteRange(qte2025, qte2026, from, to);
      const match = produit.match(WATTAGE_RE);
      if (!match) { totalSansPuissance += qte; return; }
      buckets[match[1]] = (buckets[match[1]] || 0) + qte;
      totalAvecPuissance += qte;
    });
    const rows = Object.entries(buckets)
      .map(([watt, qte]) => ({ watt, qte, pct: totalAvecPuissance ? (qte / totalAvecPuissance) * 100 : 0 }))
      .filter((r) => r.qte > 0)
      .sort((a, b) => b.qte - a.qte);
    return { rows, totalAvecPuissance, totalSansPuissance, couverturePct: (totalAvecPuissance + totalSansPuissance) ? (totalAvecPuissance / (totalAvecPuissance + totalSansPuissance)) * 100 : 0 };
  }, [dateRange.from, dateRange.to, globalMp, wattageCat]);

  const concComparatif = useMemo(() => {
    const bySousCat = {};
    concAllProducts.forEach((p) => {
      if (!bySousCat[p.sous_categorie]) bySousCat[p.sous_categorie] = { concurrents: [], bestherm: [] };
      if (p.prix == null) return;
      if (p.est_bestherm) bySousCat[p.sous_categorie].bestherm.push(p);
      else bySousCat[p.sous_categorie].concurrents.push(p);
    });
    return Object.entries(bySousCat)
      .map(([sc, d]) => {
        const concAvg = d.concurrents.length ? d.concurrents.reduce((s,p)=>s+p.prix,0) / d.concurrents.length : null;
        return { sousCategorie: sc, concAvg, nbConcurrents: d.concurrents.length, bestherm: d.bestherm.map((p) => ({ ...p, ecartPct: concAvg ? ((p.prix - concAvg) / concAvg) * 100 : null })) };
      })
      .filter((d) => d.bestherm.length > 0); // n'affiche que les sous-catégories où on a au moins un prix Bestherm/Thomson à comparer
  }, [concAllProducts]);

  // ===== résumé par marketplace — toutes sous-catégories des 2 segments,
  // indépendant du segment actuellement affiché. Uniquement des faits réels :
  // aucun prix moyen ni volume inventé là où la donnée n'existe pas =====
  const mpConcSummary = useMemo(() => {
    if (concMpFilter === "Toutes") return null;
    const bySeg = { Heater: [], Cooling: [] };
    Object.entries(COMPETITION_DATA.segments).forEach(([seg, segData]) => {
      Object.entries(segData.sous_categories).forEach(([sc, mps]) => {
        const mpData = mps[concMpFilter];
        if (!mpData) return;
        mpData.produits.forEach((p) => bySeg[seg].push({ ...p, sous_categorie: sc }));
      });
    });
    const allProducts = [...bySeg.Heater, ...bySeg.Cooling];
    const bestherm = allProducts.filter((p) => p.est_bestherm);
    const concurrents = allProducts.filter((p) => !p.est_bestherm);
    // regrouper les concurrents par marque pour la liste "principaux concurrents"
    const concurrentsByBrand = {};
    concurrents.forEach((p) => {
      const marque = p.marque || t.non_identifiee;
      if (!concurrentsByBrand[marque]) concurrentsByBrand[marque] = [];
      concurrentsByBrand[marque].push(p);
    });
    // radiateurs (3 sous-catégories) vs sèche-serviettes (3 sous-catégories) — prix réels seulement
    const radSousCats = ["Radiateur fixe", "Radiateur mobile", "Radiateur soufflant"];
    const secheSousCats = ["Sèche-serviette électrique", "Sèche-serviette soufflant", "Sèche-serviette connecté"];
    const radProducts = allProducts.filter((p) => radSousCats.includes(p.sous_categorie));
    const secheProducts = allProducts.filter((p) => secheSousCats.includes(p.sous_categorie));
    const radPrix = radProducts.filter((p) => p.prix != null);
    const sechePrix = secheProducts.filter((p) => p.prix != null);
    return {
      hasData: allProducts.length > 0,
      bestherm, concurrents, concurrentsByBrand,
      nbHeater: bySeg.Heater.length, nbCooling: bySeg.Cooling.length,
      bestHeater: bySeg.Heater.filter((p) => p.est_bestherm).length,
      bestCooling: bySeg.Cooling.filter((p) => p.est_bestherm).length,
      radProducts, radPrixMoyen: radPrix.length ? radPrix.reduce((s,p)=>s+p.prix,0)/radPrix.length : null, radPrixNb: radPrix.length,
      secheProducts, sechePrixMoyen: sechePrix.length ? sechePrix.reduce((s,p)=>s+p.prix,0)/sechePrix.length : null, sechePrixNb: sechePrix.length,
    };
  }, [concMpFilter]);

  // ===== ads : dépense, budget, restant par marketplace =====
  const adsWithRemaining = useMemo(() => (globalMp === "Toutes" ? DATA.ads : DATA.ads.filter((a) => (GF_TO_ADS[globalMp] || []).includes(a.marketplace)))
    .filter((a) => a.budget_annuel)
    .map((a) => ({ ...a, remaining: a.budget_annuel - a.spend }))
    .sort((a,b) => b.spend - a.spend), [globalMp]);

  return (
    <AccentContext.Provider value={mpAccent}>
    <div style={{ background: BG, color: INK, minHeight: "100vh", fontFamily: "'Inter', sans-serif" }} className="relative overflow-x-hidden">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700&family=Quicksand:wght@600;700&family=Archivo+Black&family=Inter:wght@400;500;600;700;800&display=swap');
        ::selection{background:${ORANGE}55}
        input[type=date]::-webkit-calendar-picker-indicator{filter:invert(0.6)}
        @keyframes drift1 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(40px,-30px)} }
        @keyframes drift2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-35px,25px)} }
        @keyframes cardIn { from{opacity:0; transform:translateY(14px)} to{opacity:1; transform:translateY(0)} }
        @keyframes rowIn { from{opacity:0; transform:translateX(-6px)} to{opacity:1; transform:translateX(0)} }
        @keyframes punch { 0%{transform:scale(1)} 40%{transform:scale(1.04)} 100%{transform:scale(1)} }
        @keyframes pulse-dot { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(0.75); } }
        @keyframes spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        @keyframes warmPulse { 0%,100%{opacity:0.35} 50%{opacity:1} }
        @keyframes riseWater { from{height:0} to{height:22px} }
        @keyframes steamFloat { 0%{transform:translateY(0); opacity:0} 30%{opacity:0.8} 100%{transform:translateY(-16px); opacity:0} }
        @keyframes ledBlink { 0%,100%{opacity:0.4} 50%{opacity:1} }
        .warm-bar { animation: warmPulse 1.8s ease-in-out infinite; }
        .water-rise { animation: riseWater 2.2s ease-out infinite alternate; }
        .steam { animation: steamFloat 1.8s ease-out infinite; }
        .panel-led { animation: ledBlink 1.4s ease-in-out infinite; }
        .pulse-dot { animation: pulse-dot 1.8s ease-in-out infinite; }
        @keyframes ember { 0%{transform:translateY(0) translateX(0); opacity:0} 10%{opacity:0.7} 90%{opacity:0.35} 100%{transform:translateY(-90vh) translateX(20px); opacity:0} }
        .orb1 { animation: drift1 14s ease-in-out infinite; } .orb2 { animation: drift2 18s ease-in-out infinite; }
        .card-reveal { animation: cardIn 0.55s cubic-bezier(.22,1,.36,1) backwards; }
        .scroll-reveal { opacity: 0; transform: translateY(28px) scale(0.96); transition: opacity 0.7s cubic-bezier(.34,1.56,.64,1), transform 0.7s cubic-bezier(.34,1.56,.64,1); }
        .scroll-reveal.is-visible { opacity: 1; transform: translateY(0) scale(1); }
        .reveal-d1.is-visible, .reveal-d1 { transition-delay: 0.06s; }
        .reveal-d2.is-visible, .reveal-d2 { transition-delay: 0.12s; }
        .reveal-d3.is-visible, .reveal-d3 { transition-delay: 0.18s; }
        .fold-panel { max-height: 600px; opacity: 1; overflow: hidden; transition: max-height 0.5s cubic-bezier(.65,0,.35,1), opacity 0.35s ease, margin 0.5s cubic-bezier(.65,0,.35,1); }
        .fold-panel.is-closed { max-height: 0; opacity: 0; margin-bottom: 0 !important; }
        .stagger-row { animation: rowIn 0.4s cubic-bezier(.22,1,.36,1) backwards; }
        .punch { animation: punch 0.26s cubic-bezier(.34,1.56,.64,1); }
        .tilt-card:hover { z-index: 5; }
        .year-chip { transition: all 0.2s; }
        .ember { position:absolute; bottom:-10px; border-radius:50%; filter: blur(0.5px); animation: ember linear infinite; }
        .tab-slide-enter { animation: tabSlideIn 0.42s cubic-bezier(.22,1,.36,1); }
        @keyframes tabSlideIn { from{opacity:0; transform:translateX(var(--slide-from))} to{opacity:1; transform:translateX(0)} }
        .grain-overlay { opacity: 0.05; mix-blend-mode: overlay; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
        .btn-lift { transition: transform 0.18s cubic-bezier(.22,1,.36,1), filter 0.18s; }
        .btn-lift:hover { transform: translateY(-1px); filter: brightness(1.08); }
        .btn-lift:active { transform: translateY(0px) scale(0.98); }
        @keyframes gaugeBreathe { 0%,100%{opacity:1} 50%{opacity:0.82} }
        .gauge-breathe { animation: gaugeBreathe 3.2s ease-in-out infinite; }
        @keyframes cursorBlink { 0%,45%{opacity:1} 50%,95%{opacity:0} 100%{opacity:1} }
        .typing-cursor { display:inline-block; animation: cursorBlink 0.85s step-end infinite; color: #FF8A50; }
        @media print {
          .no-print, .orb1, .orb2, .grain-overlay, .ember, .icon-pop { display: none !important; }
          body, * { background: white !important; color: #111 !important; box-shadow: none !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }
          .gradient-text { -webkit-text-fill-color: #111 !important; background: none !important; color: #111 !important; text-shadow: none !important; }
          [class*="rounded"] { border: 1px solid #ccc !important; }
          main { padding-top: 0 !important; }
        }
      `}</style>

      {demoMode && (
        <div className="no-print sticky top-0 z-50 flex items-center justify-center gap-2 py-1.5 px-4 text-center" style={{ background: AMBER, color: "#0A0908" }}>
          <EyeOff size={12} />
          <span className="text-[11.5px] font-semibold">{t.demo_mode_actif}</span>
        </div>
      )}
      <Embers count={10} />
      <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
        <div className="orb1 absolute" style={{ top: "-10%", left: "10%", width: 560, height: 420, background: `radial-gradient(ellipse, ${mpAccent.primary}1c, transparent 65%)`, filter: "blur(10px)", transition: "background 0.6s ease" }} />
        <div className="orb2 absolute" style={{ top: "5%", right: "-5%", width: 480, height: 420, background: `radial-gradient(ellipse, ${AMBER}12, transparent 65%)`, filter: "blur(10px)" }} />
      </div>
      <div className="grain-overlay pointer-events-none fixed inset-0 z-0" />

      <header className="no-print sticky top-0 z-20 backdrop-blur-xl" style={{ background: "rgba(10,9,8,0.75)", borderBottom: `1px solid ${PANEL_BORDER}` }}>
        <div className="max-w-[1240px] xl:max-w-[1400px] mx-auto px-5 lg:px-8 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HomyLogo size={24} />
            <div className="hidden sm:flex flex-col leading-none border-l pl-3" style={{ borderColor: PANEL_BORDER }}>
              <span className="text-[9px] uppercase tracking-[0.14em]" style={{ color: FAINT }}>{t.pilotage}</span>
              <div className="flex items-center gap-1.5 mt-0.5"><BesthermLogo size={11} color={MUTED} showMark={false} /><span style={{ color: FAINT, fontSize: 10 }}>×</span><ThomsonLogo size={10} color={MUTED} /></div>
            </div>
          </div>
          <SlidingNav tab={tab} onChange={changeTab} t={t} />
        </div>
      </header>

      <div className="no-print sticky z-[15] backdrop-blur-xl transition-colors duration-300" style={{ top: 57, background: globalMp !== "Toutes" ? `linear-gradient(90deg, ${mpAccent.primary}14, ${mpAccent.soft}0a)` : "rgba(10,9,8,0.55)", borderBottom: `1px solid ${globalMp !== "Toutes" ? mpAccent.soft + "40" : PANEL_BORDER_QUIET}` }}>
        <div className="max-w-[1240px] xl:max-w-[1400px] mx-auto px-5 lg:px-8 py-2 flex flex-col gap-2">
          <div className="flex items-center flex-wrap gap-1.5">
            <CalendarDays size={13} color={FAINT} className="shrink-0" />
            {DATE_PRESETS.map((p) => (
              <button key={p.id} onClick={() => setDatePreset(p.id)} className="btn-lift text-[11px] font-medium px-2.5 py-1 rounded-full shrink-0"
                style={{ background: datePreset === p.id ? `${ORANGE}22` : "transparent", color: datePreset === p.id ? ORANGE_SOFT : MUTED, border: `1px solid ${datePreset === p.id ? ORANGE_SOFT + "55" : "transparent"}` }}>
                {p.id === "mois_courant" ? `${t.preset_mois_courant} (${moisLabels[Number(DMAX.split("-")[1]) - 1]})`
                  : p.id === "mois_precedent" ? `${t.preset_mois_precedent} (${moisLabels[(Number(DMAX.split("-")[1]) - 2 + 12) % 12]})`
                  : (t[`preset_${p.id}`] || p.label)}
              </button>
            ))}
            {datePreset === "personnalise" && (
              <div className="flex items-center gap-1.5 ml-1">
                <input type="date" value={customFrom} min={DMIN} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} className="text-[11.5px] rounded-lg px-2 py-1 font-medium tabular-nums" style={{ background: PANEL, border: `1px solid ${PANEL_BORDER}`, color: INK, colorScheme: "dark" }} />
                <span style={{ color: FAINT }}>→</span>
                <input type="date" value={customTo} min={customFrom} max={DMAX} onChange={(e) => setCustomTo(e.target.value)} className="text-[11.5px] rounded-lg px-2 py-1 font-medium tabular-nums" style={{ background: PANEL, border: `1px solid ${PANEL_BORDER}`, color: INK, colorScheme: "dark" }} />
              </div>
            )}
          </div>

          <div className="flex items-center flex-wrap gap-2.5 pt-2" style={{ borderTop: `1px solid ${PANEL_BORDER_QUIET}` }}>
            {globalMp !== "Toutes" && (
              <span className="text-[9.5px] uppercase tracking-[0.14em] font-bold hidden sm:inline shrink-0 transition-colors duration-300" style={{ color: mpAccent.primary }}>{t.mode_presentation}</span>
            )}
            <div className="relative flex-1 min-w-[160px] max-w-[260px]">
              <select value={globalMp} onChange={(e) => setGlobalMp(e.target.value)}
                className="btn-lift appearance-none w-full text-[12.5px] font-semibold rounded-xl pl-3 pr-8 py-1.5 cursor-pointer transition-colors duration-300"
                style={{ background: globalMp !== "Toutes" ? `${mpAccent.primary}1f` : PANEL, border: `1px solid ${globalMp !== "Toutes" ? mpAccent.primary + "66" : PANEL_BORDER}`, color: globalMp !== "Toutes" ? mpAccent.primary : INK, colorScheme: "dark" }}>
                <option value="Toutes" style={{ background: BG }}>{t.toutes_mp}</option>
                {Object.keys(DATA.gf.monthly_total_by_mp).sort().map((mp) => <option key={mp} value={mp} style={{ background: BG }}>{mp}</option>)}
              </select>
              <ChevronRight size={12} className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rotate-90 transition-colors duration-300" style={{ color: globalMp !== "Toutes" ? mpAccent.primary : FAINT }} />
            </div>
            {globalMp !== "Toutes" && (
              <button onClick={() => setGlobalMp("Toutes")} className="btn-lift text-[11px] flex items-center gap-1 px-2 py-1 rounded-full shrink-0" style={{ color: MUTED, background: PANEL_QUIET }}>
                <X size={11} /> {t.reset}
              </button>
            )}
          </div>
        </div>
      </div>

      <main key={tab} className="relative z-10 max-w-[1240px] xl:max-w-[1400px] mx-auto px-5 lg:px-8 pt-7 pb-24 md:pb-7 tab-slide-enter" style={{ opacity: fading ? 0 : 1, transition: "opacity 0.18s", "--slide-from": `${slideDir * 18}px` }}>

        {tab === "apercu" && (
          <>
            <GlassCard className="p-4 mb-5" glow glowColor="#4A9EFF">
              <button onClick={() => setWeeklyPreviewOpen((o) => !o)} className="w-full flex items-center justify-between gap-2 btn-lift">
                <div className="flex items-center gap-1.5 min-w-0">
                  <CalendarDays size={13} color="#4A9EFF" style={{ flexShrink: 0 }} />
                  <span className="text-[9.5px] uppercase tracking-[0.14em] font-semibold" style={{ color: "#4A9EFF" }}>{t.apercu_semaine_titre}</span>
                  <span className="w-1.5 h-1.5 rounded-full pulse-dot shrink-0" style={{ background: "#4A9EFF" }} />
                  <span className="text-[11px] tabular-nums truncate" style={{ color: FAINT }}>· {isoWeekToRange(latestWeek)}</span>
                </div>
                <ChevronRight size={14} color={FAINT} style={{ flexShrink: 0, transform: weeklyPreviewOpen ? "rotate(90deg)" : "none", transition: "transform 0.3s cubic-bezier(.65,0,.35,1)" }} />
              </button>
              <div className={`fold-panel ${weeklyPreviewOpen ? "" : "is-closed"}`}>
                <div className="pt-3">
                  <PeriodSummaryCard key={`hebdo-${latestWeek}`} items={summaryWeekly} t={t} />
                </div>
                <div className="flex flex-wrap items-end gap-x-6 gap-y-2 mb-3">
                  <div>
                    <div className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: FAINT }}>CA</div>
                    <div className="tabular-nums text-[20px] font-bold" style={{ color: INK }}>{fmtEURk(latestWeekStats.ca)}</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: FAINT }}>{t.qte_mode}</div>
                    <div className="tabular-nums text-[16px] font-semibold" style={{ color: MUTED }}>{fmtNum(latestWeekStats.qte)} u.</div>
                  </div>
                  <div>
                    <div className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: FAINT }}>{t.cp_prix_moyen}</div>
                    <div className="tabular-nums text-[16px] font-semibold" style={{ color: MUTED }}>{latestWeekStats.prixMoyen !== null ? fmtEURplain(latestWeekStats.prixMoyen) : "N/A"}</div>
                  </div>
                  {latestWeekStats.trend !== null && (
                    <div className="text-[12px] font-semibold tabular-nums flex items-center gap-1" style={{ color: latestWeekStats.trend >= 0 ? GREEN : RED }}>
                      {latestWeekStats.trend >= 0 ? "▲" : "▼"} {Math.abs(latestWeekStats.trend).toFixed(0)}% <span className="font-normal" style={{ color: FAINT }}>{t.vs_semaine_prec}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between gap-3 mb-3 pb-3 px-3 py-2 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
                  <div>
                    <div className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: FAINT }}>{t.ca_cumule}</div>
                    <div className="tabular-nums text-[14px] font-bold" style={{ color: INK }}>{fmtEUR(DATA.kpi.ca_total_2026)}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[9px] uppercase tracking-wider mb-0.5" style={{ color: FAINT }}>{t.objectif_2026} {fmtEURk(DATA.kpi.objectif_annuel_total)}</div>
                    <div className="tabular-nums text-[14px] font-bold" style={{ color: DATA.kpi.pct_objectif_atteint >= 40 ? GREEN : AMBER }}>{DATA.kpi.pct_objectif_atteint.toFixed(1)}%</div>
                  </div>
                </div>
                {latestWeekStats.donutSegments.length > 0 && (
                  <div className="flex items-center gap-4 mb-4">
                    <MarketplaceDonut segments={latestWeekStats.donutSegments} size={128} centerValue={fmtEURk(latestWeekStats.ca)} centerLabel={t.repartition_mp_semaine_courte} />
                    <div className="flex-1 min-w-0">
                      {latestWeekStats.donutSegments.map((seg) => (
                        <div key={seg.label} className="flex items-center gap-1.5 mb-1">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: seg.color }} />
                          <span className="text-[10.5px] flex-1 truncate min-w-0" style={{ color: MUTED }}>{seg.label}</span>
                          <span className="tabular-nums text-[10px] font-semibold shrink-0" style={{ color: INK }}>{((seg.value / latestWeekStats.ca) * 100).toFixed(0)}%</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <button onClick={() => changeTab("supply")} className="btn-lift text-[11px] font-semibold flex items-center gap-1" style={{ color: "#4A9EFF" }}>
                  {t.voir_detail_supply} <ChevronRight size={12} />
                </button>
              </div>
            </GlassCard>
            <PeriodSummaryCard key={`apercu-${globalMp}-${datePreset}`} items={summaryApercu} t={t} />
            <div className="flex items-center gap-2 mb-4 px-1 text-[11px]" style={{ color: FAINT }}>
              <CalendarDays size={12} />
              <span className="tabular-nums">{periodStats.from} → {periodStats.to}</span>
              {periodStats.n1 !== null && <span className="tabular-nums">· vs {periodStats.n1From} → {periodStats.n1To}</span>}
            </div>

            <div className="grid grid-cols-2 gap-3 mb-6">
              <TiltCard className="p-5 col-span-2" glow glowColor={mpAccent.primary} scrollReveal>
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <Eyebrow hint={t.ca_cumule_hint}>{globalMp === "Toutes" ? `${t.ca_cumule} — ${t.toutes_marketplaces_suffix}` : `${t.ca_cumule} — ${globalMp}`}</Eyebrow>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full tabular-nums" style={{ background: `${mpAccent.primary}18`, color: mpAccent.primary }}>{dateRangeLabel}</span>
                </div>
                <div className={`gradient-text tabular-nums font-bold leading-none ${caPunch ? "punch" : ""}`} style={{ fontSize: "clamp(38px, 9vw, 58px)", backgroundImage: `linear-gradient(135deg, ${INK}, ${mpAccent.primary} 130%)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", textShadow: `0 2px 24px ${mpAccent.primary}30`, transition: "background-image 0.4s ease" }}>{fmtEUR(caAnimated)}</div>
                <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                  <YoyBadge pct={periodStats.yoy} size="big" lang={lang} />
                  <span className="text-[12px] tabular-nums" style={{ color: FAINT }}>{periodStats.n1 !== null ? `vs ${fmtEURplain(periodStats.n1)} · ${periodStats.n1From} → ${periodStats.n1To}` : t.sum_comparatif_n1_indispo}</span>
                </div>
              </TiltCard>

              <GlassCard className="p-4 flex flex-col items-center justify-center text-center" scrollReveal>
                <MiniRing pct={pctAnimated} color={mpAccent.primary} size={64} />
                <div className="text-[9px] uppercase tracking-wider mt-2" style={{ color: MUTED }}>{t.objectif_2026}</div>
                <div className="text-[9.5px] mt-0.5 leading-tight" style={{ color: FAINT }}>{filteredObjectif ? fmtEURk(filteredObjectif) : t.objectif_non_defini}</div>
              </GlassCard>

              <GlassCard className="p-4 flex flex-col justify-center reveal-d1" scrollReveal>
                <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: MUTED }}>{t.panier_moyen}</div>
                <div className="tabular-nums text-[21px] font-bold leading-none" style={{ letterSpacing: "-0.01em" }}>{filteredPanierMoyen !== null ? fmtEUR(filteredPanierMoyen) : "N/A"}</div>
                <div className="text-[10.5px] mt-1.5" style={{ color: FAINT }}>{fmtNum(filteredQte)} {t.unites_vendues}</div>
              </GlassCard>

              <GlassCard className="p-4 flex flex-col justify-center min-w-0 reveal-d2" scrollReveal>
                <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: MUTED }}>{t.meilleure_vente}</div>
                <div className="tabular-nums text-[15px] font-bold leading-tight truncate">{filteredBestSeller.produit}</div>
                <div className="text-[10.5px] mt-1.5" style={{ color: FAINT }}>{fmtEUR(filteredBestSeller.ca)}</div>
              </GlassCard>

              <GlassCard className="p-4 flex flex-col justify-center reveal-d3" scrollReveal>
                <div className="text-[9px] uppercase tracking-wider mb-1.5" style={{ color: MUTED }}>{t.vs_meilleure_n1}</div>
                <YoyBadge pct={bestVsN1Pct} naLabel={globalMp === "Toutes" ? t.non_comparable : t.indispo_par_mp} lang={lang} />
                <div className="text-[10.5px] mt-1.5" style={{ color: FAINT }}>{globalMp === "Toutes" ? `${fmtEURplain(DATA.best_seller_2025.ca)} ${t.en_2025}` : t.detail_non_conserve}</div>
              </GlassCard>
            </div>
            <div className="flex items-center gap-1.5 mb-5 px-1 text-[10.5px]" style={{ color: FAINT }}>
              <Info size={11} /> Panier moyen et meilleure vente ne suivent pas le filtre de date — pas de détail mensuel disponible pour ces deux indicateurs
            </div>

            <SectionHeader hint={t.repartition_categorie_hint}>{t.repartition_categorie}</SectionHeader>
            <GlassCard className="p-4 mb-6" scrollReveal>
              <div className="space-y-2 mb-1">
                {(DATA.category_by_mp.categories[globalMp] || []).map((c) => {
                  const CatIcon = c.nom === "Sèche-serviettes électrique" ? IconTowelWarmer
                    : c.nom === "Ventilateur de plafond" ? IconFan
                    : c.nom === "Déshumidificateur" ? IconDehumidifier
                    : IconRadiatorPanel;
                  return (
                    <div key={c.nom} className="flex items-center gap-3">
                      <span className="shrink-0 flex items-center justify-center" style={{ width: 20, height: 20 }}><CatIcon style={{ width: 20, height: 20 }} /></span>
                      <span className="text-[12px] shrink truncate" style={{ color: INK, maxWidth: 148 }}>{translateCat(c.nom, lang)}</span>
                      <div className="flex-1 h-5 rounded-lg relative overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                        <div className="h-full rounded-lg" style={{ width: `${c.pct}%`, background: `linear-gradient(90deg, ${ORANGE_SOFT}, ${ORANGE})`, transition: "width 0.7s cubic-bezier(.22,1,.36,1)" }} />
                      </div>
                      <span className="text-[12px] tabular-nums font-semibold w-12 text-right shrink-0" style={{ color: ORANGE_SOFT }}>{c.pct}%</span>
                    </div>
                  );
                })}
                {!(DATA.category_by_mp.categories[globalMp] || []).length && <span className="text-[11px]" style={{ color: FAINT }}>{t.aucune_donnee_mp}</span>}
              </div>
              <button onClick={() => { setTab("prix"); setCatMpFilter(globalMp); }} className="btn-lift text-[11px] font-semibold flex items-center gap-1 mt-2" style={{ color: mpAccent.primary }}>
                {t.voir_detail_prix} <ChevronRight size={12} />
              </button>
            </GlassCard>

            {datePreset === "annee_courante" && (
              <GlassCard className="p-5 mb-6" glow glowColor={estimationAnnuelle.pctObjectifHaut >= 100 ? GREEN : AMBER} scrollReveal>
                <div className="flex items-center gap-1.5 mb-2">
                  <Sparkles size={11} color={mpAccent.primary} />
                  <span className="text-[9.5px] uppercase tracking-[0.16em] font-semibold" style={{ color: mpAccent.primary }}>{t.est_fin_annee} 2026{globalMp !== "Toutes" ? ` — ${globalMp}` : ""}</span>
                </div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="tabular-nums text-[26px] font-bold">{fmtEURk(estimationAnnuelle.bas)}</span>
                  <span className="text-[16px]" style={{ color: FAINT }}>–</span>
                  <span className="tabular-nums text-[26px] font-bold">{fmtEURk(estimationAnnuelle.haut)}</span>
                </div>
                <div className="text-[12px] mt-1.5" style={{ color: MUTED }}>
                  {estimationAnnuelle.objectifRef ? (
                    <>{t.est_soit} <span style={{ color: estimationAnnuelle.pctObjectifBas >= 100 ? GREEN : AMBER }}>{estimationAnnuelle.pctObjectifBas.toFixed(0)}%</span> {t.est_a} <span style={{ color: estimationAnnuelle.pctObjectifHaut >= 100 ? GREEN : AMBER }}>{estimationAnnuelle.pctObjectifHaut.toFixed(0)}%</span> {t.est_de_objectif_annuel} ({fmtEURk(estimationAnnuelle.objectifRef)})</>
                  ) : (
                    <span style={{ color: FAINT }}>{t.objectif_non_defini_mp}</span>
                  )}
                </div>

                <div className="mt-4 pt-4 space-y-1.5" style={{ borderTop: `1px solid ${PANEL_BORDER_QUIET}` }}>
                  {estimationAnnuelle.parMois.map((m) => (
                    <div key={m.mois} className="flex items-center gap-3">
                      <span className="text-[10.5px] w-8 shrink-0" style={{ color: FAINT }}>{m.mois.slice(0,3)}</span>
                      {m.reel !== null ? (
                        <>
                          <div className="flex-1 h-3 rounded-full relative overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                            <div className="h-full rounded-full" style={{ width: `${Math.max(2, (m.reel/estimationAnnuelle.maxMois)*100)}%`, background: mpAccent.primary }} />
                          </div>
                          <span className="tabular-nums text-[11px] font-semibold w-16 text-right shrink-0">{fmtEURk(m.reel)}</span>
                        </>
                      ) : (
                        <>
                          <div className="flex-1 h-3 rounded-full relative overflow-hidden" style={{ background: "rgba(255,255,255,0.04)", border: `1px dashed ${PANEL_BORDER}` }}>
                            <div className="h-full rounded-full opacity-50" style={{ width: `${Math.max(2, (m.haut/estimationAnnuelle.maxMois)*100)}%`, background: AMBER }} />
                          </div>
                          <span className="tabular-nums text-[10px] w-24 sm:w-28 text-right shrink-0 whitespace-nowrap" style={{ color: AMBER }}>{fmtEURk(m.bas)}-{fmtEURk(m.haut)}</span>
                        </>
                      )}
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3 mt-2 text-[10px]" style={{ color: FAINT }}>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: mpAccent.primary }} /> {t.legende_reel}</span>
                  <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: AMBER, opacity: 0.6 }} /> {t.legende_anticipe}</span>
                </div>

                <div className="flex items-center gap-1.5 mt-3 pt-3 text-[10.5px]" style={{ color: FAINT, borderTop: `1px solid ${PANEL_BORDER_QUIET}` }}>
                  <Info size={11} /> CA réel jan-août + fourchette anticipée sept-déc (voir méthode détaillée dans l'onglet Supply) — pas un chiffre unique qui ferait semblant d'être certain.
                </div>
              </GlassCard>
            )}

            <div className="mt-2">
              <SectionHeader hint={`${t.tendance_hint} · clique un point pour comparer les années à ce mois`}>{t.tendance_titre}</SectionHeader>
              <div className="flex items-center gap-2 mb-3 flex-wrap">
                {[2024, 2025, 2026].map((y) => (
                  <button key={y} onClick={() => setVisibleYears((v) => ({ ...v, [y]: !v[y] }))}
                    className="btn-lift flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-full shrink-0"
                    style={{ background: visibleYears[y] ? `${YEAR_COLORS[y]}22` : PANEL_QUIET, border: `1px solid ${visibleYears[y] ? YEAR_COLORS[y] + "66" : PANEL_BORDER_QUIET}`, color: visibleYears[y] ? YEAR_COLORS[y] : FAINT, opacity: visibleYears[y] ? 1 : 0.6 }}>
                    <span className="w-2 h-2 rounded-full" style={{ background: YEAR_COLORS[y] }} /> {y}
                    <span className="tabular-nums text-[10.5px]" style={{ color: visibleYears[y] ? YEAR_COLORS[y] : FAINT }}>{fmtEURk(DATA.monthly_total[y].reduce((a,b)=>a+b,0))}</span>
                  </button>
                ))}
              </div>
              <GlassCard className="p-4" scrollReveal>
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={trendWithForecast} style={{ cursor: "pointer" }}
                    onClick={(e) => { if (e && e.activePayload && e.activePayload.length) setSelectedMonth({ monthIndex: e.activePayload[0].payload.monthIndex }); }}>
                    <defs>
                      {[2024,2025,2026].map((y) => (
                        <linearGradient key={y} id={`fillY${y}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={YEAR_COLORS[y]} stopOpacity={0.35} /><stop offset="100%" stopColor={YEAR_COLORS[y]} stopOpacity={0} /></linearGradient>
                      ))}
                    </defs>
                    <XAxis dataKey="mois" tick={{ fontSize: 10, fill: FAINT }} axisLine={false} tickLine={false} />
                    <YAxis hide domain={[0, maxYearlyMonthWithForecast]} />
                    <Tooltip formatter={(v, n) => [v ? fmtEURplain(v) : "N/A", n === "haut" ? "estimation (fourchette)" : n]} contentStyle={{ background: "#16140F", border: `1px solid ${PANEL_BORDER}`, borderRadius: 10, fontSize: 11 }} labelFormatter={() => ""} />
                    {[2024, 2025, 2026].filter((y) => visibleYears[y]).map((y) => (
                      <Area key={y} type="monotone" dataKey={String(y)} name={String(y)} stroke={YEAR_COLORS[y]} strokeWidth={2.5} fill={`url(#fillY${y})`} dot={{ r: 3, fill: YEAR_COLORS[y], cursor: "pointer" }} activeDot={{ r: 6, cursor: "pointer" }} connectNulls animationDuration={800} />
                    ))}
                    {visibleYears[2026] && (
                      <Area type="monotone" dataKey="haut" name="haut" stroke={YEAR_COLORS[2026]} strokeWidth={1} strokeDasharray="4 3" fill={YEAR_COLORS[2026]} fillOpacity={0.12} connectNulls animationDuration={800} dot={false} activeDot={false} />
                    )}
                    {visibleYears[2026] && (
                      <Area type="monotone" dataKey="bas" name="bas" stroke={YEAR_COLORS[2026]} strokeWidth={1} strokeDasharray="4 3" fill={BG} fillOpacity={1} connectNulls animationDuration={800} dot={false} activeDot={false} />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </GlassCard>
              {visibleYears[2026] && (
                <div className="flex items-center gap-1.5 mt-1.5 text-[10px]" style={{ color: FAINT }}>
                  <span className="inline-block w-3 border-t border-dashed" style={{ borderColor: YEAR_COLORS[2026] }} /> Zone en pointillés = fourchette anticipée sept-déc, pas une donnée réelle
                </div>
              )}

              {monthlyObjectif && (
                <GlassCard className="p-4 mt-3 reveal-d1" quiet scrollReveal>
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: MUTED }}>Objectif du mois — {monthlyObjectif.monthLabel} 2026</span>
                    <span className="text-[10px]" style={{ color: FAINT }}>{t.reparti_saisonnier}</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, monthlyObjectif.pct)}%`, background: monthlyObjectif.pct >= 90 ? GREEN : monthlyObjectif.pct >= 50 ? AMBER : RED }} />
                    </div>
                    <span className="tabular-nums text-[13px] font-bold shrink-0" style={{ color: monthlyObjectif.pct >= 90 ? GREEN : monthlyObjectif.pct >= 50 ? AMBER : RED }}>{monthlyObjectif.pct.toFixed(0)}%</span>
                  </div>
                  <div className="text-[11px] mt-1.5 tabular-nums" style={{ color: FAINT }}>{fmtEURplain(monthlyObjectif.curCa)} réalisés sur {fmtEURplain(monthlyObjectif.target)} visés</div>
                </GlassCard>
              )}

              {selectedMonth && (() => {
                const { monthIndex } = selectedMonth;
                const vals = [2024, 2025, 2026].map((y) => ({ year: y, ca: globalMp === "Toutes" ? DATA.monthly_total[y]?.[monthIndex] : DATA.gf.monthly_total_by_mp[globalMp]?.[y]?.[monthIndex] }));
                return (
                  <GlassCard className="p-4 mt-3 flex items-center justify-between flex-wrap gap-3" glow glowColor={mpAccent.primary}>
                    <span className="text-[12px] font-semibold" style={{ color: MUTED }}>{moisLabels[monthIndex]} — comparatif années</span>
                    <div className="flex items-center gap-4 flex-wrap">
                      {vals.filter((v) => v.ca).map((v) => (
                        <span key={v.year} className="tabular-nums text-[13px] font-semibold" style={{ color: YEAR_COLORS[v.year] }}>{v.year} : {fmtEURplain(v.ca)}</span>
                      ))}
                    </div>
                    <button onClick={() => setSelectedMonth(null)} className="btn-lift" style={{ color: FAINT }}><X size={14} /></button>
                  </GlassCard>
                );
              })()}
            </div>
            <div className="flex items-center gap-2 px-1 py-2 text-[11.5px]" style={{ color: FAINT }}><Info size={12} /> {t.tous_montants_ht}</div>
          </>
        )}

        {tab === "marketplaces" && (
          <>
            <PeriodSummaryCard key={`mp-${globalMp}-${datePreset}`} items={summaryMarketplaces} t={t} />
            {globalMp === "Toutes" ? (
              <>
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-5">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <Eyebrow hint={`${t.ca_ht_total_hint} · ${periodStats.from} → ${periodStats.to}`}>{t.ca_ht_total_titre}</Eyebrow>
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full tabular-nums" style={{ background: `${mpAccent.primary}18`, color: mpAccent.primary }}>{dateRangeLabel}</span>
                    </div>
                    <div className="flex items-baseline gap-3 flex-wrap"><div className="tabular-nums font-bold leading-none" style={{ fontSize: "clamp(32px, 5vw, 48px)" }}>{fmtEUR(totalCaAllMp)}</div><YoyBadge pct={periodStats.yoy} size="big" lang={lang} /></div>
                  </div>
                  {seasonalPace && (
                    <div className="text-[12.5px] px-3 py-2 rounded-xl" style={{ background: PANEL_QUIET, border: `1px solid ${PANEL_BORDER_QUIET}`, color: MUTED }}>
                      <div className="tabular-nums">
                        <span style={{ color: seasonalPace.statut === "avance" ? GREEN : seasonalPace.statut === "retard" ? RED : AMBER }}>
                          {seasonalPace.statut === "avance" ? "▲" : seasonalPace.statut === "retard" ? "▼" : "●"} {seasonalPace.ecart >= 0 ? "+" : ""}{seasonalPace.ecart.toFixed(1)} pt
                        </span>
                        {" "}vs rythme saisonnier
                      </div>
                      <div className="text-[10px] mt-0.5" style={{ color: FAINT }}>{seasonalPace.pctPoidsEcoule.toFixed(1)}% du poids annuel type déjà écoulé</div>
                    </div>
                  )}
                </div>
                <div className="mt-2"><SectionHeader hint={t.top3_hint}>{t.top3}</SectionHeader></div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
                  {top3Mp.map((m, i) => (
                    <TiltCard key={m.marketplace} className={`p-4 ${i === 1 ? "reveal-d1" : i === 2 ? "reveal-d2" : ""}`} glow={i === 0} glowColor={mpAccent.primary} scrollReveal>
                      <div className="flex items-center justify-between mb-2"><span className="text-[13px] font-semibold">{m.marketplace}</span><span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded" style={{ background: `${mpAccent.primary}22`, color: mpAccent.primary }}>#{i+1}</span></div>
                      <div className="tabular-nums text-[22px] font-bold">{fmtEURk(m.ca)}</div>
                      <div className="flex items-center justify-between mt-1.5">
                        {m.objectif_fiable ? <span className="text-[11.5px]" style={{ color: m.pct_objectif > 40 ? GREEN : AMBER }}>{fmtPct(m.pct_objectif).replace('+','')} {t.de_word} {fmtEURk(m.objectif)}</span> : <span className="text-[11px]" style={{ color: FAINT }}>{t.objectif_non_defini}</span>}
                        <YoyBadge pct={m.yoy_pct} naLabel={t.nouveau} lang={lang} />
                      </div>
                    </TiltCard>
                  ))}
                </div>
                <Eyebrow tone="quiet" hint={t.autres_mp_hint}>{t.autres_mp}</Eyebrow>
                <GlassCard className="p-1.5" quiet scrollReveal>
                  {restMp.map((m, i) => {
                    const alerteDeclin = m.yoy_pct !== null && m.yoy_pct < -10;
                    const alerteObjectif = !alerteDeclin && m.objectif_fiable && m.yoy_pct !== null && m.yoy_pct > 100 && m.pct_objectif < 30;
                    const alerte = alerteDeclin || alerteObjectif;
                    const alerteColor = alerteDeclin ? RED : AMBER;
                    return (
                    <StaggerRow key={m.marketplace} index={i} className="flex items-center gap-3 px-3 py-2.5" style={{ borderBottom: i < restMp.length - 1 ? `1px solid ${PANEL_BORDER_QUIET}` : "none", borderLeft: alerte ? `2px solid ${alerteColor}` : "2px solid transparent", paddingLeft: alerte ? "10px" : "12px", background: alerte ? `${alerteColor}0a` : "transparent" }}>
                      <span className="text-[12.5px] w-28 shrink-0 truncate flex items-center gap-1" style={{ color: MUTED }} title={alerteObjectif ? t.forte_croissance_objectif_bas : undefined}>{alerte && <AlertTriangle size={11} color={alerteColor} />}{m.marketplace}</span>
                      <div className="flex-1 h-4 rounded-full relative overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}><div className="h-full rounded-full" style={{ width: `${Math.max(2, (m.ca / maxMpCa) * 100)}%`, background: FAINT, transition: "width 0.6s cubic-bezier(.22,1,.36,1)" }} /></div>
                      <span className="text-[11.5px] tabular-nums w-16 text-right shrink-0" style={{ color: MUTED }}>{fmtEURk(m.ca)}</span>
                      <span className="text-[11px] tabular-nums w-12 text-right shrink-0" style={{ color: m.objectif_fiable ? FAINT : "#4A453E" }}>{m.objectif_fiable ? fmtPct(m.pct_objectif).replace('+','') : t.nd}</span>
                      <span className="w-16 text-right shrink-0"><YoyBadge pct={m.yoy_pct} naLabel={t.nouveau} lang={lang} /></span>
                    </StaggerRow>
                  );})}
                </GlassCard>
              </>
            ) : (
              <>
                <SectionHeader hint={t.vue_detaillee}>{globalMp}</SectionHeader>
                {(() => {
                  const m = DATA.mp_vs_objectif.find((x) => x.marketplace === globalMp);
                  if (!m) return <GlassCard className="p-5" quiet><span className="text-[12px]" style={{ color: FAINT }}>{t.aucune_donnee_mp}</span></GlassCard>;
                  return (
                    <TiltCard className="p-6" glow glowColor={mpAccent.primary} scrollReveal>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-[10px] uppercase tracking-[0.12em] font-semibold" style={{ color: MUTED }}>{t.ca_ht_total_titre}</span>
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full" style={{ background: `${mpAccent.primary}18`, color: mpAccent.primary }}>{dateRangeLabel}</span>
                      </div>
                      <div className="tabular-nums font-bold" style={{ fontSize: "clamp(32px, 5vw, 44px)" }}>{fmtEUR(m.ca)}</div>
                      <div className="flex items-center gap-3 mt-3 flex-wrap">
                        {m.objectif_fiable ? <span className="text-[13px]" style={{ color: m.pct_objectif > 40 ? GREEN : AMBER }}>{fmtPct(m.pct_objectif).replace('+','')} {t.de_word} ({fmtEUR(m.objectif)})</span> : <span className="text-[12px]" style={{ color: FAINT }}>{t.objectif_non_defini}</span>}
                        <YoyBadge pct={m.yoy_pct} naLabel={t.nouveau} size="big" lang={lang} />
                      </div>
                    </TiltCard>
                  );
                })()}
              </>
            )}

            {/* ===== section — International RÉEL (vraie donnée de vente par pays) —
                 ajouté en amont de l'ancienne carte ads, retrait de l'ancienne à suivre
                 une fois celle-ci confirmée stable ===== */}
            <ZoneLabel>{t.zone_international}</ZoneLabel>
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <SectionHeader hint={`${t.repartition_pays_hint} · ${dateRangeLabel} · ${mpLabel}`}>{t.repartition_pays_titre}</SectionHeader>
            </div>
            {internationalData.rows.length === 0 ? (
              <GlassCard className="p-5 text-center mb-6" quiet scrollReveal>
                <span className="text-[12.5px]" style={{ color: FAINT }}>{t.aucune_donnee_pays}</span>
              </GlassCard>
            ) : (
              <GlassCard className="p-4 mb-2" quiet scrollReveal>
                <div className="space-y-2.5">
                  {internationalData.rows.map((c, i) => {
                    const alerte = c.pctObjectif !== null && c.pctObjectif < 20;
                    return (
                    <div key={c.pays} className="flex items-center gap-3">
                      <span className="text-[11.5px] font-medium w-24 shrink-0 truncate flex items-center gap-1" style={{ color: INK }}>{alerte && <AlertTriangle size={10} color={RED} />}{translatePays(c.pays, lang)}</span>
                      <div className="flex-1 h-5 rounded-full relative overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                        <div className="h-full rounded-full transition-all duration-700 flex items-center justify-end pr-2" style={{ width: `${Math.max(3, (c.ca/internationalData.maxCa)*100)}%`, background: `linear-gradient(90deg, ${mpAccent.primary}99, ${mpAccent.primary})` }}>
                          {(c.ca/internationalData.maxCa) > 0.28 && <span className="tabular-nums text-[10.5px] font-semibold" style={{ color: mpAccent.text }}>{fmtEURk(c.ca)}</span>}
                        </div>
                      </div>
                      {(c.ca/internationalData.maxCa) <= 0.28 && <span className="tabular-nums text-[11px] font-semibold w-16 text-right shrink-0" style={{ color: mpAccent.primary }}>{fmtEURk(c.ca)}</span>}
                      <span className="tabular-nums text-[10.5px] w-14 text-right shrink-0 font-semibold" style={{ color: c.pctObjectif === null ? FAINT : alerte ? RED : c.pctObjectif >= 40 ? GREEN : AMBER }}>{c.pctObjectif !== null ? `${c.pctObjectif.toFixed(0)}% obj.` : "N/A"}</span>
                    </div>
                  );})}
                </div>
              </GlassCard>
            )}
            <div className="flex items-center gap-1.5 mb-6 px-1 text-[10.5px]" style={{ color: FAINT }}>
              <Info size={11} /> {internationalData.nbPays} pays sur cette sélection · {fmtEUR(internationalData.totalCa)} au total · % = part de l'objectif annuel du pays déjà atteinte
            </div>

            {globalMp === "Toutes" && (
              <>
                <ZoneLabel>{t.pub_par_pays}</ZoneLabel>
                <Eyebrow tone="quiet" hint={t.pub_par_pays_hint}>{t.detail_pays} ({t.depense_ads})</Eyebrow>
                <GlassCard className="p-1.5" quiet scrollReveal>
                  {DATA.country_ads.map((c, i) => (
                    <div key={c.pays} className="flex items-center gap-3 px-3 py-2" style={{ borderBottom: i < DATA.country_ads.length - 1 ? `1px solid ${PANEL_BORDER_QUIET}` : "none" }}>
                      <span className="text-[12px] w-32 shrink-0" style={{ color: INK }}>{translatePays(c.pays, lang)}</span>
                      <span className="text-[11px] tabular-nums w-20 text-right shrink-0" style={{ color: MUTED }}>{fmtEURplain(c.spend)}</span>
                      <span className="text-[11px] tabular-nums w-20 text-right shrink-0" style={{ color: ORANGE_SOFT }}>{fmtEURplain(c.ca)}</span>
                      <span className="text-[10.5px] tabular-nums w-14 text-right shrink-0 font-semibold" style={{ color: c.roas > 8 ? GREEN : c.roas > 3 ? AMBER : c.roas ? RED : FAINT }}>{c.roas ? `${c.roas}x` : "N/A"}</span>
                    </div>
                  ))}
                </GlassCard>
              </>
            )}
          </>
        )}

        {tab === "marques" && (
          <>
            <PeriodSummaryCard key={`marques-${globalMp}-${datePreset}`} items={summaryMarques} t={t} />

            <div className="flex items-center gap-1.5 mb-6 rounded-full p-1 w-fit flex-wrap" style={{ background: PANEL_QUIET, border: `1px solid ${PANEL_BORDER_QUIET}` }}>
              {[
                { id: "marque", label: t.zone_marque }, { id: "produits", label: t.zone_produits_titre },
                { id: "radar", label: t.subnav_produit_ideal }, { id: "classification", label: t.subnav_normes_cat },
                { id: "puissances", label: t.zone_puissances },
              ].map((s) => (
                <button key={s.id} onClick={() => setMarquesTab(s.id)} className="btn-lift text-[12px] font-semibold px-3.5 py-1.5 rounded-full whitespace-nowrap"
                  style={{ background: marquesTab === s.id ? mpAccent.primary : "transparent", color: marquesTab === s.id ? mpAccent.text : MUTED }}>
                  {s.label}
                </button>
              ))}
            </div>

            {marquesTab === "marque" && (
            <>
            <ZoneLabel first>{t.zone_marque}</ZoneLabel>
            <div className="mb-5 card-reveal">
              <div className="flex items-center gap-3 mb-2"><BesthermLogo size={16} color={INK} /><span style={{ color: FAINT }}>×</span><ThomsonLogo size={14} /><span style={{ color: FAINT }}>×</span><HomyLogo size={16} color={HOMY_COLOR} /></div>
              <Eyebrow hint={`${t.repartition_marque_hint} · ${dateRangeLabel} (${periodStats.from} → ${periodStats.to})`}>{globalMp === "Toutes" ? `${t.repartition_marque} — ${t.toutes_marketplaces_suffix}` : `${t.repartition_marque} — ${globalMp}`}</Eyebrow>
              <div className="flex items-baseline gap-3 flex-wrap">
                <span className="tabular-nums font-bold" style={{ fontSize: "clamp(32px, 5vw, 48px)", color: ORANGE_SOFT }}>{bestPct.toFixed(0)}%</span>
                <span className="text-[14px]" style={{ color: MUTED }}>Bestherm · {thomsonPct.toFixed(0)}% Thomson · {homyPct.toFixed(0)}% HOM'Y</span>
                <YoyBadge pct={besthermYoy} naLabel={globalMp === "Toutes" ? t.non_comparable : t.indispo_par_mp} lang={lang} /><span className="text-[11px]" style={{ color: FAINT }}>{t.bestherm_vs_n1}</span>
              </div>
              <div className="h-2.5 rounded-full overflow-hidden flex mt-3 max-w-md"><div style={{ width: `${bestPct}%`, background: `linear-gradient(90deg, ${ORANGE_SOFT}, ${ORANGE})`, transition: "width 0.8s cubic-bezier(.22,1,.36,1)" }} /><div style={{ width: `${thomsonPct}%`, background: THOMSON_RED, transition: "width 0.8s cubic-bezier(.22,1,.36,1)" }} /><div style={{ width: `${homyPct}%`, background: HOMY_COLOR, transition: "width 0.8s cubic-bezier(.22,1,.36,1)" }} /></div>
              {globalMp === "Toutes" && <div className="flex items-center gap-1.5 mt-2 text-[11px]" style={{ color: FAINT }}><Info size={11} /> {t.thomson_hint}</div>}
            </div>

            <GlassCard className="p-5 mb-5" quiet scrollReveal>
              <div className="flex items-center justify-between mb-1">
                <Eyebrow tone="quiet" hint={t.ca_mensuel_marque_hint}>{t.ca_mensuel_marque}</Eyebrow>
                <div className="flex gap-3 text-[11px]" style={{ color: MUTED }}><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: ORANGE }} /> Bestherm</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: THOMSON_RED }} /> Thomson</span><span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: HOMY_COLOR }} /> HOM'Y</span></div>
              </div>
              <ResponsiveContainer width="100%" height={170}>
                <BarChart data={brandTrend}>
                  <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                  <XAxis dataKey="mois" tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: MUTED }} axisLine={false} tickLine={false} tickFormatter={fmtEURk} width={46} />
                  <Tooltip formatter={(v) => fmtEURplain(v)} contentStyle={{ background: "#16140F", border: `1px solid ${PANEL_BORDER}`, borderRadius: 10, fontSize: 12 }} />
                  <Bar dataKey="Bestherm" stackId="a" fill={ORANGE} /><Bar dataKey="Thomson" stackId="a" fill={THOMSON_RED} /><Bar dataKey="HOM'Y" stackId="a" fill={HOMY_COLOR} radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-1.5 mt-2 text-[11px]" style={{ color: FAINT }}><Info size={11} /> {t.marque_reconstituee} {DATA.brand_coverage_pct["2026"]}%</div>
            </GlassCard>
            </>
            )}

            {marquesTab === "produits" && (
            <>
            <div>
              <ZoneLabel first>{t.zone_produits_titre}</ZoneLabel>
            </div>

            <SectionHeader hint={t.tous_produits_hint}>{t.tous_produits_titre}</SectionHeader>
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <div className="flex items-center gap-2 flex-1 min-w-[160px] px-2.5 py-1.5 rounded-lg" style={{ background: PANEL_QUIET, border: `1px solid ${PANEL_BORDER_QUIET}` }}>
                <Search size={12} color={FAINT} />
                <input type="text" value={apSearch} onChange={(e) => setApSearch(e.target.value)} placeholder={t.rechercher_produit}
                  className="flex-1 text-[12px] outline-none bg-transparent" style={{ color: INK }} />
              </div>
              <div className="flex gap-1.5 rounded-full p-0.5" style={{ background: "rgba(255,255,255,0.03)" }}>
                {[{ id: "ca", label: "CA" }, { id: "qte", label: t.qte_mode }, { id: "produit", label: t.produit_col }].map((s) => (
                  <button key={s.id} onClick={() => setApSort(s.id)} className="text-[11px] font-medium px-3 py-1 rounded-full"
                    style={{ background: apSort === s.id ? mpAccent.primary : "transparent", color: apSort === s.id ? mpAccent.text : FAINT }}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <GlassCard className="p-1.5 mb-2" scrollReveal>
              <div style={{ maxHeight: 520, overflowY: "auto" }}>
                {allProductsYTDFiltered.map((p, pi) => {
                  const isOpen = apExpanded.has(p.produit);
                  const toggle = () => setApExpanded((prev) => { const next = new Set(prev); next.has(p.produit) ? next.delete(p.produit) : next.add(p.produit); return next; });
                  const priceInfo = productPriceStats[p.produit];
                  const lifeInfo = lifecycleByProduct[p.produit];
                  const basketInfo = basketByProduct[p.produit];
                  return (
                    <div key={p.produit} style={{ borderBottom: pi < allProductsYTDFiltered.length - 1 ? `1px solid ${PANEL_BORDER_QUIET}` : "none" }}>
                      <button onClick={toggle} className="w-full flex flex-col text-left btn-lift px-3 py-2">
                        <div className="flex items-center gap-3">
                          <ChevronRight size={11} color={FAINT} style={{ transform: isOpen ? "rotate(90deg)" : "none", transition: "transform 0.2s", flexShrink: 0 }} />
                          <span className="text-[11.5px] flex-1 truncate min-w-0" style={{ color: INK }}>{p.produit}</span>
                          <span className="tabular-nums text-[11.5px] font-semibold w-20 text-right shrink-0" style={{ color: mpAccent.primary }}>{fmtEURk(p.ca)}</span>
                          <span className="tabular-nums text-[10.5px] w-16 text-right shrink-0" style={{ color: FAINT }}>{fmtNum(p.qte)} u.</span>
                        </div>
                        {(p.destockage || p.catalogue || topFlopBadges[p.produit]) && (
                          <div className="pl-[23px] mt-1 flex items-center gap-1.5">
                            {topFlopBadges[p.produit] === "top" && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: `${GREEN}18`, color: GREEN }}>🔝 {t.ap_top_badge}</span>}
                            {topFlopBadges[p.produit] === "flop" && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: `${RED}18`, color: RED }}>🔻 {t.ap_flop_badge}</span>}
                            {p.destockage && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: `${AMBER}18`, color: AMBER }}>{t.ap_destockage_badge}</span>}
                            {p.catalogue && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: "rgba(255,255,255,0.06)", color: FAINT }}>{p.marqueCatalogue} · {t.ap_catalogue_badge}</span>}
                          </div>
                        )}
                      </button>
                      {isOpen && (
                        <div className="px-3 pb-3 pl-7 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                          <div className="p-2.5 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
                            <div className="text-[9px] uppercase tracking-wider mb-1.5 font-semibold" style={{ color: ORANGE_SOFT }}>{t.pd_fiche_titre}</div>
                            {PRODUCT_CATALOG[p.produit] ? (
                              <div className="flex items-center gap-2.5">
                                <img src={PRODUCT_CATALOG[p.produit].image} alt="" className="w-11 h-11 rounded-lg object-cover shrink-0" style={{ background: "rgba(255,255,255,0.05)" }} />
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1 mb-0.5">
                                    {PRODUCT_CATALOG[p.produit].couleur && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: PRODUCT_CATALOG[p.produit].couleur, border: "1px solid rgba(255,255,255,0.25)" }} />}
                                    <span className="text-[10px] truncate" style={{ color: MUTED }}>{PRODUCT_CATALOG[p.produit].matiere}{PRODUCT_CATALOG[p.produit].garantie ? ` · ${PRODUCT_CATALOG[p.produit].garantie} ${t.pd_garantie_ans}` : ""}</span>
                                  </div>
                                  <div className="flex items-center gap-1 flex-wrap">
                                    {PRODUCT_CATALOG[p.produit].madeInFrance && <span className="text-[8.5px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: `${GREEN}18`, color: GREEN }}>{t.pd_made_in_france}</span>}
                                    {PRODUCT_CATALOG[p.produit].connecte && <span className="text-[8.5px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: `#4A9EFF18`, color: "#4A9EFF" }}>{t.pd_connecte_wifi}</span>}
                                  </div>
                                </div>
                              </div>
                            ) : <div className="text-[10px]" style={{ color: FAINT }}>{t.pd_fiche_non_dispo}</div>}
                          </div>
                          <div className="p-2.5 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
                            <div className="text-[9px] uppercase tracking-wider mb-1.5 font-semibold" style={{ color: ORANGE_SOFT }}>{t.pd_prix_titre}</div>
                            {priceInfo ? (
                              <>
                                <div className="text-[11px]"><span style={{ color: GREEN }}>{fmtEURplain(priceInfo.min.avgPrice)}</span> <span style={{ color: FAINT }}>→</span> <span style={{ color: RED }}>{fmtEURplain(priceInfo.max.avgPrice)}</span></div>
                                <div className="text-[10px] mt-0.5" style={{ color: FAINT }}>{t.cp_prix_moyen} {fmtEURplain(priceInfo.avg)}</div>
                              </>
                            ) : <div className="text-[10px]" style={{ color: FAINT }}>{t.pd_prix_non_dispo}</div>}
                          </div>
                          <div className="p-2.5 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
                            <div className="text-[9px] uppercase tracking-wider mb-1.5 font-semibold" style={{ color: ORANGE_SOFT }}>{t.pd_cycle_titre}</div>
                            {lifeInfo ? (
                              <span className="text-[10.5px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: `${lifeInfo.stage === "croissance" ? GREEN : lifeInfo.stage === "declin" ? RED : lifeInfo.stage === "lancement" ? "#4A9EFF" : AMBER}18`, color: lifeInfo.stage === "croissance" ? GREEN : lifeInfo.stage === "declin" ? RED : lifeInfo.stage === "lancement" ? "#4A9EFF" : AMBER }}>
                                {lifeInfo.stage === "croissance" ? t.lifecycle_croissance_lbl : lifeInfo.stage === "declin" ? t.lifecycle_declin_lbl : lifeInfo.stage === "lancement" ? t.lifecycle_lancement_lbl : t.lifecycle_mature_lbl}
                                {lifeInfo.variation !== null && ` ${lifeInfo.variation >= 0 ? "+" : ""}${lifeInfo.variation.toFixed(0)}%`}
                              </span>
                            ) : <div className="text-[10px]" style={{ color: FAINT }}>—</div>}
                          </div>
                          <div className="p-2.5 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
                            <div className="text-[9px] uppercase tracking-wider mb-1.5 font-semibold" style={{ color: ORANGE_SOFT }}>{t.pd_panier_titre}</div>
                            {basketInfo && basketInfo.length ? basketInfo.slice(0, 2).map((b) => (
                              <div key={b.partner} className="text-[10.5px] truncate" style={{ color: MUTED }}>{b.partner} <span style={{ color: FAINT }}>({b.n}x)</span></div>
                            )) : <div className="text-[10px]" style={{ color: FAINT }}>{t.pd_panier_non_dispo}</div>}
                          </div>
                          <div className="p-3 rounded-xl sm:col-span-2 lg:col-span-4" style={{ background: "rgba(255,255,255,0.03)" }}>
                            <div className="text-[9px] uppercase tracking-wider mb-2 font-semibold" style={{ color: ORANGE_SOFT }}>{t.pd_courbe_titre}</div>
                            {(() => {
                              const m = monthlyCaByProduct[p.produit];
                              if (!m) return <div className="text-[10px]" style={{ color: FAINT }}>{t.pd_prix_non_dispo}</div>;
                              const chartData = DATA.mois_labels.map((mois, i) => ({ mois, "2025": Math.round(m[2025][i]), "2026": Math.round(m[2026][i]) || null }));
                              return (
                                <ResponsiveContainer width="100%" height={140}>
                                  <AreaChart data={chartData} margin={{ top: 5, right: 8, bottom: 4, left: 0 }}>
                                    <defs>
                                      <linearGradient id={`grad2026-${p.produit}`} x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="0%" stopColor={mpAccent.primary} stopOpacity={0.35} />
                                        <stop offset="100%" stopColor={mpAccent.primary} stopOpacity={0} />
                                      </linearGradient>
                                    </defs>
                                    <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
                                    <XAxis dataKey="mois" tick={{ fontSize: 9, fill: MUTED }} axisLine={false} tickLine={false} />
                                    <YAxis tick={{ fontSize: 9, fill: MUTED }} axisLine={false} tickLine={false} width={38} tickFormatter={(v) => fmtEURk(v)} />
                                    <Tooltip contentStyle={{ background: "#16140F", border: `1px solid ${PANEL_BORDER}`, borderRadius: 8, fontSize: 11 }} formatter={(v) => fmtEURplain(v)} />
                                    <Area type="monotone" dataKey="2025" stroke={FAINT} strokeWidth={1.5} fill="none" strokeDasharray="3 3" dot={false} />
                                    <Area type="monotone" dataKey="2026" stroke={mpAccent.primary} strokeWidth={2} fill={`url(#grad2026-${p.produit})`} dot={false} />
                                  </AreaChart>
                                </ResponsiveContainer>
                              );
                            })()}
                          </div>
                          <div className="p-3 rounded-xl sm:col-span-2 lg:col-span-4" style={{ background: "rgba(255,255,255,0.03)" }}>
                            <div className="text-[9px] uppercase tracking-wider mb-2 font-semibold" style={{ color: ORANGE_SOFT }}>{t.pd_repartition_titre}</div>
                            {priceInfo && priceInfo.allMp.length > 0 ? (() => {
                              const sorted = [...priceInfo.allMp].filter((m) => m.ca > 0).sort((a, b) => b.ca - a.ca);
                              const top7 = sorted.slice(0, 7);
                              const reste = sorted.slice(7);
                              const autresCa = reste.reduce((s, m) => s + m.ca, 0);
                              const autresQty = reste.reduce((s, m) => s + m.qty, 0);
                              const autresCa25 = reste.reduce((s, m) => s + (m.ca25 || 0), 0);
                              const autresYoy = autresCa25 > 0 ? ((autresCa - autresCa25) / autresCa25) * 100 : null;
                              const segments = [
                                ...top7.map((m) => ({ label: m.mp, value: m.ca, qty: m.qty, yoyPct: m.yoyPct, color: (MARKETPLACE_COLORS[m.mp] && MARKETPLACE_COLORS[m.mp].primary) || FAINT })),
                                ...(autresCa > 0 ? [{ label: t.autres_lbl, value: autresCa, qty: autresQty, yoyPct: autresYoy, color: FAINT }] : []),
                              ];
                              const total = segments.reduce((s, seg) => s + seg.value, 0);
                              return (
                                <div className="flex flex-wrap items-start gap-4">
                                  <MarketplaceDonut segments={segments} size={110} centerValue={fmtEURk(total)} centerLabel="CA" />
                                  <div className="w-full max-w-sm">
                                    {segments.map((seg) => (
                                      <div key={seg.label} className="flex items-center gap-1.5 mb-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: seg.color }} />
                                        <span className="text-[10.5px] truncate min-w-0" style={{ color: MUTED, width: 96 }}>{seg.label}</span>
                                        <span className="tabular-nums text-[10px] font-semibold shrink-0 ml-auto" style={{ color: INK }}>{fmtEURk(seg.value)}</span>
                                        <span className="tabular-nums text-[9.5px] shrink-0 w-14 text-right" style={{ color: FAINT }}>{fmtNum(seg.qty)} u.</span>
                                        <span className="tabular-nums text-[9px] font-semibold shrink-0 w-10 text-right" style={{ color: seg.yoyPct === null || seg.yoyPct === undefined ? FAINT : (seg.yoyPct >= 0 ? GREEN : RED) }}>
                                          {seg.yoyPct === null || seg.yoyPct === undefined ? "—" : `${seg.yoyPct >= 0 ? "+" : ""}${seg.yoyPct.toFixed(0)}%`}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })() : <div className="text-[10px]" style={{ color: FAINT }}>{t.pd_prix_non_dispo}</div>}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </GlassCard>
            <div className="flex items-center gap-1.5 mb-6 text-[10.5px]" style={{ color: FAINT }}>
              <Info size={11} /> {allProductsYTDFiltered.length} {allProductsYTDFiltered.length > 1 ? t.resultats : t.resultat} · {mpLabel} · {t.sum_annee_complete}
            </div>

            <SectionHeader hint={t.cycle_vie_hint}>{t.cycle_vie_titre}</SectionHeader>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              {[
                { key: "lancement", label: t.lifecycle_lancement_lbl, color: "#4A9EFF", desc: t.lifecycle_lancement_desc },
                { key: "croissance", label: t.lifecycle_croissance_lbl, color: GREEN, desc: t.lifecycle_croissance_desc },
                { key: "mature", label: t.lifecycle_mature_lbl, color: AMBER, desc: t.lifecycle_mature_desc },
                { key: "declin", label: t.lifecycle_declin_lbl, color: RED, desc: t.lifecycle_declin_desc },
              ].map(({ key, label, color, desc }) => {
                const items = lifecycleData[key] || [];
                return (
                  <GlassCard key={key} className="p-4" quiet scrollReveal>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className="w-2 h-2 rounded-full" style={{ background: color }} />
                      <span className="text-[12px] font-semibold">{label}</span>
                    </div>
                    <div className="tabular-nums text-[22px] font-bold" style={{ color }}>{items.length}</div>
                    <div className="text-[10px] mb-2" style={{ color: FAINT }}>{desc}</div>
                    {items.slice(0, 3).map((it) => (
                      <div key={it.produit} className="text-[10.5px] truncate flex items-center justify-between gap-1" style={{ color: MUTED }}>
                        <span className="truncate">{it.produit}</span>
                        {it.variation !== null && <span className="shrink-0 tabular-nums" style={{ color }}>{it.variation >= 0 ? "+" : ""}{it.variation.toFixed(0)}%</span>}
                      </div>
                    ))}
                  </GlassCard>
                );
              })}
            </div>

            <div className="mt-9">
              <SectionHeader hint={t.top_produits_hint}>{t.top_produits}</SectionHeader>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              {top3Prod.map((p, i) => (
                <TiltCard key={p.produit} className={`p-4 ${i === 1 ? "reveal-d1" : i >= 2 ? "reveal-d2" : ""}`} glow={i === 0} glowColor={mpAccent.primary} scrollReveal>
                  <div className="flex items-center justify-between mb-2"><span className="text-[12.5px] font-semibold truncate">{p.produit}</span><span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded shrink-0 ml-1" style={{ background: `${mpAccent.primary}22`, color: mpAccent.primary }}>#{i+1}</span></div>
                  <div className="tabular-nums text-[20px] font-bold">{fmtEURk(p.ca)}</div>
                  <div className="flex items-center justify-between mt-1.5"><span className="text-[11.5px]" style={{ color: MUTED }}>{p.qte !== null ? `${fmtNum(p.qte)} ${t.unites_vendues}` : t.qte_nd_mp}</span><YoyBadge pct={p.yoy_pct} naLabel={t.nd} lang={lang} /></div>
                </TiltCard>
              ))}
            </div>
            <Eyebrow tone="quiet" hint={t.reste_top15_hint}>{t.reste_top15}</Eyebrow>
            <GlassCard className="p-1.5 mb-5" quiet scrollReveal>
              {restProd.map((p, i) => (
                <StaggerRow key={p.produit} index={i} className="flex items-center gap-3 px-3 py-2.5" style={{ borderBottom: i < restProd.length - 1 ? `1px solid ${PANEL_BORDER_QUIET}` : "none" }}>
                  <span className="text-[12px] w-40 shrink-0 truncate" style={{ color: MUTED }}>{p.produit}</span>
                  <div className="flex-1 h-4 rounded-full relative overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}><div className="h-full rounded-full" style={{ width: `${Math.max(2, (p.ca / maxProdCa) * 100)}%`, background: FAINT, transition: "width 0.6s cubic-bezier(.22,1,.36,1)" }} /></div>
                  <span className="text-[11.5px] tabular-nums w-14 text-right shrink-0" style={{ color: MUTED }}>{fmtEURk(p.ca)}</span>
                  <span className="text-[11px] tabular-nums w-16 text-right shrink-0" style={{ color: FAINT }}>{p.qte !== null ? `${fmtNum(p.qte)} u.` : t.nd}</span>
                  <span className="w-16 text-right shrink-0"><YoyBadge pct={p.yoy_pct} naLabel={t.nouveau} lang={lang} /></span>
                </StaggerRow>
              ))}
            </GlassCard>

            <Eyebrow tone="quiet" hint={t.ca_mois_top6_hint}>{t.ca_mois_top6}</Eyebrow>
            <GlassCard className="p-4 overflow-x-auto" scrollReveal>
              <div style={{ minWidth: 560 }}>
                <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: "140px repeat(12, 1fr)" }}>
                  <span></span>
                  {moisLabels.map((m) => <span key={m} className="text-[9.5px] text-center" style={{ color: FAINT }}>{m}</span>)}
                </div>
                {Object.entries(DATA.products_monthly_top6).map(([name, d], ri) => (
                  <StaggerRow key={name} index={ri} className="grid gap-1 mb-1 items-center" style={{ gridTemplateColumns: "140px repeat(12, 1fr)" }}>
                    <span className="text-[11px] truncate pr-2" style={{ color: MUTED }}>{name}</span>
                    {d.ca.map((v, i) => {
                      const intensity = v / heatmapMax;
                      return (
                        <div key={i} className="h-6 rounded flex items-center justify-center" style={{ background: v > 0 ? `rgba(255,90,31,${0.12 + intensity * 0.75})` : "rgba(255,255,255,0.02)", transition: "background 0.3s" }}>
                          {v > 0 && <span className="text-[8.5px] tabular-nums" style={{ color: intensity > 0.4 ? "#0A0908" : MUTED }}>{v >= 1000 ? `${Math.round(v/1000)}k` : v}</span>}
                        </div>
                      );
                    })}
                  </StaggerRow>
                ))}
              </div>
            </GlassCard>

            <SectionHeader hint={t.panier_hint}>{t.panier_titre}</SectionHeader>
            {basketCroises.length > 0 && (
              <>
                <Eyebrow tone="quiet" hint={t.panier_croise_hint}>{t.panier_croise_titre}</Eyebrow>
                <GlassCard className="p-1.5 mb-4" scrollReveal>
                  {basketCroises.map((p, i) => (
                    <div key={`${p.a}-${p.b}`} className="flex items-center gap-3 px-3 py-2" style={{ borderBottom: i < basketCroises.length - 1 ? `1px solid ${PANEL_BORDER_QUIET}` : "none" }}>
                      <span className="text-[11.5px] flex-1 truncate" style={{ color: MUTED }}>{p.a} <span style={{ color: FAINT }}>+</span> {p.b}</span>
                      <span className="tabular-nums text-[11px] font-semibold shrink-0" style={{ color: mpAccent.primary }}>{p.n}x</span>
                    </div>
                  ))}
                </GlassCard>
              </>
            )}
            <Eyebrow tone="quiet" hint={t.panier_toutes_hint}>{t.panier_toutes_titre}</Eyebrow>
            <GlassCard className="p-1.5 mb-3" scrollReveal>
              {basketTop.map((p, i) => (
                <div key={`${p.a}-${p.b}`} className="flex items-center gap-3 px-3 py-2" style={{ borderBottom: i < basketTop.length - 1 ? `1px solid ${PANEL_BORDER_QUIET}` : "none" }}>
                  <span className="text-[11.5px] flex-1 truncate" style={{ color: MUTED }}>{p.a} <span style={{ color: FAINT }}>+</span> {p.b}</span>
                  <span className="tabular-nums text-[11px] font-semibold shrink-0" style={{ color: FAINT }}>{p.n}x</span>
                </div>
              ))}
            </GlassCard>
            <div className="flex items-center gap-1.5 mb-6 text-[10.5px]" style={{ color: FAINT }}>
              <Info size={11} /> Donnée globale (2025+2026), pas encore filtrable par marketplace ou période — les paires viennent des numéros de commande réels.
            </div>
            </>
            )}

            {marquesTab === "classification" && (
            <>
            {/* ===== section — Normes NF / CE ===== */}
            <div>
              <ZoneLabel first>{t.zone_normes}</ZoneLabel>
              <SectionHeader hint={`${t.repartition_norme_hint} · ${dateRangeLabel} (${periodStats.from} → ${periodStats.to})`}>{t.repartition_norme}</SectionHeader>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              <GlassCard className="p-4" glow glowColor={mpAccent.primary} scrollReveal>
                <Eyebrow>NF — {dateRangeLabel}</Eyebrow>
                <div className="tabular-nums font-bold" style={{ fontSize: "clamp(26px, 4vw, 34px)" }}>{normesTotal.nfPct.toFixed(0)}%</div>
              </GlassCard>
              <GlassCard className="p-4 reveal-d1" glow glowColor={mpAccent.primary} scrollReveal>
                <Eyebrow>CE — {dateRangeLabel}</Eyebrow>
                <div className="tabular-nums font-bold" style={{ fontSize: "clamp(26px, 4vw, 34px)", color: mpAccent.primary }}>{normesTotal.cePct.toFixed(0)}%</div>
              </GlassCard>
            </div>
            <GlassCard className="p-4 mb-4" scrollReveal>
              <Eyebrow tone="quiet" hint={t.evolution_mensuelle_hint}>{t.evolution_mensuelle}</Eyebrow>
              <div className="space-y-1.5">
                {normesTrend.map((m, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-[10.5px] w-8 shrink-0" style={{ color: FAINT }}>{m.mois}</span>
                    <div className="flex-1 h-4 rounded-full overflow-hidden flex" style={{ background: "rgba(255,255,255,0.04)" }}>
                      {m.nfPct !== null ? (
                        <>
                          <div style={{ width: `${m.nfPct}%`, background: ORANGE, transition: "width 0.6s cubic-bezier(.22,1,.36,1)" }} />
                          <div style={{ width: `${m.cePct}%`, background: AMBER, transition: "width 0.6s cubic-bezier(.22,1,.36,1)" }} />
                        </>
                      ) : null}
                    </div>
                    <span className="text-[10px] tabular-nums w-16 text-right shrink-0" style={{ color: FAINT }}>{m.nfPct !== null ? `NF ${m.nfPct}%` : "N/A"}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-3 mt-2 text-[11px]" style={{ color: MUTED }}>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: ORANGE }} /> NF</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full" style={{ background: AMBER }} /> CE</span>
              </div>
            </GlassCard>
            </>
            )}

            {marquesTab === "radar" && radarProfiles && (
              <>
                <ZoneLabel first>Produit idéal — {globalMp}</ZoneLabel>
                <div className="flex items-center gap-1.5 mb-4 text-[10.5px]" style={{ color: FAINT }}>
                  <Info size={11} /> Profil pondéré par le CA réel des références vendues sur cette marketplace (déstockage exclu du profil) — pas une invention, un reflet de ce qui se vend vraiment.
                </div>
                <div className="grid grid-cols-1 gap-5 mb-3">
                  {[
                    { key: "radiateur", titre: t.radar_radiateurs, axes: [[t.axe_ceramique,"ceramique"],[t.axe_fonte,"fonte"],[t.axe_film,"film"],[t.axe_wifi,"wifi"],[t.axe_vertical,"vertical"],[t.axe_plinthe,"plinthe"]] },
                    { key: "secheServiette", titre: t.radar_secheserviettes, axes: [[t.axe_soufflerie,"soufflerie"],[t.axe_wifi,"wifi"]] },
                  ].map(({ key, titre, axes }) => {
                    const p = radarProfiles[key];
                    if (!p) return (
                      <GlassCard key={key} className="p-5" quiet scrollReveal>
                        <Eyebrow tone="quiet">{titre}</Eyebrow>
                        <div className="text-[12px] mt-2" style={{ color: FAINT }}>Aucune vente identifiée sur cette famille pour {globalMp}.</div>
                      </GlassCard>
                    );
                    if (!p.fiable) return (
                      <GlassCard key={key} className="p-5" quiet scrollReveal>
                        <Eyebrow tone="quiet">{titre}</Eyebrow>
                        <div className="flex items-center gap-1.5 mt-2 text-[12px]" style={{ color: AMBER }}>
                          <AlertTriangle size={13} /> {t.radar_fiabilite_insuffisante} ({p.nbRef} {p.nbRef > 1 ? t.resultats : t.resultat}, minimum {RADAR_MIN_REF})
                        </div>
                      </GlassCard>
                    );
                    const distances = key === "radiateur" ? radarDistancesRadiateur : radarDistancesSecheServiette;
                    const radarData = axes.map(([label, k]) => ({ axe: label, valeur: Math.round(p[k]) }));
                    // échelle dynamique : le max de CE radar précis + marge, pour que la
                    // forme remplisse vraiment le graphique au lieu de rester minuscule au
                    // centre quand les valeurs sont naturellement petites (ex. vertical 3%)
                    const maxVal = Math.max(...radarData.map((d) => d.valeur), 1);
                    const domainMax = Math.max(20, Math.ceil(maxVal * 1.15 / 10) * 10);
                    return (
                      <GlassCard key={key} className="p-5 sm:p-6" scrollReveal>
                        <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                          <Eyebrow hint={`Pondéré CA · ${p.nbRef} référence(s) · ${fmtEUR(p.totalCa)} de CA cumulé · échelle 0-${domainMax}%`}>{titre}</Eyebrow>
                          {p.puissanceDominante && <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full" style={{ background: `${mpAccent.primary}18`, color: mpAccent.primary }}>{p.puissanceDominante} dominant</span>}
                        </div>
                        <ResponsiveContainer width="100%" height={420}>
                          <RadarChart data={radarData} outerRadius="80%">
                            <PolarGrid stroke={PANEL_BORDER_QUIET} />
                            <PolarAngleAxis dataKey="axe" tick={{ fontSize: 15, fill: INK, fontWeight: 700 }} />
                            <PolarRadiusAxis domain={[0, domainMax]} tick={{ fontSize: 11, fill: MUTED }} tickCount={5} axisLine={false} />
                            <RadarSeries dataKey="valeur" stroke={mpAccent.primary} fill={mpAccent.primary} fillOpacity={0.42} strokeWidth={3}
                              isAnimationActive animationDuration={700} animationEasing="ease-out"
                              dot={{ r: 5, fill: mpAccent.primary, strokeWidth: 0 }} />
                            <Tooltip formatter={(v) => `${v}%`} contentStyle={{ background: "#16140F", border: `1px solid ${PANEL_BORDER}`, borderRadius: 10, fontSize: 13 }} />
                          </RadarChart>
                        </ResponsiveContainer>
                        <div className="flex items-center justify-between gap-3 pt-3 mt-1" style={{ borderTop: `1px solid ${PANEL_BORDER_QUIET}` }}>
                          <div>
                            <div className="text-[9.5px] uppercase tracking-wider" style={{ color: FAINT }}>{t.prix_regulier_ideal}</div>
                            <div className="tabular-nums text-[16px] font-bold">{p.prixRegulier !== null ? fmtEURplain(p.prixRegulier) : "N/A"}</div>
                          </div>
                          <div className="text-right">
                            <div className="text-[9.5px] uppercase tracking-wider" style={{ color: FAINT }}>{t.prix_promo_ideal}</div>
                            <div className="tabular-nums text-[16px] font-bold" style={{ color: AMBER }}>{p.prixPromo !== null ? fmtEURplain(p.prixPromo) : "N/A"}</div>
                          </div>
                        </div>
                        {p.prixRegulier !== null && p.prixPromo !== null && p.prixPromo > p.prixRegulier && (
                          <div className="flex items-center gap-1.5 mt-2 text-[10.5px] px-2.5 py-1.5 rounded-lg" style={{ background: `${AMBER}12`, color: AMBER }}>
                            <AlertTriangle size={11} /> Prix promo plus élevé que le régulier — le déstockage semble concerner des modèles premium, pas du petit stock à écouler.
                          </div>
                        )}
                      </GlassCard>
                    );
                  })}
                </div>
                <div className="flex items-center gap-1.5 mb-6 px-1 text-[10.5px]" style={{ color: FAINT }}>
                  <Info size={11} /> *Prix promo = prix moyen constaté sur les références en déstockage, utilisé comme proxy explicite — pas une vraie distinction promo ponctuelle, cette donnée n'existe pas dans les exports actuels.
                </div>
              </>
            )}

            {marquesTab === "classification" && (
            <>
            {/* ===== section — Répartition catégories / sous-catégories, filtrable par marketplace ===== */}
            <div className="flex items-center justify-between mb-2 mt-9 flex-wrap gap-2">
              <ZoneLabel>{t.categories}</ZoneLabel>
              <SectionHeader hint={t.repartition_categorie_hint}>{t.repartition_categorie}</SectionHeader>
              {globalMp === "Toutes" ? (
                <select value={catMpFilter} onChange={(e) => setCatMpFilter(e.target.value)}
                  className="text-[12px] rounded-lg px-2.5 py-1.5 font-medium" style={{ background: PANEL, border: `1px solid ${PANEL_BORDER}`, color: INK, colorScheme: "dark" }}>
                  {catMpList.map((mp) => <option key={mp} value={mp} style={{ background: BG }}>{mp}</option>)}
                </select>
              ) : (
                <span className="text-[11.5px] font-semibold flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ color: mpAccent.primary, background: `${mpAccent.primary}18` }}><Lock size={11} /> {catMpFilter}</span>
              )}
            </div>
            <div className="flex items-center gap-1.5 mb-3 text-[11px]" style={{ color: FAINT }}>
              <Info size={11} /> {DATA.category_by_mp.coverage[catMpFilter] ?? 0}% {t.rattache_catalogue}{catMpFilter === "Toutes" ? "" : ` (${catMpFilter})`}
            </div>
            <GlassCard className="p-4 mb-4" scrollReveal>
              <Eyebrow tone="quiet" hint={t.autres_mp_hint}>{t.categories}</Eyebrow>
              <div className="space-y-2">
                {(DATA.category_by_mp.categories[catMpFilter] || []).map((c) => {
                  const CatIcon = c.nom === "Sèche-serviettes électrique" ? IconTowelWarmer
                    : c.nom === "Ventilateur de plafond" ? IconFan
                    : c.nom === "Déshumidificateur" ? IconDehumidifier
                    : IconRadiatorPanel;
                  return (
                  <div key={c.nom} className="flex items-center gap-3">
                    <span className="shrink-0 flex items-center justify-center" style={{ width: 20, height: 20 }}><CatIcon style={{ width: 20, height: 20 }} /></span>
                    <span className="text-[12px] shrink truncate" style={{ color: INK, maxWidth: 148 }}>{translateCat(c.nom, lang)}</span>
                    <div className="flex-1 h-5 rounded-lg relative overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <div className="h-full rounded-lg" style={{ width: `${c.pct}%`, background: `linear-gradient(90deg, ${ORANGE_SOFT}, ${ORANGE})`, transition: "width 0.7s cubic-bezier(.22,1,.36,1)" }} />
                    </div>
                    <span className="text-[12px] tabular-nums font-semibold w-12 text-right shrink-0" style={{ color: ORANGE_SOFT }}>{c.pct}%</span>
                  </div>
                  );
                })}
                {!(DATA.category_by_mp.categories[catMpFilter] || []).length && <span className="text-[11px]" style={{ color: FAINT }}>{t.aucune_donnee_mp}</span>}
              </div>
            </GlassCard>
            <GlassCard className="p-4" quiet scrollReveal>
              <Eyebrow tone="quiet" hint={t.sous_categories_hint}>{t.sous_categories}</Eyebrow>
              <div className="space-y-1.5">
                {(DATA.category_by_mp.souscategories[catMpFilter] || []).map((s, i) => (
                  <StaggerRow key={s.nom} index={i} className="flex items-center gap-3">
                    <span className="text-[11px] w-44 shrink-0 truncate" style={{ color: MUTED }}>{translateCat(s.nom, lang)}</span>
                    <div className="flex-1 h-3.5 rounded-full relative overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.max(2, s.pct * 2.5)}%`, background: FAINT, transition: "width 0.6s cubic-bezier(.22,1,.36,1)" }} />
                    </div>
                    <span className="text-[10.5px] tabular-nums w-10 text-right shrink-0" style={{ color: FAINT }}>{s.pct}%</span>
                  </StaggerRow>
                ))}
              </div>
            </GlassCard>
            </>
            )}

            {marquesTab === "puissances" && (
            <>
            <ZoneLabel first>{t.zone_puissances}</ZoneLabel>
            <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
              <SectionHeader hint={`${t.puissances_vendues_hint} · ${dateRangeLabel} (${periodStats.from} → ${periodStats.to}) · ${mpLabel}`}>{t.puissances_vendues_titre}</SectionHeader>
              <select value={wattageCat} onChange={(e) => setWattageCat(e.target.value)}
                className="text-[12px] rounded-lg px-2.5 py-1.5 font-medium shrink-0" style={{ background: PANEL, border: `1px solid ${PANEL_BORDER}`, color: INK, colorScheme: "dark" }}>
                <option value="Toutes" style={{ background: BG }}>{t.toutes_categories}</option>
                {wattageCats.map((c) => <option key={c} value={c} style={{ background: BG }}>{c}</option>)}
              </select>
            </div>
            <GlassCard className="p-5 mb-5" scrollReveal>
              {wattageAnalysis.rows.length === 0 ? (
                <span className="text-[12px]" style={{ color: FAINT }}>{t.aucune_donnee_qte}</span>
              ) : (
                <>
                  <div className="space-y-2.5">
                    {wattageAnalysis.rows.map((r, i) => (
                      <div key={r.watt} className="flex items-center gap-3">
                        <span className="tabular-nums text-[12.5px] font-semibold w-20 shrink-0">{r.watt}</span>
                        <div className="flex-1 h-4 rounded-full relative overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                          <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(2, r.pct)}%`, background: `linear-gradient(90deg, ${mpAccent.primary}99, ${mpAccent.primary})` }} />
                        </div>
                        <span className="tabular-nums text-[11.5px] w-14 text-right shrink-0" style={{ color: mpAccent.primary }}>{r.pct.toFixed(1)}%</span>
                        <span className="tabular-nums text-[10.5px] w-20 text-right shrink-0" style={{ color: FAINT }}>{fmtNum(r.qte)} u.</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center gap-1.5 mt-4 pt-3 text-[10.5px]" style={{ color: FAINT, borderTop: `1px solid ${PANEL_BORDER_QUIET}` }}>
                    <Info size={11} /> {wattageAnalysis.couverturePct.toFixed(0)}% des unités vendues sur cette sélection ont une puissance identifiable dans leur nom produit.
                  </div>
                </>
              )}
            </GlassCard>
            </>
            )}
          </>
        )}

        {tab === "prix" && (
          <>
            <SectionHeader hint={t.suivi_prix_hint}>{t.suivi_prix}</SectionHeader>

            <GlassCard className="p-4 mb-4 flex flex-wrap items-center gap-3" quiet>
              <div className="flex items-center gap-2 flex-1 min-w-[180px]">
                <Search size={14} color={FAINT} />
                <input
                  type="text" value={priceSearch} onChange={(e) => setPriceSearch(e.target.value)}
                  placeholder={t.rechercher_produit}
                  className="flex-1 text-[13px] outline-none bg-transparent" style={{ color: INK }}
                />
              </div>
              {globalMp === "Toutes" ? (
                <select value={priceMpFilter} onChange={(e) => setPriceMpFilter(e.target.value)}
                  className="text-[12px] rounded-lg px-2.5 py-1.5 font-medium" style={{ background: PANEL, border: `1px solid ${PANEL_BORDER}`, color: INK, colorScheme: "dark" }}>
                  {priceMpList.map((mp) => <option key={mp} value={mp} style={{ background: BG }}>{mp}</option>)}
                </select>
              ) : (
                <span className="text-[11.5px] font-semibold flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg" style={{ color: mpAccent.primary, background: `${mpAccent.primary}18` }}><Lock size={11} /> {priceMpFilter}</span>
              )}
              <div className="flex gap-1.5">
                {[2025, 2026].map((y) => (
                  <button key={y} onClick={() => setPriceYear(y)} className="year-chip text-[11px] tabular-nums font-medium px-2.5 py-1 rounded-full"
                    style={{ background: priceYear === y ? `${YEAR_COLORS[y]}22` : "rgba(255,255,255,0.03)", color: priceYear === y ? YEAR_COLORS[y] : FAINT, border: `1px solid ${priceYear === y ? YEAR_COLORS[y] + "55" : PANEL_BORDER_QUIET}` }}>
                    {y}
                  </button>
                ))}
              </div>
              <div className="flex gap-1.5 rounded-full p-0.5" style={{ background: "rgba(255,255,255,0.03)" }}>
                {[{ id: "prix", label: t.prix_mode }, { id: "qte", label: t.qte_mode }].map((m) => (
                  <button key={m.id} onClick={() => setPriceMode(m.id)} className="text-[11px] font-medium px-3 py-1 rounded-full"
                    style={{ background: priceMode === m.id ? mpAccent.primary : "transparent", color: priceMode === m.id ? mpAccent.text : FAINT }}>
                    {m.label}
                  </button>
                ))}
              </div>
            </GlassCard>

            <div className="flex items-center gap-1.5 mb-3 text-[11.5px]" style={{ color: FAINT }}>
              <Info size={12} />
              {priceTotalMatches} {priceTotalMatches > 1 ? t.resultats : t.resultat} {priceTotalMatches > 40 ? `— ${t.affine_recherche}` : ""} · {t.non_dispo_2024}
            </div>


            <SectionHeader hint={t.simulation_hint}>{t.simulation_titre}</SectionHeader>

            <GlassCard className="p-4 mb-4" glow glowColor={GREEN} scrollReveal>
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp size={15} color={GREEN} />
                <span className="text-[12.5px] font-bold" style={{ color: INK }}>{t.marge_manoeuvre_titre}</span>
              </div>
              <div className="text-[10.5px] mb-3" style={{ color: FAINT }}>{t.marge_manoeuvre_sub}</div>
              {SIMULATION_PRIX.opportunites.slice(0, 6).map((r, i) => {
                const [produit, mp, elast, r2, deltaVol, deltaCa, caReel] = r;
                return (
                  <StaggerRow key={`${produit}-${mp}`} index={i} className="flex items-center gap-3 py-2" style={{ borderTop: i > 0 ? `1px solid ${PANEL_BORDER_QUIET}` : "none" }}>
                    <div className="text-center shrink-0" style={{ width: 52 }}>
                      <div className="tabular-nums font-bold" style={{ fontSize: 17, color: GREEN, lineHeight: 1 }}>+{deltaCa.toFixed(1)}%</div>
                      <div className="text-[8.5px] mt-0.5" style={{ color: FAINT }}>CA net</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[12px] font-semibold truncate" style={{ color: INK }}>{produit}</span>
                        <span className="text-[10px] shrink-0" style={{ color: FAINT }}>{mp}</span>
                      </div>
                      <div className="text-[10px]" style={{ color: FAINT }}>
                        {r2 >= 0.15 ? `${t.sim_volume} ${deltaVol.toFixed(1)}%` : t.sim_pas_de_signal} · {t.sim_ca_actuel} {fmtEURk(caReel)}
                      </div>
                    </div>
                  </StaggerRow>
                );
              })}
            </GlassCard>

            <GlassCard className="p-4 mb-6" glow glowColor={RED} scrollReveal>
              <div className="flex items-center gap-2 mb-1">
                <ShieldAlert size={15} color={RED} />
                <span className="text-[12.5px] font-bold" style={{ color: INK }}>{t.prudence_titre}</span>
              </div>
              <div className="text-[10.5px] mb-3" style={{ color: FAINT }}>{t.prudence_sub}</div>
              {SIMULATION_PRIX.risques.slice(0, 6).map((r, i) => {
                const [produit, mp, elast, r2, deltaVol, deltaCa, caReel] = r;
                return (
                  <StaggerRow key={`${produit}-${mp}`} index={i} className="flex items-center gap-3 py-2" style={{ borderTop: i > 0 ? `1px solid ${PANEL_BORDER_QUIET}` : "none" }}>
                    <div className="text-center shrink-0" style={{ width: 52 }}>
                      <div className="tabular-nums font-bold" style={{ fontSize: 17, color: RED, lineHeight: 1 }}>{deltaCa.toFixed(1)}%</div>
                      <div className="text-[8.5px] mt-0.5" style={{ color: FAINT }}>CA net</div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-[12px] font-semibold truncate" style={{ color: INK }}>{produit}</span>
                        <span className="text-[10px] shrink-0" style={{ color: FAINT }}>{mp}</span>
                      </div>
                      <div className="text-[10px]" style={{ color: FAINT }}>
                        {t.sim_volume} {deltaVol.toFixed(1)}% · {t.sim_ca_actuel} {fmtEURk(caReel)}
                      </div>
                    </div>
                  </StaggerRow>
                );
              })}
            </GlassCard>

            <SectionHeader hint={t.sim_hint}>{t.sim_titre}</SectionHeader>
            <GlassCard className="p-4 mb-6" scrollReveal>
              {!simProduit ? (
                <>
                  <div className="relative mb-2">
                    <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: FAINT }} />
                    <input value={simRecherche} onChange={(e) => setSimRecherche(e.target.value)} placeholder={t.sim_choisir_produit} autoFocus
                      className="w-full text-[12px] pl-7 pr-2 py-2 rounded-full outline-none" style={{ background: PANEL_QUIET, border: `1px solid ${PANEL_BORDER_QUIET}`, color: INK }} />
                  </div>
                  <div className="max-h-[220px] overflow-y-auto">
                    {simProduitsDisponibles.map((nom, i) => (
                      <StaggerRow key={nom} index={i}>
                        <button onClick={() => { setSimProduit(nom); setSimMp(null); setSimPrix(null); }}
                          className="btn-lift w-full text-left px-3 py-2 rounded-lg text-[12px] font-medium mb-1" style={{ background: "rgba(255,255,255,0.03)", color: INK }}>
                          {nom}
                        </button>
                      </StaggerRow>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[13px] font-bold" style={{ color: INK }}>{simProduit}</span>
                    <button onClick={() => { setSimProduit(null); setSimMp(null); setSimPrix(null); setSimRecherche(""); }} className="btn-lift p-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)" }}>
                      <X size={13} color={MUTED} />
                    </button>
                  </div>
                  <div className="flex items-center gap-1.5 mb-4 flex-wrap">
                    {simMpDisponibles.map((r) => (
                      <button key={r[1]} onClick={() => { setSimMp(r[1]); setSimPrix(r[6]); }} className="btn-lift text-[11px] font-semibold px-3 py-1.5 rounded-full"
                        style={{ background: simMp === r[1] ? mpAccent.primary : PANEL_QUIET, color: simMp === r[1] ? mpAccent.text : MUTED, transition: "background 0.25s ease, color 0.25s ease, transform 0.18s cubic-bezier(.22,1,.36,1), filter 0.18s" }}>
                        {r[1]}
                      </button>
                    ))}
                  </div>

                  {simResultat && (
                    <>
                      <div className="grid grid-cols-2 gap-3 mb-4">
                        <div className="p-3 rounded-xl" style={{ background: "rgba(255,255,255,0.03)" }}>
                          <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: FAINT }}>{t.sim_qte_actuelle}</div>
                          <div className="tabular-nums font-bold" style={{ fontSize: 18, color: INK }}>{fmtNum(simResultat.qteMoy)} u.</div>
                          <div className="text-[10px] mt-0.5" style={{ color: FAINT }}>{fmtEURplain(simResultat.prixMoyen)} · {fmtEURk(simResultat.caActuel)}</div>
                        </div>
                        <div className="p-3 rounded-xl" style={{ background: `${simResultat.deltaCaPct >= 0 ? GREEN : RED}0F`, transition: "background 0.4s ease" }}>
                          <div className="text-[9px] uppercase tracking-wider mb-1" style={{ color: FAINT }}>{t.sim_qte_projetee}</div>
                          <div key={`qte-${Math.round(simPrix)}`} className="punch tabular-nums font-bold" style={{ fontSize: 18, color: simResultat.deltaCaPct >= 0 ? GREEN : RED }}>{fmtNum(simResultat.qteProjetee)} u.</div>
                          <div className="text-[10px] mt-0.5" style={{ color: FAINT }}>{fmtEURplain(simPrix)} · {fmtEURk(simResultat.caProjete)}</div>
                        </div>
                      </div>

                      <div className="flex items-baseline justify-between mb-1.5">
                        <span className="text-[10px] uppercase tracking-wider" style={{ color: FAINT }}>{t.sim_prix_propose}</span>
                        <span key={`prix-${Math.round(simPrix)}`} className="punch tabular-nums font-bold" style={{ fontSize: 22, color: mpAccent.primary }}>{fmtEURplain(simPrix)}</span>
                      </div>
                      <input type="range" min={(simResultat.prixMin * 0.7).toFixed(2)} max={(simResultat.prixMax * 1.3).toFixed(2)} step={0.1}
                        value={simPrix} onChange={(e) => setSimPrix(Number(e.target.value))}
                        className="w-full mb-1" style={{ accentColor: mpAccent.primary }} />
                      <div className="flex items-center justify-between text-[9.5px] mb-4" style={{ color: FAINT }}>
                        <span>{fmtEURplain(simResultat.prixMin * 0.7)}</span>
                        <span>{t.sim_prix_actuel} : {fmtEURplain(simResultat.prixMoyen)}</span>
                        <span>{fmtEURplain(simResultat.prixMax * 1.3)}</span>
                      </div>

                      <div className="flex items-center justify-center gap-6 p-3 rounded-xl mb-2" style={{ background: "rgba(255,255,255,0.02)" }}>
                        <div className="text-center">
                          <div key={`vol-${Math.round(simPrix)}`} className="punch tabular-nums font-bold" style={{ fontSize: 20, color: simResultat.deltaVolPct >= 0 ? GREEN : RED }}>{simResultat.deltaVolPct >= 0 ? "+" : ""}{simResultat.deltaVolPct.toFixed(0)}%</div>
                          <div className="text-[9px]" style={{ color: FAINT }}>Volume</div>
                        </div>
                        <div className="text-center">
                          <div key={`ca-${Math.round(simPrix)}`} className="punch tabular-nums font-bold" style={{ fontSize: 20, color: simResultat.deltaCaPct >= 0 ? GREEN : RED }}>{simResultat.deltaCaPct >= 0 ? "+" : ""}{simResultat.deltaCaPct.toFixed(0)}%</div>
                          <div className="text-[9px]" style={{ color: FAINT }}>CA net</div>
                        </div>
                      </div>

                      {simResultat.horsPlage && (
                        <div className="flex items-start gap-1.5 text-[10.5px]" style={{ color: AMBER }}>
                          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {t.sim_hors_plage}
                        </div>
                      )}
                      {!simResultat.fiable && (
                        <div className="flex items-start gap-1.5 text-[10.5px] mt-1" style={{ color: FAINT }}>
                          <ShieldQuestion size={12} className="mt-0.5 shrink-0" /> R²={simResultat.r2.toFixed(2)} — {t.elast_peu_fiable}
                        </div>
                      )}
                    </>
                  )}
                </>
              )}
            </GlassCard>

            {priceResults.length === 0 ? (
              <GlassCard className="p-6 text-center" quiet>
                <span className="text-[12.5px]" style={{ color: FAINT }}>{t.aucun_resultat}</span>
              </GlassCard>
            ) : (
              <GlassCard className="p-4 overflow-x-auto">
                <div style={{ minWidth: 680 }}>
                  <div className="grid gap-1 mb-1.5 pb-1.5" style={{ gridTemplateColumns: "160px 110px repeat(12, 1fr)", borderBottom: `1px solid ${PANEL_BORDER_QUIET}` }}>
                    <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: MUTED }}>{t.produit_col}</span>
                    <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: MUTED }}>{t.marketplace_col}</span>
                    {moisLabels.map((m) => <span key={m} className="text-[9.5px] text-center" style={{ color: FAINT }}>{m}</span>)}
                  </div>
                  {priceResults.map((row, ri) => {
                    const [produit, mp, p2025, p2026, q2025, q2026] = row;
                    const prices = priceYear === 2025 ? p2025 : p2026;
                    const qtes = priceYear === 2025 ? q2025 : q2026;
                    const values = priceMode === "prix" ? prices : qtes;
                    return (
                      <StaggerRow key={`${produit}-${mp}`} index={ri} className="grid gap-1 items-center py-1" style={{ gridTemplateColumns: "160px 110px repeat(12, 1fr)" }}>
                        <span className="text-[11px] truncate pr-1" style={{ color: INK }}>{produit}</span>
                        <span className="text-[10.5px] truncate pr-1" style={{ color: MUTED }}>{mp}</span>
                        {values.map((v, i) => {
                          const empty = priceMode === "prix" ? v === null : !v;
                          return (
                            <span key={i} className="text-[10px] tabular-nums text-center" style={{ color: !empty ? (priceMode === "prix" ? ORANGE_SOFT : AMBER) : "#3A362F" }}>
                              {!empty ? (priceMode === "prix" ? `${v.toFixed(0)}€` : v) : "N/A"}
                            </span>
                          );
                        })}
                      </StaggerRow>
                    );
                  })}
                </div>
              </GlassCard>
            )}
          </>
        )}

        {tab === "ads" && (
          <>
            <PeriodSummaryCard key={`ads-${globalMp}-${datePreset}`} items={summaryAds} t={t} />
            {globalMp !== "Toutes" && (GF_TO_ADS[globalMp] || []).length === 0 ? (
              <GlassCard className="p-6 text-center" quiet scrollReveal>
                <span className="text-[12.5px]" style={{ color: FAINT }}>{lang==="en"?`No distinct ad data for ${globalMp} — this channel has no dedicated line in the marketing budget file`:lang==="zh"?`${globalMp} 暂无独立广告数据 — 该渠道在营销预算文件中没有专属行`:`Pas de données ads distinctes pour ${globalMp} — ce canal n'a pas de ligne dédiée dans le fichier budget marketing`}</span>
              </GlassCard>
            ) : (
            <>
            <ZoneLabel first>{t.zone_performance}</ZoneLabel>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <TiltCard className="p-5" glow glowColor={mpAccent.primary} scrollReveal><Eyebrow hint={t.depense_totale_hint}>{t.depense_totale}</Eyebrow><div className="tabular-nums font-bold" style={{ fontSize: "clamp(24px, 3.5vw, 32px)" }}>{fmtEUR(totalSpend)}</div></TiltCard>
              <TiltCard className="p-5 reveal-d1" glow glowColor={mpAccent.primary} scrollReveal><Eyebrow hint={t.ca_genere_ht_hint}>{t.ca_genere_ht}</Eyebrow><div className="tabular-nums font-bold" style={{ fontSize: "clamp(24px, 3.5vw, 32px)" }}>{fmtEUR(totalAdsCa)}</div></TiltCard>
              <TiltCard className="p-5 reveal-d2" glow glowColor={mpAccent.primary} scrollReveal><Eyebrow hint={t.roas_pondere_hint}>{t.roas_pondere}</Eyebrow><div className="tabular-nums font-bold" style={{ fontSize: "clamp(24px, 3.5vw, 32px)", color: mpAccent.primary }}>{blendedRoas.toFixed(1)}x</div></TiltCard>
            </div>

            {/* ===== section — Budget / Consommé / Restant, très visuel ===== */}
            <ZoneLabel>{t.zone_budget}</ZoneLabel>
            <div className="mb-2">
              <SectionHeader hint={t.budget_pub_mp_hint}>{t.budget_pub_mp}</SectionHeader>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
              {adsWithRemaining.map((a, i) => {
                const pct = Math.min(100, (a.spend / a.budget_annuel) * 100);
                const r = 34, circ = 2 * Math.PI * r;
                const color = pct > 80 ? RED : pct > 50 ? AMBER : GREEN;
                return (
                  <TiltCard key={a.marketplace} className={`p-4 flex items-center gap-4 ${i === 1 ? "reveal-d1" : i >= 2 ? "reveal-d2" : ""}`} scrollReveal>
                    <svg viewBox="0 0 80 80" width="72" height="72" className="shrink-0">
                      <circle cx="40" cy="40" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7" />
                      <circle cx="40" cy="40" r={r} fill="none" stroke={color} strokeWidth="7" strokeLinecap="round"
                        strokeDasharray={`${(pct/100)*circ} ${circ}`} transform="rotate(-90 40 40)"
                        style={{ transition: "stroke-dasharray 0.9s cubic-bezier(.22,1,.36,1)" }} />
                      <text x="40" y="45" textAnchor="middle" fontSize="17" fontWeight="700" fill={INK} fontFamily="'Inter', sans-serif" letterSpacing="-0.02em">{pct.toFixed(0)}%</text>
                    </svg>
                    <div className="min-w-0">
                      <div className="text-[12.5px] font-semibold truncate">{a.marketplace}</div>
                      <div className="text-[11px] mt-1" style={{ color: MUTED }}>{t.depense_lbl} <span className="tabular-nums">{fmtEURk(a.spend)}</span></div>
                      <div className="text-[11px]" style={{ color: MUTED }}>{t.budget_lbl} <span className="tabular-nums">{fmtEURk(a.budget_annuel)}</span></div>
                      <div className="text-[11px] font-semibold" style={{ color: GREEN }}>{t.restant_lbl} <span className="tabular-nums">{fmtEURk(a.remaining)}</span></div>
                    </div>
                  </TiltCard>
                );
              })}
            </div>

            <ZoneLabel>{t.zone_classement}</ZoneLabel>
            <div>
            <SectionHeader hint={t.top3_ads_hint}>{t.top3_ads}</SectionHeader>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
              {top3Ads.map((a, i) => (
                <TiltCard key={a.marketplace} className={`p-4 ${i === 1 ? "reveal-d1" : i >= 2 ? "reveal-d2" : ""}`} glow={i === 0} glowColor={mpAccent.primary} scrollReveal>
                  <div className="flex items-center justify-between mb-2"><span className="text-[13px] font-semibold">{a.marketplace}</span><span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded" style={{ background: `${mpAccent.primary}22`, color: mpAccent.primary }}>#{i+1}</span></div>
                  <div className="tabular-nums text-[20px] font-bold">{fmtEURk(a.ca_genere)}</div>
                  <div className="flex items-center justify-between mt-1.5">
                    <span className="text-[11.5px]" style={{ color: MUTED }}>{fmtEURk(a.spend)} {t.depense_lbl.toLowerCase()}</span>
                    <span className="tabular-nums font-semibold text-[13px]" style={{ color: a.roas > 8 ? GREEN : a.roas > 3 ? AMBER : RED }}>{a.roas}x ROAS</span>
                  </div>
                </TiltCard>
              ))}
            </div>

            {atRiskAds.length > 0 && (
              <>
                <Eyebrow tone="quiet" hint={t.a_surveiller_hint}><span className="flex items-center gap-1.5" style={{ color: RED }}><AlertTriangle size={12} /> {t.a_surveiller}</span></Eyebrow>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-5">
                  {atRiskAds.map((a, i) => (
                    <TiltCard key={a.marketplace} className={`p-4 ${i === 1 ? "reveal-d1" : i >= 2 ? "reveal-d2" : ""}`} style={{ borderColor: "rgba(248,113,113,0.25)" }} scrollReveal>
                      <div className="flex items-center justify-between"><span className="text-[13px] font-semibold">{a.marketplace}</span><span className="tabular-nums font-bold text-[15px]" style={{ color: RED }}>{a.roas}x</span></div>
                      <div className="text-[11.5px] mt-1" style={{ color: MUTED }}>{fmtEURplain(a.spend)} / {fmtEURplain(a.ca_genere)} {a.acos > 100 && <span style={{ color: RED }}> — {t.perte_nette} {a.acos}%)</span>}</div>
                    </TiltCard>
                  ))}
                </div>
              </>
            )}

            <Eyebrow tone="quiet" hint={t.reste_mp_ads_hint}>{t.reste_mp_ads}</Eyebrow>
            <GlassCard className="p-1.5" quiet scrollReveal>
              {restAdsList.map((a, i) => (
                <StaggerRow key={a.marketplace} index={i} className="flex items-center gap-3 px-3 py-2.5" style={{ borderBottom: i < restAdsList.length - 1 ? `1px solid ${PANEL_BORDER_QUIET}` : "none" }}>
                  <span className="text-[12.5px] w-28 shrink-0 truncate" style={{ color: MUTED }}>{a.marketplace}</span>
                  <span className="text-[11.5px] tabular-nums w-16 text-right shrink-0" style={{ color: FAINT }}>{fmtEURk(a.spend)}</span>
                  <span className="text-[11.5px] tabular-nums w-16 text-right shrink-0" style={{ color: MUTED }}>{fmtEURk(a.ca_genere)}</span>
                  <span className="text-[11px] tabular-nums w-10 text-right shrink-0 font-semibold" style={{ color: a.roas > 8 ? GREEN : a.roas > 3 ? AMBER : FAINT }}>{a.roas ? `${a.roas}x` : "N/A"}</span>
                  <div className="flex-1 h-3 rounded-full relative overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                    {a.pct_budget !== null && <div className="h-full rounded-full" style={{ width: `${Math.min(100, a.pct_budget)}%`, background: a.pct_budget > 60 ? RED : a.pct_budget > 35 ? AMBER : GREEN, transition: "width 0.8s cubic-bezier(.22,1,.36,1)" }} />}
                  </div>
                  <span className="text-[10.5px] tabular-nums w-10 text-right shrink-0" style={{ color: FAINT }}>{a.pct_budget !== null ? `${a.pct_budget.toFixed(0)}%` : "n/d"}</span>
                </StaggerRow>
              ))}
            </GlassCard>
            <div className="flex items-center gap-1.5 mt-2 text-[11px]" style={{ color: FAINT }}><Info size={11} /> {t.pas_budget_n1}</div>
            </>
            )}
          </>
        )}
        {tab === "concurrence" && (
          <>
            <div className="flex items-center justify-between flex-wrap gap-3 mb-4">
              <SectionHeader hint={t.conc_hint}>{t.conc_titre}</SectionHeader>
            </div>

            {/* bloc de filtres unique — segment, sous-catégorie, marketplace regroupés,
                comme sur l'onglet Prix, plutôt qu'en rangées séparées */}
            <GlassCard className="p-4 mb-5" quiet scrollReveal>
              <div className="grid grid-cols-2 gap-2 mb-3">
                {Object.keys(COMPETITION_DATA.segments).map((seg) => (
                  <button key={seg} onClick={() => { setConcSegment(seg); setConcSousCat(null); setConcMpFilter("Toutes"); }}
                    className="btn-lift text-[13px] font-bold py-2.5 rounded-xl"
                    style={{ background: concSegment === seg ? "linear-gradient(135deg, #4A9EFF, #6FB4FF)" : PANEL_QUIET, color: concSegment === seg ? "#0A0908" : MUTED, border: `1px solid ${concSegment === seg ? "transparent" : PANEL_BORDER_QUIET}` }}>
                    {seg === "Heater" ? "🔥 Heater" : "❄️ Cooling"}
                  </button>
                ))}
              </div>

              <div className="flex items-center flex-wrap gap-1.5 pt-3 mb-3" style={{ borderTop: `1px solid ${PANEL_BORDER_QUIET}` }}>
                <button onClick={() => setConcSousCat(null)} className="btn-lift text-[11px] font-medium px-2.5 py-1 rounded-full shrink-0"
                  style={{ background: concSousCat === null ? `${ORANGE}22` : "transparent", color: concSousCat === null ? ORANGE_SOFT : MUTED, border: `1px solid ${concSousCat === null ? ORANGE_SOFT + "55" : PANEL_BORDER_QUIET}` }}>
                  Toutes sous-catégories
                </button>
                {concSousCatsDuSegment.map((sc) => (
                  <button key={sc} onClick={() => setConcSousCat(sc)} className="btn-lift text-[11px] font-medium px-2.5 py-1 rounded-full shrink-0"
                    style={{ background: concSousCat === sc ? `${ORANGE}22` : "transparent", color: concSousCat === sc ? ORANGE_SOFT : MUTED, border: `1px solid ${concSousCat === sc ? ORANGE_SOFT + "55" : PANEL_BORDER_QUIET}` }}>
                    {translateCat(sc, lang)}
                  </button>
                ))}
              </div>

              <div className="flex items-center gap-2 pt-3 flex-wrap" style={{ borderTop: `1px solid ${PANEL_BORDER_QUIET}` }}>
                <span className="text-[10.5px] uppercase tracking-wider font-medium shrink-0" style={{ color: MUTED }}>{t.marketplace_label}</span>
                <select value={concMpFilter} onChange={(e) => setConcMpFilter(e.target.value)}
                  className="text-[12px] rounded-lg px-2.5 py-1.5 font-medium" style={{ background: PANEL, border: `1px solid ${PANEL_BORDER}`, color: INK, colorScheme: "dark" }}>
                  <option value="Toutes" style={{ background: BG }}>{t.toutes_mp}</option>
                  {concMarketplacesDuSegment.map((mp) => <option key={mp} value={mp} style={{ background: BG }}>{mp}</option>)}
                </select>
                {concBesthermCount > 0 && (
                  <span className="text-[10.5px] font-semibold px-2.5 py-1 rounded-full ml-auto shrink-0" style={{ background: `${ORANGE}18`, color: ORANGE_SOFT }}>
                    {concBesthermCount} Bestherm/Thomson
                  </span>
                )}
              </div>
            </GlassCard>

            {mpConcSummary && mpConcSummary.hasData && (
              <GlassCard className="p-5 mb-5" glow glowColor="#4A9EFF" scrollReveal>
                <div className="flex items-center gap-1.5 mb-3">
                  <Sparkles size={11} color="#6FB4FF" />
                  <span className="text-[9.5px] uppercase tracking-[0.16em] font-semibold" style={{ color: "#6FB4FF" }}>Résumé — {concMpFilter}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-[12.5px]" style={{ color: MUTED }}>
                  <div>
                    <span className="font-semibold" style={{ color: ORANGE_SOFT }}>{t.conc_position_heater}</span>
                    {mpConcSummary.bestHeater > 0 ? `${mpConcSummary.bestHeater} ${t.conc_ref_identifiees_sur} ${mpConcSummary.nbHeater} ${t.conc_produits_recenses}` : t.conc_aucune_ref_heater}
                  </div>
                  <div>
                    <span className="font-semibold" style={{ color: "#6FB4FF" }}>{t.conc_position_cooling}</span>
                    {mpConcSummary.bestCooling > 0 ? `${mpConcSummary.bestCooling} ${t.conc_ref_sur} ${mpConcSummary.nbCooling} ${t.conc_produits_point}` : t.conc_aucune_ref_cooling}
                  </div>
                  <div>
                    <span className="font-semibold" style={{ color: ORANGE_SOFT }}>{t.conc_radiateurs}</span>
                    {mpConcSummary.radPrixNb > 0 ? `prix moyen ${fmtEURplain(mpConcSummary.radPrixMoyen)} sur ${mpConcSummary.radPrixNb} prix réellement collecté(s) (échantillon restreint, pas une moyenne de marché fiable).` : `aucun prix collecté sur cette marketplace (${mpConcSummary.radProducts.length} produit(s) identifié(s) sans prix).`}
                  </div>
                  <div>
                    <span className="font-semibold" style={{ color: ORANGE_SOFT }}>{t.conc_secheserviettes}</span>
                    {mpConcSummary.sechePrixNb > 0 ? `prix moyen ${fmtEURplain(mpConcSummary.sechePrixMoyen)} sur ${mpConcSummary.sechePrixNb} prix collecté(s).` : `aucun prix collecté sur cette marketplace (${mpConcSummary.secheProducts.length} produit(s) identifié(s) sans prix).`}
                  </div>
                </div>
                {Object.keys(mpConcSummary.concurrentsByBrand).length > 0 && (
                  <div className="mt-4 pt-3" style={{ borderTop: `1px solid ${PANEL_BORDER_QUIET}` }}>
                    <div className="text-[10.5px] uppercase tracking-wider font-semibold mb-2" style={{ color: MUTED }}>Principaux concurrents identifiés ({Object.keys(mpConcSummary.concurrentsByBrand).length} marques)</div>
                    <div className="space-y-1.5">
                      {Object.entries(mpConcSummary.concurrentsByBrand).sort((a,b) => b[1].length - a[1].length).slice(0, 6).map(([marque, produits]) => (
                        <div key={marque} className="flex items-start gap-2 text-[11.5px]">
                          <span className="font-semibold w-24 shrink-0 truncate">{marque}</span>
                          <span style={{ color: FAINT }}>{[...new Set(produits.map((p) => p.sous_categorie))].join(", ")} — {produits.length} {produits.length>1?t.conc_reference_plur:t.conc_reference_sing}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-1.5 mt-4 pt-3 text-[10.5px]" style={{ color: FAINT, borderTop: `1px solid ${PANEL_BORDER_QUIET}` }}>
                  <Info size={11} /> Estimation de quantité annuelle des concurrents non disponible — cette donnée n'est jamais publiée par les revendeurs, aucune source ne la fournit.
                </div>
              </GlassCard>
            )}

            {/* repère de fraîcheur + comment mettre à jour — informatif, pas un faux bouton
                qui prétendrait déclencher une action qu'il ne peut pas accomplir */}
            <div className="flex items-center gap-1.5 mb-5 text-[11px] flex-wrap" style={{ color: FAINT }}>
              <CalendarDays size={12} /> Dernière collecte : {COMPETITION_DATA.collecte_date}
              <span className="mx-1">·</span>
              <Info size={11} /> Pour actualiser : demande-le directement dans la conversation avec Claude
            </div>

            {/* sous-navigation interne à l'onglet */}
            <div className="flex items-center gap-1.5 mb-6 rounded-full p-1 w-fit" style={{ background: PANEL_QUIET, border: `1px solid ${PANEL_BORDER_QUIET}` }}>
              {[{ id: "synthese", label: t.summary_synthese }, { id: "produits", label: t.conc_top_produits }, { id: "prix", label: t.prix_mode }, { id: "comparatif", label: t.conc_comparatif }].map((s) => (
                <button key={s.id} onClick={() => setConcTab(s.id)} className="btn-lift text-[12px] font-semibold px-3.5 py-1.5 rounded-full"
                  style={{ background: concTab === s.id ? "linear-gradient(135deg, #4A9EFF, #6FB4FF)" : "transparent", color: concTab === s.id ? "#0A0908" : MUTED }}>
                  {s.label}
                </button>
              ))}
            </div>

            {concTab === "synthese" && (
              <>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
                  <TiltCard className="p-4" quiet scrollReveal>
                    <Eyebrow tone="quiet" hint={t.conc_produits_suivis_hint}>{t.conc_produits_suivis}</Eyebrow>
                    <div className="tabular-nums text-[22px] font-bold">{concNbProduits}</div>
                  </TiltCard>

                  <TiltCard className="p-4 reveal-d1" quiet scrollReveal>
                    <Eyebrow tone="quiet" hint={t.conc_prix_moyen_hint}>{t.conc_prix_moyen}</Eyebrow>
                    <div className="tabular-nums text-[22px] font-bold">{concPrixMoyen !== null ? fmtEUR(concPrixMoyen) : "N/A"}</div>
                  </TiltCard>
                  <TiltCard className="p-4 reveal-d1" quiet scrollReveal>
                    <Eyebrow tone="quiet" hint={t.conc_fourchette_prix_hint}>{t.conc_fourchette_prix}</Eyebrow>
                    <div className="tabular-nums text-[15px] font-bold">{concPrixMin !== null ? `${fmtEURplain(concPrixMin)} – ${fmtEURplain(concPrixMax)}` : "N/A"}</div>
                  </TiltCard>
                  <TiltCard className="p-4 reveal-d2" quiet scrollReveal>
                    <Eyebrow tone="quiet" hint={t.conc_en_promo_hint}>{t.conc_en_promo}</Eyebrow>
                    <div className="tabular-nums text-[22px] font-bold">{concPromoCount}<span className="text-[13px] font-normal" style={{ color: FAINT }}> / {concNbProduits}</span></div>
                  </TiltCard>
                </div>

                <SectionHeader hint={t.conc_sources_qualite_hint}>{t.conc_sources_qualite}</SectionHeader>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
                  {concSourcesQualite.map((d, i) => {
                    const conf = CONF_STYLE[d.confiance];
                    const ConfIcon = conf.icon;
                    return (
                      <StaggerRow key={`${d.sousCategorie}-${d.marketplace}`} index={i} className="rounded-2xl backdrop-blur-xl p-4" style={{ background: PANEL_QUIET, border: `1px solid ${PANEL_BORDER_QUIET}` }}>
                        <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
                          <span className="text-[13px] font-semibold">{d.marketplace}</span>
                          <span className="flex items-center gap-1 text-[10.5px] font-medium shrink-0" style={{ color: conf.color }}><ConfIcon size={12} /> {conf.label}</span>
                        </div>
                        <div className="text-[10px] uppercase tracking-wider mb-1" style={{ color: FAINT }}>{d.sousCategorie}</div>
                        <div className="text-[11px] mb-1" style={{ color: MUTED }}>{d.methodologie}</div>
                        {d.note && <div className="flex items-center gap-1 text-[10.5px]" style={{ color: FAINT }}><Info size={10} /> {d.note}</div>}
                        <div className="text-[10.5px] mt-1.5" style={{ color: FAINT }}>{d.produits.length} {d.produits.length>1?t.conc_produit_plur:t.conc_produit_sing} {d.produits.length>1?t.conc_collecte_plur:t.conc_collecte_sing}</div>
                      </StaggerRow>
                    );
                  })}
                </div>

                <SectionHeader hint={t.conc_marques_visibles_hint}>{t.conc_marques_visibles}</SectionHeader>
                <GlassCard className="p-1.5" scrollReveal>
                  {concMarquesCount.slice(0, 10).map(([marque, count], i) => (
                    <div key={marque} className="flex items-center gap-3 px-3 py-2" style={{ borderBottom: i < Math.min(9, concMarquesCount.length-1) ? `1px solid ${PANEL_BORDER_QUIET}` : "none" }}>
                      <span className="text-[12px] w-40 shrink-0 truncate">{marque}</span>
                      <div className="flex-1 h-3 rounded-full relative overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.max(4, (count/concMarquesCount[0][1])*100)}%`, background: "linear-gradient(90deg, #4A9EFF, #6FB4FF)" }} />
                      </div>
                      <span className="text-[11px] tabular-nums w-20 text-right shrink-0" style={{ color: FAINT }}>{count} apparition{count>1?"s":""}</span>
                    </div>
                  ))}
                </GlassCard>
              </>
            )}

            {concTab === "produits" && (
              <>
                <GlassCard className="p-1.5 reveal-d1" scrollReveal>
                  {concAllProducts.length === 0 && <div className="p-4 text-center text-[12px]" style={{ color: FAINT }}>{t.conc_aucun_produit}</div>}
                  {concAllProducts.map((p, i) => {
                    const conf = CONF_STYLE[p.confiance];
                    const ConfIcon = conf.icon;
                    return (
                      <StaggerRow key={i} index={i} className="flex items-center gap-3 px-3 py-2.5 flex-wrap relative" style={{ borderBottom: i < concAllProducts.length-1 ? `1px solid ${PANEL_BORDER_QUIET}` : "none", borderLeft: p.est_bestherm ? `2px solid ${ORANGE}` : "2px solid transparent", paddingLeft: p.est_bestherm ? "10px" : "12px" }}>
                        <span className="text-[10px] font-mono w-6 shrink-0" style={{ color: FAINT }}>{p.rang ? `#${p.rang}` : "N/A"}</span>
                        <div className="flex-1 min-w-[140px]">
                          <div className="text-[12px] truncate">
                            {p.produit}
                            {p.est_bestherm && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-semibold" style={{ background: `${ORANGE}22`, color: ORANGE_SOFT }}>{p.note_special || "Bestherm/Thomson"}</span>}
                            {p.sponsorise && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: PANEL_QUIET, color: FAINT }}>{t.conc_sponsorise}</span>}
                          </div>
                          <div className="text-[10.5px] truncate" style={{ color: FAINT }}>{p.marque || t.marque_non_identifiee} · {p.marketplace} · {p.sous_categorie}</div>
                        </div>
                        <div className="text-right shrink-0">
                          {p.prix != null ? (
                            <>
                              <div className="text-[12px] font-semibold tabular-nums" style={{ color: "#6FB4FF" }}>{fmtEURplain(p.prix)}</div>
                              {p.remise && <div className="text-[10px] tabular-nums" style={{ color: GREEN }}>-{p.remise}% vs {fmtEURplain(p.prix_avant)}</div>}
                            </>
                          ) : <span className="text-[11px]" style={{ color: FAINT }}>{t.conc_prix_nd}</span>}
                        </div>
                        <ConfIcon size={13} color={conf.color} className="shrink-0" />
                      </StaggerRow>
                    );
                  })}
                </GlassCard>
              </>
            )}

            {concTab === "prix" && (
              <>
                <SectionHeader hint={t.conc_comparatif_prix_mp_hint}>{t.conc_comparatif_prix_mp}</SectionHeader>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {concMarketplacesDuSegment.filter((mp) => concMpFilter === "Toutes" || mp === concMpFilter).map((mp, i) => {
                    const prods = concAllProducts.filter((p) => p.marketplace === mp && p.prix != null);
                    if (!prods.length) return (
                      <StaggerRow key={mp} index={i} className="rounded-2xl p-4" style={{ background: PANEL_QUIET, border: `1px solid ${PANEL_BORDER_QUIET}` }}>
                        <span className="text-[13px] font-semibold">{mp}</span>
                        <div className="text-[11px] mt-1" style={{ color: FAINT }}>{t.conc_aucun_prix_verifie}</div>
                      </StaggerRow>
                    );
                    const avg = prods.reduce((s,p)=>s+p.prix,0)/prods.length;
                    return (
                      <StaggerRow key={mp} index={i} className="rounded-2xl p-4" style={{ background: PANEL_QUIET, border: `1px solid ${PANEL_BORDER_QUIET}` }}>
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-[13px] font-semibold">{mp}</span>
                          <span className="text-[15px] font-bold tabular-nums" style={{ color: "#6FB4FF" }}>{fmtEURplain(avg)} <span className="text-[10px] font-normal" style={{ color: FAINT }}>{t.conc_moy}</span></span>
                        </div>
                        <div className="space-y-1">
                          {prods.sort((a,b)=>a.prix-b.prix).map((p,j) => (
                            <div key={j} className="flex items-center gap-2 text-[11px]">
                              <span className="flex-1 truncate" style={{ color: p.est_bestherm ? ORANGE_SOFT : MUTED }}>{p.produit}</span>
                              <span className="tabular-nums shrink-0" style={{ color: FAINT }}>{fmtEURplain(p.prix)}</span>
                            </div>
                          ))}
                        </div>
                      </StaggerRow>
                    );
                  })}
                </div>
              </>
            )}

            {concTab === "comparatif" && (
              <>
                <SectionHeader hint={t.conc_vs_marche_hint}>{t.conc_vs_marche}</SectionHeader>
                {concComparatif.length === 0 ? (
                  <GlassCard className="p-5 text-center" quiet scrollReveal>
                    <span className="text-[12.5px]" style={{ color: FAINT }}>{t.conc_pas_de_comparaison}</span>
                  </GlassCard>
                ) : (
                  <div className="space-y-4">
                    {concComparatif.map((d, i) => (
                      <StaggerRow key={d.sousCategorie} index={i} className="rounded-2xl p-4" style={{ background: PANEL_QUIET, border: `1px solid ${PANEL_BORDER_QUIET}` }}>
                        <div className="flex items-center justify-between mb-3 flex-wrap gap-1">
                          <span className="text-[13px] font-semibold">{d.sousCategorie}</span>
                          <span className="text-[11px]" style={{ color: FAINT }}>Moyenne concurrents ({d.nbConcurrents}) : {fmtEURplain(d.concAvg)}</span>
                        </div>
                        <div className="space-y-2">
                          {d.bestherm.map((p, j) => (
                            <div key={j} className="flex items-center justify-between gap-2 flex-wrap">
                              <span className="text-[12px] flex-1 min-w-[140px] truncate" style={{ color: ORANGE_SOFT }}>{p.produit}</span>
                              <div className="flex items-center gap-2 shrink-0">
                                <span className="tabular-nums text-[13px] font-semibold">{fmtEURplain(p.prix)}</span>
                                {p.ecartPct !== null && (
                                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full" style={{ background: p.ecartPct < 0 ? `${GREEN}18` : `${RED}18`, color: p.ecartPct < 0 ? GREEN : RED }}>
                                    {p.ecartPct >= 0 ? "+" : ""}{p.ecartPct.toFixed(0)}% vs marché
                                  </span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </StaggerRow>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* export du rapport — toujours visible, quel que soit le sous-onglet actif */}
            <div className="flex items-center gap-2 mt-8 pt-5 flex-wrap" style={{ borderTop: `1px solid ${PANEL_BORDER_QUIET}` }}>
              <span className="text-[10.5px] uppercase tracking-wider font-medium shrink-0" style={{ color: MUTED }}>{t.conc_exporter}</span>
              <button onClick={downloadConcReportMd} className="btn-lift text-[11.5px] font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5" style={{ background: PANEL_QUIET, border: `1px solid ${PANEL_BORDER_QUIET}`, color: "#6FB4FF" }}>
                <ExternalLink size={11} /> Rapport (Markdown)
              </button>
              <button onClick={downloadConcReportCsv} className="btn-lift text-[11.5px] font-semibold px-3 py-1.5 rounded-full flex items-center gap-1.5" style={{ background: PANEL_QUIET, border: `1px solid ${PANEL_BORDER_QUIET}`, color: "#6FB4FF" }}>
                <ExternalLink size={11} /> Données (CSV)
              </button>
              <span className="text-[10px] w-full sm:w-auto sm:ml-1" style={{ color: FAINT }}>{t.conc_nomme_date}</span>
            </div>
          </>
        )}

        {tab === "supply" && (
          <>
            <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
              <SectionHeader hint={t.supply_hint}>{t.supply_titre}</SectionHeader>
            </div>
            <div className="flex items-center gap-1.5 mb-6 text-[11px]" style={{ color: FAINT }}>
              <Info size={11} /> Onglet volontairement partiel — voir la note en bas de page pour ce qui manque et pourquoi
            </div>

            <ZoneLabel first>{t.zone_hebdo}</ZoneLabel>
            <div className="flex items-center gap-1.5 mb-1 text-[10.5px]" style={{ color: FAINT }}>
              <Info size={11} /> {t.zone_hebdo_hint}
            </div>
            <div className="flex items-center gap-1.5 mb-3 flex-wrap">
              <CalendarDays size={12} color={mpAccent.primary} />
              <span className="text-[12.5px] font-semibold tabular-nums" style={{ color: INK }}>{isoWeekToRange(selectedWeek)}</span>
              {weekTrends[selectedWeek] !== null && weekTrends[selectedWeek] !== undefined && (
                <span className="text-[11px] font-semibold tabular-nums" style={{ color: weekTrends[selectedWeek] >= 0 ? GREEN : RED }}>
                  {weekTrends[selectedWeek] >= 0 ? "▲" : "▼"} {Math.abs(weekTrends[selectedWeek]).toFixed(0)}% {t.vs_semaine_prec}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 mb-4">
              <button onClick={() => setSelectedWeek((w) => Math.max(weekOptions[0], w - 1))} disabled={selectedWeek === weekOptions[0]}
                className="btn-lift shrink-0 w-7 h-7 rounded-full flex items-center justify-center" style={{ background: PANEL_QUIET, color: selectedWeek === weekOptions[0] ? "#3A362F" : MUTED }}>
                <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
              </button>
              <div ref={weekButtonsRef} className="flex items-center gap-2 overflow-x-auto pb-1" style={{ scrollBehavior: "smooth" }}>
                {weekOptions.map((w) => (
                  <button key={w} data-week={w} onClick={() => setSelectedWeek(w)} className="btn-lift shrink-0 flex items-center gap-1.5 text-[11.5px] font-semibold px-3 py-1.5 rounded-full"
                    style={{ background: selectedWeek === w ? mpAccent.primary : PANEL_QUIET, color: selectedWeek === w ? mpAccent.text : MUTED }}>
                    {weekTrends[w] !== null && weekTrends[w] !== undefined && (
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: selectedWeek === w ? mpAccent.text : (weekTrends[w] >= 0 ? GREEN : RED) }} />
                    )}
                    {w}
                  </button>
                ))}
              </div>
              <button onClick={() => setSelectedWeek((w) => Math.min(weekOptions[weekOptions.length - 1], w + 1))} disabled={selectedWeek === weekOptions[weekOptions.length - 1]}
                className="btn-lift shrink-0 w-7 h-7 rounded-full flex items-center justify-center" style={{ background: PANEL_QUIET, color: selectedWeek === weekOptions[weekOptions.length - 1] ? "#3A362F" : MUTED }}>
                <ChevronRight size={14} />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
              <TiltCard className="p-4" glow glowColor={mpAccent.primary} scrollReveal>
                <div className="text-[9.5px] uppercase tracking-wider mb-1" style={{ color: MUTED }}>CA HT</div>
                <div className={`tabular-nums text-[19px] font-bold ${weekCaPunch ? "punch" : ""}`}>{fmtEURk(weekCaAnimated)}</div>
              </TiltCard>
              <TiltCard className="p-4 reveal-d1" glow glowColor={mpAccent.primary} scrollReveal>
                <div className="text-[9.5px] uppercase tracking-wider mb-1" style={{ color: MUTED }}>{t.qte_mode}</div>
                <div className={`tabular-nums text-[19px] font-bold ${weekQtePunch ? "punch" : ""}`}>{fmtNum(weekQteAnimated)}</div>
              </TiltCard>
              <GlassCard className="p-4 reveal-d1" quiet scrollReveal>
                <div className="text-[9.5px] uppercase tracking-wider mb-1" style={{ color: FAINT }}>{t.suivi_prix}</div>
                <div className={`tabular-nums text-[19px] font-bold ${weekPrixPunch ? "punch" : ""}`}>{weeklyStats.prixMoyen !== null ? fmtEURplain(weekPrixAnimated) : "N/A"}</div>
              </GlassCard>
              <GlassCard className="p-4 reveal-d2" quiet scrollReveal>
                <div className="text-[9.5px] uppercase tracking-wider mb-1" style={{ color: FAINT }}>{t.tendance_4_semaines}</div>
                <div className="flex items-end gap-1 h-[26px] mt-1">
                  {weeklyTrend.map(([w, ca]) => (
                    <div key={w} className="flex-1 rounded-sm" style={{ height: `${Math.max(10, (ca / Math.max(...weeklyTrend.map((x) => x[1]))) * 100)}%`, background: w === selectedWeek ? mpAccent.primary : PANEL_BORDER }} title={`S${w}: ${fmtEURk(ca)}`} />
                  ))}
                </div>
              </GlassCard>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              <GlassCard className="p-4" scrollReveal>
                <Eyebrow hint={t.repartition_mp_semaine}>{t.repartition_mp_semaine}</Eyebrow>
                <div className="mt-2">
                  {weeklyStats.mpRows.slice(0, 8).map((r, i) => (
                    <StaggerRow key={r.mp} index={i} className="flex items-center gap-2.5 py-1.5" style={{ borderBottom: i < 7 ? `1px solid ${PANEL_BORDER_QUIET}` : "none" }}>
                      <span className="text-[11px] w-24 shrink-0 truncate" style={{ color: MUTED }}>{r.mp}</span>
                      <div className="flex-1 h-3.5 rounded-full relative overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.max(2, (r.ca / weeklyStats.mpRows[0].ca) * 100)}%`, background: mpAccent.primary }} />
                      </div>
                      <span className="tabular-nums text-[10.5px] w-14 text-right shrink-0" style={{ color: INK }}>{fmtEURk(r.ca)}</span>
                      <span className="tabular-nums text-[10px] w-12 text-right shrink-0" style={{ color: FAINT }}>{weeklyStats.mpTotalCa > 0 ? `${((r.ca / weeklyStats.mpTotalCa) * 100).toFixed(0)}%` : "N/A"}</span>
                    </StaggerRow>
                  ))}
                </div>
                {weeklyStats.mpTotalCa > 0 && (
                  <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${PANEL_BORDER_QUIET}` }}>
                    <div className="text-[9.5px] uppercase tracking-wider mb-1" style={{ color: FAINT }}>{t.part_ca_pct}</div>
                    <ResponsiveContainer width="100%" height={180}>
                      <PieChart>
                        <Pie data={weeklyPieData} dataKey="ca" nameKey="mp" cx="50%" cy="50%" outerRadius={70} label={({ mp, percent }) => `${mp} ${(percent * 100).toFixed(0)}%`} labelLine={false} style={{ fontSize: 9 }}>
                          {weeklyPieData.map((r, i) => (
                            <Cell key={r.mp} fill={r.mp === t.autres_lbl ? FAINT : (MARKETPLACE_COLORS[r.mp] && MARKETPLACE_COLORS[r.mp].primary) || [ORANGE, AMBER, GREEN, "#4A9EFF", RED, "#A78BFA", "#F472B6"][i % 7]} />
                          ))}
                        </Pie>
                        <Tooltip formatter={(v) => fmtEURplain(v)} contentStyle={{ background: "#16140F", border: `1px solid ${PANEL_BORDER}`, borderRadius: 10, fontSize: 11 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </GlassCard>

              <GlassCard className="p-4" scrollReveal>
                <Eyebrow hint={t.expeditions_hint}>{t.expeditions_titre}</Eyebrow>
                <div className="mt-2">
                  {weeklyStats.expRows.map((r, i) => (
                    <div key={r.exp} className="flex items-center gap-2.5 py-1.5" style={{ borderBottom: i < weeklyStats.expRows.length - 1 ? `1px solid ${PANEL_BORDER_QUIET}` : "none" }}>
                      <span className="text-[11px] w-24 shrink-0 truncate" style={{ color: MUTED }}>{r.exp}</span>
                      <div className="flex-1 h-3.5 rounded-full relative overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                        <div className="h-full rounded-full" style={{ width: `${Math.max(2, (r.qte / weeklyStats.expRows[0].qte) * 100)}%`, background: AMBER }} />
                      </div>
                      <span className="tabular-nums text-[10.5px] w-14 text-right shrink-0" style={{ color: INK }}>{r.qte} u.</span>
                      <span className="tabular-nums text-[10px] w-12 text-right shrink-0" style={{ color: FAINT }}>{weeklyStats.expTotalQte > 0 ? `${((r.qte / weeklyStats.expTotalQte) * 100).toFixed(0)}%` : "N/A"}</span>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
              <GlassCard className="p-4" quiet scrollReveal>
                <Eyebrow hint={t.entrepot_hint}>{t.entrepot_titre}</Eyebrow>
                <div className="mt-2">
                  {weeklyStats.entRows.map((r, i) => (
                    <div key={r.ent} className="flex items-center gap-2.5 py-1.5" style={{ borderBottom: i < weeklyStats.entRows.length - 1 ? `1px solid ${PANEL_BORDER_QUIET}` : "none" }}>
                      <span className="text-[11px] flex-1 truncate" style={{ color: MUTED }}>{r.ent}</span>
                      <span className="tabular-nums text-[11px] font-semibold shrink-0" style={{ color: INK }}>{r.qte} u.</span>
                      <span className="tabular-nums text-[10px] w-10 text-right shrink-0" style={{ color: FAINT }}>{weeklyStats.entTotalQte > 0 ? `${((r.qte / weeklyStats.entTotalQte) * 100).toFixed(0)}%` : "N/A"}</span>
                    </div>
                  ))}
                </div>
              </GlassCard>

              <GlassCard className="p-4" scrollReveal>
                <Eyebrow hint={t.top_semaine_titre}>{t.top_semaine_titre}</Eyebrow>
                <div className="mt-2">
                  {weeklyStats.topProducts.map((p, i) => (
                    <StaggerRow key={p.produit} index={i} className="flex items-center gap-2.5 py-1.5" style={{ borderBottom: i < weeklyStats.topProducts.length - 1 ? `1px solid ${PANEL_BORDER_QUIET}` : "none" }}>
                      <span className="text-[11px] flex-1 truncate" style={{ color: MUTED }}>{p.produit}</span>
                      <span className="tabular-nums text-[11px] font-semibold shrink-0" style={{ color: mpAccent.primary }}>{p.qte} u.</span>
                    </StaggerRow>
                  ))}
                </div>
              </GlassCard>
            </div>

            <ZoneLabel>{t.zone_abc}</ZoneLabel>
            <div className="grid grid-cols-2 gap-3 mb-2">
              <GlassCard className="p-4 col-span-2" quiet scrollReveal>
                <div className="text-[10px] uppercase tracking-[0.12em] font-semibold mb-1.5" style={{ color: MUTED }}>{t.sku_classes}</div>
                <div className="tabular-nums text-[26px] font-bold leading-none">{abcSummary.nbSku}</div>
                <div className="text-[11px] mt-1.5" style={{ color: FAINT }}>CA HT total : {fmtEUR(abcSummary.totalCa)}</div>
              </GlassCard>
              {["A","B","C","D"].map((cls, i) => {
                const d = abcSummary.byClass[cls];
                const pct = abcSummary.totalCa ? (d.ca / abcSummary.totalCa) * 100 : 0;
                const color = cls === "A" ? GREEN : cls === "B" ? AMBER : cls === "C" ? mpAccent.primary : FAINT;
                return (
                  <GlassCard key={cls} className={`p-4 ${i === 1 ? "reveal-d1" : i === 2 ? "reveal-d2" : i === 3 ? "reveal-d3" : ""}`} quiet scrollReveal>
                    <div className="text-[10px] uppercase tracking-[0.12em] font-semibold mb-1.5 flex items-center gap-1.5" style={{ color: MUTED }}>
                      <span className="w-2 h-2 rounded-full" style={{ background: color }} /> Classe {cls}
                    </div>
                    <div className="tabular-nums text-[23px] font-bold leading-none" style={{ color }}>{d.nb}<span className="text-[13px] font-normal" style={{ color: FAINT }}> SKU</span></div>
                    <div className="text-[11px] mt-1.5" style={{ color: FAINT }}>{pct.toFixed(1)}% du CA</div>
                  </GlassCard>
                );
              })}
            </div>
            <div className="flex items-center gap-1.5 mb-6 px-1 text-[10.5px]" style={{ color: FAINT }}>
              <Info size={11} /> A = forte contribution CA, D = contribution marginale — classification fournie directement par ton fichier, année 2026 uniquement (seule année avec cette donnée)
            </div>

            <ZoneLabel>{t.zone_saison}</ZoneLabel>
            <GlassCard className="p-5 mb-3" quiet scrollReveal>
              <div className="space-y-2">
                {seasonalityRows.map((r) => (
                  <div key={r.mois} className="flex items-center gap-3">
                    <span className="text-[11px] font-medium w-9 shrink-0" style={{ color: MUTED }}>{r.mois}</span>
                    <div className="flex-1 h-4 rounded-full relative overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                      <div className="absolute top-0 bottom-0" style={{ left: "38.5%", width: "1px", background: "rgba(255,255,255,0.15)" }} />
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, (r.index/2.6)*100)}%`, background: r.index > 1.3 ? `linear-gradient(90deg, ${AMBER}, ${RED})` : r.index < 0.6 ? "#4A9EFF" : mpAccent.primary }} />
                    </div>
                    <span className="tabular-nums text-[11.5px] font-semibold w-10 text-right shrink-0">{r.index.toFixed(2)}</span>
                    {r.mois === peakMonth.mois && <Flame size={13} color={RED} className="shrink-0" />}
                    {r.mois === troughMonth.mois && <Snowflake size={13} color="#4A9EFF" className="shrink-0" />}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-1.5 mt-4 pt-3 text-[10.5px]" style={{ color: FAINT, borderTop: `1px solid ${PANEL_BORDER_QUIET}` }}>
                <Info size={11} /> Indice = CA moyen du mois (2024+2025) ÷ CA moyen mensuel global. 1,00 = mois moyen. {peakMonth.mois} est le pic ({peakMonth.index.toFixed(2)}x), {troughMonth.mois} le creux ({troughMonth.index.toFixed(2)}x) — cohérent avec un produit de chauffage.
              </div>
            </GlassCard>

            <ZoneLabel>{t.zone_anticipation}</ZoneLabel>
            <div className="flex items-center gap-1.5 mb-3 px-1 text-[10.5px]" style={{ color: FAINT }}>
              <Info size={11} /> Fourchette, pas un chiffre unique — la croissance mois par mois 2026 vs 2025 est volatile (jusqu'à -13% un mois, +138% un autre). Basse = croissance YTD (jan-août, plus stable) · Haute = croissance récente (juin-août, plus réactive).
            </div>
            <div className="grid grid-cols-3 gap-3 mb-3">
              {["Oct","Nov","Déc"].map((m, i) => (
                <GlassCard key={m} className="p-4" quiet glow={m === "Nov"} glowColor={RED} scrollReveal>
                  <div className="text-[10px] uppercase tracking-[0.12em] font-semibold mb-1" style={{ color: MUTED }}>{{Oct:t.mois_oct_court,Nov:t.mois_nov_court,"Déc":t.mois_dec_court}[m]} 2026</div>
                  <div className="tabular-nums text-[15px] font-bold">{fmtEURk(anticipation.parMois[i].bas)} <span className="text-[11px] font-normal" style={{ color: FAINT }}>–</span> {fmtEURk(anticipation.parMois[i].haut)}</div>
                </GlassCard>
              ))}
            </div>
            <div className="flex items-center gap-1.5 mb-6 px-1 text-[10.5px]" style={{ color: FAINT }}>
              <Info size={11} /> Total anticipé oct-déc : {fmtEUR(anticipation.bas)} à {fmtEUR(anticipation.haut)} · croissance YTD +{(anticipation.growthYtd*100).toFixed(0)}%, croissance récente +{(anticipation.growthRecent*100).toFixed(0)}% · pas une boîte noire, les deux méthodes sont explicites. À affiner si tu as un budget ou une tendance plus récente à intégrer.
            </div>

            <SectionHeader hint={t.anticipation_mp_hint}>{t.anticipation_mp_titre}</SectionHeader>
            <GlassCard className="p-1.5 mb-6" scrollReveal>
              {anticipationByMp.map((r, i) => (
                <StaggerRow key={r.mp} index={i} className="flex items-center gap-3 px-3 py-2.5" style={{ borderBottom: i < anticipationByMp.length - 1 ? `1px solid ${PANEL_BORDER_QUIET}` : "none" }}>
                  <span className="text-[12px] w-28 shrink-0 truncate" style={{ color: INK }}>{r.mp}</span>
                  <div className="flex-1 h-4 rounded-full relative overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.max(2, (r.total/anticipationByMp[0].total)*100)}%`, background: mpAccent.primary }} />
                  </div>
                  <span className="tabular-nums text-[11.5px] font-semibold w-32 text-right shrink-0">{fmtEURk(r.bas)}–{fmtEURk(r.haut)}</span>
                </StaggerRow>
              ))}
            </GlassCard>

            <ZoneLabel>{t.zone_manquant}</ZoneLabel>
            <GlassCard className="p-5" quiet scrollReveal>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-[12px]" style={{ color: MUTED }}>
                <div>
                  <div className="font-semibold mb-1" style={{ color: INK }}>{t.manque_stock_titre}</div>
                  <div style={{ color: FAINT }}>{t.manque_stock_texte}</div>
                </div>
                <div>
                  <div className="font-semibold mb-1" style={{ color: INK }}>{t.manque_transport_titre}</div>
                  <div style={{ color: FAINT }}>{t.manque_transport_texte}</div>
                </div>
              </div>
            </GlassCard>
          </>
        )}
      </main>

      <footer className="no-print relative z-10 max-w-[1240px] xl:max-w-[1400px] mx-auto px-5 lg:px-8 py-10 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 opacity-70">
          <HomyLogo size={16} color={MUTED} /><span style={{ color: FAINT }}>·</span>
          <BesthermLogo size={11} color={FAINT} showMark={false} /><ThomsonLogo size={10} color={FAINT} />
        </div>
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-1 rounded-full p-0.5" style={{ background: PANEL_QUIET, border: `1px solid ${PANEL_BORDER_QUIET}` }}>
            {[{ id: "fr", label: "FR" }, { id: "en", label: "EN" }, { id: "es", label: "ES" }, { id: "zh", label: "中文" }].map((l) => (
              <button key={l.id} onClick={() => setLang(l.id)} className="btn-lift text-[10.5px] font-semibold px-2.5 py-1 rounded-full"
                style={{ background: lang === l.id ? `linear-gradient(135deg, ${ORANGE}, ${ORANGE_SOFT})` : "transparent", color: lang === l.id ? "#0A0908" : MUTED }}>
                {l.label}
              </button>
            ))}
          </div>
          <button onClick={toggleDemoMode} title={t.demo_mode_tooltip} aria-label={t.demo_mode_tooltip}
            className="btn-lift p-1.5 rounded-full" style={{ background: demoMode ? `${AMBER}22` : PANEL_QUIET, border: `1px solid ${demoMode ? AMBER + "55" : PANEL_BORDER_QUIET}`, color: demoMode ? AMBER : FAINT }}>
            <EyeOff size={12} />
          </button>
          <span className="text-[11px] flex items-center gap-1" style={{ color: FAINT }}>{t.tous_montants_ht} <ChevronRight size={11} /></span>
          <span className="text-[10.5px] flex items-center gap-1.5 px-2 py-1 rounded-full" style={{
            color: liveConnection.status === "connected" ? GREEN : liveConnection.status === "error" ? RED : FAINT,
            background: liveConnection.status === "connected" ? `${GREEN}18` : "transparent",
          }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: liveConnection.status === "connected" ? GREEN : liveConnection.status === "error" ? RED : FAINT }} />
            {liveConnection.status === "not_configured" && t.donnees_statiques}
            {liveConnection.status === "loading" && "Connexion en cours…"}
            {liveConnection.status === "connected" && `Live · ${liveConnection.data.nb_lignes_ventes} lignes · ${liveConnection.syncedAt.toLocaleTimeString("fr-FR")}`}
            {liveConnection.status === "error" && `Échec connexion (${liveConnection.error})`}
          </span>
        </div>
      </footer>
      <BottomTabBar tab={tab} onChange={changeTab} t={t} />
    </div>
    </AccentContext.Provider>
  );
}

/* filet de sécurité : si une erreur JS survient pendant le rendu (bug futur,
   donnée inattendue…), affiche un écran de secours propre plutôt qu'un
   écran blanc total — particulièrement important en contexte de présentation
   devant un client, où un plantage brut serait le pire moment possible */
class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false }; }
  static getDerivedStateFromError() { return { hasError: true }; }
  componentDidCatch(error, info) { console.error("Erreur applicative :", error, info); }
  render() {
    if (this.state.hasError) {
      // ErrorBoundary est au-dessus de DashboardApp dans l'arbre : il n'a pas
      // accès à son état "lang" interne (remonter cet état casserait potentiellement
      // le chemin normal pour un gain minime sur cet écran de secours rare).
      // Détection autonome via la langue du navigateur à la place.
      const browserLang = (typeof navigator !== "undefined" && navigator.language || "fr").slice(0, 2);
      const et = I18N[browserLang] && I18N[browserLang].erreur_titre ? I18N[browserLang] : I18N.fr;
      return (
        <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center" style={{ background: BG, color: INK }}>
          <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: `${ORANGE}22` }}>
            <AlertTriangle size={18} color={ORANGE_SOFT} />
          </div>
          <p className="text-[14px] font-semibold">{et.erreur_titre}</p>
          <p className="text-[12.5px] max-w-xs" style={{ color: MUTED }}>{et.erreur_msg}</p>
          <button onClick={() => window.location.reload()} className="btn-lift text-[12px] font-semibold px-5 py-2 rounded-full mt-1"
            style={{ background: `linear-gradient(135deg, ${ORANGE}, ${ORANGE_SOFT})`, color: "#0A0908" }}>
            {et.recharger}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  // null = vérification de session en cours (bref), true/false = résultat.
  // Évite de redemander le mot de passe à chaque rafraîchissement tant que
  // le cookie de session (émis par /api/login, HttpOnly) reste valide —
  // /api/data sert ici uniquement à tester si la session est valide.
  const [unlocked, setUnlocked] = useState(null);
  useEffect(() => {
    fetch("/api/data").then((res) => {
      if (!res.ok) { setUnlocked(false); return; }
      return res.json().then((json) => { populateData(json); setUnlocked(true); });
    }).catch(() => setUnlocked(false));
  }, []);
  if (unlocked === null) return <div className="fixed inset-0" style={{ background: BG }} />;
  return (
    <ErrorBoundary>
      {unlocked ? <DashboardApp /> : <EntryGate onUnlock={() => setUnlocked(true)} />}
    </ErrorBoundary>
  );
}
