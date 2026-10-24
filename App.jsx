import React, { useState, useMemo, useEffect, useRef, useLayoutEffect, useContext, createContext } from "react";
import {
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, BarChart, Bar, Line, ComposedChart,
  RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar as RadarSeries,
  PieChart, Pie, Cell, ScatterChart, Scatter, ZAxis, ReferenceLine
} from "recharts";
import {
  TrendingUp, TrendingDown, ChevronRight,
  X, Package, Store, Megaphone, LayoutGrid, Info, Minus, AlertTriangle, Lock, Tag, Search, CalendarDays, Sparkles, Radar, ExternalLink, ShieldAlert, ShieldCheck, ShieldQuestion, Truck, Snowflake, Flame, EyeOff, Eye, Check, Download
} from "lucide-react";
import { construire, squelette } from "./socle.js"; // calcul de tous les chiffres à partir des ventes Shopify (voir « DONNÉES »)
import SHOPIFY_EXT from "./shopify_extension.json"; // ventes des deux boutiques Shopify, jour par jour (actualisé chaque matin)
import REFERENTIEL from "./data/referentiel.json"; // table de référence : nom, marque, famille, norme de chaque produit ; objectifs du plan
import HORS_SHOPIFY from "./data/hors_shopify.json"; // chiffres sans source Shopify (publicité), conservés tels quels
import { construireRepartitions, vue as repVue, matrice as repMatrice, partsParMarketplace as repParts, replier, attribuerCouleurs, dispoQte, infoMois, AUTRES_PRODUITS, NB_SERIES, GRIS } from "./repartitions.js"; // répartitions pays / marque / type de produit × mois × marketplace (page Marques) // onglet Marques › Répartitions : calculs purs

/* ============================================================================ DONNÉES (Shopify uniquement, HT) */
// Plus aucun fichier Excel : tous les chiffres ci-dessous sont recalculés au chargement par socle.js à partir des ventes des
// deux boutiques Shopify (shopify_extension.json, actualisé chaque matin : marketplaces BESTHERM + site bestherm.fr) et de la
// table de référence data/referentiel.json (nom, marque, famille, norme de chaque produit ; objectifs du plan). Ils sont donc
// cohérents entre eux et arrêtés au même jour (DMAX). Voir scripts/extension/README.md.
// Atomique : si l'extraction est invalide, rien n'est construit et l'application affiche un écran d'erreur (DonneesIndisponibles).
//  DATA              KPI, courbes mensuelles (total, marques, marketplaces, normes), comparaisons N-1 à date identique,
//                    marketplaces vs objectif, meilleurs produits, suivi des prix, catégories. DATA.ads et DATA.country_ads
//                    (publicité) ne viennent PAS de Shopify : data/hors_shopify.json, conservés tels quels.
//  SKU_PRODUIT       produits vendus (année précédente et en cours) ; SKU_MONTHLY : [indexProduit, indexMp, année, mois, ca, qté] ;
//                    SKU_MPS : marketplaces ; SKU_DESTOCKAGE / SKU_FAMILLE / SKU_WIFI / SKU_PLINTHE / SKU_VERTICAL /
//                    SKU_SOUS_FAMILLE / SKU_SOUS_SOUS_FAMILLE : tableaux parallèles à SKU_PRODUIT (table de référence)
//  PAYS_MONTHLY      [pays, marketplace, année, mois, ca, quantité] (année précédente et en cours ; la quantité n'est présente que pour une année dont toutes
//                    les lignes d'extraction en portent une) ; SKU_MARQUE : marque de chaque produit (parallèle à SKU_PRODUIT) ; SKU_CUT_N1 : ventes de l'année
//                    précédente du 1er du mois au jour de DMAX, [indexProduit, indexMp, ca, qté]
//  WEEKLY_*          semaines Excel (dimanche→samedi, semaine 1 = celle du 1er janvier) de l'année en cours
//  ELASTICITE_DATA   élasticité-prix par produit × marketplace : régression log-log (ln qté ~ ln prix) sur les semaines complètes
//                    de l'année en cours (au moins 4 semaines et 2 % de variation de prix ; « fiable » : 8 semaines, R² ≥ 0,25,
//                    5 % de variation) ; [produit, marketplace, élasticité, r2, nb_semaines, qté_moy, prix_moy, fiable, …]
//  SIMULATION_PRIX   hausse de +5 % simulée d'après ELASTICITE_DATA : « opportunites » (élasticité entre -1 et 0, même à R² faible)
//                    et « risques » (élasticité ≤ -1 ET fiable), triées par CA réel en jeu
//  BASKET_PAIRS      paires de produits achetés dans une même commande Shopify (année en cours) ; ABC_BY_SKU : classes ABC par
//                    CA (A jusqu'à 50 % du CA cumulé, B 80 %, C 98 %, D le reste, NC sans vente) ; SEASONALITY_INDEX : poids de
//                    chaque mois dans le CA des deux années complètes précédentes ; PRODUCT_TO_CATEGORY : catégorie par produit
const SOCLE = (() => {
  let r;
  try { r = construire(SHOPIFY_EXT, REFERENTIEL, { horsShopify: HORS_SHOPIFY }); }
  catch (e) { r = { appliquee: false, erreurs: [String((e && e.message) || e)], avertissements: [] }; }
  return r.appliquee ? r : { ...r, ...squelette() }; // extraction inutilisable : constantes vides, écran d'erreur (App)
})();
const {
  DATA, ELASTICITE_DATA, SIMULATION_PRIX, SKU_PRODUIT, SKU_MPS, SKU_MONTHLY, SKU_DESTOCKAGE, SKU_FAMILLE, SKU_WIFI, SKU_PLINTHE,
  SKU_VERTICAL, SKU_SOUS_FAMILLE, SKU_SOUS_SOUS_FAMILLE, SKU_MARQUE, PRODUCT_TO_CATEGORY, ABC_BY_SKU, SEASONALITY_INDEX, PAYS_MONTHLY,
  SKU_CUT_N1, BASKET_PAIRS, WEEKLY_TOTALS, WEEKLY_BY_MP, WEEKLY_BY_PROD,
} = SOCLE.C;








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
const PASSWORD = "Anthony<3";
// le clavier mobile remplace souvent "<3" par un cœur ❤ à la frappe — on
// reconvertit ces variantes avant de comparer, pour ne jamais bloquer
// quelqu'un qui a tapé le bon mot de passe mais dont le clavier l'a réécrit
function normalizePwd(s) {
  return s.trim().replace(/[\u2764\uFE0F\u2665\uFE0E💕💗💓💞🩷]/g, "<3");
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
const DMIN = "2024-01-01"; // premier jour affiché : début de l'historique Shopify des marketplaces
// Le dernier jour de données affiché (DMAX) et l'index du mois en cours (MOIS_EN_COURS_IDX) sont définis plus bas, d'après les
// ventes Shopify.

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
  const [unlocking, setUnlocking] = useState(false);
  const [success, setSuccess] = useState(false);
  const [show, setShow] = useState(false);
  const [showPwd, setShowPwd] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [focused, setFocused] = useState(false);
  const [parallax, setParallax] = useState({ x: 0, y: 0 });
  const reduitMotion = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // EntryGate précède le montage de DashboardApp : "lang" n'existe pas encore
  // à ce stade (même contrainte qu'ErrorBoundary) — détection autonome via le
  // navigateur pour cet écran précis, indépendante du sélecteur de langue in-app.
  const browserLang = (typeof navigator !== "undefined" && navigator.language || "fr").slice(0, 2);
  const et = I18N[browserLang] && I18N[browserLang].entry_acces_restreint ? I18N[browserLang] : I18N.fr;

  useEffect(() => {
    const t = setTimeout(() => setShow(true), 40);
    return () => clearTimeout(t);
  }, []);

  // parallaxe souris, desktop uniquement (pointeur fin) et seulement si
  // l'utilisateur n'a pas demandé de réduire les animations
  useEffect(() => {
    if (reduitMotion || !window.matchMedia("(pointer: fine)").matches) return;
    const onMove = (e) => {
      const px = e.clientX / window.innerWidth, py = e.clientY / window.innerHeight;
      setParallax({ x: (px - 0.5) * 14, y: (py - 0.5) * 10 });
    };
    window.addEventListener("mousemove", onMove);
    return () => window.removeEventListener("mousemove", onMove);
  }, [reduitMotion]);

  const tryUnlock = () => {
    if (normalizePwd(pwd) === PASSWORD) {
      if (rememberMe) memoriserSession();
      setSuccess(true);
      setTimeout(() => setUnlocking(true), 550);
      setTimeout(onUnlock, 1050);
    } else {
      setError(true); setTimeout(() => setError(false), 500);
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
        @keyframes checkPop { 0%{opacity:0; transform:scale(0.6)} 60%{transform:scale(1.12)} 100%{opacity:1; transform:scale(1)} }
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
        .check-pop { animation: checkPop 0.4s cubic-bezier(.34,1.56,.64,1) both; }
        .grain-overlay { opacity: 0.05; mix-blend-mode: overlay; background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='120' height='120'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E"); }
        .btn-lift { transition: transform 0.18s cubic-bezier(.22,1,.36,1), filter 0.18s; }
        .btn-lift:hover { transform: translateY(-1px); filter: brightness(1.08); }
        .btn-lift:active { transform: translateY(0px) scale(0.98); }
        .gate-input { transition: border-color 0.25s ease, box-shadow 0.25s ease, transform 0.2s cubic-bezier(.22,1,.36,1); }
        .gate-input:focus { box-shadow: 0 0 0 4px ${ORANGE}22; }
        .gate-parallax { transition: transform 0.15s ease-out; }
        .gate-checkbox { transition: background 0.18s, border-color 0.18s; }
        @media (prefers-reduced-motion: reduce) {
          .icon-pop, .float-up, .gate-orb1, .gate-orb2, .warm-bar, .water-rise, .steam, .panel-led, .check-pop { animation: none !important; opacity: 1 !important; transform: none !important; }
          .gate-parallax { transition: none !important; transform: none !important; }
        }
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
            {/* rangée d'icônes en flexbox — parallaxe subtile liée à la souris,
                désactivée sur tactile et si prefers-reduced-motion */}
            <div className="gate-parallax flex items-center gap-3 sm:gap-5 mb-7" style={{ transform: `translate(${parallax.x}px, ${parallax.y}px)` }}>
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

            {success ? (
              <div className="check-pop flex flex-col items-center gap-2" style={{ minHeight: 96 }}>
                <div className="w-12 h-12 rounded-full flex items-center justify-center" style={{ background: `${GREEN}18`, border: `1px solid ${GREEN}40` }}>
                  <Check size={20} color={GREEN} />
                </div>
                <span className="text-[12px] font-medium" style={{ color: INK }}>{et.entry_succes}</span>
              </div>
            ) : (
              <div className={`float-up flex flex-col items-center gap-3 ${error ? "shake" : ""}`} style={{ animationDelay: "620ms" }}>
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.14em]" style={{ color: FAINT }}><Lock size={12} /> {et.entry_acces_restreint}</div>
                <div className="relative">
                  <input
                    type={showPwd ? "text" : "password"} value={pwd}
                    onChange={(e) => setPwd(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") tryUnlock(); }}
                    onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
                    autoFocus placeholder={et.entry_placeholder}
                    className="gate-input text-center text-[14px] tabular-nums rounded-xl pl-4 pr-10 py-2.5 outline-none"
                    style={{ background: PANEL, border: `1px solid ${error ? RED : focused ? ORANGE : PANEL_BORDER}`, color: INK, width: 220, colorScheme: "dark" }}
                  />
                  <button type="button" onClick={() => setShowPwd((v) => !v)} tabIndex={-1}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 btn-lift" style={{ color: FAINT }} aria-label={showPwd ? et.entry_masquer : et.entry_afficher}>
                    {showPwd ? <EyeOff size={15} /> : <Eye size={15} />}
                  </button>
                </div>

                <label className="flex items-center gap-1.5 cursor-pointer select-none" style={{ color: FAINT }}>
                  <span className="gate-checkbox w-3.5 h-3.5 rounded flex items-center justify-center shrink-0"
                    style={{ background: rememberMe ? ORANGE : "transparent", border: `1px solid ${rememberMe ? ORANGE : PANEL_BORDER}` }}
                    onClick={() => setRememberMe((v) => !v)}>
                    {rememberMe && <Check size={10} color="#0A0908" strokeWidth={3} />}
                  </span>
                  <span className="text-[10.5px]" onClick={() => setRememberMe((v) => !v)}>{et.entry_se_souvenir}</span>
                </label>

                <button
                  type="button" onClick={tryUnlock}
                  className="btn-lift text-[12px] font-semibold px-5 py-2 rounded-full"
                  style={{ background: `linear-gradient(135deg, ${ORANGE}, ${ORANGE_SOFT})`, color: "#0A0908" }}
                >
                  {et.entry_entrer}
                </button>
                {error && <span className="text-[11px]" style={{ color: RED }}>{et.entry_erreur}</span>}
              </div>
            )}
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
    <div ref={scrollReveal ? revealRef : undefined} className={`relative rounded-2xl backdrop-blur-xl liquid-glass ${scrollReveal ? `scroll-reveal ${isVisible ? "is-visible" : ""}` : ""} ${className}`}
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
// SOUS_INFOS : true rétablit les sous-titres explicatifs sous les titres et les notes de méthode sous les graphiques
// (retirés le 17 octobre 2026 à la demande de l'utilisateur : « garde l'essentiel »).
const SOUS_INFOS = false;
function Eyebrow({ children, tone = "primary", hint }) {
  const accent = useContext(AccentContext);
  return (
    <div className="mb-2">
      <div className="flex items-center gap-1.5">
        <span className="w-3 h-[1.5px]" style={{ background: tone === "primary" ? accent.primary : FAINT }} />
        <span className="text-[10px] tracking-[0.16em] uppercase font-semibold" style={{ color: tone === "primary" ? accent.primary : MUTED }}>{children}</span>
      </div>
      {SOUS_INFOS && hint && <div className="text-[9.5px] mt-0.5 pl-[18px] opacity-75" style={{ color: FAINT }}>{hint}</div>}
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
function SectionHeader({ children, hint, essentiel }) {
  const accent = useContext(AccentContext);
  return (
    <div className="mb-4">
      <div className="flex items-center gap-2.5">
        <span className="w-6 h-[3px] rounded-full transition-colors duration-300" style={{ background: `linear-gradient(90deg, ${accent.primary}, ${accent.primary}bb)` }} />
        <h2 className="text-[14.5px] tracking-[0.02em] font-bold" style={{ color: INK }}>{children}</h2>
      </div>
      {(SOUS_INFOS || essentiel) && hint && <div className="text-[11.5px] mt-1 pl-[34px]" style={{ color: MUTED }}>{hint}</div>}
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

const I18N = {
  fr: {
    /* repartitions */ rep_tab: "Répartitions", rep_titre: "Répartitions par mois et par marketplace", rep_pays: "Pays", rep_marque: "Marque", rep_type: "Type de produit", rep_categorie: "Catégorie", rep_sous: "Sous-catégorie", rep_ca: "CA HT", rep_qte: "Quantités", rep_evolution: "Évolution mensuelle", rep_classement: "Classement", rep_detail: "Détail par marketplace et par mois", rep_total: "Total", rep_toutes: "Toutes les marketplaces", rep_marketplace: "Marketplace", rep_marketplaces: "Sous-total marketplaces", rep_valeurs: "Valeurs", rep_parts: "Parts", rep_graphique: "Graphique", rep_tableau: "Tableau", rep_montant: "Montant", rep_part: "Part", rep_part_de: "Part de {x} dans le total de chaque case (marketplace × mois)", rep_mix: "Répartition", rep_col_part: "Part", rep_vide: "Aucune vente sur cette sélection.", rep_retirer: "Retirer ce filtre", rep_autres: "Autres ({n})", rep_autres_produits: "Autres produits", rep_marque_inconnue: "Marque non renseignée", rep_tous_pays: "Tous les pays", rep_toutes_marques: "Toutes les marques", rep_tous_types: "Tous les types de produit", rep_astuce_classement: "Touchez une ligne pour isoler son détail par marketplace.", rep_astuce_mp: "Touchez une marketplace pour filtrer le graphique et le classement.", rep_qte_indispo: "Quantités indisponibles pour cette année et ce découpage (l'extraction Shopify ne les fournit pas) : le CA est affiché.", rep_site_prec: "Site web 2025 : ses ventes ne commencent qu'en mai 2025 dans Shopify : ne pas le comparer à 2026 sur l'année entière.", rep_en_cours: "Mois en cours, données jusqu'au {d}", rep_en_cours_court: "mois en cours", rep_lien_marque: "Détail par mois et par marketplace", rep_hors_france: "Hors France",
    /* donnees */ donnees_titre: "Données Shopify à jour", donnees_jusqua: "jusqu'au {date}", donnees_socle: "Source unique : Shopify (marketplaces BESTHERM et site web), du {du} au {au}", donnees_perime: "Non actualisé depuis {n} j", donnees_tout: "Tous les chiffres du tableau de bord (KPI, courbes, marketplaces, marques, produits, pays, catégories, prix, élasticités, paniers, comparaisons avec 2025) sont recalculés à partir des ventes Shopify.", donnees_base: "Marketplaces : CA HT = (ventes nettes + taxes) ÷ 1,2, la marketplace étant celle de la passerelle de paiement de chaque commande. Site web : ventes nettes hors taxes, remises et retours déduits, comme dans Shopify.", donnees_site_depuis: "Le site web n'existe dans Shopify que depuis le {du} : ses ventes antérieures ne sont pas dans les chiffres, donc les comparaisons avec 2025 sont partielles pour le site et pour le total.", donnees_bricoman: "Bricoman ne se distingue pas de Leroy Merlin dans Shopify : ses ventes sont comptées dans Leroy Merlin.", donnees_hors: "Ne viennent pas de Shopify (conservés tels quels) : publicité, concurrence, objectifs du plan, famille et norme de chaque produit, fiches du catalogue.", donnees_maj: "Actualisé chaque matin · dernière extraction : {date}.", donnees_graph: "CA HT par jour (30 derniers jours)", suivi_jours: "{n} j", suivi_ca: "CA HT", suivi_vs: "vs {plage}", suivi_n1: "{an} · mêmes jours", suivi_n1_mp: "{an} · marketplaces", suivi_toucher: "Touchez un jour pour voir son top 10, ses marketplaces et ses pays", suivi_top10: "Top 10 produits", suivi_pays: "Part du CA par pays", suivi_aucune: "Aucune vente sur ces jours", suivi_autres: "Autres", suivi_nouveau: "nouveau", suivi_u: "u.", suivi_pt: "pt", suivi_entiere: "Période entière", suivi_delta_mp: "Δ marketplaces", suivi_tab_top: "Produits", suivi_tab_mp: "Marketplaces", suivi_tab_pays: "% par pays", suivi_top10_mp: "Top 10 marketplaces", suivi_meme_date: "Même date", suivi_meme_semaine: "Même jour de semaine", suivi_obj_leg: "Objectif (plan 2026)", suivi_obj_jour: "Objectif du jour", suivi_obj_per: "Objectif", obj_2026_nom: "Objectif 2026", obj_2026_mensuel: "Objectif 2026 (plan mensuel)", suivi_commandes: "Commandes", suivi_panier: "Panier moyen", donnees_mp: "Marketplaces", donnees_site: "Site web", donnees_source: "Source : Shopify", donnees_indispo_titre: "Données Shopify indisponibles", donnees_indispo_msg: "Les ventes Shopify sont illisibles ou incomplètes : le tableau de bord ne peut pas s'afficher. La prochaine actualisation du matin les reconstruit ; sinon, contactez le support.",
    nav_apercu: "Vue d'ensemble", nav_marketplaces: "Marketplaces", nav_marques: "Marques & Produits", nav_prix: "Suivi Prix", nav_ads: "Campagnes Ads", nav_concurrence: "Concurrence", nav_data: "Data", data_hint: "Sélectionne un ou plusieurs produits pour générer un rapport Excel détaillé", data_titre: "Extraction de données", data_intro: "Choisis des produits et génère un rapport Excel avec répartition par canal, prix HT/TTC et évolution mensuelle — comme un export à la demande.", data_recherche_placeholder: "Rechercher un produit…", data_aucun_resultat: "Aucun produit trouvé", data_aucune_selection: "Aucun produit sélectionné", data_produits_selectionnes_sg: "produit sélectionné", data_produits_selectionnes_pl: "produits sélectionnés", data_tout_deselectionner: "Tout désélectionner", data_generation_en_cours: "Génération…", data_generer_excel: "Générer Excel", data_erreur_generation: "Erreur lors de la génération — réessaie, ou vérifie ta connexion (le fichier de mise en forme se charge depuis internet).", data_note_contenu: "Le rapport contient 3 onglets : synthèse, répartition par canal (marketplace, prix HT/TTC), et évolution mensuelle 2024-2026. TVA appliquée : 20% (standard France, à ajuster si besoin).", promo_titre: "Sélection prix promo", promo_externe_desc: "Outil collaboratif partagé avec toute l'équipe en temps réel — s'ouvre dans un nouvel onglet.", promo_ouvrir_outil: "Ouvrir l'outil collaboratif",
    pilotage: "Pilotage", marketplace_label: "Marketplace :", toutes_mp: "Toutes marketplaces", mode_presentation: "Mode présentation", reset: "réinitialiser",
    analyser_periode: "Analyser la période :", vs_an_dernier: "l'an dernier", ht_suffix: "Tous montants HT",
    ca_cumule: "CA HT cumulé YTD", ca_cumule_hint: "Somme du CA HT de toutes les commandes depuis le 1er janvier 2026",
    toutes_marketplaces_suffix: "toutes marketplaces", objectif_2026: "sur", objectif_non_defini: "objectif non défini",
    panier_moyen: "Prix moyen HT", panier_moyen_hint: "CA HT total ÷ nombre de commandes, 2026", unites_vendues: "unités vendues",
    meilleure_vente: "Meilleure vente 2026", meilleure_vente_hint: "Produit au CA HT cumulé le plus élevé depuis janvier",
    vs_meilleure_n1: "Vs meilleure vente N-1", vs_meilleure_n1_hint: "Même produit, CA HT comparé à la même fenêtre 2025", en_2025: "sur la même période 2025",
    non_comparable: "non comparable", indispo_par_mp: "indisponible par marketplace", detail_non_conserve: "détail par marketplace non conservé pour 2025",
    tendance_titre: "Tendance CA HT — une courbe par année", tendance_hint: "Un graphique par année, même échelle verticale pour comparer honnêtement les courbes",
    ca_ht_total_titre: "CA HT total — toutes marketplaces, à date", ca_ht_total_hint: "Somme du CA HT 2026 de toutes les marketplaces suivies",
    au_rythme: "au rythme attendu", top3: "Top 3", top3_hint: "Les 3 marketplaces au CA HT cumulé 2026 le plus élevé", de_word: "de", nouveau: "nouveau",
    est_fin_annee: "Estimation fin d'année", objectif_non_defini_mp: "Objectif annuel non défini pour cette marketplace", legende_reel: "Réel", legende_anticipe: "Anticipé", reparti_saisonnier: "d'après le plan mensuel 2026",
    repartition_pays_titre: "Répartition par pays", repartition_pays_hint: "Vraies commandes par pays — pas une estimation ads. 2024 exclu (pas de détail pays cette année-là)", aucune_donnee_pays: "Aucune donnée pays sur cette sélection — vérifie que la période inclut 2025 ou 2026.", pub_par_pays: "Publicité par pays", depense_ads: "dépense ads", conc_titre: "Concurrence", conc_hint: "Veille collectée manuellement par recherche web — France. Aucun prix, classement ou volume inventé.", conc_position_heater: "Position Heater — ", conc_position_cooling: "Position Cooling — ", conc_radiateurs: "Radiateurs — ", conc_secheserviettes: "Sèche-serviettes — ", conc_produits_suivis: "Produits suivis", conc_produits_suivis_hint: "Sélection actuelle (segment/sous-catégorie/marketplace)", conc_prix_moyen: "Prix moyen", conc_prix_moyen_hint: "Sur les produits où le prix a pu être vérifié", conc_fourchette_prix: "Fourchette prix", conc_fourchette_prix_hint: "Du moins cher au plus cher, prix vérifiés uniquement", conc_en_promo: "En promotion", conc_en_promo_hint: "Produits affichant une remise vs prix de référence", conc_sources_qualite: "Sources et qualité", conc_sources_qualite_hint: "Fiabilité de la collecte par sous-catégorie et marketplace — méthodologie et limites propres à chaque source", conc_marques_visibles: "Marques les plus visibles", conc_marques_visibles_hint: "Marques les plus présentes dans la collecte, toutes marketplaces confondues (nombre d'apparitions, pas de part de marché réelle)", conc_aucun_produit: "Aucun produit pour cette sélection", conc_sponsorise: "Sponsorisé", conc_prix_nd: "Prix n/d", conc_comparatif_prix_mp: "Comparatif prix par marketplace", conc_comparatif_prix_mp_hint: "Prix vérifiés uniquement — les produits sans prix extrait de façon fiable n'apparaissent pas ici", conc_aucun_prix_verifie: "Aucun prix vérifié sur cette sélection", conc_moy: "moy.", conc_vs_marche: "Bestherm/Thomson vs marché", conc_vs_marche_hint: "Prix Bestherm/Thomson comparés à la moyenne des concurrents (Bestherm/Thomson exclus du calcul de cette moyenne) — uniquement où un vrai prix concurrent a pu être vérifié", conc_pas_de_comparaison: "Pas encore de prix concurrent vérifié dans la même sous-catégorie qu'un produit Bestherm/Thomson, sur cette sélection — comparaison impossible pour l'instant plutôt qu'approximative.", conc_exporter: "Exporter :", conc_nomme_date: "Nommé à la date du jour · reflète la sélection en cours (segment/sous-catégorie/marketplace)", zone_marque: "Marque", zone_produits_titre: "Produits", zone_normes: "Normes", zone_puissances: "Puissances", subnav_produit_ideal: "Produit idéal", subnav_normes_cat: "Normes & Catégories", topflop_titre: "Tops & Flops", topflop_hint: "Filtrable date + marketplace comme le reste de l'app · accessoires et pièces détachées exclus", top5_hint: "Meilleures performances sur la sélection actuelle", flop5_hint: "Performances les plus faibles sur la sélection actuelle, hors accessoires", aucune_donnee: "Aucune donnée", cycle_vie_titre: "Cycle de vie produit", cycle_vie_hint: "Compare juillet-septembre 2026 à la même période 2025 (pas les mois précédents, pour ne pas confondre saisonnalité et vraie tendance) — respecte le filtre marketplace", panier_titre: "Souvent achetés ensemble", panier_hint: "Produits réellement achetés ensemble (même numéro de commande), 2025+2026 — donnée globale, pas encore filtrable par marketplace ou période", panier_croise_hint: "Radiateur + sèche-serviette dans la même commande — signal de rénovation salle de bain complète", panier_croise_titre: "Ventes croisées radiateur × sèche-serviette", panier_toutes_hint: "Toutes paires confondues, y compris même gamme à puissances différentes", panier_toutes_titre: "Toutes paires — top 8", prix_regulier_ideal: "Prix régulier idéal", prix_promo_ideal: "Prix promo idéal*", toutes_categories: "Toutes catégories", aucune_donnee_qte: "Aucune donnée de quantité sur cette sélection", puissances_vendues_titre: "Puissances les plus vendues", puissances_vendues_hint: "Quantité vendue par puissance, filtrable date + marketplace comme le reste de l'app", supply_titre: "Supply", supply_hint: "Construit uniquement sur des données réellement disponibles — classification ABC (2026), historique de ventes (2024-2026). Aucune donnée stock, transport ou fournisseur n'existe dans les fichiers fournis.", comparatif_prix_titre: "Comparatif par produit", comparatif_prix_hint: "Prix le plus haut et le plus bas entre marketplaces (2026), qui en vend le plus, écart en %, prix moyen pondéré. Marketplaces \"Non identifié\"/\"Autre\" exclues du comparatif — pas de vraie marketplace identifiable.", cp_vend_plus: "Vend le plus", cp_prix_moyen: "Prix moyen", signal_premium: "Positionnement premium", signal_sensible: "Sensible au prix", signal_neutre: "Signal neutre", radar_fiabilite_insuffisante: "Données insuffisantes pour un profil fiable", radar_plus_proche: "Le plus proche du profil idéal", radar_plus_loin: "Le plus éloigné du profil idéal", radar_score_hint: "Écart moyen entre les attributs du produit et le profil idéal — plus bas = plus proche. Descriptif, pas un jugement de qualité.", elasticite_titre: "Élasticité prix par référence", elasticite_hint: "Régression log-log quantité~prix, par semaine 2026 (HT ou TTC : même résultat, la TVA ne change pas la pente). Seuils : ≥8 semaines de données et ≥3% de variation de prix avant tout calcul.", elast_fiable_uniquement: "Fiables uniquement (R² ≥ 0,3)", elast_peu_fiable: "peu fiable", elast_semaines: "semaines de données", elast_variation_prix: "de variation de prix", elast_prix_moyen: "prix moyen", elast_cat_elastique: "Élastique (≤-1)", elast_cat_inelastique: "Inélastique", elast_cat_positif: "Positif (atypique)", simulation_titre: "Simulation — hausse de prix de 5%", simulation_hint: "Impact estimé sur le volume (élasticité mesurée) et sur le CA net, si le prix augmentait de 5% et que rien d'autre ne changeait. Une simulation, pas une prédiction garantie.", marge_manoeuvre_titre: "Marge de manœuvre", marge_manoeuvre_sub: "Le prix influence peu ces volumes", prudence_titre: "Prudence prix", prudence_sub: "Une hausse ferait fuir des volumes importants", sim_ca_actuel: "CA en jeu", sim_volume: "volume", sim_pas_de_signal: "aucun signal fort détecté", sim_titre: "Simulateur prix → quantité", sim_hint: "Choisissez un produit et une marketplace, proposez un prix : la quantité et le CA projetés se recalculent en direct, à partir de l'élasticité mesurée sur cette référence.", sim_choisir_produit: "Choisir un produit", sim_choisir_mp: "Marketplace", sim_prix_actuel: "Prix moyen observé", sim_prix_propose: "Prix proposé", sim_qte_actuelle: "Volume actuel (semaine)", sim_qte_projetee: "Volume projeté", sim_ca_semaine_actuel: "CA actuel (semaine)", sim_ca_semaine_projete: "CA projeté", sim_hors_plage: "Ce prix dépasse la plage observée historiquement — la projection devient une extrapolation, moins fiable.", sim_aucun_resultat: "Aucune donnée d'élasticité pour ce produit.", resultat: "résultat", resultats: "résultats", tous_produits_titre: "Tous les produits", tous_produits_hint: "CA et quantité vendue, année 2026 complète (year-to-date) — inclut le déstockage, contrairement aux Tops/Flops ci-dessus", ap_destockage_badge: "déstockage", zone_hebdo: "Vue hebdomadaire", zone_hebdo_hint: "Données réelles par semaine — chiffre d'affaires, quantité, répartition marketplace, transporteur, origine des expéditions et top produits", repartition_mp_semaine: "Répartition par marketplace", part_ca_pct: "Part dans le CA (%)", expeditions_titre: "Expéditions", expeditions_hint: "Transporteur réel utilisé pour les commandes expédiées cette semaine", entrepot_titre: "Origine des expéditions", entrepot_hint: "Entrepôt d'où sont parties les commandes cette semaine — un flux d'expédition, pas une photo du stock actuellement disponible", top_semaine_titre: "Top produits de la semaine", qte_semaine_courte: "sem.", tendance_4_semaines: "Tendance — 4 dernières semaines", zone_abc: "Classification ABC — 2026", sku_classes: "SKU classés", zone_saison: "Saisonnalité — indice 2024-2025", preset_mois_courant: "Mois en cours", preset_mois_precedent: "Mois précédent", preset_annee_courante: "Année en cours", preset_annee_passee: "Année passée", preset_personnalise: "Personnalisé", yoy_variation_forte: "Variation très forte — vérifier la valeur absolue N-1, souvent une base de comparaison faible plutôt qu'une vraie tendance",
    sum_ca_titre: "Chiffre d'affaires", sum_vs_mois_prec: "Vs mois précédent", sum_objectif_titre: "Objectif", sum_ytd_titre: "Year-to-date", sum_panier_moyen_titre: "Panier moyen", sum_repartition_marque_titre: "Répartition marque", sum_mp_leader: "Marketplace leader", sum_position: "Position", sum_evolution_bestherm: "Évolution Bestherm", sum_top5_produits: "Top 5 produits", sum_normes_titre: "Normes", sum_top_cat: "Top catégorie / sous-catégorie", sum_performance: "Performance", sum_budget_investi: "Budget investi", sum_periode_titre: "Période",
sum_en: "en", sum_sur: "sur", sum_soit_lower: "soit", sum_vs_meme_periode_an_dernier: "vs la même période l'an dernier", sum_comparatif_n1_indispo: "comparatif N-1 indisponible", sum_objectif_annuel_realise: "de l'objectif annuel", sum_deja_realise_periode: "déjà réalisé sur la période choisie.", sum_aucun_objectif_pour: "Aucun objectif annuel défini pour", sum_depuis_1er_janvier: "depuis le 1er janvier, soit", sum_objectif_annuel_point: "de l'objectif annuel.", sum_ytd_non_dispo: "Repère YTD non disponible sans objectif défini.", sum_annee_complete_pas_detail: "année 2026 complète, pas de détail par période disponible.", sum_non_disponible: "Non disponible.", sum_du_ca_periode: "du CA sur cette période.", sum_realise_cette_periode: "de l'objectif annuel réalisé sur cette période.", sum_aucun_objectif_point: "Aucun objectif annuel défini.", sum_depuis_1er_janvier_parenthese: "depuis le 1er janvier", sum_de_objectif_parenthese: "de l'objectif).", sum_sur_cette_periode_point: "sur cette période.", sum_non_calculable: "Non calculable.", sum_ere: "ère", sum_e: "e", sum_mp_sur: "marketplace sur", sum_pour_cette_periode: "pour cette période.", sum_rang_non_calculable: "Rang non calculable.", sum_vs_an_dernier_point: "vs l'an dernier.", sum_comparatif_n1_mp_indispo: "Comparatif N-1 non disponible par marketplace.", sum_qte_non_dispo_mp: "quantité non disponible par marketplace", sum_annee_complete: "année 2026 complète", sum_aucune_donnee_produit: "Aucune donnée produit disponible.", sum_du_ca_ce: "du CA en CE,", sum_en_nf_periode: "en NF sur cette période.", sum_annee_complete_non_filtrable: "année 2026 complète, non filtrable par période.", sum_roas_de: "ROAS de", sum_sur_annee_2026: "sur l'année 2026.", sum_depenses_pour: "dépensés pour", sum_generes_cumul: "générés — cumul year-to-date 2026 (seule donnée disponible, pas de détail par mois).", sum_donnee_annuelle_complete: "Donnée annuelle 2026 complète — le filtre de date ne s'applique pas à cet onglet.", conc_top_produits: "Top produits", conc_comparatif: "Comparatif", non_identifiee: "Non identifiée", marque_non_identifiee: "Marque non identifiée", lifecycle_croissance_desc: "+20% ou plus vs même période 2025", lifecycle_declin_desc: "-20% ou moins vs même période 2025", lifecycle_declin_lbl: "Déclin", donnees_statiques: "Données statiques", autres_lbl: "Autres", vs_semaine_prec: "vs semaine précédente", apercu_semaine_titre: "Aperçu de la semaine", voir_detail_supply: "Voir le détail dans Supply", voir_detail_prix: "Voir le détail dans Prix", demo_mode_tooltip: "Mode démo — fausse les chiffres affichés, sans toucher aux vraies données", demo_mode_actif: "Mode démo actif — les chiffres affichés sont faussés, pas les vraies données", repartition_mp_semaine_courte: "CETTE SEMAINE", sum_cette_semaine: "cette semaine", sum_du_ca_semaine: "du CA de la semaine", sum_meilleure_progression: "Meilleure progression", sum_vs_semaine_derniere: "vs la semaine précédente", pd_prix_titre: "Positionnement prix", pd_cycle_titre: "Cycle de vie", pd_panier_titre: "Souvent acheté avec", pd_prix_non_dispo: "Prix non disponible pour ce produit", pd_panier_non_dispo: "Aucune association fréquente identifiée", pd_repartition_titre: "Répartition des ventes par marketplace", pd_courbe_titre: "Courbe de ventes mensuelle", pd_reel: "Réel", pd_estime_saison: "Estimé (saisonnalité)", pd_rupture: "Rupture probable", pd_forecast_annuel: "Forecast annuel :", pd_potentiel_titre: "Potentiel annuel", pd_potentiel_2025: "2025 (réel)", pd_potentiel_2026: "2026 (projeté)", cat_potentiel_titre: "Potentiel annuel par catégorie", cat_potentiel_hint: "2025 réalisé · 2026 projeté", cat_saisonnalite_limitee: "Catégorie trop récente (moins de 6 mois d'historique 2025) : projection au rythme actuel, sans saisonnalité propre", pd_forecast_fragile: "Estimation basée sur moins de 3 mois de vente réelle — à prendre avec prudence.", pd_fiche_titre: "Fiche produit", pd_fiche_non_dispo: "Fiche catalogue non disponible", pd_made_in_france: "Fabriqué en France", pd_connecte_wifi: "Connecté WiFi", pd_garantie_ans: "ans de garantie", ap_catalogue_badge: "catalogue, non vendu", ap_top_badge: "Top 5", ap_flop_badge: "Flop 5", note_homy_marque: "Le catalogue révèle une 4e marque, HOM'Y, avec de vraies ventes (ex. Orphée Connect, ~11k€ en 2026, 0,2% du CA) actuellement comptées dans Bestherm ci-dessus — pas encore isolée séparément, la structure de calcul existante ne distingue que 2 marques.", forte_croissance_objectif_bas: "Forte croissance mais objectif peu atteint — objectif potentiellement à recalibrer", lifecycle_lancement_lbl: "Lancement", lifecycle_lancement_desc: "Pas de vente comparable l'an dernier", lifecycle_croissance_lbl: "Croissance", lifecycle_mature_lbl: "Mature", lifecycle_mature_desc: "Stable, entre -20% et +20%", mois_dec_court: "Déc", mois_sep_court: "Sep", mois_oct_court: "Oct", mois_nov_court: "Nov", zone_anticipation: "Anticipation — octobre à décembre 2026", anticipation_mp_titre: "Anticipation par marketplace", anticipation_mp_hint: "Même méthode que l'anticipation globale, calculée séparément par marketplace — la répartition attendue du pic n'est pas forcément celle du poids actuel", zone_manquant: "Ce qui manque pour aller plus loin", manque_stock_titre: "Stocks & approvisionnement", manque_stock_texte: "Le fichier source donne l'entrepôt d'origine de chaque expédition (voir Vue hebdomadaire ci-dessus) — un flux, pas un stock actuel. Couverture, point de commande, stock de sécurité, rupture, surstock restent hors de portée : il faudrait un export stock (disponible/réservé/bloqué) à un instant T, qui n'existe pas dans les fichiers fournis.", manque_transport_titre: "Transport & livraison", manque_transport_texte: "Le transporteur réel par commande est maintenant visible (Vue hebdomadaire ci-dessus). Coûts transporteur, délais de livraison, taux de retard/casse restent hors de portée — ces informations n'existent pas dans les fichiers fournis.", radar_radiateurs: "Radiateurs", radar_secheserviettes: "Sèche-serviettes", axe_ceramique: "Céramique", axe_fonte: "Fonte", axe_film: "Film", axe_wifi: "WiFi", axe_vertical: "Vertical", axe_plinthe: "Plinthe", axe_soufflerie: "Soufflerie", entry_acces_restreint: "Accès restreint", entry_succes: "Accès autorisé", entry_afficher: "Afficher le mot de passe", entry_masquer: "Masquer le mot de passe", entry_se_souvenir: "Se souvenir de moi", entry_placeholder: "Clé d'entrée", entry_entrer: "Entrer", entry_erreur: "Clé incorrecte", gauge_objectif: "OBJECTIF 2026", summary_synthese: "Synthèse", summary_fermer: "Fermer la synthèse", zone_international: "International", est_soit: "Soit", est_a: "à", est_de_objectif_annuel: "de l'objectif annuel", pub_par_pays_hint: "Distinct de la répartition ci-dessus : ceci mesure la performance des campagnes publicitaires par pays, pas le total des ventes réelles", conf_haute: "Confiance haute", conf_moyenne: "Confiance moyenne", conf_basse: "Confiance basse", conc_ref_identifiees_sur: "référence(s) Bestherm/Thomson identifiée(s) sur", conc_produits_recenses: "produits recensés.", conc_aucune_ref_heater: "Aucune référence Bestherm/Thomson identifiée dans la collecte actuelle.", conc_ref_sur: "référence(s) Bestherm/Thomson sur", conc_produits_point: "produits.", conc_aucune_ref_cooling: "Aucune référence Bestherm/Thomson — marché non adressé sur cette marketplace pour l'instant.", conc_reference_sing: "référence", conc_reference_plur: "références", conc_produit_sing: "produit", conc_produit_plur: "produits", conc_collecte_sing: "collecté", conc_collecte_plur: "collectés",
    autres_mp: "Autres marketplaces", autres_mp_hint: "Triées par CA HT décroissant", vue_detaillee: "Vue détaillée limitée à la marketplace sélectionnée en haut de page",
    aucune_donnee_mp: "Aucune donnée pour cette marketplace",
    repartition_geo: "Répartition géographique", repartition_geo_hint: "CA HT généré par les campagnes publicitaires, par pays — pas le CA total des ventes, qui n'a pas de détail pays fiable dans nos exports",
    filtrer_par_mp: "Filtrer par marketplace :", detail_mensuel_indispo: "2026 uniquement — pas de détail mensuel fiable disponible",
    positions_approx: "Positions approximatives (pas une projection géographique réelle) · échelle non-linéaire pour garder les petits pays visibles",
    detail_pays: "Détail par pays", detail_pays_hint: "Toujours les 14 marketplaces, cumul complet 2026",
    repartition_marque: "Répartition du CA HT 2026 par marque", repartition_marque_hint: "Part de chaque marque dans le CA HT cumulé 2026", bestherm_vs_n1: "Bestherm vs N-1",
    thomson_hint: "Thomson : {ca} sur la même période de 2025 (marque lancée mi-2025) — évolution non significative, base trop faible",
    ca_mensuel_marque: "CA HT mensuel par marque", ca_mensuel_marque_hint: "CA HT par mois calendaire, année 2026 uniquement",
    marque_reconstituee: "Marque reconstituée par référence produit sur l'historique — couverture 2026 :",
    top_produits: "Top produits", top_produits_hint: "Les 3 produits au CA HT cumulé le plus élevé, comparés à la même période de 2025 (du 1er janvier à la dernière date de données)",
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
    tous_montants_ht: "Montants HT",
    erreur_titre: "Un problème est survenu", erreur_msg: "L'application a rencontré une erreur inattendue. Recharger la page résout généralement le problème.", recharger: "Recharger",
    langue: "Langue",
    plan_a_date: "Plan à date",
    vs_plan_a_date: "vs plan à date",
    plan_pct_attendu: "de l'objectif annuel attendu à ce jour",
    objectif_semaine: "Objectif semaine",
    attendu_a_ce_jour: "attendu à ce jour",
    objectif_du_mois: "Objectif du mois",
    realises_sur: "réalisés sur",
    vises: "visés",
  },
  en: {
    /* repartitions */ rep_tab: "Breakdowns", rep_titre: "Breakdowns by month and marketplace", rep_pays: "Country", rep_marque: "Brand", rep_type: "Product type", rep_categorie: "Category", rep_sous: "Sub-category", rep_ca: "Revenue excl. VAT", rep_qte: "Units", rep_evolution: "Monthly trend", rep_classement: "Ranking", rep_detail: "Detail by marketplace and month", rep_total: "Total", rep_toutes: "All marketplaces", rep_marketplace: "Marketplace", rep_marketplaces: "Marketplaces subtotal", rep_valeurs: "Values", rep_parts: "Share", rep_graphique: "Chart", rep_tableau: "Table", rep_montant: "Amount", rep_part: "Share", rep_part_de: "Share of {x} in each cell's total (marketplace × month)", rep_mix: "Mix", rep_col_part: "Share", rep_vide: "No sales for this selection.", rep_retirer: "Remove this filter", rep_autres: "Other ({n})", rep_autres_produits: "Other products", rep_marque_inconnue: "Brand not set", rep_tous_pays: "All countries", rep_toutes_marques: "All brands", rep_tous_types: "All product types", rep_astuce_classement: "Tap a row to isolate its detail by marketplace.", rep_astuce_mp: "Tap a marketplace to filter the chart and the ranking.", rep_qte_indispo: "Units are unavailable for this year and breakdown (the Shopify extraction does not provide them): revenue is shown.", rep_site_prec: "Website 2025: its sales only start in May 2025 in Shopify: do not compare it with 2026 over the full year.", rep_en_cours: "Current month, data through {d}.", rep_en_cours_court: "current month", rep_lien_marque: "Detail by month and marketplace", rep_hors_france: "Excl. France",
    /* donnees */ donnees_titre: "Shopify data up to date", donnees_jusqua: "through {date}", donnees_socle: "Single source: Shopify (BESTHERM marketplaces and website), from {du} to {au}", donnees_perime: "Not updated for {n} d", donnees_tout: "Every figure in the dashboard (KPIs, curves, marketplaces, brands, products, countries, categories, prices, elasticities, baskets, comparisons with 2025) is recalculated from Shopify sales.", donnees_base: "Marketplaces: revenue excl. VAT = (net sales + taxes) ÷ 1.2, the marketplace being that of each order's payment gateway. Website: net sales excl. taxes, discounts and returns deducted, as in Shopify.", donnees_site_depuis: "The website only exists in Shopify since {du}: earlier website sales are not in the figures, so comparisons with 2025 are partial for the website and for the total.", donnees_bricoman: "Bricoman cannot be told apart from Leroy Merlin in Shopify: its sales are counted in Leroy Merlin.", donnees_hors: "Not from Shopify (kept as is): advertising, competition, plan targets, each product's family and standard, catalogue sheets.", donnees_maj: "Updated every morning · last extraction: {date}.", donnees_graph: "Daily revenue excl. VAT (last 30 days)", suivi_jours: "{n} d", suivi_ca: "Revenue excl. VAT", suivi_vs: "vs {plage}", suivi_n1: "{an} · same days", suivi_n1_mp: "{an} · marketplaces", suivi_toucher: "Tap a day to see its top 10, marketplaces and countries", suivi_top10: "Top 10 products", suivi_pays: "Revenue share by country", suivi_aucune: "No sales on these days", suivi_autres: "Others", suivi_nouveau: "new", suivi_u: "pcs", suivi_pt: "pt", suivi_entiere: "Whole period", suivi_delta_mp: "Δ marketplaces", suivi_tab_top: "Products", suivi_tab_mp: "Marketplaces", suivi_tab_pays: "% by country", suivi_top10_mp: "Top 10 marketplaces", suivi_meme_date: "Same date", suivi_meme_semaine: "Same weekday", suivi_obj_leg: "Target (2026 plan)", suivi_obj_jour: "Daily target", suivi_obj_per: "Target", obj_2026_nom: "2026 target", obj_2026_mensuel: "2026 target (monthly plan)", suivi_commandes: "Orders", suivi_panier: "Avg. order value", donnees_mp: "Marketplaces", donnees_site: "Website", donnees_source: "Source: Shopify", donnees_indispo_titre: "Shopify data unavailable", donnees_indispo_msg: "The Shopify sales are unreadable or incomplete, so the dashboard cannot be displayed. The next morning update rebuilds them; otherwise contact support.",
    nav_apercu: "Overview", nav_marketplaces: "Marketplaces", nav_marques: "Brands & Products", nav_prix: "Price Tracking", nav_ads: "Ad Campaigns", nav_concurrence: "Competition", nav_data: "Data", data_hint: "Select one or more products to generate a detailed Excel report", data_titre: "Data extraction", data_intro: "Pick products and generate an Excel report with channel breakdown, HT/TTC prices and monthly trend — an export on demand.", data_recherche_placeholder: "Search a product…", data_aucun_resultat: "No product found", data_aucune_selection: "No product selected", data_produits_selectionnes_sg: "product selected", data_produits_selectionnes_pl: "products selected", data_tout_deselectionner: "Deselect all", data_generation_en_cours: "Generating…", data_generer_excel: "Generate Excel", data_erreur_generation: "Error while generating — try again, or check your connection (the formatting library loads from the internet).", data_note_contenu: "The report has 3 tabs: summary, channel breakdown (marketplace, HT/TTC prices), and 2024-2026 monthly trend. VAT applied: 20% (standard France rate, adjust if needed).", promo_titre: "Promo price selection", promo_externe_desc: "Collaborative tool shared with the whole team in real time — opens in a new tab.", promo_ouvrir_outil: "Open the collaborative tool",
    pilotage: "Dashboard", marketplace_label: "Marketplace:", toutes_mp: "All marketplaces", mode_presentation: "Presentation mode", reset: "reset",
    analyser_periode: "Analyze period:", vs_an_dernier: "last year", ht_suffix: "All amounts excl. tax",
    ca_cumule: "Cumulative Revenue YTD", ca_cumule_hint: "Sum of revenue (excl. tax) for all orders since January 1, 2026",
    toutes_marketplaces_suffix: "all marketplaces", objectif_2026: "of", objectif_non_defini: "target not defined",
    panier_moyen: "Average Price", panier_moyen_hint: "Total revenue (excl. tax) ÷ number of orders, 2026", unites_vendues: "units sold",
    meilleure_vente: "Best Seller 2026", meilleure_vente_hint: "Product with the highest cumulative revenue since January",
    vs_meilleure_n1: "Vs Best Seller Last Year", vs_meilleure_n1_hint: "Same product, revenue compared to the same window in 2025", en_2025: "over the same period of 2025",
    non_comparable: "not comparable", indispo_par_mp: "unavailable by marketplace", detail_non_conserve: "per-marketplace detail not kept for 2025",
    tendance_titre: "Revenue Trend — One Curve per Year", tendance_hint: "One chart per year, same vertical scale, for a fair comparison of the curves",
    ca_ht_total_titre: "Total Revenue — all marketplaces, to date", ca_ht_total_hint: "Sum of 2026 revenue for all tracked marketplaces",
    au_rythme: "on track", top3: "Top 3", top3_hint: "The 3 marketplaces with the highest cumulative revenue in 2026", de_word: "of", nouveau: "new",
    est_fin_annee: "Year-end estimate", objectif_non_defini_mp: "No annual target set for this marketplace", legende_reel: "Actual", legende_anticipe: "Forecast", reparti_saisonnier: "from the 2026 monthly plan",
    repartition_pays_titre: "Breakdown by country", repartition_pays_hint: "Real orders by country — not an ads estimate. 2024 excluded (no country detail that year)", aucune_donnee_pays: "No country data for this selection — check that the period includes 2025 or 2026.", pub_par_pays: "Ads spend by country", depense_ads: "ads spend", conc_titre: "Competition", conc_hint: "Manually collected via web research — France. No invented price, rank or volume.", conc_position_heater: "Heater position — ", conc_position_cooling: "Cooling position — ", conc_radiateurs: "Radiators — ", conc_secheserviettes: "Towel warmers — ", conc_produits_suivis: "Tracked products", conc_produits_suivis_hint: "Current selection (segment/subcategory/marketplace)", conc_prix_moyen: "Average price", conc_prix_moyen_hint: "On products where the price could be verified", conc_fourchette_prix: "Price range", conc_fourchette_prix_hint: "Cheapest to most expensive, verified prices only", conc_en_promo: "On promotion", conc_en_promo_hint: "Products showing a discount vs reference price", conc_sources_qualite: "Sources & data quality", conc_sources_qualite_hint: "Collection reliability by subcategory and marketplace — methodology and limits specific to each source", conc_marques_visibles: "Most visible brands", conc_marques_visibles_hint: "Brands most present in the collection, all marketplaces combined (number of appearances, not real market share)", conc_aucun_produit: "No products for this selection", conc_sponsorise: "Sponsored", conc_prix_nd: "Price n/a", conc_comparatif_prix_mp: "Price comparison by marketplace", conc_comparatif_prix_mp_hint: "Verified prices only — products without a reliably extracted price don't appear here", conc_aucun_prix_verifie: "No verified price for this selection", conc_moy: "avg.", conc_vs_marche: "Bestherm/Thomson vs market", conc_vs_marche_hint: "Bestherm/Thomson prices compared to the competitor average (Bestherm/Thomson excluded from that average) — only where a real competitor price could be verified", conc_pas_de_comparaison: "No verified competitor price yet in the same subcategory as a Bestherm/Thomson product, for this selection — no comparison rather than an approximate one.", conc_exporter: "Export:", conc_nomme_date: "Named after today's date · reflects the current selection (segment/subcategory/marketplace)", zone_marque: "Brand", zone_produits_titre: "Products", zone_normes: "Standards", zone_puissances: "Wattage", subnav_produit_ideal: "Ideal product", subnav_normes_cat: "Standards & Categories", topflop_titre: "Tops & Flops", topflop_hint: "Filterable by date + marketplace like the rest of the app · accessories and spare parts excluded", top5_hint: "Best performers for the current selection", flop5_hint: "Weakest performers for the current selection, accessories excluded", aucune_donnee: "No data", cycle_vie_titre: "Product lifecycle", cycle_vie_hint: "Compares July-Sept 2026 to the same period in 2025 (not the preceding months, to avoid confusing seasonality with a real trend) — respects the marketplace filter", panier_titre: "Frequently bought together", panier_hint: "Products genuinely bought together (same order number), 2025+2026 — global data, not yet filterable by marketplace or period", panier_croise_hint: "Radiator + towel warmer in the same order — a bathroom renovation signal", panier_croise_titre: "Cross-sell: radiators × towel warmers", panier_toutes_hint: "All pairs combined, including same range at different wattages", panier_toutes_titre: "All pairs — top 8", prix_regulier_ideal: "Ideal regular price", prix_promo_ideal: "Ideal promo price*", toutes_categories: "All categories", aucune_donnee_qte: "No quantity data for this selection", puissances_vendues_titre: "Best-selling wattages", puissances_vendues_hint: "Quantity sold by wattage, filterable by date + marketplace like the rest of the app", supply_titre: "Supply", supply_hint: "Built only on genuinely available data — ABC classification (2026), sales history (2024-2026). No stock, transport or supplier data exists in the files provided.", comparatif_prix_titre: "Comparison by product", comparatif_prix_hint: "Highest and lowest price across marketplaces (2026), who sells the most, % spread, weighted average price. \"Unidentified\"/\"Other\" marketplaces excluded from the comparison — not a real identifiable marketplace.", cp_vend_plus: "Sells the most", cp_prix_moyen: "Average price", signal_premium: "Premium positioning", signal_sensible: "Price sensitive", signal_neutre: "Neutral signal", radar_fiabilite_insuffisante: "Insufficient data for a reliable profile", radar_plus_proche: "Closest to the ideal profile", radar_plus_loin: "Furthest from the ideal profile", radar_score_hint: "Average gap between the product attributes and the ideal profile — lower = closer. Descriptive, not a quality judgment.", elasticite_titre: "Price elasticity by reference", elasticite_hint: "Log-log regression of quantity on price, by 2026 week (HT or TTC: same result, VAT does not change the slope). Thresholds: >=8 weeks of data and >=3% price variation before any calculation.", elast_fiable_uniquement: "Reliable only (R2 >= 0.3)", elast_peu_fiable: "low reliability", elast_semaines: "weeks of data", elast_variation_prix: "price variation", elast_prix_moyen: "average price", elast_cat_elastique: "Elastic (<=-1)", elast_cat_inelastique: "Inelastic", elast_cat_positif: "Positive (atypical)", simulation_titre: "Simulation — 5% price increase", simulation_hint: "Estimated impact on volume (measured elasticity) and net revenue, if price rose 5% and nothing else changed. A simulation, not a guaranteed prediction.", marge_manoeuvre_titre: "Room to maneuver", marge_manoeuvre_sub: "Price has little influence on these volumes", prudence_titre: "Price caution", prudence_sub: "An increase would drive away significant volume", sim_ca_actuel: "revenue at stake", sim_volume: "volume", sim_pas_de_signal: "no strong signal detected", sim_titre: "Price -> quantity simulator", sim_hint: "Pick a product and a marketplace, propose a price: projected volume and revenue recompute live, based on the elasticity measured for that reference.", sim_choisir_produit: "Choose a product", sim_choisir_mp: "Marketplace", sim_prix_actuel: "Observed average price", sim_prix_propose: "Proposed price", sim_qte_actuelle: "Current volume (week)", sim_qte_projetee: "Projected volume", sim_ca_semaine_actuel: "Current revenue (week)", sim_ca_semaine_projete: "Projected revenue", sim_hors_plage: "This price is outside the historically observed range — the projection becomes an extrapolation, less reliable.", sim_aucun_resultat: "No elasticity data for this product.", resultat: "result", resultats: "results", tous_produits_titre: "All products", tous_produits_hint: "Revenue and quantity sold, full 2026 (year-to-date) — includes clearance stock, unlike the Tops/Flops above", ap_destockage_badge: "clearance", zone_hebdo: "Weekly view", zone_hebdo_hint: "Real weekly data — revenue, quantity, marketplace split, carrier, shipment origin and top products", repartition_mp_semaine: "Marketplace breakdown", part_ca_pct: "Share of revenue (%)", expeditions_titre: "Shipments", expeditions_hint: "Actual carrier used for orders shipped this week", entrepot_titre: "Shipment origin", entrepot_hint: "Warehouse orders shipped from this week — a shipment flow, not a snapshot of currently available stock", top_semaine_titre: "Top products this week", qte_semaine_courte: "wk", tendance_4_semaines: "Trend — last 4 weeks", zone_abc: "ABC classification — 2026", sku_classes: "Classified SKUs", zone_saison: "Seasonality — 2024-2025 index", preset_mois_courant: "Current month", preset_mois_precedent: "Previous month", preset_annee_courante: "Current year", preset_annee_passee: "Previous year", preset_personnalise: "Custom", yoy_variation_forte: "Very large change — check the absolute N-1 value, often a low comparison base rather than a real trend",
    sum_ca_titre: "Revenue", sum_vs_mois_prec: "Vs previous month", sum_objectif_titre: "Target", sum_ytd_titre: "Year-to-date", sum_panier_moyen_titre: "Average order value", sum_repartition_marque_titre: "Brand split", sum_mp_leader: "Leading marketplace", sum_position: "Position", sum_evolution_bestherm: "Bestherm trend", sum_top5_produits: "Top 5 products", sum_normes_titre: "Standards", sum_top_cat: "Top category / subcategory", sum_performance: "Performance", sum_budget_investi: "Budget spent", sum_periode_titre: "Period",
sum_en: "in", sum_sur: "for", sum_soit_lower: "i.e.", sum_vs_meme_periode_an_dernier: "vs the same period last year", sum_comparatif_n1_indispo: "N-1 comparison unavailable", sum_objectif_annuel_realise: "of the annual target", sum_deja_realise_periode: "already reached for the chosen period.", sum_aucun_objectif_pour: "No annual target set for", sum_depuis_1er_janvier: "since January 1st, i.e.", sum_objectif_annuel_point: "of the annual target.", sum_ytd_non_dispo: "YTD marker unavailable without a defined target.", sum_annee_complete_pas_detail: "full 2026, no detail available by period.", sum_non_disponible: "Not available.", sum_du_ca_periode: "of revenue for this period.", sum_realise_cette_periode: "of the annual target reached for this period.", sum_aucun_objectif_point: "No annual target defined.", sum_depuis_1er_janvier_parenthese: "since January 1st", sum_de_objectif_parenthese: "of target).", sum_sur_cette_periode_point: "for this period.", sum_non_calculable: "Not calculable.", sum_ere: "", sum_e: "", sum_mp_sur: "marketplace out of", sum_pour_cette_periode: "for this period.", sum_rang_non_calculable: "Rank not calculable.", sum_vs_an_dernier_point: "vs last year.", sum_comparatif_n1_mp_indispo: "N-1 comparison unavailable by marketplace.", sum_qte_non_dispo_mp: "quantity unavailable by marketplace", sum_annee_complete: "full 2026", sum_aucune_donnee_produit: "No product data available.", sum_du_ca_ce: "of revenue under CE,", sum_en_nf_periode: "under NF for this period.", sum_annee_complete_non_filtrable: "full 2026, not filterable by period.", sum_roas_de: "ROAS of", sum_sur_annee_2026: "for 2026.", sum_depenses_pour: "spent for", sum_generes_cumul: "generated — 2026 year-to-date total (only data available, no monthly detail).", sum_donnee_annuelle_complete: "Full 2026 data — the date filter doesn't apply to this tab.", conc_top_produits: "Top products", conc_comparatif: "Comparison", non_identifiee: "Unidentified", marque_non_identifiee: "Unidentified brand", lifecycle_croissance_desc: "+20% or more vs same period 2025", lifecycle_declin_desc: "-20% or less vs same period 2025", lifecycle_declin_lbl: "Decline", donnees_statiques: "Static data", autres_lbl: "Other", vs_semaine_prec: "vs previous week", apercu_semaine_titre: "Weekly snapshot", voir_detail_supply: "See full detail in Supply", voir_detail_prix: "See full detail in Prices", demo_mode_tooltip: "Demo mode — distorts the displayed figures, without touching the real data", demo_mode_actif: "Demo mode active — displayed figures are distorted, not the real data", repartition_mp_semaine_courte: "THIS WEEK", sum_cette_semaine: "this week", sum_du_ca_semaine: "of the week's revenue", sum_meilleure_progression: "Best improvement", sum_vs_semaine_derniere: "vs the previous week", pd_prix_titre: "Price positioning", pd_cycle_titre: "Lifecycle", pd_panier_titre: "Frequently bought with", pd_prix_non_dispo: "Price not available for this product", pd_panier_non_dispo: "No frequent pairing identified", pd_repartition_titre: "Sales breakdown by marketplace", pd_courbe_titre: "Monthly sales curve", pd_reel: "Actual", pd_estime_saison: "Estimated (seasonality)", pd_rupture: "Likely stockout", pd_forecast_annuel: "Annual forecast:", pd_potentiel_titre: "Annual potential", pd_potentiel_2025: "2025 (actual)", pd_potentiel_2026: "2026 (projected)", cat_potentiel_titre: "Annual potential by category", cat_potentiel_hint: "2025 actual · 2026 projected", cat_saisonnalite_limitee: "Category too recent (fewer than 6 months of 2025 history): projected at the current pace, without its own seasonal pattern", pd_forecast_fragile: "Estimate based on fewer than 3 months of actual sales — treat with caution.", pd_fiche_titre: "Product sheet", pd_fiche_non_dispo: "Catalog sheet not available", pd_made_in_france: "Made in France", pd_connecte_wifi: "WiFi connected", pd_garantie_ans: "year warranty", ap_catalogue_badge: "catalog, not sold", ap_top_badge: "Top 5", ap_flop_badge: "Flop 5", note_homy_marque: "The catalog reveals a 4th brand, HOM'Y, with real sales (e.g. Orphée Connect, ~11k€ in 2026, 0.2% of revenue) currently counted under Bestherm above — not yet isolated separately, since the existing calculation only distinguishes 2 brands.", forte_croissance_objectif_bas: "Strong growth but low target achievement — target potentially needs recalibrating", lifecycle_lancement_lbl: "Launch", lifecycle_lancement_desc: "No comparable sale last year", lifecycle_croissance_lbl: "Growth", lifecycle_mature_lbl: "Mature", lifecycle_mature_desc: "Stable, between -20% and +20%", mois_dec_court: "Dec", mois_sep_court: "Sep", mois_oct_court: "Oct", mois_nov_court: "Nov", zone_anticipation: "Forecast — October to December 2026", anticipation_mp_titre: "Forecast by marketplace", anticipation_mp_hint: "Same method as the overall forecast, computed separately per marketplace — the expected peak split isn't necessarily the current one", zone_manquant: "What's missing to go further", manque_stock_titre: "Stock & replenishment", manque_stock_texte: "The source file gives the origin warehouse for each shipment (see Weekly view above) — a flow, not a current stock level. Coverage, reorder point, safety stock, stockouts, overstock remain out of reach: that would need a point-in-time stock export (available/reserved/blocked), which doesn't exist in the files provided.", manque_transport_titre: "Shipping & delivery", manque_transport_texte: "The actual carrier per order is now visible (Weekly view above). Carrier costs, delivery lead times, delay/damage rates remain out of reach — this information doesn't exist in the files provided.", radar_radiateurs: "Radiators", radar_secheserviettes: "Towel warmers", axe_ceramique: "Ceramic", axe_fonte: "Cast iron", axe_film: "Film", axe_wifi: "WiFi", axe_vertical: "Vertical", axe_plinthe: "Baseboard", axe_soufflerie: "Fan-assist", entry_acces_restreint: "Restricted access", entry_succes: "Access granted", entry_afficher: "Show password", entry_masquer: "Hide password", entry_se_souvenir: "Remember me", entry_placeholder: "Access key", entry_entrer: "Enter", entry_erreur: "Incorrect key", gauge_objectif: "2026 TARGET", summary_synthese: "Summary", summary_fermer: "Close summary", zone_international: "International", est_soit: "That's", est_a: "to", est_de_objectif_annuel: "of the annual target", pub_par_pays_hint: "Distinct from the breakdown above: this measures ad campaign performance by country, not total real sales", conf_haute: "High confidence", conf_moyenne: "Medium confidence", conf_basse: "Low confidence", conc_ref_identifiees_sur: "Bestherm/Thomson reference(s) identified out of", conc_produits_recenses: "products tracked.", conc_aucune_ref_heater: "No Bestherm/Thomson reference identified in the current collection.", conc_ref_sur: "Bestherm/Thomson reference(s) out of", conc_produits_point: "products.", conc_aucune_ref_cooling: "No Bestherm/Thomson reference — market not yet addressed on this marketplace.", conc_reference_sing: "reference", conc_reference_plur: "references", conc_produit_sing: "product", conc_produit_plur: "products", conc_collecte_sing: "collected", conc_collecte_plur: "collected",
    autres_mp: "Other Marketplaces", autres_mp_hint: "Sorted by revenue, descending", vue_detaillee: "Detailed view limited to the marketplace selected at the top of the page",
    aucune_donnee_mp: "No data for this marketplace",
    repartition_geo: "Geographic Breakdown", repartition_geo_hint: "Revenue generated by ad campaigns, by country — not total sales revenue, which has no reliable country detail in our exports",
    filtrer_par_mp: "Filter by marketplace:", detail_mensuel_indispo: "2026 only — no reliable monthly detail available",
    positions_approx: "Approximate positions (not a real geographic projection) · non-linear scale to keep smaller countries visible",
    detail_pays: "Country Detail", detail_pays_hint: "Always all 14 marketplaces, full 2026 total",
    repartition_marque: "2026 Revenue Breakdown by Brand", repartition_marque_hint: "Share of each brand in cumulative 2026 revenue", bestherm_vs_n1: "Bestherm vs Last Year",
    thomson_hint: "Thomson: {ca} over the same period of 2025 (brand launched mid-2025) — growth not meaningful, base too small",
    ca_mensuel_marque: "Monthly Revenue by Brand", ca_mensuel_marque_hint: "Revenue by calendar month, 2026 only",
    marque_reconstituee: "Brand reconstructed from product reference on historical data — 2026 coverage:",
    top_produits: "Top Products", top_produits_hint: "The 3 products with the highest cumulative revenue, compared with the same period of 2025 (Jan 1 to the latest data date)",
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
    tous_montants_ht: "Amounts excl. tax",
    erreur_titre: "Something went wrong", erreur_msg: "The application encountered an unexpected error. Reloading the page usually fixes it.", recharger: "Reload",
    langue: "Language",
    plan_a_date: "Plan to date",
    vs_plan_a_date: "vs plan to date",
    plan_pct_attendu: "of the annual target expected by now",
    objectif_semaine: "Weekly target",
    attendu_a_ce_jour: "expected to date",
    objectif_du_mois: "Monthly target",
    realises_sur: "achieved out of",
    vises: "targeted",
  },
  zh: {
    /* repartitions */ rep_tab: "分布", rep_titre: "按月份和平台的分布", rep_pays: "国家", rep_marque: "品牌", rep_type: "产品类型", rep_categorie: "品类", rep_sous: "子品类", rep_ca: "销售额（不含税）", rep_qte: "销量", rep_evolution: "月度走势", rep_classement: "排名", rep_detail: "按平台和月份的明细", rep_total: "合计", rep_toutes: "全部平台", rep_marketplace: "平台", rep_marketplaces: "平台小计", rep_valeurs: "数值", rep_parts: "占比", rep_graphique: "图表", rep_tableau: "表格", rep_montant: "金额", rep_part: "占比", rep_part_de: "{x} 在每个单元格合计中的占比（平台 × 月份）", rep_mix: "构成", rep_col_part: "占比", rep_vide: "该选择下没有销售。", rep_retirer: "移除此筛选", rep_autres: "其他（{n}）", rep_autres_produits: "其他产品", rep_marque_inconnue: "未标注品牌", rep_tous_pays: "所有国家", rep_toutes_marques: "所有品牌", rep_tous_types: "所有产品类型", rep_astuce_classement: "点按一行，查看其按平台的明细。", rep_astuce_mp: "点按某个平台，即可筛选图表和排名。", rep_qte_indispo: "该年份和该维度没有销量数据（Shopify 提取数据未提供）：现显示销售额。", rep_site_prec: "2025 年官网：其销售在 Shopify 中自 2025 年 5 月才开始，请勿与 2026 全年直接比较。", rep_en_cours: "当月数据截至 {d}。", rep_en_cours_court: "当月", rep_lien_marque: "按月份和平台查看明细", rep_hors_france: "不含法国",
    /* donnees */ donnees_titre: "Shopify 数据已更新", donnees_jusqua: "截至 {date}", donnees_socle: "唯一数据来源：Shopify（BESTHERM 平台和官网），{du} 至 {au}", donnees_perime: "已 {n} 天未更新", donnees_tout: "看板中的所有数据（KPI、曲线、平台、品牌、产品、国家、品类、价格、弹性、购物篮、与 2025 年的对比）均根据 Shopify 销售重新计算。", donnees_base: "平台：销售额不含税 =（净销售额 + 税）÷ 1.2，平台以每笔订单的支付网关为准。官网：不含税的净销售额，已扣除折扣和退货，与 Shopify 一致。", donnees_site_depuis: "官网自 {du} 起才存在于 Shopify：此前的官网销售不在数据中，因此官网和总计与 2025 年的对比并不完整。", donnees_bricoman: "Shopify 中无法区分 Bricoman 与 Leroy Merlin：其销售计入 Leroy Merlin。", donnees_hors: "非 Shopify 来源（保持原样）：广告、竞争、计划目标、每个产品的系列和标准、目录资料。", donnees_maj: "每天早上更新 · 最近一次提取：{date}。", donnees_graph: "每日销售额（不含税，近 30 天）", suivi_jours: "{n} 天", suivi_ca: "销售额（不含税）", suivi_vs: "对比 {plage}", suivi_n1: "{an} 年同期", suivi_n1_mp: "{an} 年 · 平台", suivi_toucher: "点按某一天，查看当日前 10 名产品、平台和各国占比", suivi_top10: "产品前 10 名", suivi_pays: "各国销售占比", suivi_aucune: "这些天没有销售", suivi_autres: "其他", suivi_nouveau: "新品", suivi_u: "件", suivi_pt: "pt", suivi_entiere: "整个期间", suivi_delta_mp: "Δ 平台", suivi_tab_top: "产品", suivi_tab_mp: "平台", suivi_tab_pays: "国家占比", suivi_top10_mp: "平台前 10 名", suivi_meme_date: "同一日期", suivi_meme_semaine: "同一星期几", suivi_obj_leg: "目标（2026 年计划）", suivi_obj_jour: "当日目标", suivi_obj_per: "目标", obj_2026_nom: "2026 年目标", obj_2026_mensuel: "2026 年目标（月度计划）", suivi_commandes: "订单数", suivi_panier: "平均客单价", donnees_mp: "平台", donnees_site: "官网", donnees_source: "数据来源：Shopify", donnees_indispo_titre: "Shopify 数据不可用", donnees_indispo_msg: "Shopify 销售数据无法读取或不完整，看板无法显示。次日早上的更新会重新生成；否则请联系支持人员。",
    nav_apercu: "总览", nav_marketplaces: "电商平台", nav_marques: "品牌与产品", nav_prix: "价格追踪", nav_ads: "广告活动", nav_concurrence: "竞争分析", nav_data: "数据", data_hint: "选择一个或多个产品以生成详细的Excel报告", data_titre: "数据提取", data_intro: "选择产品并生成包含渠道分布、含税/未含税价格及月度趋势的Excel报告 — 按需导出。", data_recherche_placeholder: "搜索产品…", data_aucun_resultat: "未找到产品", data_aucune_selection: "未选择产品", data_produits_selectionnes_sg: "个产品已选择", data_produits_selectionnes_pl: "个产品已选择", data_tout_deselectionner: "取消全选", data_generation_en_cours: "生成中…", data_generer_excel: "生成Excel", data_erreur_generation: "生成时出错 — 请重试，或检查网络连接（格式库需从互联网加载）。", data_note_contenu: "报告包含3个工作表：汇总、渠道分布（平台、含税/未含税价格）、以及2024-2026年月度趋势。适用增值税：20%（法国标准税率，如需可调整）。", promo_titre: "促销价格选择", promo_externe_desc: "与团队实时共享的协作工具 — 将在新标签页中打开。", promo_ouvrir_outil: "打开协作工具",
    pilotage: "管理面板", marketplace_label: "电商平台：", toutes_mp: "所有平台", mode_presentation: "演示模式", reset: "重置",
    analyser_periode: "分析时间段：", vs_an_dernier: "同比去年", ht_suffix: "所有金额均为不含税价",
    ca_cumule: "累计营业额（年初至今）", ca_cumule_hint: "2026年1月1日以来所有订单的不含税营业额总和",
    toutes_marketplaces_suffix: "所有平台", objectif_2026: "占", objectif_non_defini: "目标未设定",
    panier_moyen: "平均价格", panier_moyen_hint: "不含税总营业额 ÷ 订单数，2026年", unites_vendues: "件已售",
    meilleure_vente: "2026年畅销产品", meilleure_vente_hint: "自1月以来累计营业额最高的产品",
    vs_meilleure_n1: "同比畅销产品", vs_meilleure_n1_hint: "同一产品，与2025年同期营业额对比", en_2025: "2025年同期",
    non_comparable: "无法比较", indispo_par_mp: "该平台数据不可用", detail_non_conserve: "2025年未保留分平台明细",
    tendance_titre: "营业额趋势 — 按年度分列", tendance_hint: "每年一张图，纵轴比例相同，便于公平比较各年曲线",
    ca_ht_total_titre: "不含税总营业额 — 所有平台，截至目前", ca_ht_total_hint: "所有跟踪平台2026年营业额总和",
    au_rythme: "符合预期进度", top3: "前三名", top3_hint: "2026年累计营业额最高的3个平台", de_word: "占", nouveau: "新",
    est_fin_annee: "年底预估", objectif_non_defini_mp: "该平台未设定年度目标", legende_reel: "实际", legende_anticipe: "预测", reparti_saisonnier: "依据2026年月度计划",
    repartition_pays_titre: "按国家分布", repartition_pays_hint: "真实订单数据，非广告估算 · 不含2024年（该年无国家明细）", aucune_donnee_pays: "此筛选条件下无国家数据 — 请确认时间范围包含2025或2026年", pub_par_pays: "按国家广告支出", depense_ads: "广告支出", conc_titre: "竞争分析", conc_hint: "通过网络调研人工收集 — 法国。不虚构任何价格、排名或销量。", conc_position_heater: "取暖器地位 — ", conc_position_cooling: "制冷产品地位 — ", conc_radiateurs: "散热器 — ", conc_secheserviettes: "毛巾架 — ", conc_produits_suivis: "已追踪产品", conc_produits_suivis_hint: "当前筛选（细分/子类别/平台）", conc_prix_moyen: "平均价格", conc_prix_moyen_hint: "仅统计价格已核实的产品", conc_fourchette_prix: "价格区间", conc_fourchette_prix_hint: "从最低到最高，仅核实价格", conc_en_promo: "促销中", conc_en_promo_hint: "相对参考价有折扣的产品", conc_sources_qualite: "数据来源与质量", conc_sources_qualite_hint: "按子类别和平台划分的采集可靠性 — 每个来源的方法与局限性", conc_marques_visibles: "最常见品牌", conc_marques_visibles_hint: "采集数据中出现最多的品牌，涵盖所有平台（出现次数，非真实市场份额）", conc_aucun_produit: "此筛选条件下无产品", conc_sponsorise: "推广", conc_prix_nd: "价格未知", conc_comparatif_prix_mp: "按平台价格对比", conc_comparatif_prix_mp_hint: "仅核实价格 — 未能可靠提取价格的产品不在此显示", conc_aucun_prix_verifie: "此筛选条件下无核实价格", conc_moy: "均", conc_vs_marche: "Bestherm/Thomson 对比市场", conc_vs_marche_hint: "Bestherm/Thomson价格与竞品平均价对比（该平均价不含Bestherm/Thomson）— 仅限已核实竞品真实价格的情况", conc_pas_de_comparaison: "此筛选条件下，与Bestherm/Thomson产品同子类别尚无已核实的竞品价格 — 暂不比较，而非给出近似值。", conc_exporter: "导出：", conc_nomme_date: "以当天日期命名 · 反映当前筛选（细分/子类别/平台）", zone_marque: "品牌", zone_produits_titre: "产品", zone_normes: "认证标准", zone_puissances: "功率", subnav_produit_ideal: "理想产品", subnav_normes_cat: "认证与品类", topflop_titre: "排行榜", topflop_hint: "可按日期+平台筛选，与应用其余部分一致 · 不含配件与零件", top5_hint: "当前筛选下表现最好的产品", flop5_hint: "当前筛选下表现最弱的产品（不含配件）", aucune_donnee: "暂无数据", cycle_vie_titre: "产品生命周期", cycle_vie_hint: "对比2026年7-9月与2025年同期（非紧邻月份，以避免将季节性误判为真实趋势）— 遵循平台筛选", panier_titre: "常一起购买", panier_hint: "同一订单号下真实一起购买的产品，2025+2026年 — 全局数据，暂不支持按平台或时间筛选", panier_croise_hint: "同一订单中的散热器+毛巾架 — 卫浴翻新信号", panier_croise_titre: "交叉销售：散热器×毛巾架", panier_toutes_hint: "包含所有组合，含同系列不同功率", panier_toutes_titre: "所有组合 — 前8名", prix_regulier_ideal: "理想常规价", prix_promo_ideal: "理想促销价*", toutes_categories: "所有品类", aucune_donnee_qte: "此筛选条件下无数量数据", puissances_vendues_titre: "最畅销功率", puissances_vendues_hint: "按功率统计的销售数量，可按日期+平台筛选，与应用其余部分一致", supply_titre: "供应链", supply_hint: "仅基于真实可用数据构建 — ABC分类（2026年）、销售历史（2024-2026年）。所提供文件中不存在库存、物流或供应商数据。", comparatif_prix_titre: "按产品对比", comparatif_prix_hint: "各平台间最高与最低价格（2026年）、销量最高平台、价差百分比、加权平均价。「未识别」/「其他」平台不参与对比 — 非真实可识别平台。", cp_vend_plus: "销量最高", cp_prix_moyen: "平均价", signal_premium: "高端定位", signal_sensible: "价格敏感", signal_neutre: "中性信号", radar_fiabilite_insuffisante: "数据不足，无法形成可靠画像", radar_plus_proche: "最接近理想画像", radar_plus_loin: "最偏离理想画像", radar_score_hint: "产品属性与理想画像之间的平均差距 — 越低越接近。仅为描述性指标，非质量判断。", elasticite_titre: "各参考产品价格弹性", elasticite_hint: "2026年按周的数量~价格对数回归（含税或不含税结果相同，增值税不改变斜率）。门槛：至少8周数据且价格变动至少3%才计算。", elast_fiable_uniquement: "仅显示可靠数据（R² ≥ 0.3）", elast_peu_fiable: "可靠性较低", elast_semaines: "周数据", elast_variation_prix: "价格变动", elast_prix_moyen: "平均价格", elast_cat_elastique: "弹性 (≤-1)", elast_cat_inelastique: "非弹性", elast_cat_positif: "正向（非典型）", simulation_titre: "模拟 — 提价5%", simulation_hint: "若价格上涨5%且其他条件不变，对销量（基于测得的弹性）和净营业额的估计影响。这是模拟，非保证性预测。", marge_manoeuvre_titre: "调价空间", marge_manoeuvre_sub: "价格对这些销量影响较小", prudence_titre: "价格谨慎", prudence_sub: "提价将导致大量销量流失", sim_ca_actuel: "涉及营业额", sim_volume: "销量", sim_pas_de_signal: "未检测到明显信号", sim_titre: "价格→销量模拟器", sim_hint: "选择一个产品和一个平台，提出一个价格：预计销量和营业额会根据该产品测得的弹性实时重新计算。", sim_choisir_produit: "选择产品", sim_choisir_mp: "平台", sim_prix_actuel: "观察到的平均价格", sim_prix_propose: "提议价格", sim_qte_actuelle: "当前销量（周）", sim_qte_projetee: "预计销量", sim_ca_semaine_actuel: "当前营业额（周）", sim_ca_semaine_projete: "预计营业额", sim_hors_plage: "该价格超出历史观察范围 — 预测变为外推，可靠性较低。", sim_aucun_resultat: "该产品无弹性数据。", resultat: "条结果", resultats: "条结果", tous_produits_titre: "所有产品", tous_produits_hint: "营业额与销量，完整2026年（年初至今）— 含清仓产品，与上方排行榜不同", ap_destockage_badge: "清仓", zone_hebdo: "周视图", zone_hebdo_hint: "真实每周数据 — 营业额、数量、平台分布、承运商、发货来源与热销产品", repartition_mp_semaine: "按平台分布", part_ca_pct: "营业额占比（%）", expeditions_titre: "发货", expeditions_hint: "本周订单实际使用的承运商", entrepot_titre: "发货来源", entrepot_hint: "本周订单发出的仓库 — 反映发货流向，非当前库存快照", top_semaine_titre: "本周热销产品", qte_semaine_courte: "周", tendance_4_semaines: "趋势 — 最近4周", zone_abc: "ABC分类 — 2026年", sku_classes: "已分类SKU", zone_saison: "季节性 — 2024-2025年指数", preset_mois_courant: "本月", preset_mois_precedent: "上月", preset_annee_courante: "今年", preset_annee_passee: "去年", preset_personnalise: "自定义", yoy_variation_forte: "变化幅度极大 — 请核实去年同期绝对值，通常是基数过低而非真实趋势",
    sum_ca_titre: "营业额", sum_vs_mois_prec: "对比上月", sum_objectif_titre: "目标", sum_ytd_titre: "年初至今", sum_panier_moyen_titre: "平均客单价", sum_repartition_marque_titre: "品牌分布", sum_mp_leader: "领先平台", sum_position: "排名", sum_evolution_bestherm: "Bestherm趋势", sum_top5_produits: "热销产品前5", sum_normes_titre: "认证标准", sum_top_cat: "热门品类/子品类", sum_performance: "效果表现", sum_budget_investi: "已投入预算", sum_periode_titre: "周期",
sum_en: "于", sum_sur: "，共", sum_soit_lower: "即", sum_vs_meme_periode_an_dernier: "对比去年同期", sum_comparatif_n1_indispo: "去年同期数据不可用", sum_objectif_annuel_realise: "年度目标", sum_deja_realise_periode: "已在所选周期内达成。", sum_aucun_objectif_pour: "未为以下对象设定年度目标：", sum_depuis_1er_janvier: "自1月1日起，即", sum_objectif_annuel_point: "年度目标。", sum_ytd_non_dispo: "未设定目标，无法显示年初至今指标。", sum_annee_complete_pas_detail: "完整2026年数据，暂无按周期细分。", sum_non_disponible: "暂无数据。", sum_du_ca_periode: "本周期营业额。", sum_realise_cette_periode: "本周期已达成的年度目标。", sum_aucun_objectif_point: "未设定年度目标。", sum_depuis_1er_janvier_parenthese: "自1月1日起", sum_de_objectif_parenthese: "目标）。", sum_sur_cette_periode_point: "本周期。", sum_non_calculable: "无法计算。", sum_ere: "", sum_e: "", sum_mp_sur: "平台，共", sum_pour_cette_periode: "（本周期）。", sum_rang_non_calculable: "排名无法计算。", sum_vs_an_dernier_point: "对比去年。", sum_comparatif_n1_mp_indispo: "按平台的去年同期数据不可用。", sum_qte_non_dispo_mp: "按平台的数量数据不可用", sum_annee_complete: "完整2026年", sum_aucune_donnee_produit: "暂无产品数据。", sum_du_ca_ce: "营业额为CE认证，", sum_en_nf_periode: "为NF认证（本周期）。", sum_annee_complete_non_filtrable: "完整2026年数据，不可按周期筛选。", sum_roas_de: "ROAS为", sum_sur_annee_2026: "（2026年）。", sum_depenses_pour: "已花费，带来", sum_generes_cumul: "营业额 — 2026年初至今累计（唯一可用数据，无月度细分）。", sum_donnee_annuelle_complete: "完整2026年年度数据 — 日期筛选不适用于此标签页。", conc_top_produits: "热销产品", conc_comparatif: "对比", non_identifiee: "未识别", marque_non_identifiee: "未识别品牌", lifecycle_croissance_desc: "对比2025年同期+20%或以上", lifecycle_declin_desc: "对比2025年同期-20%或以下", lifecycle_declin_lbl: "下滑", donnees_statiques: "静态数据", autres_lbl: "其他", vs_semaine_prec: "对比上周", apercu_semaine_titre: "本周概览", voir_detail_supply: "在Supply中查看详情", voir_detail_prix: "在价格页查看详情", demo_mode_tooltip: "演示模式 — 使显示数字失真，不影响真实数据", demo_mode_actif: "演示模式已启用 — 显示数字已失真，非真实数据", repartition_mp_semaine_courte: "本周", sum_cette_semaine: "本周", sum_du_ca_semaine: "占本周营业额", sum_meilleure_progression: "最佳增长", sum_vs_semaine_derniere: "对比上周", pd_prix_titre: "价格定位", pd_cycle_titre: "生命周期", pd_panier_titre: "常与以下产品一起购买", pd_prix_non_dispo: "该产品暂无价格数据", pd_panier_non_dispo: "未发现常见搭配", pd_repartition_titre: "各平台销售分布", pd_courbe_titre: "月度销售曲线", pd_reel: "实际", pd_estime_saison: "预计（季节性）", pd_rupture: "可能缺货", pd_forecast_annuel: "年度预测：", pd_potentiel_titre: "年度潜力", pd_potentiel_2025: "2025年（实际）", pd_potentiel_2026: "2026年（预测）", cat_potentiel_titre: "按品类的年度潜力", cat_potentiel_hint: "2025年实际 · 2026年预测", cat_saisonnalite_limitee: "品类历史过短（2025年不足6个月数据）：按当前节奏预测，未使用专属季节性", pd_forecast_fragile: "该估算基于不足3个月的实际销售数据，请谨慎参考。", pd_fiche_titre: "产品资料", pd_fiche_non_dispo: "暂无产品目录资料", pd_made_in_france: "法国制造", pd_connecte_wifi: "WiFi连接", pd_garantie_ans: "年保修", ap_catalogue_badge: "目录中，未售出", ap_top_badge: "前5名", ap_flop_badge: "后5名", note_homy_marque: "产品目录揭示了第4个品牌HOM'Y，有真实销售记录（如Orphée Connect，2026年约1.1万欧元，占营业额0.2%），目前计入上方Bestherm — 尚未单独区分，现有计算结构仅区分2个品牌。", forte_croissance_objectif_bas: "增长强劲但目标达成率低 — 目标可能需要重新校准", lifecycle_lancement_lbl: "新品期", lifecycle_lancement_desc: "去年同期无可比销售", lifecycle_croissance_lbl: "增长期", lifecycle_mature_lbl: "成熟期", lifecycle_mature_desc: "稳定，介于-20%至+20%之间", mois_dec_court: "12月", mois_sep_court: "9月", mois_oct_court: "10月", mois_nov_court: "11月", zone_anticipation: "预测 — 2026年10月至12月", anticipation_mp_titre: "按平台预测", anticipation_mp_hint: "与总体预测同一方法，按平台单独计算 — 预期高峰的分布未必与当前分布相同", zone_manquant: "进一步分析所缺内容", manque_stock_titre: "库存与补货", manque_stock_texte: "源文件给出了每笔发货的来源仓库（见上方周视图）— 这是流量，非当前库存水平。覆盖率、再订货点、安全库存、缺货、超储仍无法实现：需要某一时点的库存导出数据（可用/预留/锁定），所提供文件中不存在此类数据。", manque_transport_titre: "物流与配送", manque_transport_texte: "每笔订单的实际承运商现已可见（见上方周视图）。承运商成本、配送时效、延误/破损率仍无法实现 — 所提供文件中不存在此类信息。", radar_radiateurs: "散热器", radar_secheserviettes: "毛巾架", axe_ceramique: "陶瓷", axe_fonte: "铸铁", axe_film: "发热膜", axe_wifi: "WiFi", axe_vertical: "立式", axe_plinthe: "踢脚线", axe_soufflerie: "带风扇", entry_acces_restreint: "访问受限", entry_succes: "已授权访问", entry_afficher: "显示密码", entry_masquer: "隐藏密码", entry_se_souvenir: "记住我", entry_placeholder: "访问密钥", entry_entrer: "进入", entry_erreur: "密钥错误", gauge_objectif: "2026年目标", summary_synthese: "摘要", summary_fermer: "关闭摘要", zone_international: "国际", est_soit: "即", est_a: "至", est_de_objectif_annuel: "年度目标", pub_par_pays_hint: "与上方分布不同：此处衡量广告投放表现，非真实销售总额", conf_haute: "高可信度", conf_moyenne: "中等可信度", conf_basse: "低可信度", conc_ref_identifiees_sur: "个Bestherm/Thomson参考产品，已识别，共", conc_produits_recenses: "个已统计产品。", conc_aucune_ref_heater: "当前采集数据中未识别到Bestherm/Thomson产品。", conc_ref_sur: "个Bestherm/Thomson参考产品，共", conc_produits_point: "个产品。", conc_aucune_ref_cooling: "未发现Bestherm/Thomson产品 — 该平台暂未布局此市场。", conc_reference_sing: "个产品", conc_reference_plur: "个产品", conc_produit_sing: "个产品", conc_produit_plur: "个产品", conc_collecte_sing: "已采集", conc_collecte_plur: "已采集",
    autres_mp: "其他平台", autres_mp_hint: "按营业额降序排列", vue_detaillee: "仅显示页面顶部所选平台的详细信息",
    aucune_donnee_mp: "该平台暂无数据",
    repartition_geo: "地理分布", repartition_geo_hint: "广告活动产生的营业额，按国家分列 — 并非总销售额，销售数据中没有可靠的国家明细",
    filtrer_par_mp: "按平台筛选：", detail_mensuel_indispo: "仅限2026年 — 暂无可靠的月度明细",
    positions_approx: "位置为示意性排布（非真实地理投影）· 采用非线性比例以保证小国家可见",
    detail_pays: "国家明细", detail_pays_hint: "始终显示全部14个平台，2026年完整累计",
    repartition_marque: "2026年营业额按品牌分布", repartition_marque_hint: "各品牌占2026年累计营业额的比例", bestherm_vs_n1: "Bestherm 同比",
    thomson_hint: "Thomson：2025年同期为{ca}（该品牌于2025年中上市）— 基数过小，增长率无参考意义",
    ca_mensuel_marque: "各品牌月度营业额", ca_mensuel_marque_hint: "按自然月统计，仅限2026年",
    marque_reconstituee: "历史数据中的品牌信息通过产品参考编号还原 — 2026年覆盖率：",
    top_produits: "热销产品", top_produits_hint: "累计营业额最高的3款产品，与2025年同期对比（1月1日至最新数据日期）",
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
    tous_montants_ht: "金额不含税",
    erreur_titre: "出现了一些问题", erreur_msg: "应用程序遇到意外错误，刷新页面通常可以解决此问题。", recharger: "刷新页面",
    langue: "语言",
    plan_a_date: "计划进度",
    vs_plan_a_date: "对比计划进度",
    plan_pct_attendu: "年度目标截至目前应完成",
    objectif_semaine: "周目标",
    attendu_a_ce_jour: "截至今日应完成",
    objectif_du_mois: "月度目标",
    realises_sur: "已完成，目标",
    vises: "",
  },
  es: {
    /* repartitions */ rep_tab: "Desgloses", rep_titre: "Desgloses por mes y por marketplace", rep_pays: "País", rep_marque: "Marca", rep_type: "Tipo de producto", rep_categorie: "Categoría", rep_sous: "Subcategoría", rep_ca: "Ventas sin IVA", rep_qte: "Unidades", rep_evolution: "Evolución mensual", rep_classement: "Clasificación", rep_detail: "Detalle por marketplace y por mes", rep_total: "Total", rep_toutes: "Todos los marketplaces", rep_marketplace: "Marketplace", rep_marketplaces: "Subtotal marketplaces", rep_valeurs: "Valores", rep_parts: "Cuotas", rep_graphique: "Gráfico", rep_tableau: "Tabla", rep_montant: "Importe", rep_part: "Cuota", rep_part_de: "Cuota de {x} en el total de cada casilla (marketplace × mes)", rep_mix: "Reparto", rep_col_part: "Cuota", rep_vide: "Sin ventas en esta selección.", rep_retirer: "Quitar este filtro", rep_autres: "Otros ({n})", rep_autres_produits: "Otros productos", rep_marque_inconnue: "Marca sin asignar", rep_tous_pays: "Todos los países", rep_toutes_marques: "Todas las marcas", rep_tous_types: "Todos los tipos de producto", rep_astuce_classement: "Toca una fila para aislar su detalle por marketplace.", rep_astuce_mp: "Toca un marketplace para filtrar el gráfico y la clasificación.", rep_qte_indispo: "Unidades no disponibles para este año y este desglose (la extracción de Shopify no las incluye): se muestran las ventas.", rep_site_prec: "Sitio web 2025: sus ventas solo empiezan en mayo de 2025 en Shopify: no lo compares con 2026 sobre el año completo.", rep_en_cours: "Mes en curso, datos hasta el {d}", rep_en_cours_court: "mes en curso", rep_lien_marque: "Detalle por mes y por marketplace", rep_hors_france: "Sin Francia",
    /* donnees */ donnees_titre: "Datos de Shopify actualizados", donnees_jusqua: "hasta el {date}", donnees_socle: "Fuente única: Shopify (marketplaces BESTHERM y sitio web), del {du} al {au}", donnees_perime: "Sin actualizar desde hace {n} d", donnees_tout: "Todas las cifras del panel (KPI, curvas, marketplaces, marcas, productos, países, categorías, precios, elasticidades, cestas, comparaciones con 2025) se recalculan a partir de las ventas de Shopify.", donnees_base: "Marketplaces: ventas sin IVA = (ventas netas + impuestos) ÷ 1,2, siendo la marketplace la de la pasarela de pago de cada pedido. Sitio web: ventas netas sin impuestos, con descuentos y devoluciones deducidos, como en Shopify.", donnees_site_depuis: "El sitio web solo existe en Shopify desde el {du}: las ventas anteriores del sitio no están en las cifras, por lo que las comparaciones con 2025 son parciales para el sitio y para el total.", donnees_bricoman: "Bricoman no se distingue de Leroy Merlin en Shopify: sus ventas se cuentan en Leroy Merlin.", donnees_hors: "No vienen de Shopify (se conservan tal cual): publicidad, competencia, objetivos del plan, familia y norma de cada producto, fichas del catálogo.", donnees_maj: "Actualizado cada mañana · última extracción: {date}.", donnees_graph: "Ventas diarias sin IVA (últimos 30 días)", suivi_jours: "{n} d", suivi_ca: "Ventas sin IVA", suivi_vs: "vs {plage}", suivi_n1: "{an} · mismos días", suivi_n1_mp: "{an} · marketplaces", suivi_toucher: "Toca un día para ver su top 10, sus marketplaces y sus países", suivi_top10: "Top 10 productos", suivi_pays: "Cuota de ventas por país", suivi_aucune: "Sin ventas en estos días", suivi_autres: "Otros", suivi_nouveau: "nuevo", suivi_u: "uds.", suivi_pt: "pt", suivi_entiere: "Todo el período", suivi_delta_mp: "Δ marketplaces", suivi_tab_top: "Productos", suivi_tab_mp: "Marketplaces", suivi_tab_pays: "% por país", suivi_top10_mp: "Top 10 marketplaces", suivi_meme_date: "Misma fecha", suivi_meme_semaine: "Mismo día de la semana", suivi_obj_leg: "Objetivo (plan 2026)", suivi_obj_jour: "Objetivo del día", suivi_obj_per: "Objetivo", obj_2026_nom: "Objetivo 2026", obj_2026_mensuel: "Objetivo 2026 (plan mensual)", suivi_commandes: "Pedidos", suivi_panier: "Ticket medio", donnees_mp: "Marketplaces", donnees_site: "Sitio web", donnees_source: "Fuente: Shopify", donnees_indispo_titre: "Datos de Shopify no disponibles", donnees_indispo_msg: "Las ventas de Shopify son ilegibles o están incompletas, por lo que el panel no puede mostrarse. La actualización de la próxima mañana las reconstruye; si no, contacta con soporte.",
    nav_apercu: "Resumen", nav_marketplaces: "Marketplaces", nav_marques: "Marcas y Productos", nav_prix: "Seguimiento de Precios", nav_ads: "Campañas Ads", nav_concurrence: "Competencia", nav_data: "Datos", data_hint: "Selecciona uno o varios productos para generar un informe Excel detallado", data_titre: "Extraccion de datos", data_intro: "Elige productos y genera un informe Excel con reparto por canal, precios HT/TTC y evolucion mensual — una exportacion bajo demanda.", data_recherche_placeholder: "Buscar un producto…", data_aucun_resultat: "Ningun producto encontrado", data_aucune_selection: "Ningun producto seleccionado", data_produits_selectionnes_sg: "producto seleccionado", data_produits_selectionnes_pl: "productos seleccionados", data_tout_deselectionner: "Deseleccionar todo", data_generation_en_cours: "Generando…", data_generer_excel: "Generar Excel", data_erreur_generation: "Error al generar — intentalo de nuevo, o verifica tu conexion (la libreria de formato se carga desde internet).", data_note_contenu: "El informe tiene 3 pestanas: resumen, reparto por canal (marketplace, precios HT/TTC), y evolucion mensual 2024-2026. IVA aplicado: 20% (tasa estandar de Francia, ajustar si es necesario).", promo_titre: "Seleccion de precios promo", promo_externe_desc: "Herramienta colaborativa compartida con todo el equipo en tiempo real — se abre en una pestana nueva.", promo_ouvrir_outil: "Abrir la herramienta colaborativa", pilotage: "Panel de control", marketplace_label: "Marketplace:", toutes_mp: "Todas las marketplaces", mode_presentation: "Modo presentación", reset: "reiniciar", analyser_periode: "Analizar el período:", vs_an_dernier: "el año pasado", ht_suffix: "Todos los importes sin IVA", ca_cumule: "Facturación HT acumulada YTD", ca_cumule_hint: "Suma de la facturación HT de todos los pedidos desde el 1 de enero de 2026", toutes_marketplaces_suffix: "todas las marketplaces", objectif_2026: "de", objectif_non_defini: "objetivo no definido", panier_moyen: "Precio medio HT", panier_moyen_hint: "Facturación HT total ÷ número de pedidos, 2026", unites_vendues: "unidades vendidas", meilleure_vente: "Mejor venta 2026", meilleure_vente_hint: "Producto con mayor facturación HT acumulada desde enero", vs_meilleure_n1: "Vs mejor venta N-1", vs_meilleure_n1_hint: "Mismo producto, facturación HT comparada con la misma ventana 2025", en_2025: "en el mismo período de 2025", non_comparable: "no comparable", indispo_par_mp: "no disponible por marketplace", detail_non_conserve: "detalle por marketplace no conservado para 2025", tendance_titre: "Tendencia de facturación HT — una curva por año", tendance_hint: "Un gráfico por año, misma escala vertical para comparar las curvas honestamente", ca_ht_total_titre: "Facturación HT total — todas las marketplaces, a la fecha", ca_ht_total_hint: "Suma de la facturación HT 2026 de todas las marketplaces monitorizadas", au_rythme: "según lo previsto", top3: "Top 3", top3_hint: "Las 3 marketplaces con mayor facturación HT acumulada 2026", de_word: "de", nouveau: "nuevo", est_fin_annee: "Previsión fin de año", objectif_non_defini_mp: "Objetivo anual no definido para esta marketplace", legende_reel: "Real", legende_anticipe: "Previsto", reparti_saisonnier: "según el plan mensual 2026", repartition_pays_titre: "Reparto por país", repartition_pays_hint: "Pedidos reales por país — no una estimación de ads. 2024 excluido (sin detalle de país ese año)", aucune_donnee_pays: "Sin datos de país para esta selección — verifica que el período incluya 2025 o 2026.", pub_par_pays: "Publicidad por país", depense_ads: "gasto en ads", conc_titre: "Competencia", conc_hint: "Datos recopilados manualmente mediante búsqueda web — Francia. Ningún precio, ranking o volumen inventado.", conc_position_heater: "Posición Heater — ", conc_position_cooling: "Posición Cooling — ", conc_radiateurs: "Radiadores — ", conc_secheserviettes: "Toalleros — ", conc_produits_suivis: "Productos monitorizados", conc_produits_suivis_hint: "Selección actual (segmento/subcategoría/marketplace)", conc_prix_moyen: "Precio medio", conc_prix_moyen_hint: "Sobre los productos cuyo precio pudo verificarse", conc_fourchette_prix: "Rango de precios", conc_fourchette_prix_hint: "Del más barato al más caro, solo precios verificados", conc_en_promo: "En promoción", conc_en_promo_hint: "Productos que muestran un descuento vs precio de referencia", conc_sources_qualite: "Fuentes y calidad", conc_sources_qualite_hint: "Fiabilidad de la recopilación por subcategoría y marketplace — metodología y límites propios de cada fuente", conc_marques_visibles: "Marcas más visibles", conc_marques_visibles_hint: "Marcas más presentes en la recopilación, todas las marketplaces combinadas (número de apariciones, no cuota de mercado real)", conc_aucun_produit: "Ningún producto para esta selección", conc_sponsorise: "Patrocinado", conc_prix_nd: "Precio n/d", conc_comparatif_prix_mp: "Comparativa de precios por marketplace", conc_comparatif_prix_mp_hint: "Solo precios verificados — los productos sin un precio extraído de forma fiable no aparecen aquí", conc_aucun_prix_verifie: "Ningún precio verificado para esta selección", conc_moy: "prom.", conc_vs_marche: "Bestherm/Thomson vs mercado", conc_vs_marche_hint: "Precios Bestherm/Thomson comparados con la media de los competidores (Bestherm/Thomson excluidos del cálculo de esa media) — solo donde se pudo verificar un precio real de la competencia", conc_pas_de_comparaison: "Aún no hay precio de competidor verificado en la misma subcategoría que un producto Bestherm/Thomson, para esta selección — comparación imposible por ahora en lugar de aproximada.", conc_exporter: "Exportar:", conc_nomme_date: "Nombrado con la fecha del día · refleja la selección actual (segmento/subcategoría/marketplace)", zone_marque: "Marca", zone_produits_titre: "Productos", zone_normes: "Normas", zone_puissances: "Potencias", subnav_produit_ideal: "Producto ideal", subnav_normes_cat: "Normas y Categorías", topflop_titre: "Tops y Flops", topflop_hint: "Filtrable por fecha + marketplace como el resto de la app · accesorios y piezas de repuesto excluidos", top5_hint: "Mejores resultados en la selección actual", flop5_hint: "Peores resultados en la selección actual, accesorios excluidos", aucune_donnee: "Sin datos", cycle_vie_titre: "Ciclo de vida del producto", cycle_vie_hint: "Compara julio-septiembre 2026 con el mismo período de 2025 (no los meses anteriores, para no confundir estacionalidad con tendencia real) — respeta el filtro de marketplace", panier_titre: "Comprados frecuentemente juntos", panier_hint: "Productos realmente comprados juntos (mismo número de pedido), 2025+2026 — dato global, aún no filtrable por marketplace o período", panier_croise_hint: "Radiador + toallero en el mismo pedido — señal de reforma completa de baño", panier_croise_titre: "Ventas cruzadas radiador × toallero", panier_toutes_hint: "Todos los pares combinados, incluida la misma gama en distintas potencias", panier_toutes_titre: "Todos los pares — top 8", prix_regulier_ideal: "Precio regular ideal", prix_promo_ideal: "Precio promo ideal*", toutes_categories: "Todas las categorías", aucune_donnee_qte: "Sin datos de cantidad para esta selección", puissances_vendues_titre: "Potencias más vendidas", puissances_vendues_hint: "Cantidad vendida por potencia, filtrable por fecha + marketplace como el resto de la app", supply_titre: "Supply", supply_hint: "Construido solo con datos realmente disponibles — clasificación ABC (2026), histórico de ventas (2024-2026). No existe ningún dato de stock, transporte o proveedor en los archivos proporcionados.", comparatif_prix_titre: "Comparativa por producto", comparatif_prix_hint: "Precio más alto y más bajo entre marketplaces (2026), quién vende más, diferencia en %, precio medio ponderado. Marketplaces \"No identificada\"/\"Otra\" excluidas de la comparativa — no son marketplaces reales identificables.", cp_vend_plus: "Vende más", cp_prix_moyen: "Precio medio", signal_premium: "Posicionamiento premium", signal_sensible: "Sensible al precio", signal_neutre: "Señal neutra", radar_fiabilite_insuffisante: "Datos insuficientes para un perfil fiable", radar_plus_proche: "Mas cercano al perfil ideal", radar_plus_loin: "Mas alejado del perfil ideal", radar_score_hint: "Diferencia media entre los atributos del producto y el perfil ideal — mas bajo = mas cercano. Descriptivo, no un juicio de calidad.", elasticite_titre: "Elasticidad precio por referencia", elasticite_hint: "Regresion log-log cantidad~precio, por semana 2026 (HT o TTC: mismo resultado, el IVA no cambia la pendiente). Umbrales: >=8 semanas de datos y >=3% de variacion de precio antes de calcular.", elast_fiable_uniquement: "Solo fiables (R2 >= 0.3)", elast_peu_fiable: "poco fiable", elast_semaines: "semanas de datos", elast_variation_prix: "variacion de precio", elast_prix_moyen: "precio medio", elast_cat_elastique: "Elastico (<=-1)", elast_cat_inelastique: "Inelastico", elast_cat_positif: "Positivo (atipico)", simulation_titre: "Simulacion — subida de precio del 5%", simulation_hint: "Impacto estimado en el volumen (elasticidad medida) y en la facturacion neta, si el precio subiera un 5% y nada mas cambiara. Una simulacion, no una prediccion garantizada.", marge_manoeuvre_titre: "Margen de maniobra", marge_manoeuvre_sub: "El precio influye poco en estos volumenes", prudence_titre: "Precaucion de precio", prudence_sub: "Una subida haria huir volumenes importantes", sim_ca_actuel: "facturacion en juego", sim_volume: "volumen", sim_pas_de_signal: "ninguna senal fuerte detectada", sim_titre: "Simulador precio -> cantidad", sim_hint: "Elija un producto y un marketplace, proponga un precio: el volumen y la facturacion proyectados se recalculan en vivo, a partir de la elasticidad medida para esa referencia.", sim_choisir_produit: "Elegir un producto", sim_choisir_mp: "Marketplace", sim_prix_actuel: "Precio medio observado", sim_prix_propose: "Precio propuesto", sim_qte_actuelle: "Volumen actual (semana)", sim_qte_projetee: "Volumen proyectado", sim_ca_semaine_actuel: "Facturacion actual (semana)", sim_ca_semaine_projete: "Facturacion proyectada", sim_hors_plage: "Este precio supera el rango observado historicamente — la proyeccion se convierte en una extrapolacion, menos fiable.", sim_aucun_resultat: "Sin datos de elasticidad para este producto.", resultat: "resultado", resultats: "resultados", tous_produits_titre: "Todos los productos", tous_produits_hint: "Facturación y cantidad vendida, año 2026 completo (year-to-date) — incluye liquidación de stock, a diferencia de los Tops/Flops de arriba", ap_destockage_badge: "liquidación", zone_hebdo: "Vista semanal", zone_hebdo_hint: "Datos reales semanales — facturación, cantidad, reparto por marketplace, transportista, origen de envíos y productos top", repartition_mp_semaine: "Reparto por marketplace", part_ca_pct: "Parte de la facturación (%)", expeditions_titre: "Envíos", expeditions_hint: "Transportista real usado para los pedidos enviados esta semana", entrepot_titre: "Origen de los envíos", entrepot_hint: "Almacén desde donde salieron los pedidos esta semana — un flujo de envío, no una foto del stock actualmente disponible", top_semaine_titre: "Productos top de la semana", qte_semaine_courte: "sem.", tendance_4_semaines: "Tendencia — últimas 4 semanas", zone_abc: "Clasificación ABC — 2026", sku_classes: "SKU clasificados", zone_saison: "Estacionalidad — índice 2024-2025", preset_mois_courant: "Mes en curso", preset_mois_precedent: "Mes anterior", preset_annee_courante: "Año en curso", preset_annee_passee: "Año anterior", preset_personnalise: "Personalizado", yoy_variation_forte: "Variación muy fuerte — verifica el valor absoluto N-1, a menudo una base de comparación baja más que una tendencia real",
    sum_ca_titre: "Facturación", sum_vs_mois_prec: "Vs mes anterior", sum_objectif_titre: "Objetivo", sum_ytd_titre: "Year-to-date", sum_panier_moyen_titre: "Ticket medio", sum_repartition_marque_titre: "Reparto por marca", sum_mp_leader: "Marketplace líder", sum_position: "Posición", sum_evolution_bestherm: "Evolución Bestherm", sum_top5_produits: "Top 5 productos", sum_normes_titre: "Normas", sum_top_cat: "Categoría / subcategoría top", sum_performance: "Rendimiento", sum_budget_investi: "Presupuesto invertido", sum_periode_titre: "Período",
sum_en: "en", sum_sur: "en", sum_soit_lower: "es decir", sum_vs_meme_periode_an_dernier: "vs el mismo período del año pasado", sum_comparatif_n1_indispo: "comparativa N-1 no disponible", sum_objectif_annuel_realise: "del objetivo anual", sum_deja_realise_periode: "ya alcanzado para el período elegido.", sum_aucun_objectif_pour: "Sin objetivo anual definido para", sum_depuis_1er_janvier: "desde el 1 de enero, es decir", sum_objectif_annuel_point: "del objetivo anual.", sum_ytd_non_dispo: "Indicador YTD no disponible sin objetivo definido.", sum_annee_complete_pas_detail: "año 2026 completo, sin detalle disponible por período.", sum_non_disponible: "No disponible.", sum_du_ca_periode: "de la facturación en este período.", sum_realise_cette_periode: "del objetivo anual alcanzado en este período.", sum_aucun_objectif_point: "Sin objetivo anual definido.", sum_depuis_1er_janvier_parenthese: "desde el 1 de enero", sum_de_objectif_parenthese: "del objetivo).", sum_sur_cette_periode_point: "en este período.", sum_non_calculable: "No calculable.", sum_ere: "ª", sum_e: "ª", sum_mp_sur: "marketplace de", sum_pour_cette_periode: "para este período.", sum_rang_non_calculable: "Puesto no calculable.", sum_vs_an_dernier_point: "vs el año pasado.", sum_comparatif_n1_mp_indispo: "Comparativa N-1 no disponible por marketplace.", sum_qte_non_dispo_mp: "cantidad no disponible por marketplace", sum_annee_complete: "año 2026 completo", sum_aucune_donnee_produit: "Sin datos de producto disponibles.", sum_du_ca_ce: "de la facturación en CE,", sum_en_nf_periode: "en NF en este período.", sum_annee_complete_non_filtrable: "año 2026 completo, no filtrable por período.", sum_roas_de: "ROAS de", sum_sur_annee_2026: "en el año 2026.", sum_depenses_pour: "gastados para", sum_generes_cumul: "generados — total year-to-date 2026 (único dato disponible, sin detalle mensual).", sum_donnee_annuelle_complete: "Dato anual 2026 completo — el filtro de fecha no se aplica a esta pestaña.", conc_top_produits: "Productos top", conc_comparatif: "Comparativa", non_identifiee: "No identificada", marque_non_identifiee: "Marca no identificada", lifecycle_croissance_desc: "+20% o más vs mismo período 2025", lifecycle_declin_desc: "-20% o menos vs mismo período 2025", lifecycle_declin_lbl: "Declive", donnees_statiques: "Datos estáticos", autres_lbl: "Otras", vs_semaine_prec: "vs semana anterior", apercu_semaine_titre: "Resumen semanal", voir_detail_supply: "Ver detalle completo en Supply", voir_detail_prix: "Ver detalle completo en Precios", demo_mode_tooltip: "Modo demo — distorsiona las cifras mostradas, sin tocar los datos reales", demo_mode_actif: "Modo demo activo — las cifras mostradas están distorsionadas, no son los datos reales", repartition_mp_semaine_courte: "ESTA SEMANA", sum_cette_semaine: "esta semana", sum_du_ca_semaine: "de la facturación de la semana", sum_meilleure_progression: "Mejor progresión", sum_vs_semaine_derniere: "vs la semana anterior", pd_prix_titre: "Posicionamiento de precio", pd_cycle_titre: "Ciclo de vida", pd_panier_titre: "Comprado frecuentemente con", pd_prix_non_dispo: "Precio no disponible para este producto", pd_panier_non_dispo: "Ninguna asociación frecuente identificada", pd_repartition_titre: "Reparto de ventas por marketplace", pd_courbe_titre: "Curva de ventas mensual", pd_reel: "Real", pd_estime_saison: "Estimado (estacionalidad)", pd_rupture: "Posible rotura de stock", pd_forecast_annuel: "Previsión anual:", pd_potentiel_titre: "Potencial anual", pd_potentiel_2025: "2025 (real)", pd_potentiel_2026: "2026 (proyectado)", cat_potentiel_titre: "Potencial anual por categoría", cat_potentiel_hint: "2025 real · 2026 proyectado", cat_saisonnalite_limitee: "Categoría demasiado reciente (menos de 6 meses de historial 2025): proyectado al ritmo actual, sin estacionalidad propia", pd_forecast_fragile: "Estimación basada en menos de 3 meses de ventas reales — tomar con precaucion.", pd_fiche_titre: "Ficha de producto", pd_fiche_non_dispo: "Ficha de catálogo no disponible", pd_made_in_france: "Fabricado en Francia", pd_connecte_wifi: "Conectado WiFi", pd_garantie_ans: "años de garantía", ap_catalogue_badge: "catálogo, no vendido", ap_top_badge: "Top 5", ap_flop_badge: "Flop 5", note_homy_marque: "El catálogo revela una 4ª marca, HOM'Y, con ventas reales (ej. Orphée Connect, ~11k€ en 2026, 0,2% de la facturación) actualmente contabilizada en Bestherm arriba — aún no aislada por separado, ya que la estructura de cálculo existente solo distingue 2 marcas.", forte_croissance_objectif_bas: "Fuerte crecimiento pero objetivo poco alcanzado — objetivo posiblemente a recalibrar", lifecycle_lancement_lbl: "Lanzamiento", lifecycle_lancement_desc: "Sin venta comparable el año pasado", lifecycle_croissance_lbl: "Crecimiento", lifecycle_mature_lbl: "Maduro", lifecycle_mature_desc: "Estable, entre -20% y +20%", mois_dec_court: "Dic", mois_sep_court: "Sep", mois_oct_court: "Oct", mois_nov_court: "Nov", zone_anticipation: "Previsión — octubre a diciembre 2026", anticipation_mp_titre: "Previsión por marketplace", anticipation_mp_hint: "Mismo método que la previsión global, calculado por separado por marketplace — el reparto esperado del pico no es necesariamente el actual", zone_manquant: "Qué falta para ir más lejos", manque_stock_titre: "Stock y aprovisionamiento", manque_stock_texte: "El archivo fuente da el almacén de origen de cada envío (ver Vista semanal arriba) — un flujo, no un nivel de stock actual. Cobertura, punto de pedido, stock de seguridad, roturas, exceso de stock siguen fuera de alcance: haría falta una exportación de stock en un momento dado (disponible/reservado/bloqueado), que no existe en los archivos proporcionados.", manque_transport_titre: "Transporte y entrega", manque_transport_texte: "El transportista real por pedido ahora es visible (Vista semanal arriba). Costes de transporte, plazos de entrega, tasas de retraso/daños siguen fuera de alcance — esta información no existe en los archivos proporcionados.", radar_radiateurs: "Radiadores", radar_secheserviettes: "Toalleros", axe_ceramique: "Cerámica", axe_fonte: "Fundición", axe_film: "Film", axe_wifi: "WiFi", axe_vertical: "Vertical", axe_plinthe: "Rodapié", axe_soufflerie: "Con ventilador", entry_acces_restreint: "Acceso restringido", entry_succes: "Acceso autorizado", entry_afficher: "Mostrar contrasena", entry_masquer: "Ocultar contrasena", entry_se_souvenir: "Recordarme", entry_placeholder: "Clave de acceso", entry_entrer: "Entrar", entry_erreur: "Clave incorrecta", gauge_objectif: "OBJETIVO 2026", summary_synthese: "Resumen", summary_fermer: "Cerrar el resumen", zone_international: "Internacional", est_soit: "Es decir", est_a: "a", est_de_objectif_annuel: "del objetivo anual", pub_par_pays_hint: "Distinto del reparto anterior: esto mide el rendimiento de las campañas publicitarias por país, no el total de ventas reales", conf_haute: "Confianza alta", conf_moyenne: "Confianza media", conf_basse: "Confianza baja", conc_ref_identifiees_sur: "referencia(s) Bestherm/Thomson identificada(s) de", conc_produits_recenses: "productos registrados.", conc_aucune_ref_heater: "Ninguna referencia Bestherm/Thomson identificada en la recopilación actual.", conc_ref_sur: "referencia(s) Bestherm/Thomson de", conc_produits_point: "productos.", conc_aucune_ref_cooling: "Ninguna referencia Bestherm/Thomson — mercado aún no abordado en esta marketplace.", conc_reference_sing: "referencia", conc_reference_plur: "referencias", conc_produit_sing: "producto", conc_produit_plur: "productos", conc_collecte_sing: "recopilado", conc_collecte_plur: "recopilados", autres_mp: "Otras marketplaces", autres_mp_hint: "Ordenadas por facturación HT decreciente", vue_detaillee: "Vista detallada limitada a la marketplace seleccionada arriba", aucune_donnee_mp: "Sin datos para esta marketplace", repartition_geo: "Reparto geográfico", repartition_geo_hint: "Facturación HT generada por las campañas publicitarias, por país — no la facturación total de ventas, que no tiene detalle de país fiable en nuestras exportaciones", filtrer_par_mp: "Filtrar por marketplace:", detail_mensuel_indispo: "Solo 2026 — sin detalle mensual fiable disponible", positions_approx: "Posiciones aproximadas (no una proyección geográfica real) · escala no lineal para mantener visibles los países pequeños", detail_pays: "Detalle por país", detail_pays_hint: "Siempre las 14 marketplaces, acumulado completo 2026", repartition_marque: "Reparto de la facturación HT 2026 por marca", repartition_marque_hint: "Parte de cada marca en la facturación HT acumulada 2026", bestherm_vs_n1: "Bestherm vs N-1", thomson_hint: "Thomson: {ca} en el mismo período de 2025 (marca lanzada a mediados de 2025) — evolución no significativa, base demasiado baja", ca_mensuel_marque: "Facturación HT mensual por marca", ca_mensuel_marque_hint: "Facturación HT por mes natural, solo año 2026", marque_reconstituee: "Marca reconstruida por referencia de producto sobre el histórico — cobertura 2026:", top_produits: "Productos top", top_produits_hint: "Los 3 productos con mayor facturación HT acumulada, comparados con el mismo período de 2025 (del 1 de enero a la última fecha de datos)", qte_nd_mp: "cant. n/d por mp", nd: "n/d", reste_top15: "Resto del Top 15", reste_top15_hint: "Puesto 4 a 15", ca_mois_top6: "Facturación HT por mes — Top 6 productos, 2026", ca_mois_top6_hint: "Los 6 productos con mayor facturación HT acumulada · intensidad = facturación HT del mes", repartition_norme: "Reparto por norma (NF / CE)", repartition_norme_hint: "Parte de la facturación HT por norma de producto, mes a mes — año seleccionado con el filtro de abajo", evolution_mensuelle: "Evolución mensual", evolution_mensuelle_hint: "% de la facturación HT del mes según cada norma", repartition_categorie: "Reparto por categoría", repartition_categorie_hint: "% de la facturación HT 2026 por categoría y subcategoría — elige una marketplace para ver su propio reparto", rattache_catalogue: "% de la facturación HT vinculada a una categoría vía el catálogo de productos", categories: "Categorías", sous_categories: "Subcategorías", sous_categories_hint: "Columna «Subcategoría» del catálogo (ej. Cerámica gama básica, Cerámica + wifi…) — no las gamas de producto", suivi_prix: "Seguimiento de precios", suivi_prix_hint: "Precio de venta medio HT (facturación HT ÷ cantidad) por producto, marketplace y mes — conjunto de datos completo", rechercher_produit: "Buscar un producto…", affine_recherche: "Se muestran los primeros 40, afina tu búsqueda para ver el resto", non_dispo_2024: "2024 no disponible (sin detalle de marketplace en esta exportación)", aucun_resultat: "Sin resultados — prueba otro término de búsqueda", produit_col: "Producto", marketplace_col: "Marketplace", prix_mode: "Precio", qte_mode: "Cantidad", depense_totale: "Gasto total HT", depense_totale_hint: "Suma de los presupuestos ads consumidos, acumulado 2026", ca_genere_ht: "Facturación generada HT", ca_genere_ht_hint: "Facturación HT atribuida a las campañas ads, acumulado 2026", roas_pondere: "ROAS medio ponderado", roas_pondere_hint: "Facturación generada ÷ gasto, todas las marketplaces combinadas", budget_pub_mp: "Presupuesto publicitario por marketplace", budget_pub_mp_hint: "Presupuesto anual, gasto comprometido y saldo restante por marketplace — indicador circular para una lectura inmediata", depense_lbl: "Gastado", budget_lbl: "Presupuesto", restant_lbl: "Restante", top3_ads: "Top 3 por facturación generada", top3_ads_hint: "Las 3 marketplaces con mayor facturación generada por ads, acumulado 2026", a_surveiller: "A vigilar", a_surveiller_hint: "Gasto en ads cuyo retorno (ROAS) es inferior a 3x — umbral de alerta", perte_nette: "gasto superior a la facturación generada · por cada 100€ invertidos, ACOS de", reste_mp_ads: "Resto de marketplaces", reste_mp_ads_hint: "Ordenadas por facturación generada decreciente · barra = % del presupuesto anual ya consumido", pas_budget_n1: "Sin presupuesto ads N-1 proporcionado — comparativa interanual no disponible para este apartado", tous_montants_ht: "Importes sin IVA", erreur_titre: "Se produjo un problema", erreur_msg: "La aplicación encontró un error inesperado. Recargar la página normalmente resuelve el problema.", recharger: "Recargar", langue: "Idioma",
    plan_a_date: "Plan a la fecha",
    vs_plan_a_date: "vs plan a la fecha",
    plan_pct_attendu: "del objetivo anual previsto a la fecha",
    objectif_semaine: "Objetivo semanal",
    attendu_a_ce_jour: "previsto a la fecha",
    objectif_du_mois: "Objetivo del mes",
    realises_sur: "realizados de",
    vises: "previstos",
  },
};

// ============================================================================
// CONCURRENCE — veille concurrentielle, collectée manuellement via recherche
// web. Phase 1 : France uniquement, catégorie Ventilateurs. Chaque source a
// son propre niveau de confiance et sa méthodologie affichée — jamais de
// prix, classement ou volume inventé quand la donnée n'a pas pu être
// vérifiée (ex. Amazon : rang confirmé, prix non extrait de façon fiable).
// ============================================================================
const COMPETITION_DATA = {"collecte_date": "2026-08-24", "segments": {"Heater": {"sous_categories": {"Radiateur fixe": {"Leroy Merlin": {"methodologie": "Meilleures ventes officiel (CA, quantités, ajout panier)", "confiance": "haute", "produits": [{"rang": 1, "produit": "Radiateur fixe inertie sèche céramique 1500W ARIA horizontal blanc", "marque": "Bestherm", "prix": 104.9, "prix_avant": 139.9, "remise": 25, "note": 4.5, "avis": 16, "vendeur": "BESTHERM", "est_bestherm": true}, {"rang": 2, "produit": "Radiateur fixe inertie sèche céramique 1000W ARIA horizontal noir", "marque": "Bestherm", "prix": 74.9, "prix_avant": 99.9, "remise": 25, "note": 5.0, "avis": 1, "vendeur": "BESTHERM", "est_bestherm": true}, {"rang": 3, "produit": "Radiateur connecté inertie sèche céramique 1000W CDHTD10A-W", "marque": "Ciarra", "prix": null, "vendeur": "Ciarra", "est_bestherm": false}, {"produit": "Radiateur électrique mural inertie sèche céramique 1500W CDHT15E", "marque": "Ciarra", "prix": 135.99, "vendeur": "E.Leclerc", "est_bestherm": false}, {"rang": 4, "produit": "Radiateur inertie sèche céramique thermostat interchangeable 1000W OVEO", "marque": "Bestherm", "prix": null, "vendeur": "BESTHERM", "est_bestherm": true}]}, "Amazon.fr": {"methodologie": "Badge officiel Best Seller", "confiance": "haute", "produits": [{"rang": null, "produit": "Radiateur fixe inertie sèche céramique 2000W NESSA CONNECT horizontal blanc (WiFi)", "marque": "Bestherm", "prix": null, "vendeur": "Bestherm", "est_bestherm": true, "note_special": "Best Seller catégorie Heating"}, {"rang": null, "produit": "Radiateur fixe inertie sèche céramique 1500W Diane horizontal blanc, détecteur présence", "marque": "Bestherm", "prix": null, "vendeur": "Bestherm", "est_bestherm": true, "note_special": "Best Seller catégorie Electric Heaters"}, {"rang": null, "produit": "CBHTD20A-W Radiateur inertie céramique 2000W WiFi", "marque": "Ciarra", "prix": null, "vendeur": "Ciarra", "est_bestherm": false}, {"rang": null, "produit": "ReadyWarm 3000 Textile, 2000W, oscillation", "marque": "Cecotec", "prix": null, "vendeur": "Cecotec", "est_bestherm": false}]}}, "Radiateur mobile": {"Leroy Merlin": {"methodologie": "Meilleures ventes officiel", "confiance": "moyenne", "note": "Catégorie dominée par du chauffage de chantier professionnel, peu de radiateurs mobiles domestiques classiques identifiés", "produits": [{"rang": 1, "produit": "Chauffage soufflant TFH 19 E 2000W, chauffage d'appoint mobile", "marque": "Trotec", "prix": null, "vendeur": "Trotec", "est_bestherm": false}, {"rang": 2, "produit": "Chauffage de chantier électrique TDE 95 V2 400V mobile", "marque": "Trotec", "prix": null, "vendeur": "Trotec", "est_bestherm": false}]}}, "Radiateur soufflant": {"Amazon.fr": {"methodologie": "Badge officiel Best Seller", "confiance": "haute", "produits": [{"rang": 1, "produit": "Ceramic Fan Heater 3000W, thermostat, 3 modes", "marque": "Dahtec", "prix": null, "vendeur": "Dahtec", "est_bestherm": false}, {"rang": 2, "produit": "Electric Heater Fan Blower 2400W SO2330F2", "marque": "Rowenta", "prix": null, "vendeur": "Rowenta", "est_bestherm": false}, {"rang": 3, "produit": "Mini Excel 2-in-1 Ceramic Fan Heater SO9261F0", "marque": "Rowenta", "prix": null, "vendeur": "Rowenta", "est_bestherm": false}, {"rang": 4, "produit": "PTC Ceramic Radiator 2000W thermostat + télécommande", "marque": "Midea", "prix": null, "vendeur": "Midea", "est_bestherm": false}]}, "Leroy Merlin": {"methodologie": "Tri pertinence — pas de classement officiel isolé sur cette sous-catégorie précise", "confiance": "basse", "produits": [{"rang": null, "produit": "Radiateur soufflant céramique programmable digital Nexeo 1000/2000W", "marque": "Fácula", "prix": null, "vendeur": "Fácula", "est_bestherm": false}]}}, "Sèche-serviette électrique": {"Leroy Merlin": {"methodologie": "Meilleures ventes officiel", "confiance": "haute", "produits": [{"rang": 1, "produit": "Sèche-serviette sans fluide avec soufflerie 500W+1000W HESTIA blanc", "marque": "Bestherm", "prix": null, "vendeur": "BESTHERM", "est_bestherm": true}, {"rang": 2, "produit": "Sèche-serviette sans fluide avec soufflerie 500W+1000W HESTIA noir", "marque": "Bestherm", "prix": null, "vendeur": "BESTHERM", "est_bestherm": true}, {"rang": 3, "produit": "Sèche-serviette sans fluide avec soufflerie 500+1000W HANAE noir", "marque": "Bestherm", "prix": null, "vendeur": "BESTHERM", "est_bestherm": true}, {"rang": 4, "produit": "Sèche-serviettes connecté Allure 4 soufflerie 1500W", "marque": "Thermor", "prix": null, "vendeur": "Thermor", "est_bestherm": false}, {"rang": 5, "produit": "Sèche-serviettes connecté Nefertiti soufflerie 1750W", "marque": "Atlantic", "prix": null, "vendeur": "Atlantic", "est_bestherm": false}, {"rang": 6, "produit": "Sèche-serviettes électrique connecté WiFi thermostat digital 600W", "marque": "S'Afielina", "prix": null, "vendeur": "S'Afielina", "est_bestherm": false}]}}, "Sèche-serviette soufflant": {"Leroy Merlin": {"methodologie": "Meilleures ventes officiel", "confiance": "haute", "produits": [{"rang": 1, "produit": "Sèche-serviette sans fluide connecté WiFi soufflerie 500+1000W COSMO blanc", "marque": "Thomson", "prix": null, "vendeur": "Thomson", "est_bestherm": true, "note_special": "Marque sœur HOM'Y"}, {"rang": 2, "produit": "Sèche-serviette sans fluide connecté WiFi soufflerie 500+1000W COSMO noir", "marque": "Thomson", "prix": null, "vendeur": "Thomson", "est_bestherm": true, "note_special": "Marque sœur HOM'Y"}, {"rang": 3, "produit": "Sèche-serviette sans fluide avec soufflerie 500W+1000W HESTIA blanc", "marque": "Bestherm", "prix": null, "vendeur": "BESTHERM", "est_bestherm": true}, {"rang": 4, "produit": "SILK EVO Radiateur soufflant sèche-serviettes surface verre 1000W", "marque": "Radialight", "prix": null, "vendeur": "Radialight", "est_bestherm": false}]}}, "Sèche-serviette connecté": {"Leroy Merlin": {"methodologie": "Tri pertinence — pas de classement officiel isolé sur cette sous-catégorie précise", "confiance": "moyenne", "produits": [{"rang": null, "produit": "Sèche-serviette connecté WiFi soufflerie 500+1000W COSMO", "marque": "Thomson", "prix": null, "vendeur": "Thomson", "est_bestherm": true, "note_special": "Marque sœur HOM'Y"}, {"rang": null, "produit": "WARM TOWEL PRO connecté WiFi 500/1500W", "marque": "Create", "prix": null, "vendeur": "Create", "est_bestherm": false}, {"rang": null, "produit": "Sèche-serviettes connecté WiFi thermostat digital programmable", "marque": "S'Afielina", "prix": null, "vendeur": "S'Afielina", "est_bestherm": false}, {"rang": null, "produit": "Radiateur sèche-serviettes connecté Adelis soufflerie 1500W", "marque": "Atlantic", "prix": null, "vendeur": "Atlantic", "est_bestherm": false}]}}}}, "Cooling": {"sous_categories": {"Ventilateur sur pied": {"Leroy Merlin": {"methodologie": "Meilleures ventes officiel", "confiance": "haute", "produits": [{"rang": 1, "produit": "Ventilateur de pied 45W blanc 41cm oscillation 75°", "marque": "Oceanic", "prix": 28.14, "vendeur": "Leroy Merlin", "est_bestherm": false}, {"rang": 2, "produit": "Ventilateur sur pied blanc 45W", "marque": "Oceanic", "prix": 26.02, "vendeur": "Leroy Merlin", "est_bestherm": false}, {"rang": 3, "produit": "Ventilateur sur pied SFT 3107WH 3 vitesses 50W", "marque": "Sencor", "prix": 34.18, "vendeur": "Leroy Merlin", "est_bestherm": false}]}, "ManoMano": {"methodologie": "Top ventes automatique (volume, note, avis)", "confiance": "haute", "produits": [{"rang": 1, "produit": "Ventilateur sur pied 120W 3 vitesses D50cm", "marque": "Arebos", "prix": 69.9, "avis": 28, "vendeur": "ManoMano", "est_bestherm": false}, {"rang": 2, "produit": "Ventilateur Essential VU4410 blanc", "marque": "Rowenta", "prix": 100.15, "vendeur": "ManoMano", "est_bestherm": false}]}, "Amazon.fr": {"methodologie": "Badge officiel Best Seller", "confiance": "haute", "produits": [{"rang": 1, "produit": "EnergySilence 1040 SmartExtreme, moteur DC, 28W", "marque": "Cecotec", "prix": null, "vendeur": "Cecotec", "est_bestherm": false}]}}, "Ventilateur de plafond": {"Amazon.fr": {"methodologie": "Badge officiel Best Seller", "confiance": "haute", "produits": [{"rang": 1, "produit": "WinDCALM ABS blanc effet bois + télécommande 40W", "marque": "Create", "prix": null, "vendeur": "Create", "est_bestherm": false}]}, "Cdiscount": {"methodologie": "Tri pertinence — pas de badge meilleures ventes officiel identifié", "confiance": "moyenne", "produits": [{"rang": 1, "produit": "Ventilateur de plafond SARA 132cm LED + télécommande", "marque": "Thomson", "prix": 149.99, "prix_avant": 208.95, "remise": 28, "note": 4.8, "avis": 54, "vendeur": "Cdiscount", "est_bestherm": true, "note_special": "Marque sœur HOM'Y"}]}, "Castorama": {"methodologie": "Tri pertinence — rang non extrait de façon fiable", "confiance": "basse", "produits": [{"rang": null, "produit": "Ventilateur de plafond avec lumière ALMA 7 pales Ø50cm", "marque": "Thomson", "prix": null, "vendeur": "Castorama", "est_bestherm": true, "note_special": "Marque sœur HOM'Y"}, {"rang": null, "produit": "Ventilateur de plafond avec lumière SARA 3 pales Ø132cm", "marque": "Thomson", "prix": null, "vendeur": "Castorama", "est_bestherm": true, "note_special": "Marque sœur HOM'Y"}, {"rang": null, "produit": "Ventilateur sur pied silencieux Ø36,5cm noir 12 vitesses", "marque": "GoodHome", "prix": null, "note": 4.18, "avis": 11, "vendeur": "Castorama", "est_bestherm": false}]}}, "Climatisation": {"Leroy Merlin": {"methodologie": "Meilleures ventes officiel", "confiance": "haute", "note": "Aucune présence Bestherm/Thomson identifiée sur cette sous-catégorie — hors du catalogue actuel", "produits": [{"rang": 1, "produit": "Climatiseur mobile réversible connecté Ph7 1300/2600W 11970/8892BTU", "marque": "Qlima", "prix": null, "avis": 30, "vendeur": "Leroy Merlin", "est_bestherm": false}, {"rang": 2, "produit": "Climatiseur Mobile 9000 BTU/h 2,6kW, contrôle App, Alexa", "marque": "Comfee", "prix": null, "vendeur": "Leroy Merlin", "est_bestherm": false}, {"rang": 3, "produit": "Climatiseur portable MC Series Pro 12000 BTU, app mobile", "marque": "MeacoCool", "prix": null, "vendeur": "Leroy Merlin", "est_bestherm": false}]}}}}}};
;


// couleurs de marque vérifiées par recherche web (pas de hex deviné) —
// seules les marketplaces confirmées par plusieurs sources indépendantes
// figurent ici ; les autres restent sur l'orange Bestherm par défaut
// ============================================================================






































// SUPPLY — indice de saisonnalité et classes ABC : calculés plus haut depuis les ventes Shopify (voir « DONNÉES ») ; la projection
// de fin d'année en découle (méthodologie détaillée dans les hints affichés dans l'app).








// PAYS_MONTHLY (calculé plus haut depuis Shopify : pays de livraison des commandes). PAYS_OBJECTIF :
// objectifs annuels par pays (Target MKTP, tous marketplaces confondus) — plan, hors Shopify.






const PAYS_OBJECTIF = {"France": 12800000.0, "Royaume-Uni": 700000.0, "Belgique": 560000.0, "Pays-Bas": 90000.0, "Allemagne": 240000.0, "Espagne": 310000.0, "Portugal": 135000.0, "Pologne": 65000.0, "Italie": 180000.0};

// OBJECTIF_2026 — plan officiel 2026 (onglet « Objectif 2024 - 2025 » du dashboard) : objectif annuel,
// objectifs mensuels (CA HT et quantités) et objectifs hebdomadaires [semaine, CA HT, quantités] — semaines
// Excel (dimanche→samedi). La dernière semaine peut être partielle (DMAX n'est pas toujours un samedi).
const OBJECTIF_2026 = {"annuel":15000000,"mensuel":[1605000,1125000,705000,555000,375000,472500,772500,691500,1768500,2175000,3105000,1650000],"mensuel_qte":[16895,11842,7421,5842,3947,4974,8132,7279,18616,22895,32684,17368],"hebdo":[[1,96300,991],[2,323408,3327],[3,376373,3872],[4,415695,4277],[5,393225,4046],[6,339231,3490],[7,298846,3075],[8,262500,2701],[9,224423,2309],[10,189808,1953],[11,165577,1704],[12,147404,1517],[13,141865,1460],[14,137885,1419],[15,132462,1363],[16,127615,1313],[17,126808,1305],[18,121731,1252],[19,95423,982],[20,82615,850],[21,72346,744],[22,80192,825],[23,96923,997],[24,103250,1062],[25,107288,1104],[26,120904,1244],[27,146468,1507],[28,159324,1639],[29,173617,1786],[30,194051,1997],[31,178503,1837],[32,154420,1589],[33,149228,1535],[34,142305,1464],[35,190142,1956],[36,244314,2514],[37,372416,3832],[38,441647,4544],[39,469339,4829],[40,478535,4923],[41,476942,4907],[42,479365,4932],[43,498404,5128],[44,515885,5308],[45,574000,5906],[46,616000,6338],[47,650000,6688],[48,1045000,10752],[49,571686,5882],[50,434796,4473],[51,360133,3705],[52,503386,5179]]};

// ===== Plan 2026 — outils de calcul. Les semaines suivent la convention Excel (WEEKNUM, dimanche→samedi,
// semaine 1 = celle du 1er janvier) : c'est celle des données hebdomadaires WEEKLY_* et du plan hebdomadaire. =====
// numéro de semaine Excel d'une date "AAAA-MM-JJ"
function excelWeekOf(iso) {
  const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
  const jan1 = Date.UTC(y, 0, 1), dt = Date.UTC(y, m - 1, d);
  return Math.floor((Math.round((dt - jan1) / 86400000) + new Date(jan1).getUTCDay()) / 7) + 1;
}
// plage "27 sept. – 3 oct." d'une semaine Excel (tronquée au 1er janvier et à la dernière donnée DMAX)
function excelWeekRange(week, year = 2026) {
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const start = new Date(jan1); start.setUTCDate(jan1.getUTCDate() - jan1.getUTCDay() + (week - 1) * 7);
  const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
  const dmax = new Date(DMAX + "T00:00:00Z");
  const a = start < jan1 ? jan1 : start, b = end > dmax ? dmax : end;
  const fmt = (x) => x.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${fmt(a)} – ${fmt(b)}`;
}
// objectif cumulé que le plan hebdomadaire prévoyait à une date : semaines entières précédentes + prorata
// des jours écoulés de la semaine en cours (dimanche = 1 jour … samedi = 7 jours)
function planAttenduAuJour(iso) {
  const w = excelWeekOf(iso);
  const jours = new Date(String(iso).slice(0, 10) + "T00:00:00Z").getUTCDay() + 1;
  let total = 0;
  for (const [sem, obj] of OBJECTIF_2026.hebdo) { if (sem < w) total += obj; else if (sem === w) total += (obj * Math.min(7, jours)) / 7; }
  return total;
}

;


// PRODUCT_CATALOG — fiches produit issues du catalogue Shopify (export du 7
// septembre 2026), réconciliées avec les noms de vente existants par extraction
// de motif depuis les titres longs (marque + wattage + couleur). 74 produits sur
// les 120 actuels ont une correspondance fiable avec fiche complète (image,
// couleur, matière, poids, dimensions, garantie, connectivité) ; les autres
// n'ont pas de spec exploitable dans l'export ou pas de correspondance certaine
// (le catalogue référence des variantes plus récentes non encore vendues).
const PRODUCT_CATALOG = {"ARIA BLANC 500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HT5PDC.1.png?v=1757414368","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":4.5,"dimensions":"45 x 41,4 x 12 cm"},"ARIA VERTICAL 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1000wface_3f169ddd-be3a-4709-8147-3b4556372d73.png?v=1759155873","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":6.6,"dimensions":"61,4 x 45 x 12 cm"},"ARIA VERTICAL 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/2000wface_5d036ad1-98ef-4959-9ebb-aee4b26a0223.png?v=1759156826","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":11.2,"dimensions":"101,4 x 45 x 12 cm"},"ARIA PLINTHE 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HR10-TL11.1.png?v=1759391736","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":6.44,"dimensions":"30 x 81,4 x 12 cm"},"ARIA PLINTHE 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HR15-TL11.5.png?v=1759391840","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":7.96,"dimensions":"30 x 101,4 x 12 cm"},"CLEO BLANC 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/test.png?v=1769785903","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":7.74,"dimensions":"45 x 60 x 12,5 cm"},"CLEO BLANC 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/test1500.png?v=1769785801","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":10.5,"dimensions":"45 x 80 x 12,5 cm"},"CLEO BLANC 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/test2000.png?v=1769785842","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":12.7,"dimensions":"45 x 100 x 12,5 cm"},"MILLA BLANC 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/11000_0ed2b73c-fa1a-47fb-b077-c72dcfcf29eb.png?v=1775659952","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":true,"poids":9.7,"dimensions":"48,5 x 69,2 x 12,5 cm"},"MILLA BLANC 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/192000-Copie.png?v=1756893563","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":true,"poids":11.7,"dimensions":"48,5 x 89,2 x 12,5 cm"},"MILLA BLANC 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/101500_0ecd8a44-7e52-4555-b5f0-b88b5e4f7797.png?v=1756893498","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":true,"poids":13.88,"dimensions":"48,5 x 109,2 x 12,5 cm"},"MOLY BLANC 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/11000_ed60fe6f-dd55-4209-8ec9-ff6bdf7e85cf.png?v=1756892484","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":true,"poids":7.4,"dimensions":"60 x 50 x 11,5 cm"},"MOLY BLANC 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/101500_e8f70edc-6efb-4d6d-9e56-f2f4eed56eb0.png?v=1756892575","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":true,"poids":9.9,"dimensions":"60 x 66 x 11,5 cm"},"MOLY BLANC 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/192000_7971383b-5f3a-45ab-bcf7-64b6b33f4f15.png?v=1756894284","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":true,"poids":11.9,"dimensions":"60 x 82 x 11,5 cm"},"COSMO BLANC 500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1750_5e4a5a1c-29ac-4351-82a5-9a324bd61b74.png?v=1774274735","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":true,"poids":3.9,"dimensions":"98 x 54 x 9,2 cm"},"HANAE 500W+1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1000_FACE-100.jpg?v=1761919751","couleur":"#ffffff","garantie":2,"madeInFrance":false,"connecte":false,"poids":9.4,"dimensions":"60 x 13 x 108,4 cm"},"HESTIA BLANC 300W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1000_FACE_49c67e4a-275f-4164-a074-b400d6c80afa.png?v=1761920907","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":2.46,"dimensions":"54 x 9,2 x 61,5 cm"},"SPARK 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1000_face_3dba475a-8082-471a-a49f-78fbd9d9c4a9.jpg?v=1777984883","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":5.8,"dimensions":"45 x 55 x 11,5"},"SPARK 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1500_face_e545cc07-c1c3-47f3-8748-7551a6feb2ad.jpg?v=1777985290","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":8.2,"dimensions":"45 x 75 x 11,5"},"SPARK 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/2000_face_180cffe7-2c79-4a30-88ae-6d23d23ba96c.jpg?v=1777985890","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":10.0,"dimensions":"45 x 95 x 11,5"},"ALOA CONNECT 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1_eee1b005-6d2a-49d2-a674-384a9bc8769e.jpg?v=1781271120","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":6.6,"dimensions":"45 X 60 X 12"},"ALOA CONNECT 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/3_0fb64bdb-f01a-42c1-a181-d6b862f089e9.jpg?v=1781269364","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":8.5,"dimensions":"45 X 80 X 12"},"ARIA 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ARIA_1000_FRONT.png?v=1755848456","couleur":"#000000","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":5.4,"dimensions":"57 x 11 x 45"},"ARIA 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ARIA_1500_FRONT.png?v=1748270950","couleur":"#000000","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":6.7,"dimensions":"71,4 x 45 x 11"},"ARIA 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ARIA_2000_FRONT.png?v=1748271209","couleur":"#000000","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":8.1,"dimensions":"86,4 x 45 x 11"},"ARIA VERTICAL 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1500wface_dd5daf9c-2dbc-4d67-a38e-ecd3f3263195.png?v=1759156483","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":8.9,"dimensions":"81,4 x 45 x 12 cm"},"TANIN 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1000_FACE-100_89863b10-9851-49ec-89e7-e065fcf9d28b.jpg?v=1762339516","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":7.4,"dimensions":"55cm x 11cm x 45cm"},"TANIN 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1500_FACE-100.jpg?v=1762339610","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":9.1,"dimensions":"70cm x 11cm x 45cm"},"TANIN 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/2000_FACE-100.jpg?v=1762339727","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":11.5,"dimensions":"85cm x 11cm x 45cm"},"ALBA 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1_4bf66a63-08f3-429f-8e02-1aeb97b8659d.jpg?v=1759735745","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":7.3,"dimensions":"55cm x 11cm x 45cm"},"ALBA 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1_07027b07-b235-4fa6-8e37-3d99ada2db2e.jpg?v=1759909968","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":9.1,"dimensions":"70cm x 11cm x 45cm"},"ALBA 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1_ebbfa642-298c-4dd9-9ba1-3fb9d4a0e5a4.jpg?v=1759910519","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":11.5,"dimensions":"85cm x 11cm x 45cm"},"OVEO 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/OVEO1000_FRONT.png?v=1748355427","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":6.8,"dimensions":"63,5 x 45 x 12,5"},"OVEO 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/OVEO1500_FRONT.png?v=1748355484","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":9.2,"dimensions":"83,5 x 45 x 12,5"},"OVEO 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/OVEO2000_FRONT.png?v=1748355531","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":11.7,"dimensions":"103,5 x 45 x 12,5"},"BIA 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1.jpg?v=1756110910","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":7.2,"dimensions":"55cm x 11cm x 45cm"},"BIA 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1500_FACE-100_18fff749-19c3-480d-be09-73f7bf50d193.jpg?v=1771411648","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":8.7,"dimensions":"70cmx 11cm x 45cm"},"BIA 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/2000_FACE-100_83c90b64-b6f1-459d-9cf4-1cce38a1d951.jpg?v=1771411714","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":11.4,"dimensions":"85cm x 11cm x 45cm"},"MOTU 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/MOTU1000W_FACE.png?v=1748353359","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":6.6,"dimensions":"60 x 12,5 x 45 cm"},"MOTU 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/MOTU_1500W_FACE.png?v=1748353497","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":8.5,"dimensions":"80 x 12,5 x 45 cm"},"MOTU 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/MOTU_2000W_FACE.png?v=1748353589","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":10.8,"dimensions":"100 x 12,5 45 cm"},"NESSA CONNECT 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HT10-23AEW_front.png?v=1763733791","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":7.0,"dimensions":"60 x 45,5 x 12,5"},"NESSA CONNECT 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HT15-23AEW_front.png?v=1748350190","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":9.2,"dimensions":"80 x 45,5 x 12,5"},"NESSA CONNECT 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HT20-23AEWfront.png?v=1748350277","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":11.3,"dimensions":"100 x 45,5 x 12,5"},"FREYA 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HT10PYE_532cd907-ef7a-452c-9c0c-8109211dfb83.png?v=1748351730","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":7.0,"dimensions":"45 x 60 x 12,5"},"FREYA 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HT15PYE_with_logo.png?v=1748351861","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":9.1,"dimensions":"45 x 80 x 12,5"},"FREYA 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HT20PYE_front_withlogo.png?v=1748351971","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":11.5,"dimensions":"45 x 100 x 12,5"},"NEMESIS 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1000_FACE.png?v=1761918655","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":7.1,"dimensions":"60 x 12,5 x 45 cm"},"NEMESIS 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/NEMESIS1500W_FACE.png?v=1748354674","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":8.9,"dimensions":"80 x12,5 x 45 cm"},"NEMESIS 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/NEMESIS2000W.png?v=1748354766","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":12.0,"dimensions":"100 x 45 x 11,8 cm"},"ALMEA 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1000_FACE_40006dc0-d245-45d8-988b-2978a962f9a4.png?v=1771500008","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":6.8,"dimensions":"63,5 x 45 x 12,5"},"ALMEA 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1500_FACE_66d0ee43-e87d-4a84-a232-9feff58e12b9.png?v=1771500187","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":8.5,"dimensions":"83,5 x 45 x 12,5"},"ALMEA 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/2000_FACE_fc7c5cf7-39d2-407f-88c0-73c907eaa127.png?v=1771500336","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":11.3,"dimensions":"103,5 x 45 x 12,5"},"HESTIA BLANC 500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1500_FACE.png?v=1761921110","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":3.9,"dimensions":"54 x 9,2 x 98 cm"},"ATLAS 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HT10PYG_front_withlogo.png?v=1748350856","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":6.8,"dimensions":"60 x 12,5 x45 cm"},"ATLAS 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HT15PYG_front_with_logo.png?v=1748350939","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":9.0,"dimensions":"80 x 12,5 x 45 cm"},"ATLAS 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HT20PYG_front.png?v=1748351064","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":11.2,"dimensions":"100 x 12,5 x 45 cm"},"HANAE 500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/aa3271f96d9e332248660bb00ed603f5.jpg?v=1686899901","couleur":"#ffffff","matiere":"Acier","madeInFrance":false,"connecte":false,"poids":7.2,"dimensions":"60 x 11,6 x 101 cm"},"EOLE 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/EOLE1000_FRONT.png?v=1748356815","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":9.7,"dimensions":"69,2 x 48,5 x 12,5"},"EOLE 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/EOLE1500_FRONT.png?v=1748356864","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":11.7,"dimensions":"89,2 x 48,5 x 12,5"},"EOLE 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/EOLE2000_FRONT.png?v=1748356922","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":15.7,"dimensions":"109.2cm x 12.5cm x 48.5cm"},"DIANE 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/FACE_1000W_5ad2ab94-5b11-4e01-857c-5853526b3bd4.png?v=1761909639","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":8.2,"dimensions":"60cm x 12cm x 58cm"},"TIKEI 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/FACE_1000W_352fc97d-eb40-4325-b9bc-942318ffbb7f.png?v=1748349270","couleur":"#ffffff","matiere":"Aluminium","garantie":2,"madeInFrance":false,"connecte":false,"poids":7.8,"dimensions":"40.9x10x58"},"ZOE 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/2.jpg?v=1756110966","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":7.2,"dimensions":"55cmx 11cm x 45cm"},"ANIS BLANC 500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ANIS500WBLANCFACE.png?v=1776351392","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":5.6,"dimensions":"50 x 11 x 101 cm"},"ZOE 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/FACE1500W_47f84c09-cff5-4aaa-9c41-72c9b4f37e42.png?v=1755693999","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":8.7,"dimensions":"70cm x 11cm x 45cm"},"ZOE 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/FACE_2000W_fa83688f-bbf7-4f41-affb-739423e9df6b.png?v=1755693876","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":11.4,"dimensions":"85cm x 11cm x 45cm"},"TIKEI 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/FACE1500W_90a2802f-b3b2-4f5e-8622-73670fc58e0a.png?v=1748349373","couleur":"#ffffff","matiere":"Aluminium","garantie":2,"madeInFrance":false,"connecte":false,"poids":10.4,"dimensions":"57.2x10x58"},"TIKEI 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/FACE2000W_a7d9b2a0-378a-4c92-8c41-3b99f17730a7.png?v=1748349408","couleur":"#ffffff","matiere":"Aluminium","garantie":2,"madeInFrance":false,"connecte":false,"poids":12.9,"dimensions":"73,5 x 58 x 10"},"DIANE 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/FACE_1500W_c1fc6e53-44b0-434a-b676-e347cb233d72.png?v=1748348837","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":10.4,"dimensions":"72x12x58"},"DIANE 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/FACE_2000W_c1c7e154-4243-4b1e-8651-1dfc99796d68.png?v=1748348908","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":12.3,"dimensions":"84cm x 12 cm x 58cm"},"IRIS BLANC 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/seul_face_iris_blanc_1000_fde6210f-ccec-4106-ac19-0b2ed0ecd312.png?v=1748416829","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":8.9,"dimensions":"55cm X 11cm X 45cm"},"IRIS BLANC 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/seul_face_iris_blanc_1500_bb53f68b-ae78-42f3-9b04-116b6723b191.png?v=1748416908","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":11.0,"dimensions":"70cm X 11cm X 45cm"},"IRIS BLANC 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/seul_face_iris_blanc_2000_0f93ba91-b62b-4a79-b11c-8ba8a481087d.png?v=1748416957","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":13.7,"dimensions":"85cm X 11cm X 45cm"},"Aria 500W Noir":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HT5PDC_.5.png?v=1757414451","couleur":"#000000","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":4.5,"dimensions":"45 x 41,4 x 12 cm"},"Nemea Vertical 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ChatGPTImage16juin2026_15_36_20_1.png?v=1781617008","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":8.3,"dimensions":"70 x 45 x 9,6 cm"},"Cosmo 500W Noir":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/37750.png?v=1756891865","couleur":"#000000","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":true,"poids":3.9,"dimensions":"98 x 54 x 9,2 cm"},"Hestia 300W Noir":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1000_BIAIS_86956428-921e-4f40-9860-047327492c22.png?v=1774276427","couleur":"#000000","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":2.46,"dimensions":"54 x 9,2 x 61,5 cm"},"Cosmo 500W+1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/191500.png?v=1756891734","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":true,"poids":7.17,"dimensions":"102 x 54 x 11,5 cm"},"Cosmo 500W+1000W Noir":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/55_1500_43d963ee-aed1-4abe-9226-fd55fd609f57.png?v=1774272481","couleur":"#000000","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":true,"poids":7.17,"dimensions":"102 x 54 x 11,5 cm"},"Millo 2000W Noir":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/11000_2.png?v=1763116746","couleur":"#000000","matiere":"Aluminium","garantie":2,"madeInFrance":false,"connecte":false,"poids":8.9,"dimensions":"62,5 x 53,5 x 25,7 cm"},"Calista 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/11000_b8b814c5-4219-4f84-81fa-cdfb3f6d622c.png?v=1763116658","couleur":"#ffffff","matiere":"Aluminium","garantie":2,"madeInFrance":false,"connecte":false,"poids":8.3,"dimensions":"63 x 39 x 24.5 cm"},"Calista 2000W Noir":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/101500_7f78ceab-a2aa-4929-8a04-94fc186d15c5.png?v=1763116656","couleur":"#000000","matiere":"Aluminium","garantie":2,"madeInFrance":false,"connecte":false,"poids":8.3,"dimensions":"63 x 39 x 24.5 cm"},"Nessa Connect 500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/2000_FACEcopie.png?v=1777971845","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":6.1,"dimensions":"55 x 45,5 x 12,5"},"Olia":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/OLIAAMBIANCE.jpg?v=1779696967","garantie":2,"madeInFrance":false,"connecte":false,"poids":5.5,"dimensions":"30,5x25x132"},"Nero":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/NEROAMBIANCE-100.jpg?v=1779697032","couleur":"#050000","garantie":2,"madeInFrance":false,"connecte":false,"poids":4.4,"dimensions":"132 x 30,5 x 25"},"Nao":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/NAOAMBIANCE.jpg?v=1779696792","garantie":2,"madeInFrance":false,"connecte":false,"poids":4.4,"dimensions":"132 x 30,5 x 25"},"Orphee Connect 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ORPHEE_CONNECT_1000W_BIAIS.png?v=1781185804","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":7.0,"dimensions":"60 x 45,5 x 12,5"},"Orphee Connect 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/OPRHEECONNECT1500WBIAIS.png?v=1781187715","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":9.2,"dimensions":"80 x 45,5 x 12,5"},"Orphee Connect 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ORPHEECONNECT2000WBIAIS.png?v=1781188247","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":11.3,"dimensions":"100 x 45,5 x 12,5"},"Anis 750W Noir":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ChatGPTImage18juin2026_13_50_18_1.png?v=1781783439","couleur":"#000000","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":7.8,"dimensions":"50 x 11 x 138.5 cm"},"Aloa Connect 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/5_161dae49-ab98-45a6-a398-ee4bc50278b6.jpg?v=1781271008","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":10.8,"dimensions":"45 X 100 X 12"},"Maya 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/MAYA_AMBIANCE_1000W.png?v=1781189226","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":4.4,"dimensions":"56,4 x 12,5 x 45 cm"},"Maya 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/MAYA1500WAMBIANCE.png?v=1781189977","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":5.4,"dimensions":"71,4 x 12,5 x 45 cm"},"Maya 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/BIAIS2000W_82dbe783-c74d-40e7-879d-744b4757f2a3.png?v=1781530912","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":6.7,"dimensions":"86,4 x 12,5 x 45 cm"},"Hestia 750W+1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ChatGPTImage18juin2026_13_48_00_1_814aa2b3-0d29-44d8-9f6e-b36f980d5227.png?v=1781783331","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":8.2,"dimensions":"54 x 15x 139,5 cm"},"Hestia 750W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ChatGPTImage18juin2026_13_44_35_1.png?v=1781783109","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":5.4,"dimensions":"54 x 9,2 x 137 cm"},"Vail 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HE10EPTHfrontwithlogo_2048x2048_c1b82275-4194-449c-af74-4e42e9016713.png?v=1781534644","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":4.4,"dimensions":"56,4 x 12,5 x 45 cm"},"Vail 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HE15EPTHfrontwithlogo_2048x2048_89fa65b7-86e1-41cb-bf22-243152fdea84.png?v=1781534675","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":5.4,"dimensions":"71,4 x 12,5 x 45 cm"},"Vail 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HE20EPTHfrontwithlogo_2048x2048_01a2c648-6328-4270-920c-1b147ed07cc2.png?v=1781534749","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":6.7,"dimensions":"71,4 x 12,5 x 45 cm"},"Nemea Vertical 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ChatGPTImage16juin2026_15_29_28_1.png?v=1781616613","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":12.5,"dimensions":"100 x 45 x 9,6 cm"},"Stellina 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/FACE_1000.jpg?v=1783085168","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":8.2,"dimensions":"60cm x 12cm x 58cm"},"Stellina 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/FACE_1500.jpg?v=1783087329","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":10.3,"dimensions":"72cm x 12cm x 58cm"},"Stellina 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/FACE_2000.jpg?v=1783087801","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":12.1,"dimensions":"84cm x 12cm x 58cm"},"Nour":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ChatGPTImage10juil.2026_11_44_50_4.png?v=1783676910","couleur":"#ffffff","garantie":2,"madeInFrance":false,"connecte":false,"poids":5.5,"dimensions":"30,5x25x132"},"Sara":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ChatGPTImage10juil.2026_11_44_50_5.png?v=1783676743","couleur":"#ffffff","garantie":2,"madeInFrance":false,"connecte":false,"poids":4.4,"dimensions":"30,5x25x132"},"Lila":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ChatGPT_Image_10_juil._2026_12_05_57_2.png?v=1783678053","couleur":"#ffffff","garantie":2,"madeInFrance":false,"connecte":false,"poids":2.85,"dimensions":"14X50"},"Mira":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ChatGPTImage10juil.2026_12_05_57_3.png?v=1783677986","couleur":"#964b00","garantie":2,"madeInFrance":false,"connecte":false,"poids":4.4,"dimensions":"14X50"},"Alma":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ChatGPTImage10juil.2026_12_05_57_1.png?v=1783678394","couleur":"#8E863E","garantie":2,"madeInFrance":false,"connecte":false,"poids":2.85,"dimensions":"14X50"},"Fifty 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/fiftynoir_ambiance.webp?v=1787129505","couleur":"#000000","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":1.7},"Soria 500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/produit_face.png?v=1787753134","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":4.2,"dimensions":"100 x 54 x 40 cm"},"Aryna 1500W":{"couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":10.2,"dimensions":"45 x 75 x 11.5 cm"},"Aryna 2000W":{"couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":12.5,"dimensions":"45 x 95 x 11.5 cm"},"Aryna 1000W":{"couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":7.5,"dimensions":"45 x 55 x 11.5 cm"},"Talya 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/TalyaHE10EPTleft2-min.png?v=1686907310","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":4.6,"dimensions":"56,4 x 12,5 x 45 cm"},"Talya 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/TalyaHE15EPTleft2-min.jpg?v=1692889555","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":5.3,"dimensions":"71,4 x 12,5 x 45 cm"},"Talya 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/custom_resized_5add7728-c9ec-4785-ba27-1386628190bf.png?v=1692889792","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":6.3,"dimensions":"86.4 x 12,5 x 45 cm"},"Hanae 750W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/07aa0af98783b7660537927eed756c31.png?v=1686899910","couleur":"#ffffff","matiere":"Acier","madeInFrance":false,"connecte":false,"poids":9.8,"dimensions":"60 x 11,6 x 138.5 cm"},"Nessa 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HT10PZ.314.png?v=1691409347","couleur":"#ffffff","matiere":"Acier","madeInFrance":false,"connecte":false,"poids":6.8,"dimensions":"45 x 60 x 12,5"},"Nessa 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HT15PZ.319.png?v=1692709754","couleur":"#ffffff","matiere":"Acier","madeInFrance":false,"connecte":false,"poids":9.1,"dimensions":"80 x 45,5 x 12,5"},"Lesso Connect 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/FACE1000W_78c1bea7-d683-4c92-a49b-89f5ea09acd4.png?v=1764249390","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":7.3,"dimensions":"55x11x45"},"Illo Connect 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/FACE_1000W_a2c80f84-5efe-49b1-aef2-487df5b8868f.png?v=1764250184","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":7.3,"dimensions":"55cm x 11cm x 45cm"},"Ariane Connect 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HT10-23AEW.5_d10dfedf-6759-438c-ad74-71e1e5695d9f.png?v=1748347453","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":7.0,"dimensions":"45.5cm x 12.5cm x 60cm"},"Ariane Connect 1000W Noir":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/FACE1000W_1b71f49e-67c9-4fde-a4fb-386592868b9f.png?v=1748347948","couleur":"#000000","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":7.0,"dimensions":"45.5cm x 12,5cm x 60cm"},"Hestia 500W Noir":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1500_FACE_0d7b68d0-378c-40cc-b30a-aada1e9a4e82.png?v=1761921173","couleur":"#000000","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":3.9,"dimensions":"54 x 9,2 x 98 cm"},"Hestia 500W+1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/2000_FACE.png?v=1761921228","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":6.9,"dimensions":"54 x 15x 100,5 cm"},"Hestia 500W+1000W Noir":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/2000_FACE_bf8b201c-fc89-4a3f-b4d2-1daf20a0ac09.png?v=1761921272","couleur":"#000000","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":6.9,"dimensions":"54 x 15x 100,5 cm"},"Lesso Connect 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/FACE1500W_0c69d1a7-63b5-42e9-8072-d6877a8bd747.png?v=1748330608","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":9.1,"dimensions":"70cm x 11cm x 45cm"},"Lesso Connect 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/FACE2000W_de3a7889-6584-40ec-8342-fe7917757a33.png?v=1748330704","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":11.1,"dimensions":"85cm x 11cm x 45cm"},"Illo Connect 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/FACE1500W_6121b6cd-41dc-4a9c-bf8f-0aa69b0a94a0.png?v=1748332677","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":9.11,"dimensions":"45cm x 11cm x 70cm"},"Illo Connect 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/FACE2000W_81bc71d0-804d-451d-90f0-c0975bc8c434.png?v=1748332735","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":11.1,"dimensions":"45cm x 11cm x 85cm"},"Ariane Connect 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HT15-23AEW.21_941740e2-6e62-4e32-90a7-521f716da6da.png?v=1748347542","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":9.2,"dimensions":"45.5cm x 12cm x 80 cm"},"Ariane Connect 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HT20-23AEW.24_69954a86-a178-4d1b-919d-b045e4d52de6.png?v=1748347662","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":11.4,"dimensions":"100cm x 12.5cm x 45.5cm"},"Ariane Connect 1500W Noir":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/FACE1500W_c29280a5-6773-450e-b8ca-972593dafc74.png?v=1748348046","couleur":"#000000","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":9.2,"dimensions":"80cm x 11.8cm x 45.5cm"},"Ariane Connect 2000W Noir":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/FACE2000W_c9b621cf-8650-4ab6-ad5f-727391ecc6a3.png?v=1748348107","couleur":"#000000","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":11.4,"dimensions":"100cm x 12.5cm x 45.5cm"},"Iris 1000W Noir":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/seul_face_iris_noir_1000_6638396f-0400-47f6-904f-e254476df20e.png?v=1748417243","couleur":"#000000","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":8.9,"dimensions":"55cm x 11cm x 45cm"},"Iris 1500W Noir":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/seul_face_iris_noir_1500_631e7078-93f1-486d-8628-1cfac80a1fc7.png?v=1748417300","couleur":"#000000","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":11.0,"dimensions":"70cm x 11cm x 45cm"},"Iris 2000W Noir":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/seul_face_iris_noir_2000_a97139dc-90b1-4e67-82b5-e7ce72dbb12b.png?v=1748417347","couleur":"#000000","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":13.7,"dimensions":"85cm x 11cm x 45cm"},"Anis 500W Noir":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1_2519ddd4-070b-410d-b568-48bc8bef5201.jpg?v=1759393604","couleur":"#000000","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":5.6,"dimensions":"50 x 11 x 101 cm"},"Keria 10L":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1_3c89bc90-6170-4512-824b-f0ee688592ef.png?v=1748418090","couleur":"#ffffff","matiere":"Plastique","garantie":2,"madeInFrance":false,"connecte":false,"poids":10.0,"dimensions":"49.1 X 34.9 X 20 cm"},"ALMA":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ChatGPTImage10juil.2026_12_05_57_1.png?v=1783678394","couleur":"#8E863E","garantie":2,"madeInFrance":false,"connecte":false,"poids":2.85,"dimensions":"14X50"},"HESTIA NOIR 500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1500_FACE_0d7b68d0-378c-40cc-b30a-aada1e9a4e82.png?v=1761921173","couleur":"#000000","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":3.9,"dimensions":"54 x 9,2 x 98 cm"},"LILA":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ChatGPT_Image_10_juil._2026_12_05_57_2.png?v=1783678053","couleur":"#ffffff","garantie":2,"madeInFrance":false,"connecte":false,"poids":2.85,"dimensions":"14X50"},"MIRA":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ChatGPTImage10juil.2026_12_05_57_3.png?v=1783677986","couleur":"#964b00","garantie":2,"madeInFrance":false,"connecte":false,"poids":4.4,"dimensions":"14X50"},"NOUR":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ChatGPTImage10juil.2026_11_44_50_4.png?v=1783676910","couleur":"#ffffff","garantie":2,"madeInFrance":false,"connecte":false,"poids":5.5,"dimensions":"30,5x25x132"},"SARA":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ChatGPTImage10juil.2026_11_44_50_5.png?v=1783676743","couleur":"#ffffff","garantie":2,"madeInFrance":false,"connecte":false,"poids":4.4,"dimensions":"30,5x25x132"},"ARIA 500W NOIR":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HT5PDC_.5.png?v=1757414451","couleur":"#000000","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":4.5,"dimensions":"45 x 41,4 x 12 cm"},"NAO":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/NAOAMBIANCE.jpg?v=1779696792","garantie":2,"madeInFrance":false,"connecte":false,"poids":4.4,"dimensions":"132 x 30,5 x 25"},"NERO":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/NEROAMBIANCE-100.jpg?v=1779697032","couleur":"#050000","garantie":2,"madeInFrance":false,"connecte":false,"poids":4.4,"dimensions":"132 x 30,5 x 25"},"OLIA":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/OLIAAMBIANCE.jpg?v=1779696967","garantie":2,"madeInFrance":false,"connecte":false,"poids":5.5,"dimensions":"30,5x25x132"},"TALYA 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/TalyaHE10EPTleft2-min.png?v=1686907310","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":4.6,"dimensions":"56,4 x 12,5 x 45 cm"},"TALYA 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/TalyaHE15EPTleft2-min.jpg?v=1692889555","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":5.3,"dimensions":"71,4 x 12,5 x 45 cm"},"TALYA 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/custom_resized_5add7728-c9ec-4785-ba27-1386628190bf.png?v=1692889792","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":6.3,"dimensions":"86.4 x 12,5 x 45 cm"},"VAIL 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HE10EPTHfrontwithlogo_2048x2048_c1b82275-4194-449c-af74-4e42e9016713.png?v=1781534644","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":4.4,"dimensions":"56,4 x 12,5 x 45 cm"},"VAIL 1500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HE15EPTHfrontwithlogo_2048x2048_89fa65b7-86e1-41cb-bf22-243152fdea84.png?v=1781534675","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":5.4,"dimensions":"71,4 x 12,5 x 45 cm"},"VAIL 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HE20EPTHfrontwithlogo_2048x2048_01a2c648-6328-4270-920c-1b147ed07cc2.png?v=1781534749","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":6.7,"dimensions":"71,4 x 12,5 x 45 cm"},"ANIS 500W BLANC":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ANIS500WBLANCFACE.png?v=1776351392","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":5.6,"dimensions":"50 x 11 x 101 cm"},"ANIS 500W NOIR":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1_2519ddd4-070b-410d-b568-48bc8bef5201.jpg?v=1759393604","couleur":"#000000","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":5.6,"dimensions":"50 x 11 x 101 cm"},"ARIA 500W BLANC":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HT5PDC.1.png?v=1757414368","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":4.5,"dimensions":"45 x 41,4 x 12 cm"},"CLEO 1000W BLANC":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/test.png?v=1769785903","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":7.74,"dimensions":"45 x 60 x 12,5 cm"},"CLEO 1500W BLANC":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/test1500.png?v=1769785801","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":10.5,"dimensions":"45 x 80 x 12,5 cm"},"CLEO 2000W BLANC":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/test2000.png?v=1769785842","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":12.7,"dimensions":"45 x 100 x 12,5 cm"},"COSMO 500W BLANC":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1750_5e4a5a1c-29ac-4351-82a5-9a324bd61b74.png?v=1774274735","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":true,"poids":3.9,"dimensions":"98 x 54 x 9,2 cm"},"COSMO 500W NOIR":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/37750.png?v=1756891865","couleur":"#000000","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":true,"poids":3.9,"dimensions":"98 x 54 x 9,2 cm"},"HESTIA 300W BLANC":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1000_FACE_49c67e4a-275f-4164-a074-b400d6c80afa.png?v=1761920907","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":2.46,"dimensions":"54 x 9,2 x 61,5 cm"},"HESTIA 300W NOIR":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1000_BIAIS_86956428-921e-4f40-9860-047327492c22.png?v=1774276427","couleur":"#000000","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":2.46,"dimensions":"54 x 9,2 x 61,5 cm"},"HESTIA 500W BLANC":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1500_FACE.png?v=1761921110","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":3.9,"dimensions":"54 x 9,2 x 98 cm"},"HESTIA 500W NOIR":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/1500_FACE_0d7b68d0-378c-40cc-b30a-aada1e9a4e82.png?v=1761921173","couleur":"#000000","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":3.9,"dimensions":"54 x 9,2 x 98 cm"},"HESTIA 500W+1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/2000_FACE.png?v=1761921228","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":6.9,"dimensions":"54 x 15x 100,5 cm"},"HESTIA 750W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ChatGPTImage18juin2026_13_44_35_1.png?v=1781783109","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":5.4,"dimensions":"54 x 9,2 x 137 cm"},"HESTIA 750W+1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/ChatGPTImage18juin2026_13_48_00_1_814aa2b3-0d29-44d8-9f6e-b36f980d5227.png?v=1781783331","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":8.2,"dimensions":"54 x 15x 139,5 cm"},"IRIS 1000W BLANC":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/seul_face_iris_blanc_1000_fde6210f-ccec-4106-ac19-0b2ed0ecd312.png?v=1748416829","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":8.9,"dimensions":"55cm X 11cm X 45cm"},"IRIS 1000W NOIR":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/seul_face_iris_noir_1000_6638396f-0400-47f6-904f-e254476df20e.png?v=1748417243","couleur":"#000000","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":8.9,"dimensions":"55cm x 11cm x 45cm"},"IRIS 1500W BLANC":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/seul_face_iris_blanc_1500_bb53f68b-ae78-42f3-9b04-116b6723b191.png?v=1748416908","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":11.0,"dimensions":"70cm X 11cm X 45cm"},"IRIS 1500W NOIR":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/seul_face_iris_noir_1500_631e7078-93f1-486d-8628-1cfac80a1fc7.png?v=1748417300","couleur":"#000000","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":11.0,"dimensions":"70cm x 11cm x 45cm"},"IRIS 2000W BLANC":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/seul_face_iris_blanc_2000_0f93ba91-b62b-4a79-b11c-8ba8a481087d.png?v=1748416957","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":13.7,"dimensions":"85cm X 11cm X 45cm"},"IRIS 2000W NOIR":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/seul_face_iris_noir_2000_a97139dc-90b1-4e67-82b5-e7ce72dbb12b.png?v=1748417347","couleur":"#000000","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":false,"poids":13.7,"dimensions":"85cm x 11cm x 45cm"},"MILLA 1000W BLANC":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/11000_0ed2b73c-fa1a-47fb-b077-c72dcfcf29eb.png?v=1775659952","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":true,"poids":9.7,"dimensions":"48,5 x 69,2 x 12,5 cm"},"MILLA 1500W BLANC":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/192000-Copie.png?v=1756893563","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":true,"poids":11.7,"dimensions":"48,5 x 89,2 x 12,5 cm"},"MILLA 2000W BLANC":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/101500_0ecd8a44-7e52-4555-b5f0-b88b5e4f7797.png?v=1756893498","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":true,"poids":13.88,"dimensions":"48,5 x 109,2 x 12,5 cm"},"MOLY 1000W BLANC":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/11000_ed60fe6f-dd55-4209-8ec9-ff6bdf7e85cf.png?v=1756892484","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":true,"poids":7.4,"dimensions":"60 x 50 x 11,5 cm"},"MOLY 1500W BLANC":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/101500_e8f70edc-6efb-4d6d-9e56-f2f4eed56eb0.png?v=1756892575","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":true,"poids":9.9,"dimensions":"60 x 66 x 11,5 cm"},"MOLY 2000W BLANC":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/192000_7971383b-5f3a-45ab-bcf7-64b6b33f4f15.png?v=1756894284","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":true,"poids":11.9,"dimensions":"60 x 82 x 11,5 cm"},"HANAE 750W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/07aa0af98783b7660537927eed756c31.png?v=1686899910","couleur":"#ffffff","matiere":"Acier","madeInFrance":false,"connecte":false,"poids":9.8,"dimensions":"60 x 11,6 x 138.5 cm"},"NESSA 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/HT10PZ.314.png?v=1691409347","couleur":"#ffffff","matiere":"Acier","madeInFrance":false,"connecte":false,"poids":6.8,"dimensions":"45 x 60 x 12,5"},"STELLINA 1000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/FACE_1000.jpg?v=1783085168","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":8.2,"dimensions":"60cm x 12cm x 58cm"},"STELLINA 2000W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/FACE_2000.jpg?v=1783087801","couleur":"#ffffff","matiere":"Acier","garantie":3,"madeInFrance":false,"connecte":false,"poids":12.1,"dimensions":"84cm x 12cm x 58cm"},"SORIA 500W":{"image":"https://cdn.shopify.com/s/files/1/0761/3169/6981/files/produit_face.png?v=1787753134","couleur":"#ffffff","matiere":"Acier","garantie":2,"madeInFrance":false,"connecte":true,"poids":4.2,"dimensions":"100 x 54 x 40 cm"}};
;

// CATALOGUE_NON_VENDU — produits actifs du catalogue Shopify sans correspondance
// dans l'historique des ventes (aucune ligne de commande trouvée). Peut être un
// lancement récent, une variante WiFi qui remplace une référence existante sous
// un autre nom, ou un produit listé mais jamais réellement mis en avant. [nom, marque].
const CATALOGUE_NON_VENDU_BRUT = [["Aloa Connect 2000W","BESTHERM"],["Anis 750W Noir","BESTHERM"],["Ariane Connect 1000W","BESTHERM"],["Ariane Connect 1000W Noir","BESTHERM"],["Ariane Connect 1500W","BESTHERM"],["Ariane Connect 1500W Noir","BESTHERM"],["Ariane Connect 2000W","BESTHERM"],["Ariane Connect 2000W Noir","BESTHERM"],["Aryna 1000W","BESTHERM"],["Aryna 1500W","BESTHERM"],["Aryna 2000W","BESTHERM"],["Calista 2000W","THOMSON"],["Calista 2000W Noir","THOMSON"],["Cosmo 500W+1000W","THOMSON"],["Cosmo 500W+1000W Noir","THOMSON"],["Fifty 2000W","THOMSON"],["Hanae 750W","BESTHERM"],["Hestia 500W+1000W Noir","BESTHERM"],["Illo Connect 1000W","BESTHERM"],["Illo Connect 1500W","BESTHERM"],["Illo Connect 2000W","BESTHERM"],["Keria 10L","BESTHERM"],["Lesso Connect 1000W","BESTHERM"],["Lesso Connect 1500W","BESTHERM"],["Lesso Connect 2000W","BESTHERM"],["Maya 1000W","HOM'Y"],["Maya 1500W","HOM'Y"],["Maya 2000W","HOM'Y"],["Millo 2000W Noir","THOMSON"],["Nemea Vertical 1000W","BESTHERM"],["Nemea Vertical 1500W","BESTHERM"],["Nessa 1000W","BESTHERM"],["Nessa 1500W","BESTHERM"],["Nessa Connect 500W","BESTHERM"],["Orphee Connect 1000W","HOM'Y"],["Orphee Connect 1500W","HOM'Y"],["Orphee Connect 2000W","HOM'Y"],["Stellina 1500W","BESTHERM"]];


;
// Un produit du catalogue qui a désormais des ventes n'est plus « non vendu » (comparaison sans tenir compte de la casse)
const PRODUITS_VENDUS_MIN = new Set(SKU_PRODUIT.map((n) => n.toLowerCase()));
const CATALOGUE_NON_VENDU = CATALOGUE_NON_VENDU_BRUT.filter(([nom]) => !PRODUITS_VENDUS_MIN.has(String(nom).toLowerCase()));


// Flux d'expédition par semaine (transporteurs, entrepôts d'origine) : issus de l'ancien fichier source, HORS Shopify, figés à la
// semaine 40 de 2026 et non utilisés par l'interface. WEEKLY_BY_ENT reflète les expéditions PARTIES de chaque entrepôt (flux,
// pas un stock actuel).














const WEEKLY_BY_EXP = [[1, "DPD", 484], [1, "Chronopost", 223], [1, "GEODIS", 45], [1, "Mano Mano", 119], [1, "AMAZON FBA", 71], [2, "AMAZON FBA", 112], [2, "DPD", 2061], [2, "GEODIS", 552], [2, "Chronopost", 1135], [2, "Mano Mano", 336], [2, "Affretement", 120], [3, "Mano Mano", 167], [3, "DPD", 1504], [3, "Chronopost", 834], [3, "GEODIS", 438], [3, "Affretement", 288], [3, "AMAZON FBA", 70], [4, "Mano Mano", 136], [4, "DPD", 1312], [4, "GEODIS", 547], [4, "Chronopost", 912], [4, "AMAZON FBA", 202], [5, "Chronopost", 880], [5, "DPD", 1502], [5, "GEODIS", 593], [5, "Mano Mano", 208], [5, "Affretement", 276], [5, "AMAZON FBA", 438], [6, "DPD", 1293], [6, "Chronopost", 668], [6, "GEODIS", 551], [6, "Mano Mano", 131], [6, "AMAZON FBA", 192], [7, "AMAZON FBA", 291], [7, "Mano Mano", 118], [7, "DPD", 809], [7, "Chronopost", 446], [7, "GEODIS", 245], [7, "Affretement", 285], [8, "Chronopost", 453], [8, "DPD", 729], [8, "GEODIS", 287], [8, "Mano Mano", 109], [8, "AMAZON FBA", 132], [9, "Mano Mano", 132], [9, "AMAZON FBA", 137], [9, "Chronopost", 385], [9, "DPD", 622], [9, "GEODIS", 252], [10, "DPD", 663], [10, "Chronopost", 211], [10, "GEODIS", 368], [10, "AMAZON FBA", 97], [10, "Mano Mano", 74], [11, "DPD", 567], [11, "Chronopost", 167], [11, "GEODIS", 216], [11, "AMAZON FBA", 174], [11, "Mano Mano", 149], [12, "Mano Mano", 211], [12, "AMAZON FBA", 220], [12, "DPD", 496], [12, "GEODIS", 296], [12, "Chronopost", 177], [12, "Affretement", 5], [13, "Mano Mano", 201], [13, "AMAZON FBA", 165], [13, "DPD", 676], [13, "Chronopost", 161], [13, "GEODIS", 239], [13, "Affretement", 63], [14, "DPD", 696], [14, "GEODIS", 457], [14, "Chronopost", 327], [14, "Mano Mano", 65], [14, "AMAZON FBA", 196], [14, "Affretement", 325], [15, "DPD", 522], [15, "GEODIS", 398], [15, "Chronopost", 215], [15, "AMAZON FBA", 277], [15, "Mano Mano", 109], [16, "Mano Mano", 109], [16, "AMAZON FBA", 248], [16, "DPD", 633], [16, "Chronopost", 288], [16, "GEODIS", 261], [17, "DPD", 544], [17, "GEODIS", 329], [17, "Chronopost", 259], [17, "AMAZON FBA", 118], [17, "Mano Mano", 86], [18, "AMAZON FBA", 228], [18, "DPD", 474], [18, "Chronopost", 180], [18, "GEODIS", 267], [18, "Mano Mano", 153], [19, "DPD", 629], [19, "GEODIS", 304], [19, "Chronopost", 221], [19, "Mano Mano", 213], [19, "AMAZON FBA", 121], [20, "AMAZON FBA", 65], [20, "Mano Mano", 263], [20, "DPD", 588], [20, "Chronopost", 275], [20, "GEODIS", 323], [20, "Affretement", 30], [21, "DPD", 410], [21, "GEODIS", 206], [21, "Chronopost", 262], [21, "AMAZON FBA", 51], [21, "Mano Mano", 211], [22, "DPD", 337], [22, "GEODIS", 182], [22, "Chronopost", 124], [22, "Affretement", 61], [22, "AMAZON FBA", 82], [22, "Mano Mano", 55], [23, "DPD", 458], [23, "Chronopost", 154], [23, "GEODIS", 145], [23, "AMAZON FBA", 111], [23, "Mano Mano", 81], [24, "DPD", 331], [24, "Chronopost", 150], [24, "GEODIS", 197], [24, "Mano Mano", 90], [24, "AMAZON FBA", 194], [25, "DPD", 277], [25, "GEODIS", 137], [25, "Chronopost", 118], [25, "AMAZON FBA", 124], [25, "Mano Mano", 100], [26, "Chronopost", 639], [26, "DPD", 2801], [26, "GEODIS", 354], [26, "AMAZON FBA", 238], [26, "Mano Mano", 143], [27, "Chronopost", 377], [27, "DPD", 565], [27, "GEODIS", 335], [27, "Affretement", 438], [27, "AMAZON FBA", 127], [27, "Mano Mano", 103], [28, "DPD", 657], [28, "GEODIS", 521], [28, "Chronopost", 481], [28, "AMAZON FBA", 163], [28, "Mano Mano", 128], [29, "DPD", 700], [29, "GEODIS", 476], [29, "Chronopost", 339], [29, "Mano Mano", 140], [29, "AMAZON FBA", 163], [30, "DPD", 726], [30, "Chronopost", 395], [30, "GEODIS", 411], [30, "Affretement", 45], [30, "AMAZON FBA", 99], [30, "Mano Mano", 211], [31, "Chronopost", 304], [31, "DPD", 1050], [31, "GEODIS", 280], [31, "AMAZON FBA", 189], [31, "Mano Mano", 102], [32, "DPD", 1225], [32, "Chronopost", 358], [32, "GEODIS", 232], [32, "Mano Mano", 50], [32, "AMAZON FBA", 132], [33, "FLM", 156], [32, "FLM", 125], [31, "FLM", 616], [30, "FLM", 644], [33, "DPD", 995], [33, "GEODIS", 142], [33, "Chronopost", 244], [33, "Mano Mano", 62], [33, "AMAZON FBA", 101], [34, "Chronopost", 143], [34, "GEODIS", 184], [34, "DPD", 663], [34, "AMAZON FBA", 379], [34, "Mano Mano", 79], [34, "FLM", 282], [35, "DPD", 696], [35, "Chronopost", 264], [35, "GEODIS", 169], [35, "AMAZON FBA", 797], [35, "Mano Mano", 113], [35, "FLM", 275], [36, "AMAZON FBA", 645], [36, "Mano Mano", 28], [36, "DPD", 774], [36, "Chronopost", 236], [36, "GEODIS", 265], [36, "FLM", 225], [37, "DPD", 777], [37, "Chronopost", 320], [37, "GEODIS", 325], [37, "AMAZON FBA", 245], [37, "Mano Mano", 101], [37, "FLM", 362]];
;







const WEEKLY_BY_ENT = [[1, "Dometrans", 752], [1, "Mano Mano", 119], [1, "Amazon", 71], [2, "Amazon", 112], [2, "Dometrans", 3868], [2, "Mano Mano", 336], [3, "Mano Mano", 167], [3, "Dometrans", 3064], [3, "Amazon", 70], [4, "Mano Mano", 136], [4, "Dometrans", 2771], [4, "Amazon", 202], [5, "Dometrans", 3251], [5, "Mano Mano", 208], [5, "Amazon", 438], [6, "Dometrans", 2512], [6, "Mano Mano", 131], [6, "Amazon", 192], [7, "Amazon", 291], [7, "Mano Mano", 118], [7, "Dometrans", 1785], [8, "Dometrans", 1469], [8, "Mano Mano", 109], [8, "Amazon", 132], [9, "Mano Mano", 132], [9, "Amazon", 137], [9, "Dometrans", 1259], [10, "Dometrans", 1242], [10, "Amazon", 97], [10, "Mano Mano", 74], [11, "Dometrans", 950], [11, "Amazon", 174], [11, "Mano Mano", 149], [12, "Mano Mano", 211], [12, "Amazon", 220], [12, "Dometrans", 974], [13, "Mano Mano", 201], [13, "Amazon", 165], [13, "Dometrans", 1139], [14, "Dometrans", 1805], [14, "Mano Mano", 65], [14, "Amazon", 196], [15, "Dometrans", 1135], [15, "Amazon", 277], [15, "Mano Mano", 109], [16, "Mano Mano", 109], [16, "Amazon", 248], [16, "Dometrans", 1182], [17, "Dometrans", 1132], [17, "Amazon", 118], [17, "Mano Mano", 86], [18, "Amazon", 228], [18, "Dometrans", 921], [18, "Mano Mano", 153], [19, "Dometrans", 1154], [19, "Mano Mano", 213], [19, "Amazon", 121], [20, "Amazon", 65], [20, "Mano Mano", 263], [20, "Dometrans", 1216], [21, "Dometrans", 878], [21, "Amazon", 51], [21, "Mano Mano", 211], [22, "Dometrans", 704], [22, "Amazon", 82], [22, "Mano Mano", 55], [23, "Dometrans", 757], [23, "Amazon", 111], [23, "Mano Mano", 81], [24, "Dometrans", 678], [24, "Mano Mano", 90], [24, "Amazon", 194], [25, "Dometrans", 532], [25, "Amazon", 124], [25, "Mano Mano", 100], [26, "Dometrans", 3794], [26, "Amazon", 238], [26, "Mano Mano", 143], [27, "Dometrans", 1715], [27, "Amazon", 127], [27, "Mano Mano", 103], [28, "Dometrans", 1659], [28, "Amazon", 163], [28, "Mano Mano", 128], [29, "Dometrans", 1515], [29, "Mano Mano", 140], [29, "Amazon", 163], [30, "Dometrans", 1577], [30, "Amazon", 99], [30, "Mano Mano", 211], [31, "Dometrans", 1634], [31, "Amazon", 189], [31, "Mano Mano", 102], [32, "Dometrans", 1815], [32, "Mano Mano", 50], [32, "Amazon", 132], [33, "Leroy Merlin", 156], [32, "Leroy Merlin", 125], [31, "Leroy Merlin", 616], [30, "Leroy Merlin", 644], [33, "Dometrans", 1381], [33, "Mano Mano", 62], [33, "Amazon", 101], [34, "Dometrans", 990], [34, "Amazon", 379], [34, "Mano Mano", 79], [34, "Leroy Merlin", 282], [35, "Dometrans", 1129], [35, "Amazon", 797], [35, "Mano Mano", 113], [35, "Leroy Merlin", 275], [36, "Amazon", 645], [36, "Mano Mano", 28], [36, "Dometrans", 1275], [36, "Leroy Merlin", 225], [37, "Dometrans", 1422], [37, "Amazon", 245], [37, "Mano Mano", 101], [37, "Leroy Merlin", 362]];
;

















/* ============================================================================ DERNIER JOUR DE DONNÉES */
// DMAX : dernier jour couvert par les deux boutiques Shopify (le plus ancien de leurs « au », voir socle.js). Tout le tableau de
// bord (KPI, courbes, comparaisons N-1 à date identique, plan) est arrêté à ce jour.
const DMAX = SOCLE.dmax;
// index (0=janvier) du mois en cours d'après la dernière donnée réelle
// disponible — sert à distinguer un mois "pas encore lancé" (avant la
// première vente), un mois "en cours" (partiel, jamais qualifié de rupture),
// et un mois futur (à estimer par saisonnalité) dans la courbe produit
const MOIS_EN_COURS_IDX = new Date(DMAX).getMonth();

// Bandeau « Données Shopify » : jusqu'où vont les chiffres, d'où ils viennent, ce qui ne vient pas de Shopify
const DONNEES_SITE_COULEUR = "#4A9EFF";
// Données du suivi quotidien — version Shopify seul : toutes les ventes (jour × marketplace × produit) et le détail par pays viennent du
// même historique Shopify ; « les mêmes jours l'an dernier » est donc lu dans le même fichier, au même format, avec le même calcul.
// Le site web n'existe dans Shopify que depuis sa première vente (siteDepuis) : avant, le suivi compare les marketplaces seules.
let SUIVI_CACHE = null;
function suiviDonnees() {
  if (SUIVI_CACHE) return SUIVI_CACHE;
  const E = SHOPIFY_EXT;
  const par = (lignes) => { const m = new Map(); for (const l of lignes || []) { const a = m.get(l[0]); if (a) a.push(l); else m.set(l[0], [l]); } return m; };
  const jour = par(E.lignes), paysJ = par(E.pays_jour), cmdJ = par(E.commandes);
  const iSite = (E.mp || []).indexOf(SUIVI_SITE);
  let jourMin = null, siteDepuis = null;
  for (const l of E.lignes || []) {
    if (jourMin === null || l[0] < jourMin) jourMin = l[0];
    if (l[1] === iSite && (siteDepuis === null || l[0] < siteDepuis)) siteDepuis = l[0];
  }
  const lire = (d, f) => { for (const l of jour.get(d) || []) { const p = E.produits[l[2]]; f(E.mp[l[1]], p[0], p[1], l[3], l[4]); } };
  const lirePays = (d, f) => { for (const l of paysJ.get(d) || []) f(E.pays[l[1]] || null, E.mp[l[2]], l[3]); };
  const lireCmd = (d, f) => { for (const l of cmdJ.get(d) || []) f(E.mp[l[1]], l[2]); }; // commandes (CA > 0) du jour, par marketplace
  SUIVI_CACHE = {
    jourMin, jourMax: jourMin ? DMAX : null,
    debutN1: /^\d{4}-\d{2}-\d{2}$/.test(E.du || "") ? E.du : jourMin,
    siteDepuis,
    n1Connait: () => true,
    parcourir: lire, parcourirPays: lirePays, parcourirN1: lire, parcourirPaysN1: lirePays, parcourirCmd: lireCmd,
    // série journalière (CA HT du périmètre) dont on tire le poids habituel de chaque jour de la semaine : tout l'historique Shopify
    tranchesJours: (mpF) => {
      const c = new Map();
      const ca = (d) => { let v = c.get(d); if (v === undefined) { v = 0; for (const l of jour.get(d) || []) if (!mpF || E.mp[l[1]] === mpF) v += l[4]; c.set(d, v); } return v; };
      return jourMin ? [{ du: jourMin, au: DMAX, ca }] : [];
    },
  };
  return SUIVI_CACHE;
}

/* ---------- Suivi quotidien (premier bloc) : CA HT par jour + même période l'an dernier, top 10 produits, top 10 marketplaces, part du CA par pays ----------
   Tout vient des lignes Shopify (jour × marketplace × produit × pays). Les trois zones suivent la même fenêtre : la période choisie
   (puces 7 j, 14 j…) ou, si l'on touche une barre, ce seul jour. « Même période l'an dernier » = les mêmes dates calendaires un an
   plus tôt. Quand l'an dernier n'est pas comparable (site web avant sa première vente Shopify, marketplace absente du fichier 2025),
   la courbe et les variations se limitent au périmètre comparable et la légende le dit : jamais de variation calculée sur une base
   incomplète. */
const SUIVI_SITE = "Site Web";
const SUIVI_LIGNE_N1 = "#EDE7DB";
const SUIVI_COULEURS_PAYS = ["#FF5A1F", "#4A9EFF", "#34D399", "#FFB020", "#A78BFA", "#F472B6"];
const SUIVI_PAYS_VISIBLES = 6;
const SUIVI_MP_VISIBLES = 10; // top 10 des canaux de vente : marketplaces, site web compris
const suiviJour = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
const suiviAnAvant = (iso) => { // même jour un an plus tôt (29 févr. → 28 févr.)
  const [y, m, d] = iso.split("-").map(Number);
  const t = new Date(Date.UTC(y - 1, m - 1, d));
  return (t.getUTCMonth() !== m - 1 ? new Date(Date.UTC(y - 1, m, 0)) : t).toISOString().slice(0, 10);
};
const suiviNbJours = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5) + 1;
const suiviVariation = (cur, ref) => (ref !== null && ref !== undefined && ref > 0 ? (cur / ref - 1) * 100 : null);
// Écart en euros, signé et compact, posé à côté d'une variation en % (le % seul exagère les petites bases : +211 % peut être +3 k€).
// « +19k€ » à partir de 10 000 €, « +4.2k€ » de 1 000 à 9 999 €, « +840€ » en dessous ; suit le mode démo comme les autres montants.
const suiviEcart = (n) => {
  const v = n * demoFactor, r = Math.round(Math.abs(v));
  if (r === 0) return "0€";
  const sg = v > 0 ? "+" : "-", k = r / 1000;
  return r < 1000 ? `${sg}${r}€` : `${sg}${k >= 9.95 ? Math.round(k) : k.toFixed(1)}k€`;
};
const suiviCouleurEcart = (n) => (Math.round(Math.abs(n * demoFactor)) === 0 ? MUTED : n > 0 ? GREEN : RED);

// Poids habituel de chaque jour de la semaine (dimanche → samedi, moyenne = 1), lu dans l'historique journalier du suivi : pour chaque semaine complète
// dimanche → samedi où le périmètre vend tous les jours, la part de chaque jour rapportée à la moyenne de sa semaine, puis la moyenne de ces semaines
// (au moins SUIVI_PROFIL_MIN, sinon pas de profil). Il sert à répartir l'objectif d'une semaine du plan sur ses jours — un lundi pèse plus qu'un
// dimanche — sans changer le total de la semaine. tranches : [{ du, au, ca(jour) }], le CA HT du périmètre jour par jour.
const SUIVI_PROFIL_MIN = 8;
function suiviProfilJours(tranches) {
  const somme = [0, 0, 0, 0, 0, 0, 0];
  let nb = 0;
  for (const tr of tranches) {
    let d = tr.du;
    while (new Date(d + "T00:00:00Z").getUTCDay() !== 0) d = suiviJour(d, 1); // premier dimanche de la tranche
    for (; suiviJour(d, 6) <= tr.au; d = suiviJour(d, 7)) {
      const v = [0, 1, 2, 3, 4, 5, 6].map((k) => tr.ca(suiviJour(d, k)));
      if (v.some((x) => !(x > 0))) continue; // un jour sans vente : semaine écartée
      const moy = v.reduce((a, b) => a + b, 0) / 7;
      v.forEach((x, k) => { somme[k] += x / moy; });
      nb++;
    }
  }
  return nb >= SUIVI_PROFIL_MIN ? somme.map((x) => x / nb) : null;
}
// Poids des jours du périmètre mpF (marketplace, « Site Web », ou null pour l'ensemble) ; à défaut d'historique assez fourni, ceux de l'ensemble ;
// null = pas de profil (l'objectif de la semaine est alors réparti à plat, ÷ 7). Calculé une fois par périmètre : l'historique ne change pas pendant la visite.
const SUIVI_POIDS_CACHE = new Map();
function suiviPoidsJours(S, mpF) {
  const cle = mpF || "";
  if (!SUIVI_POIDS_CACHE.has(cle)) SUIVI_POIDS_CACHE.set(cle, suiviProfilJours(S.tranchesJours(mpF)) || (mpF ? suiviProfilJours(S.tranchesJours(null)) : null));
  return SUIVI_POIDS_CACHE.get(cle);
}

// Agrège les ventes de du → au (filtre marketplace facultatif) et les met en regard des mêmes dates un an plus tôt.
//   mode : "total"  → l'an dernier est comparable sur tout le périmètre affiché
//          "mp"     → seules les marketplaces sont comparables (le site web n'a pas d'historique Shopify sur ces dates)
//          "aucun"  → pas de comparaison possible
function suiviCalc(S, du, au, mpF, semaine = false) { // semaine : l'an dernier = 364 jours avant (même jour de la semaine) au lieu des mêmes dates
  const decale = (iso) => (semaine ? suiviJour(iso, -364) : suiviAnAvant(iso));
  const avecMp = mpF !== SUIVI_SITE, avecSite = !mpF || mpF === SUIVI_SITE;
  const garde = (mp) => !mpF || mp === mpF;
  const n1Du = decale(du), n1Au = decale(au);
  const mpOk = avecMp && S.debutN1 !== null && n1Du >= S.debutN1 && (!mpF || S.n1Connait(mpF));
  const siteOk = avecSite && S.siteDepuis !== null && n1Du >= S.siteDepuis;
  const mode = (!avecMp || mpOk) && (!avecSite || siteOk) ? "total" : mpOk ? "mp" : "aucun";
  const jours = [], prod = new Map(), prodN1 = new Map(), pays = new Map(), paysN1 = new Map(), canaux = new Map(), canauxN1 = new Map();
  let totMp = 0, totSite = 0, n1Mp = 0, n1Site = 0;
  let cmd = 0, cmdN1 = 0; // commandes (seulement si l'historique les donne par jour : version Shopify seul)
  const cumuler = (m, nom, marque, qte, ca, site) => {
    let p = m.get(nom);
    if (!p) { p = { nom, marque, ca: 0, caMp: 0, qte: 0 }; m.set(nom, p); }
    p.ca += ca; p.qte += qte; if (!site) p.caMp += ca;
  };
  for (let d = du; d <= au; d = suiviJour(d, 1)) {
    let cMp = 0, cSite = 0, bMp = 0, bSite = 0;
    S.parcourir(d, (mp, nom, marque, qte, ca) => {
      if (!garde(mp)) return;
      const site = mp === SUIVI_SITE;
      if (site) cSite += ca; else cMp += ca;
      cumuler(prod, nom, marque, qte, ca, site);
      const cn = canaux.get(mp); if (cn) { cn.ca += ca; cn.qte += qte; } else canaux.set(mp, { nom: mp, ca, qte });
    });
    S.parcourirPays(d, (pn, mp, ca) => { if (garde(mp)) pays.set(pn, (pays.get(pn) || 0) + ca); });
    const dN1 = decale(d);
    if (S.parcourirCmd) {
      S.parcourirCmd(d, (mp, n) => { if (garde(mp)) cmd += n; });
      if (mode !== "aucun") S.parcourirCmd(dN1, (mp, n) => { if (garde(mp)) cmdN1 += n; });
    }
    if (mode !== "aucun") {
      S.parcourirN1(dN1, (mp, nom, marque, qte, ca) => {
        if (!garde(mp)) return;
        const site = mp === SUIVI_SITE;
        if (site) bSite += ca; else bMp += ca;
        cumuler(prodN1, nom, marque, qte, ca, site);
        canauxN1.set(mp, (canauxN1.get(mp) || 0) + ca);
      });
      if (S.parcourirPaysN1) S.parcourirPaysN1(dN1, (pn, mp, ca) => { if (garde(mp)) paysN1.set(pn, (paysN1.get(pn) || 0) + ca); });
    }
    jours.push({ d, mp: cMp, site: cSite, n1d: dN1, n1mp: bMp, n1site: bSite });
    totMp += cMp; totSite += cSite; n1Mp += bMp; n1Site += bSite;
  }
  const totAll = totMp + totSite;
  const base = (p) => (mode === "mp" ? p.caMp : p.ca);
  const top = [...prod.values()].sort((a, b) => b.ca - a.ca).slice(0, 10).map((p) => {
    const n = prodN1.get(p.nom);
    const ref = mode === "aucun" ? null : n ? base(n) : 0;
    return { nom: p.nom, marque: p.marque, ca: p.ca, qte: p.qte, part: totAll > 0 ? (p.ca / totAll) * 100 : 0,
      delta: suiviVariation(base(p), ref), deltaEur: ref === null || (ref === 0 && base(p) === 0) ? null : base(p) - ref, nouveau: ref === 0 && base(p) > 0 };
  });
  // top 10 des canaux de vente (le site web compte comme un canal) : part du CA affiché ; variation seulement quand CE canal est comparable
  // (le site web : depuis sa première vente Shopify ; une marketplace : si le fichier de l'an dernier la connaît) — jamais sur une base incomplète
  const topMp = [...canaux.values()].sort((a, b) => b.ca - a.ca).slice(0, SUIVI_MP_VISIBLES).map((c) => {
    const site = c.nom === SUIVI_SITE;
    const comparable = mode !== "aucun" && (site ? siteOk : S.debutN1 !== null && n1Du >= S.debutN1 && S.n1Connait(c.nom));
    const ref = comparable ? canauxN1.get(c.nom) || 0 : null;
    return { nom: c.nom, site, ca: c.ca, qte: c.qte, part: totAll > 0 ? (c.ca / totAll) * 100 : 0,
      delta: suiviVariation(c.ca, ref), deltaEur: ref === null || (ref === 0 && c.ca === 0) ? null : c.ca - ref, nouveau: ref === 0 && c.ca > 0 };
  });
  const somme = (m) => { let s = 0; for (const v of m.values()) s += v; return s; };
  const totPays = somme(pays), totPaysN1 = somme(paysN1);
  const deltaPays = mode === "total" && totPays > 0 && totPaysN1 > 0;
  const partDe = (ca, tot) => (tot > 0 ? (ca / tot) * 100 : 0);
  const triPays = [...pays.entries()].map(([nom, ca]) => ({ nom, ca })).sort((a, b) => b.ca - a.ca);
  const lignesPays = triPays.slice(0, SUIVI_PAYS_VISIBLES).map((l) => ({
    nom: l.nom, ca: l.ca, part: partDe(l.ca, totPays), autres: false,
    delta: deltaPays ? partDe(l.ca, totPays) - partDe(paysN1.get(l.nom) || 0, totPaysN1) : null,
  }));
  const reste = triPays.slice(SUIVI_PAYS_VISIBLES);
  if (reste.length) {
    const ca = reste.reduce((s, l) => s + l.ca, 0), ca1 = reste.reduce((s, l) => s + (paysN1.get(l.nom) || 0), 0);
    lignesPays.push({ nom: null, ca, part: partDe(ca, totPays), autres: true, n: reste.length,
      delta: deltaPays ? partDe(ca, totPays) - partDe(ca1, totPaysN1) : null });
  }
  return {
    jours, mode, avecMp, avecSite, n1Du, n1Au, top, topMp, pays: lignesPays, deltaPays,
    cur: { mp: totMp, site: totSite, all: totAll },
    commandes: S.parcourirCmd ? { cur: cmd, ref: mode === "total" ? cmdN1 : null } : null,
    ref: { mp: mpOk ? n1Mp : null, site: siteOk ? n1Site : null, all: mode === "total" ? (avecMp ? n1Mp : 0) + (avecSite ? n1Site : 0) : null },
  };
}

// Variation en pourcentage (▲ vert / ▼ rouge) ou, pour les parts de pays, en points
function SuiviDelta({ pct, unite = "%", petit = false }) {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  const plat = Math.abs(pct) < 0.05, hausse = pct >= 0;
  const v = plat ? 0 : pct; // évite « -0.0 »
  const txt = unite === "%"
    ? (pct >= 500 ? `×${Math.round(pct / 100 + 1)}` : Math.abs(v) >= 99.95 ? `${v > 0 ? "+" : ""}${Math.round(v)} %` : fmtPct(v)) // dès 100 % : sans décimale
    : `${v > 0 ? "+" : ""}${v.toFixed(1)} ${unite}`;
  return (
    <span className="inline-flex items-center gap-0.5 tabular-nums font-semibold whitespace-nowrap" style={{ color: plat ? MUTED : hausse ? GREEN : RED, fontSize: petit ? 10.5 : 11.5 }}>
      {plat ? "▬" : hausse ? "▲" : "▼"} {txt}
    </span>
  );
}

function SuiviQuotidien({ t, lang, mpF, accent }) {
  const S = useMemo(() => suiviDonnees(), []);
  const nDispo = S.jourMin && S.jourMax ? suiviNbJours(S.jourMin, S.jourMax) : 0;
  const puces = useMemo(() => {
    const l = [7, 14, 30, 90].filter((n) => n <= nDispo);
    if (nDispo > 0 && (l.length === 0 || (nDispo > l[l.length - 1] && nDispo < 90))) l.push(nDispo); // tout ce qui est disponible
    return l;
  }, [nDispo]);
  const [n, setN] = useState(() => {
    try { const v = Number(localStorage.getItem("homy_suivi_periode")); if (puces.includes(v)) return v; } catch { /* stockage indisponible */ }
    return puces.filter((c) => c <= 14).pop() || puces[0];
  });
  const [sel, setSel] = useState(null); // jour touché dans l'histogramme (AAAA-MM-JJ)
  const [onglet, setOnglet] = useState(() => { // mobile : volet affiché sous l'histogramme (« top », « mp » ou « pays »)
    try { const v = localStorage.getItem("homy_suivi_onglet"); if (v === "top" || v === "mp" || v === "pays") return v; } catch { /* stockage indisponible */ }
    return "top";
  });
  const [memeJS, setMemeJS] = useState(() => { // jour touché : comparer au même jour de la semaine l'an dernier plutôt qu'aux mêmes dates
    try { return localStorage.getItem("homy_suivi_jour_semaine") === "1"; } catch { return false; }
  });
  useEffect(() => { setSel(null); }, [n, mpF]);
  const au = S.jourMax;
  const du = au ? (suiviJour(au, 1 - (n || 1)) < S.jourMin ? S.jourMin : suiviJour(au, 1 - (n || 1))) : null;
  const periode = useMemo(() => (au && n ? suiviCalc(S, du, au, mpF) : null), [S, du, au, n, mpF]);
  const jourR = useMemo(() => (sel ? suiviCalc(S, sel, sel, mpF, memeJS) : null), [S, sel, mpF, memeJS]);
  const modeAlt = useMemo(() => (sel ? suiviCalc(S, sel, sel, mpF, !memeJS).mode : "aucun"), [S, sel, mpF, memeJS]); // l'autre choix est-il comparable ?
  if (!puces.length || !periode) return null;

  const R = jourR || periode; // chiffre en tête et listes : le jour touché, sinon la période
  const loc = lang === "zh" ? "zh-CN" : lang;
  const jourLocal = (iso) => new Date(iso + "T12:00:00");
  const fmtCourt = (iso) => jourLocal(iso).toLocaleDateString(loc, { day: "numeric", month: "short" });
  const fmtLong = (iso) => jourLocal(iso).toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "short" });
  const fmtPlage = (a, b, avecAn = false, avecJour = false) => {
    if (a === b) return jourLocal(a).toLocaleDateString(loc, { ...(avecJour ? { weekday: "short" } : {}), day: "numeric", month: "short", ...(avecAn ? { year: "numeric" } : {}) });
    try { return new Intl.DateTimeFormat(loc, { day: "numeric", month: "short", ...(avecAn ? { year: "numeric" } : {}) }).formatRange(jourLocal(a), jourLocal(b)); }
    catch { return `${fmtCourt(a)} → ${fmtCourt(b)}`; }
  };
  const filtreMp = mpF && mpF !== SUIVI_SITE;
  const cMp = filtreMp ? accent.primary : ORANGE, cSite = DONNEES_SITE_COULEUR;
  const cBarre = mpF === SUIVI_SITE ? cSite : cMp;
  const an1 = Number(au.slice(0, 4)) - 1;
  const ligneN1 = periode.mode !== "aucun";
  // objectif du jour : objectif de la semaine Excel du plan 2026 ÷ 7 × poids habituel du jour de la semaine (le total de la semaine reste celui du plan),
  // ramené à la marketplace filtrée au prorata de son objectif annuel
  const objEntree = mpF ? DATA.mp_vs_objectif.find((m) => m.marketplace === mpF) : null;
  const partObj = !mpF ? 1 : objEntree && objEntree.objectif_fiable && objEntree.objectif ? objEntree.objectif / DATA.kpi.objectif_annuel_total : null;
  const poidsJ = partObj === null ? null : suiviPoidsJours(S, mpF || null);
  const objJour = (iso) => {
    if (partObj === null || iso.slice(0, 4) !== "2026") return null; // le plan hebdomadaire ne concerne que 2026
    const h = OBJECTIF_2026.hebdo.find((x) => x[0] === excelWeekOf(iso));
    return h ? Math.round((h[1] / 7) * (poidsJ ? poidsJ[new Date(iso + "T00:00:00Z").getUTCDay()] : 1) * partObj) : null;
  };
  const avecObj = partObj !== null && periode.jours.every((j) => objJour(j.d) !== null);
  const donnees = periode.jours.map((j) => ({
    d: j.d, mp: Math.round(j.mp), site: Math.round(j.site), obj: avecObj ? objJour(j.d) : null,
    n1: !ligneN1 ? null : Math.round(periode.mode === "mp" ? j.n1mp : (periode.avecMp ? j.n1mp : 0) + (periode.avecSite ? j.n1site : 0)),
    n1d: j.n1d,
  }));
  // objectif de la période (somme des objectifs de ses jours) ou du jour touché, et part atteinte : le chiffre qui dit si l'on est dans le plan
  const objVue = !avecObj ? null : sel ? (donnees.find((x) => x.d === sel) || {}).obj ?? null : donnees.reduce((a, x) => a + x.obj, 0);
  const pctPlan = objVue > 0 ? (R.cur.all / objVue) * 100 : null;
  const choisir = (p) => { setN(p); try { localStorage.setItem("homy_suivi_periode", String(p)); } catch { /* ignoré */ } };
  const choisirOnglet = (k) => { setOnglet(k); try { localStorage.setItem("homy_suivi_onglet", k); } catch { /* ignoré */ } };
  const choisirAlignement = (v) => { setMemeJS(v); try { localStorage.setItem("homy_suivi_jour_semaine", v ? "1" : "0"); } catch { /* ignoré */ } };
  const surGraphique = (e) => { const d = e && e.activeLabel; if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) setSel((cur) => (cur === d ? null : d)); };
  const quand = sel ? fmtLong(sel) : fmtPlage(du, au);
  const nbJoursVus = sel ? 1 : periode.jours.length;
  const montrerVar = R.mode !== "aucun" && nbJoursVus >= 7; // sur un seul jour, la variation par produit ne veut rien dire
  const maxCa = R.top.length ? R.top[0].ca : 0;
  const vide = R.cur.all <= 0;
  const fmtMontant = sel ? fmtEURplain : fmtEURk;
  // top 10 des marketplaces : seulement sans filtre marketplace (avec un filtre il n'y aurait qu'une ligne) ; la colonne de variation n'existe que si une ligne en a une
  const montrerMp = !mpF;
  const ongletVu = onglet === "mp" && !montrerMp ? "top" : onglet;
  const maxCaMp = R.topMp.length ? R.topMp[0].ca : 0;
  const colVarMp = R.topMp.some((c) => c.delta !== null || c.nouveau), colEcartMp = R.topMp.some((c) => c.deltaEur !== null);
  const libelleCanal = (c) => (c.site ? t.donnees_site : c.nom === "Autre" ? t.suivi_autres : c.nom);
  // commandes et panier moyen (CA HT ÷ commandes) de la période ou du jour ; variations seulement quand l'an dernier est comparable sur tout le périmètre
  const cm = R.commandes && R.commandes.cur > 0 ? R.commandes : null;
  const panier = cm ? R.cur.all / cm.cur : null;
  const panierRef = cm && cm.ref > 0 && R.ref.all !== null ? R.ref.all / cm.ref : null;
  const fmtPanier = (v) => `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(Math.round(v))} €`; // CA et commandes suivent ensemble le mode démo : le panier ne change pas

  const bulle = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const r = payload[0].payload;
    const ligne = (couleur, nom, v) => (
      <div className="flex items-center justify-between gap-4"><span className="flex items-center gap-1.5" style={{ color: MUTED }}><span className="w-2 h-2 rounded-sm" style={{ background: couleur }} />{nom}</span><span className="tabular-nums font-semibold" style={{ color: INK }}>{fmtEURplain(v)}</span></div>
    );
    const tot = r.mp + r.site;
    const dv = suiviVariation(tot, r.n1 !== null && periode.mode === "total" ? r.n1 : null);
    return (
      <div style={{ background: "#16140F", border: `1px solid ${PANEL_BORDER}`, borderRadius: 10, padding: "8px 10px", fontSize: 11.5, minWidth: 168 }}>
        <div style={{ color: INK, fontWeight: 600, marginBottom: 5 }}>{fmtLong(r.d)} · <span className="tabular-nums">{fmtEURplain(tot)}</span></div>
        <div className="flex flex-col gap-0.5">
          {periode.avecMp && ligne(cMp, filtreMp ? mpF : t.donnees_mp, r.mp)}
          {periode.avecSite && ligne(cSite, t.donnees_site, r.site)}
          {r.obj !== null && r.obj !== undefined && (
            <div className="flex items-center justify-between gap-4 mt-1 pt-1" style={{ borderTop: `1px solid ${PANEL_BORDER_QUIET}` }}>
              <span style={{ color: MUTED }}>{t.suivi_obj_jour}</span>
              <span className="tabular-nums" style={{ color: GREEN }}>{fmtEURplain(r.obj)} <SuiviDelta pct={suiviVariation(tot, r.obj)} petit /></span>
            </div>
          )}
          {r.n1 !== null && (
            <div className="flex items-center justify-between gap-4 mt-1 pt-1" style={{ borderTop: `1px solid ${PANEL_BORDER_QUIET}` }}>
              <span style={{ color: MUTED }}>{fmtCourt(r.n1d)} {an1}{periode.mode === "mp" ? ` · ${t.donnees_mp.toLowerCase()}` : ""}</span>
              <span className="tabular-nums" style={{ color: INK }}>{fmtEURplain(r.n1)} {dv !== null && <SuiviDelta pct={dv} petit />}</span>
            </div>
          )}
        </div>
      </div>
    );
  };
  const celles = (cle) => donnees.map((r) => <Cell key={`${cle}${r.d}`} fill={cle === "mp" ? cMp : cSite} fillOpacity={sel && sel !== r.d ? 0.3 : 1} />);

  return (
    <div data-suivi="bloc">
      {/* période + plage de dates (ou retour à la période quand un jour est touché) */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-0.5 p-0.5 rounded-full" role="group" data-suivi="puces" style={{ background: PANEL_QUIET, border: `1px solid ${PANEL_BORDER_QUIET}` }}>
          {puces.map((p) => (
            <button key={p} data-n={p} aria-pressed={p === n} onClick={() => choisir(p)}
              className="btn-lift text-[11px] font-semibold px-2.5 py-1 rounded-full tabular-nums"
              style={{ background: p === n ? `${ORANGE}26` : "transparent", color: p === n ? ORANGE_SOFT : MUTED }}>
              {t.suivi_jours.replace("{n}", p)}
            </button>
          ))}
        </div>
        {sel ? (
          <button data-suivi="reset" onClick={() => setSel(null)} className="btn-lift inline-flex items-center gap-1 text-[10.5px] font-semibold pl-1.5 pr-2 py-1 rounded-full"
            style={{ color: ORANGE_SOFT, background: `${ORANGE}1F`, border: `1px solid ${ORANGE}40` }}>
            <X size={11} /> {t.suivi_entiere}
          </button>
        ) : (
          <span className="text-[10.5px] tabular-nums" style={{ color: FAINT }} data-suivi="plage">{fmtPlage(du, au)}</span>
        )}
      </div>

      {/* chiffre en tête : CA HT de la période (ou du jour) et variation vs l'an dernier */}
      <div className="mt-3" data-suivi="kpi">
        <div className="text-[9.5px] uppercase tracking-[0.14em] font-semibold" style={{ color: FAINT }}>
          {t.suivi_ca} · <span style={{ color: sel ? ORANGE_SOFT : FAINT }}>{quand}</span>{filtreMp || mpF === SUIVI_SITE ? ` · ${mpF === SUIVI_SITE ? t.donnees_site : mpF}` : ""}
        </div>
        <div className="flex items-baseline gap-x-3 gap-y-0.5 flex-wrap mt-0.5">
          <span className="text-[26px] sm:text-[30px] font-semibold tabular-nums leading-none" style={{ color: INK }} data-suivi="total" data-valeur={Math.round(R.cur.all)}>{fmtEURplain(R.cur.all)}</span>
          {R.mode === "total" && <SuiviDelta pct={suiviVariation(R.cur.all, R.ref.all)} />}
          {R.mode === "total" && R.ref.all > 0 && <span className="text-[11px] tabular-nums font-medium" style={{ color: suiviCouleurEcart(R.cur.all - R.ref.all) }} data-suivi="ecart">{suiviEcart(R.cur.all - R.ref.all)}</span>}
          {(R.mode === "total" || (sel && R.mode === "mp")) && <span className="text-[10.5px] tabular-nums" style={{ color: FAINT }} data-suivi="vs">{t.suivi_vs.replace("{plage}", fmtPlage(R.n1Du, R.n1Au, true, Boolean(sel)))}{R.mode === "mp" ? ` · ${t.donnees_mp.toLowerCase()}` : ""}</span>}
        </div>
      </div>
      {/* objectif du plan 2026 sur la même fenêtre : montant attendu, part atteinte et écart */}
      {pctPlan !== null && (
        <div className="mt-1 flex items-baseline flex-wrap gap-x-1.5 text-[11px] tabular-nums" data-suivi="plan" data-objectif={objVue} data-pct={pctPlan.toFixed(1)}>
          <span style={{ color: FAINT }}>{sel ? t.suivi_obj_jour : t.suivi_obj_per}</span>
          <span style={{ color: INK }}>{fmtMontant(objVue)}</span>
          <span style={{ color: FAINT }}>·</span>
          <span className="font-semibold" style={{ color: suiviCouleurEcart(R.cur.all - objVue) }}>{Math.abs(pctPlan - 100) < 0.5 ? pctPlan.toFixed(1) : Math.round(pctPlan)} %</span>
          <span style={{ color: suiviCouleurEcart(R.cur.all - objVue) }}>{suiviEcart(R.cur.all - objVue)}</span>
        </div>
      )}
      {/* jour touché : comparer aux mêmes dates (défaut) ou au même jour de la semaine l'an dernier */}
      {sel && (R.mode !== "aucun" || modeAlt !== "aucun") && (
        <div className="flex items-center gap-0.5 p-0.5 mt-2 rounded-full w-fit max-w-full" role="group" data-suivi="alignement" style={{ background: PANEL_QUIET, border: `1px solid ${PANEL_BORDER_QUIET}` }}>
          {[["date", t.suivi_meme_date, false], ["semaine", t.suivi_meme_semaine, true]].map(([k, lib, v]) => (
            <button key={k} data-align={k} aria-pressed={memeJS === v} onClick={() => choisirAlignement(v)}
              className="btn-lift text-[10.5px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap"
              style={{ background: memeJS === v ? `${ORANGE}26` : "transparent", color: memeJS === v ? ORANGE_SOFT : MUTED }}>
              {lib}
            </button>
          ))}
        </div>
      )}

      {/* commandes et panier moyen : le chiffre d'affaires = commandes × panier, donc on voit si une variation vient du volume ou du panier */}
      {cm && (
        <div className="grid grid-cols-2 gap-x-4 mt-2.5" data-suivi="volume">
          <div className="min-w-0" data-suivi="commandes" data-valeur={cm.cur}>
            <div className="truncate text-[9.5px] uppercase tracking-[0.14em] font-semibold" style={{ color: FAINT }}>{t.suivi_commandes}</div>
            <div className="flex items-baseline gap-x-2 flex-wrap">
              <span className="text-[15px] font-semibold tabular-nums" style={{ color: INK }}>{fmtNum(cm.cur)}</span>
              <SuiviDelta pct={suiviVariation(cm.cur, cm.ref)} petit />
            </div>
          </div>
          <div className="min-w-0" data-suivi="panier" data-valeur={Math.round(panier)}>
            <div className="truncate text-[9.5px] uppercase tracking-[0.14em] font-semibold" style={{ color: FAINT }}>{t.suivi_panier}</div>
            <div className="flex items-baseline gap-x-2 flex-wrap">
              <span className="text-[15px] font-semibold tabular-nums" style={{ color: INK }}>{fmtPanier(panier)}</span>
              <SuiviDelta pct={suiviVariation(panier, panierRef)} petit />
            </div>
          </div>
        </div>
      )}

      {/* légende : marketplaces / site web (avec leur variation) et courbe de l'an dernier */}
      <div className="flex items-center gap-x-4 gap-y-1 flex-wrap mt-2 text-[11px]" style={{ color: MUTED }} data-suivi="legende">
        {R.avecMp && (
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: cMp }} />{filtreMp ? mpF : t.donnees_mp} <span className="tabular-nums" style={{ color: INK }}>{fmtMontant(R.cur.mp)}</span>{R.avecSite && <SuiviDelta pct={suiviVariation(R.cur.mp, R.ref.mp)} petit />}</span>
        )}
        {R.avecSite && (
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: cSite }} />{t.donnees_site} <span className="tabular-nums" style={{ color: INK }}>{fmtMontant(R.cur.site)}</span>{R.avecMp && <SuiviDelta pct={suiviVariation(R.cur.site, R.ref.site)} petit />}</span>
        )}
        {avecObj && (
          <span className="flex items-center gap-1.5" data-suivi="objectif"><span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: GREEN }} />{t.suivi_obj_leg}</span>
        )}
        {ligneN1 && (
          <span className="flex items-center gap-1.5" data-suivi="n1"><span className="inline-block w-4 border-t-2 border-dashed" style={{ borderColor: SUIVI_LIGNE_N1 }} />{(periode.mode === "mp" ? t.suivi_n1_mp : t.suivi_n1).replace("{an}", an1)}</span>
        )}
      </div>

      {/* histogramme du CA HT par jour + courbe de l'an dernier ; toucher une barre sélectionne le jour */}
      <div className="mt-2 h-[184px] md:h-[236px]" data-suivi="graphique" style={{ cursor: "pointer" }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={donnees} margin={{ top: 6, right: 6, bottom: 0, left: 0 }} onClick={surGraphique} barCategoryGap="16%">
            <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
            <XAxis dataKey="d" tickFormatter={fmtCourt} tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} interval="preserveStartEnd" minTickGap={14} />
            <YAxis tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} tickFormatter={fmtEURk} width={44} />
            <Tooltip content={bulle} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
            {periode.avecMp && <Bar dataKey="mp" stackId="j" fill={cMp} radius={periode.avecSite ? undefined : [4, 4, 0, 0]} isAnimationActive={false}>{celles("mp")}</Bar>}
            {periode.avecSite && <Bar dataKey="site" stackId="j" fill={cSite} radius={[4, 4, 0, 0]} isAnimationActive={false}>{celles("site")}</Bar>}
            {avecObj && <Line dataKey="obj" type="step" stroke={GREEN} strokeWidth={1.75} strokeDasharray="6 4" activeDot={false} connectNulls isAnimationActive={false}
              dot={(p) => <circle key={`obj${p.index}`} cx={p.cx} cy={p.cy} r={0.5} fill="none" stroke="none" data-suivi="objectif-jour" data-d={p.payload.d} data-obj={p.payload.obj} />} />}
            {ligneN1 && <Line dataKey="n1" type="monotone" stroke={SUIVI_LIGNE_N1} strokeWidth={1.75} strokeDasharray="5 4" dot={donnees.length <= 16 ? { r: 2.2, fill: SUIVI_LIGNE_N1, stroke: "none" } : false} activeDot={false} connectNulls isAnimationActive={false} />}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      {!sel && <div className="text-[10.5px] mt-1 px-0.5" style={{ color: FAINT }} data-suivi="astuce">{t.suivi_toucher}</div>}

      {/* top 10 produits, top 10 marketplaces et part du CA par pays — sur la période ou sur le jour touché */}
      <div className={`mt-3 pt-3 lg:mt-4 lg:pt-4 grid grid-cols-1 gap-x-8 gap-y-2 lg:gap-y-4 lg:grid-cols-5 ${montrerMp ? "xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)]" : ""}`} style={{ borderTop: `1px solid ${PANEL_BORDER_QUIET}` }}>
        {/* mobile (< lg) : un seul volet à la fois, choisi ici ; bureau : les volets côte à côte, sans onglets (trois colonnes dès 1280 px, produits à gauche et marketplaces au-dessus des pays en dessous) */}
        <div className="flex items-center justify-between gap-2 lg:hidden">
          <div className="flex items-center gap-0.5 p-0.5 rounded-full shrink-0" role="tablist" data-suivi="onglets" style={{ background: PANEL_QUIET, border: `1px solid ${PANEL_BORDER_QUIET}` }}>
            {[["top", t.suivi_tab_top], ...(montrerMp ? [["mp", t.suivi_tab_mp]] : []), ["pays", t.suivi_tab_pays]].map(([k, lib]) => (
              <button key={k} role="tab" data-onglet={k} aria-selected={ongletVu === k} onClick={() => choisirOnglet(k)}
                className="btn-lift text-[11px] font-semibold px-2.5 min-[380px]:px-3 py-1 rounded-full whitespace-nowrap"
                style={{ background: ongletVu === k ? `${ORANGE}26` : "transparent", color: ongletVu === k ? ORANGE_SOFT : MUTED }}>
                {lib}
              </button>
            ))}
          </div>
          <span className="hidden min-[400px]:block min-w-0 truncate text-[10.5px] tabular-nums" style={{ color: FAINT }}>{quand}</span>
        </div>
        <div className={`min-w-0 lg:col-span-3 ${montrerMp ? "lg:row-span-2 xl:col-span-1 xl:row-span-1" : ""} ${ongletVu === "top" ? "" : "hidden lg:block"}`} role="tabpanel" data-suivi="top10">
          <div className="hidden lg:flex items-baseline justify-between gap-2 mb-1">
            <span className="text-[9.5px] uppercase tracking-[0.14em] font-semibold" style={{ color: MUTED }}>{t.suivi_top10}{montrerVar && R.mode === "mp" && <span className="ml-1.5 normal-case tracking-normal font-normal" style={{ color: FAINT }} data-suivi="delta-mp">· {t.suivi_delta_mp}</span>}</span>
            <span className="text-[10.5px] tabular-nums" style={{ color: FAINT }}>{quand}</span>
          </div>
          {montrerVar && R.mode === "mp" && <div className="lg:hidden text-[10px] px-0.5" style={{ color: FAINT }} data-suivi="delta-mp">{t.suivi_delta_mp}</div>}
          {vide ? <div className="text-[12px] py-3" style={{ color: FAINT }}>{t.suivi_aucune}</div> : R.top.map((p, i) => (
            <div key={p.nom} data-suivi-ligne="produit" data-nom={p.nom} data-ca={Math.round(p.ca)} className="py-[3px] lg:py-1.5" style={{ borderTop: i ? `1px solid ${PANEL_BORDER_QUIET}` : "none" }}>
              <div className="flex items-baseline gap-2 text-[12.5px] leading-[18px] lg:leading-normal">
                <span className="w-4 shrink-0 text-right text-[10px] tabular-nums" style={{ color: FAINT }}>{i + 1}</span>
                <span className="flex-1 min-w-0 truncate text-[12.5px] font-medium" style={{ color: INK }}>{p.nom}{p.marque ? <span className="hidden sm:inline ml-1.5 text-[10px] font-normal" style={{ color: FAINT }}>{p.marque}</span> : null}</span>
                <span className="shrink-0 text-[12.5px] tabular-nums font-semibold" style={{ color: INK }}>{fmtEURplain(p.ca)}</span>
                {montrerVar && (
                  <span className="shrink-0 min-w-[58px] text-right">
                    {p.nouveau
                      ? <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded" style={{ color: AMBER, background: `${AMBER}1F` }}>{t.suivi_nouveau}</span>
                      : <SuiviDelta pct={p.delta} petit />}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5 lg:mt-1 pl-6 leading-[14px] lg:leading-normal">
                <div className="flex-1 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)" }}>
                  <div className="h-full rounded-full" style={{ width: `${Math.max(2, (p.ca / maxCa) * 100)}%`, background: `linear-gradient(90deg, ${cBarre}88, ${cBarre})` }} />
                </div>
                <span className="shrink-0 text-[10px] tabular-nums" style={{ color: FAINT }}>{p.part.toFixed(1)} % · {fmtNum(p.qte)} {t.suivi_u}</span>
                {montrerVar && p.deltaEur !== null && (
                  <span className="shrink-0 min-w-[58px] text-right text-[10px] tabular-nums font-medium" style={{ color: suiviCouleurEcart(p.deltaEur) }} data-suivi="ecart-produit">{suiviEcart(p.deltaEur)}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {montrerMp && (
          <div className={`min-w-0 lg:col-span-2 xl:col-span-1 ${ongletVu === "mp" ? "" : "hidden lg:block"}`} role="tabpanel" data-suivi="mp">
            <div className="hidden lg:flex items-baseline justify-between gap-2 mb-1">
              <span className="text-[9.5px] uppercase tracking-[0.14em] font-semibold" style={{ color: MUTED }}>{t.suivi_top10_mp}</span>
              <span className="text-[10.5px] tabular-nums" style={{ color: FAINT }}>{quand}</span>
            </div>
            {vide ? <div className="text-[12px] py-3" style={{ color: FAINT }}>{t.suivi_aucune}</div> : R.topMp.map((c, i) => {
              const coul = c.site ? cSite : cMp;
              return (
                <div key={c.nom} data-suivi-ligne="mp" data-nom={c.nom} data-ca={Math.round(c.ca)} className="py-[3px] lg:py-1.5" style={{ borderTop: i ? `1px solid ${PANEL_BORDER_QUIET}` : "none" }}>
                  <div className="flex items-baseline gap-2 text-[12.5px] leading-[18px] lg:leading-normal">
                    <span className="w-4 shrink-0 text-right text-[10px] tabular-nums" style={{ color: FAINT }}>{i + 1}</span>
                    <span className="flex-1 min-w-0 truncate text-[12.5px] font-medium" style={{ color: INK }}>{libelleCanal(c)}</span>
                    <span className="shrink-0 text-[12.5px] tabular-nums font-semibold" style={{ color: INK }}>{fmtEURplain(c.ca)}</span>
                    {colVarMp && (
                      <span className="shrink-0 min-w-[58px] text-right">
                        {c.nouveau
                          ? <span className="text-[9.5px] font-semibold px-1.5 py-0.5 rounded" style={{ color: AMBER, background: `${AMBER}1F` }}>{t.suivi_nouveau}</span>
                          : <SuiviDelta pct={c.delta} petit />}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5 lg:mt-1 pl-6 leading-[14px] lg:leading-normal">
                    <div className="flex-1 h-1 rounded-full" style={{ background: "rgba(255,255,255,0.05)" }}>
                      <div className="h-full rounded-full" style={{ width: `${Math.max(2, (c.ca / maxCaMp) * 100)}%`, background: `linear-gradient(90deg, ${coul}88, ${coul})` }} />
                    </div>
                    <span className="shrink-0 min-w-[100px] text-right text-[10px] tabular-nums" style={{ color: FAINT }}>{c.part.toFixed(1)} % · {fmtNum(c.qte)} {t.suivi_u}</span>
                    {colEcartMp && (
                      <span className="shrink-0 min-w-[58px] text-right text-[10px] tabular-nums font-medium" style={{ color: c.deltaEur !== null ? suiviCouleurEcart(c.deltaEur) : undefined }} data-suivi={c.deltaEur !== null ? "ecart-mp" : undefined}>{c.deltaEur !== null ? suiviEcart(c.deltaEur) : ""}</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className={`min-w-0 lg:col-span-2 ${montrerMp ? "xl:col-span-1" : ""} ${ongletVu === "pays" ? "" : "hidden lg:block"}`} role="tabpanel" data-suivi="pays">
          <div className="hidden lg:flex items-baseline justify-between gap-2 mb-2">
            <span className="text-[9.5px] uppercase tracking-[0.14em] font-semibold" style={{ color: MUTED }}>{t.suivi_pays}</span>
            <span className="text-[10.5px] tabular-nums" style={{ color: FAINT }}>{quand}</span>
          </div>
          {vide || R.pays.length === 0 ? <div className="text-[12px] py-3" style={{ color: FAINT }}>{t.suivi_aucune}</div> : (
            <>
              <div className="flex h-2.5 rounded-full overflow-hidden mb-2.5" style={{ background: "rgba(255,255,255,0.05)" }} data-suivi="pays-barre">
                {R.pays.map((c, i) => (
                  <div key={c.autres ? "autres" : (c.nom ?? "inconnu")} title={`${c.autres ? t.suivi_autres : translatePays(c.nom, lang)} ${c.part.toFixed(1)} %`}
                    style={{ width: `${c.part}%`, background: c.autres ? "#6B645A" : SUIVI_COULEURS_PAYS[i % SUIVI_COULEURS_PAYS.length], marginRight: i < R.pays.length - 1 ? 1 : 0 }} />
                ))}
              </div>
              {R.pays.map((c, i) => (
                <div key={c.autres ? "autres" : (c.nom ?? "inconnu")} data-suivi-ligne="pays" data-nom={c.autres ? "autres" : (c.nom ?? "inconnu")} data-part={c.part.toFixed(2)} data-ca={Math.round(c.ca)} className="flex items-center gap-2 py-1">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: c.autres ? "#6B645A" : SUIVI_COULEURS_PAYS[i % SUIVI_COULEURS_PAYS.length] }} />
                  <span className="flex-1 min-w-0 truncate text-[12px]" style={{ color: INK }}>{c.autres ? `${t.suivi_autres} (${c.n})` : translatePays(c.nom || t.suivi_autres, lang)}</span>
                  <span className="shrink-0 w-[52px] text-right text-[12px] tabular-nums font-semibold" style={{ color: INK }}>{c.part.toFixed(1)} %</span>
                  <span className="shrink-0 w-[46px] text-right text-[10.5px] tabular-nums" style={{ color: FAINT }}>{fmtEURk(c.ca)}</span>
                  {R.deltaPays && <span className="shrink-0 min-w-[64px] text-right"><SuiviDelta pct={c.delta} unite={t.suivi_pt} petit /></span>}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// Bloc « Données à jour » : jusqu'où vont les chiffres et le CA HT de chaque jour (marketplaces / site web).
// Version allégée (17 octobre 2026) : sans la phrase de source ni les notes de bas de bloc (SOUS_INFOS = true les rétablit).
function DonneesFraicheurCard({ t, lang, mpF = null, accent = null }) {
  // Ouvert par défaut quand les sous-informations sont masquées (le graphique est l'essentiel) ; le choix du lecteur est mémorisé
  const [open, setOpen] = useState(() => {
    try { const v = localStorage.getItem("homy_donnees_ouvert"); if (v === "1" || v === "0") return v === "1"; } catch { /* stockage indisponible */ }
    return !SOUS_INFOS;
  });
  const basculer = () => { const n = !open; setOpen(n); try { localStorage.setItem("homy_donnees_ouvert", n ? "1" : "0"); } catch { /* ignoré */ } };
  // premier jour de vente du site web dans Shopify
  const siteDepuis = suiviDonnees().siteDepuis;
  const loc = lang === "zh" ? "zh-CN" : lang;
  const fmtJour = (iso) => new Date(iso + "T12:00:00").toLocaleDateString(loc, { day: "numeric", month: "short" });
  const fmtJourAn = (iso) => new Date(iso + "T12:00:00").toLocaleDateString(loc, { day: "numeric", month: "short", year: "numeric" });
  const extraitMs = Date.parse((SHOPIFY_EXT && SHOPIFY_EXT.extrait_a) || "");
  const age = Number.isFinite(extraitMs) ? Math.floor((Date.now() - extraitMs) / 864e5) : 0; // l'extraction tourne chaque matin
  const fmtExtrait = Number.isFinite(extraitMs)
    ? new Date(extraitMs).toLocaleString(loc, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Paris" })
    : "";
  const couleur = age >= 2 ? AMBER : GREEN;
  const du = SOCLE.du || DMIN;
  const notes = [
    t.donnees_tout,
    t.donnees_base,
    ...(siteDepuis && siteDepuis > DMIN ? [t.donnees_site_depuis.replace("{du}", fmtJourAn(siteDepuis))] : []),
    t.donnees_bricoman,
    t.donnees_hors,
    t.donnees_maj.replace("{date}", fmtExtrait),
  ];
  return (
    <div data-bandeau>
    <GlassCard className="p-4 mb-5" glow glowColor={couleur}>
      <button onClick={basculer} className="w-full flex items-center justify-between gap-2 btn-lift" style={{ cursor: "pointer" }}>
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          <Store size={13} color={couleur} style={{ flexShrink: 0 }} />
          <span className="text-[9.5px] uppercase tracking-[0.14em] font-semibold" style={{ color: couleur }}>{t.donnees_titre}</span>
          <span className="w-1.5 h-1.5 rounded-full pulse-dot shrink-0" style={{ background: couleur }} />
          <span className="text-[11px] tabular-nums" style={{ color: INK }}>{t.donnees_jusqua.replace("{date}", fmtJour(DMAX))}</span>
          {age >= 2 && (
            <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0" style={{ color: AMBER, background: `${AMBER}1F` }}>
              {t.donnees_perime.replace("{n}", age)}
            </span>
          )}
        </div>
        <ChevronRight size={14} color={FAINT} style={{ flexShrink: 0, transform: open ? "rotate(90deg)" : "none", transition: "transform 0.3s cubic-bezier(.65,0,.35,1)" }} />
      </button>
      {SOUS_INFOS && (<div className="mt-1 text-[10.5px] leading-snug tabular-nums" style={{ color: FAINT }}>
        {t.donnees_socle.replace("{du}", fmtJourAn(du)).replace("{au}", fmtJourAn(DMAX))}
      </div>)}
      <div className={`fold-panel ${open ? "" : "is-closed"}`} style={open ? { maxHeight: 3600 } : undefined}>
        <div className="pt-3">
          <SuiviQuotidien t={t} lang={lang} mpF={mpF} accent={accent || { primary: ORANGE, soft: ORANGE_SOFT, text: "#0A0908" }} />
          {SOUS_INFOS && (<div className="flex flex-col gap-1.5 mt-3">
            {notes.map((n, i) => (
              <div key={i} className="flex items-start gap-1.5 text-[10.5px] leading-snug" style={{ color: FAINT }}>
                <Info size={11} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>{n}</span>
              </div>
            ))}
            {(SOCLE.avertissements || []).map((a, i) => (
              <div key={`w${i}`} className="flex items-start gap-1.5 text-[10.5px] leading-snug" style={{ color: AMBER }}>
                <AlertTriangle size={11} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>{a}</span>
              </div>
            ))}
          </div>)}
        </div>
      </div>
    </GlassCard>
    </div>
  );
}

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
const PAYS_I18N = {"France":{"en":"France","zh":"法国","es":"Francia"},"Allemagne":{"en":"Germany","zh":"德国","es":"Alemania"},"Autriche":{"en":"Austria","zh":"奥地利","es":"Austria"},"Belgique":{"en":"Belgium","zh":"比利时","es":"Bélgica"},"Bulgarie":{"en":"Bulgaria","zh":"保加利亚","es":"Bulgaria"},"Canaries, îles":{"en":"Canary Islands","zh":"加那利群岛","es":"Islas Canarias"},"Espagne":{"en":"Spain","zh":"西班牙","es":"España"},"Estonie":{"en":"Estonia","zh":"爱沙尼亚","es":"Estonia"},"Grèce":{"en":"Greece","zh":"希腊","es":"Grecia"},"Irlande":{"en":"Ireland","zh":"爱尔兰","es":"Irlanda"},"Italie":{"en":"Italy","zh":"意大利","es":"Italia"},"Lettonie":{"en":"Latvia","zh":"拉脱维亚","es":"Letonia"},"Luxembourg":{"en":"Luxembourg","zh":"卢森堡","es":"Luxemburgo"},"Monaco":{"en":"Monaco","zh":"摩纳哥","es":"Mónaco"},"Pays-Bas":{"en":"Netherlands","zh":"荷兰","es":"Países Bajos"},"Pologne":{"en":"Poland","zh":"波兰","es":"Polonia"},"Portugal":{"en":"Portugal","zh":"葡萄牙","es":"Portugal"},"Royaume-Uni":{"en":"United Kingdom","zh":"英国","es":"Reino Unido"},"Suisse":{"en":"Switzerland","zh":"瑞士","es":"Suiza"},"Belgique/Pays-Bas":{"en":"Belgium/Netherlands","zh":"比利时/荷兰","es":"Bélgica/Países Bajos"},"Roumanie":{"en":"Romania","zh":"罗马尼亚","es":"Rumanía"},"Danemark":{"en":"Denmark","zh":"丹麦","es":"Dinamarca"},"Croatie":{"en":"Croatia","zh":"克罗地亚","es":"Croacia"},"Non renseigné":{"en":"Not specified","zh":"未填写","es":"No especificado"}};

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
  { id: "data", labelKey: "nav_data", icon: Download },
];

function shiftYear(iso, delta) { const d = new Date(iso); d.setFullYear(d.getFullYear() + delta); return d.toISOString().slice(0, 10); }

// périodes prédéfinies du filtre de date global — calculées à partir de DMAX
// (dernier jour de données réel, DMAX), pas de la date du navigateur
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

// ===== CHAT_INTENTS — reconnaissance par mots-clés pour le routeur
// conversationnel (ChatRouter, avant DashboardApp). Pas d'IA/LLM ici :
// tout tourne côté client, sans appel réseau — chaque entrée associe des
// mots-clés à une destination (onglet + filtre marketplace optionnel).
// Testé du haut vers le bas, la première correspondance gagne — les intentions
// marketplace précises passent avant les génériques pour ne pas être masquées. =====
const CHAT_INTENTS = [
  // sous-onglets — placés en tête pour être testés avant les intentions
  // génériques homonymes (ex. "prix concurrents" doit gagner sur le "prix"
  // générique qui route vers l'onglet Prix, pas Concurrence)
  { keywords: ["repartition", "répartition", "ventilation", "ca par pays", "quantites par pays", "quantités par pays", "par type de produit", "type de produit"], tab: "marques", sousTab: "repartitions", label: "Répartitions (pays, marque, type de produit)" },
  { keywords: ["produit ideal", "produit idéal", "radar produit", "profil ideal"], tab: "marques", sousTab: "radar", label: "Produit idéal" },
  { keywords: ["puissance", "wattage"], tab: "marques", sousTab: "puissances", label: "Puissances" },
  { keywords: ["classification marque"], tab: "marques", sousTab: "classification", label: "Classification par marque" },
  { keywords: ["produits par marque", "produits marque"], tab: "marques", sousTab: "produits", label: "Produits par marque" },
  { keywords: ["prix concurrents", "prix de la concurrence", "prix adverses"], tab: "concurrence", sousTab: "prix", label: "Prix de la concurrence" },
  { keywords: ["comparatif concurrence", "comparaison concurrence"], tab: "concurrence", sousTab: "comparatif", label: "Comparatif concurrence" },
  { keywords: ["produits concurrence", "produits concurrents"], tab: "concurrence", sousTab: "produits", label: "Produits concurrents" },
  { keywords: ["leroy merlin", "leroy"], tab: "apercu", mp: "Leroy Merlin", label: "Leroy Merlin" },
  { keywords: ["amazon"], tab: "apercu", mp: "Amazon FR", label: "Amazon FR" },
  { keywords: ["cdiscount"], tab: "apercu", mp: "Cdiscount", label: "Cdiscount" },
  { keywords: ["manomano", "mano mano"], tab: "apercu", mp: "ManoMano", label: "ManoMano" },
  { keywords: ["castorama"], tab: "apercu", mp: "Castorama", label: "Castorama" },
  { keywords: ["site web", "site internet"], tab: "apercu", mp: "Site Web", label: "Site Web" },
  { keywords: ["bricoman"], tab: "apercu", mp: "Leroy Merlin", label: "Leroy Merlin (Bricoman inclus)" },
  { keywords: ["bricomarch"], tab: "apercu", mp: "Bricomarché", label: "Bricomarché" },
  { keywords: ["maxeda"], tab: "apercu", mp: "Maxeda", label: "Maxeda" },
  { keywords: ["boulanger"], tab: "apercu", mp: "Boulanger", label: "Boulanger" },
  { keywords: ["darty"], tab: "apercu", mp: "Darty", label: "Darty" },
  { keywords: ["bol.com", "bol com"], tab: "apercu", mp: "Bol.com", label: "Bol.com" },
  { keywords: ["objectif", "target", "annuel"], tab: "apercu", label: "Objectif annuel" },
  { keywords: ["semaine", "hebdo", "supply", "stock", "entrepot", "entrepôt", "expedition", "expédition"], tab: "apercu", label: "Aperçu de la semaine" },
  { keywords: ["prix", "price", "elastic", "élastic", "tarif", "simulateur"], tab: "prix", label: "Analyse des prix" },
  { keywords: ["concurrence", "concurrent", "compet"], tab: "concurrence", label: "Concurrence" },
  { keywords: ["ads", "pub", "publicite", "publicité", "budget", "roas"], tab: "ads", label: "Publicité" },
  { keywords: ["marque", "bestherm", "thomson", "hom'y", "homy"], tab: "marques", label: "Marques" },
  { keywords: ["marketplace", "plateforme"], tab: "marketplaces", label: "Marketplaces" },
  { keywords: ["mois dernier", "mois precedent", "mois précédent"], tab: "apercu", periode: "mois_precedent", label: "Mois précédent" },
  { keywords: ["ce mois", "mois en cours", "mois actuel"], tab: "apercu", periode: "mois_courant", label: "Mois en cours" },
  { keywords: ["annee derniere", "année dernière", "an dernier", "annee passee", "année passée"], tab: "apercu", periode: "annee_passee", label: "Année passée" },
];

// ===== CHAT_QUESTIONS — questions courantes avec une vraie réponse calculée
// depuis les données de l'app (pas de navigation directe), testées avant
// CHAT_INTENTS. Chaque réponse est une fonction (pas une valeur figée) pour
// rester à jour à chaque nouvel import de données. =====
// période réellement couverte par le fichier « Dépenses budget marketing 2026 – year to date » (juillet→décembre vides au 7 octobre 2026)
const ADS_PERIODE = { fr: "janvier–juin 2026", en: "January–June 2026", es: "enero–junio 2026", zh: "2026年1月至6月" };
function scannerRupturesRapide() {
  const dernierMoisComplet = MOIS_EN_COURS_IDX - 1;
  if (dernierMoisComplet < 0) return [];
  const parProduit = {};
  SKU_MONTHLY.forEach(([pi, mi, an, mo, ca]) => {
    if (an !== 2026) return;
    const nom = SKU_PRODUIT[pi];
    if (!parProduit[nom]) parProduit[nom] = Array(12).fill(0);
    parProduit[nom][mo - 1] += ca;
  });
  const ruptures = [];
  for (const [nom, arr] of Object.entries(parProduit)) {
    const premier = arr.findIndex((v) => v > 0);
    if (premier === -1 || premier >= dernierMoisComplet || arr[dernierMoisComplet] !== 0) continue;
    let duree = 0;
    for (let i = dernierMoisComplet; i >= premier && arr[i] === 0; i--) duree++;
    ruptures.push({ produit: nom, duree });
  }
  return ruptures.sort((a, b) => b.duree - a.duree);
}
const CHAT_QUESTIONS = [
  {
    keywords: ["meilleur produit", "produit qui se vend le mieux", "best seller", "top produit", "produit le plus vendu"],
    reponse: () => `${DATA.best_seller_2026.produit} — ${fmtEURplain(DATA.best_seller_2026.ca)} de CA en 2026.`,
    action: { tab: "marques", sousTab: "produits" },
  },
  {
    keywords: ["objectif", "où en est l'objectif", "atteint l'objectif"],
    reponse: () => {
      const attendu = planAttenduAuJour(DMAX), pctPlan = (attendu / OBJECTIF_2026.annuel) * 100, ecart = DATA.kpi.pct_objectif_atteint - pctPlan;
      return `${DATA.kpi.pct_objectif_atteint.toFixed(0)}% de l'objectif annuel atteint (${fmtEURplain(DATA.kpi.ca_total_2026)} sur ${fmtEURplain(DATA.kpi.objectif_annuel_total)}). Le plan prévoyait ${pctPlan.toFixed(1)}% à ce jour (semaine ${excelWeekOf(DMAX)}, ${fmtEURplain(attendu)}) : ${ecart >= 0 ? "+" : ""}${ecart.toFixed(1)} pt.`;
    },
    action: { tab: "apercu" },
  },
  {
    keywords: ["meilleure marketplace", "quelle marketplace", "marketplace qui performe", "marketplace numero un"],
    reponse: () => { const top = [...DATA.mp_vs_objectif].sort((a, b) => b.ca - a.ca)[0]; return `${top.marketplace} — ${fmtEURplain(top.ca)} de CA, ${top.pct_objectif}% de son objectif.`; },
    action: { tab: "marketplaces" },
  },
  {
    keywords: ["chiffre d'affaires", "chiffre daffaires", "combien j'ai fait", "ca total", "quel est mon ca"],
    reponse: () => {
      const c = DATA.total_yoy_comparable, y = c["2025"] ? ((c["2026"] - c["2025"]) / c["2025"]) * 100 : null;
      return `${fmtEURplain(DATA.kpi.ca_total_2026)} de CA HT depuis le 1er janvier 2026${y !== null ? ` (${y >= 0 ? "+" : ""}${y.toFixed(1)}% vs la même période 2025)` : ""}.`;
    },
    action: { tab: "apercu" },
  },
  {
    keywords: ["rupture", "en rupture", "produit qui ne se vend plus", "stock"],
    reponse: () => {
      const r = scannerRupturesRapide();
      if (!r.length) return "Aucune rupture détectée sur les produits actifs — tout se vend normalement.";
      const top = r[0];
      return r.length === 1
        ? `${top.produit} semble en rupture depuis ${top.duree} mois.`
        : `${r.length} produits semblent en rupture, le plus long : ${top.produit} (${top.duree} mois).`;
    },
    action: { tab: "marques", sousTab: "produits" },
  },
];
// ===== requêtes structurées : période + marketplace + métrique, ex. "dépenses
// ads de janvier à mars 2026 sur amazon" ou "CA de leroy merlin en juillet".
// Testées avant CHAT_QUESTIONS (plus spécifiques). Couvre CA et quantité
// (granularité mois × marketplace disponible via SKU_MONTHLY) ; pour les
// dépenses ads, seul un total ANNUEL par marketplace existe (DATA.ads n'a pas
// de détail mensuel) — la réponse le précise plutôt que d'inventer une
// répartition mensuelle qui n'existe pas dans les données sources. =====
const MOIS_NOMS_FR = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"];
const ADS_MP_GROUPES = {
  "amazon": ["AMAZON FR", "AMAZON ES", "AMAZON IT", "AMAZON DE"],
  "leroy merlin": ["LEROY MERLIN FR", "LEROY MERLIN ES", "LEROY MERLIN IT", "LEROY MERLIN PL"],
  "site web": ["SITE WEB"], "manomano": ["MANO MANO"], "mano mano": ["MANO MANO"],
  "cdiscount": ["CDISCOUNT"], "castorama": ["CASTORAMA"], "darty": ["DARTY"], "bol": ["BOL"], "bol.com": ["BOL"],
};
function normaliserTexte(s) { return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); }

function parseRequeteStructuree(texteOriginal) {
  const t = normaliserTexte(texteOriginal);

  // marque (Bestherm/Thomson/HOM'Y) — CA annuel + YoY, seule granularité disponible
  const MARQUES_CLES = { "bestherm": "Bestherm", "thomson": "Thomson", "hom'y": "HOM'Y", "homy": "HOM'Y", "hom y": "HOM'Y" };
  const margueCle = Object.keys(MARQUES_CLES).find((k) => t.includes(k));
  if (margueCle && (t.includes("ca") || t.includes("chiffre") || t.includes("vente"))) {
    const marque = MARQUES_CLES[margueCle];
    const ca26 = DATA.brand_yoy[marque]["2026"], ca25 = DATA.brand_yoy[marque]["2025"];
    const yoy = ca25 > 0 ? (((ca26 - ca25) / ca25) * 100).toFixed(0) : null;
    return { reponse: () => `${marque} — ${fmtEURplain(ca26)} de CA en 2026${yoy !== null ? ` (${yoy >= 0 ? "+" : ""}${yoy}% vs la même période 2025)` : ""}.`, action: { tab: "apercu" } };
  }

  // produit spécifique — cherche un nom de produit connu dans la phrase (le
  // plus long match d'abord pour éviter qu'"ARIA 1000W" soit coupé par un
  // match partiel sur juste "ARIA")
  const produitTrouve = [...new Set(SKU_PRODUIT)].sort((a, b) => b.length - a.length).find((p) => t.includes(normaliserTexte(p)));
  if (produitTrouve && (t.includes("prix") || t.includes("combien") || t.includes("vend"))) {
    const lignesProduit = DATA.price_tracking.filter((r) => r[0] === produitTrouve);
    if (!lignesProduit.length) return { reponse: () => `Aucune donnée de prix trouvée pour ${produitTrouve}.`, action: { tab: "marques", sousTab: "produits", recherche: produitTrouve } };
    if (t.includes("prix")) {
      const mpMatchProduit = Object.keys({ "amazon": "Amazon FR", "leroy merlin": "Leroy Merlin", "leroy": "Leroy Merlin", "cdiscount": "Cdiscount", "manomano": "ManoMano", "castorama": "Castorama" }).find((k) => t.includes(k));
      const mpCanonique = mpMatchProduit ? { "amazon": "Amazon FR", "leroy merlin": "Leroy Merlin", "leroy": "Leroy Merlin", "cdiscount": "Cdiscount", "manomano": "ManoMano", "castorama": "Castorama" }[mpMatchProduit] : null;
      const ligne = mpCanonique ? lignesProduit.find((r) => r[1] === mpCanonique) : lignesProduit[0];
      if (!ligne) return { reponse: () => `Pas de prix connu pour ${produitTrouve} sur ${mpCanonique}.`, action: { tab: "marques", sousTab: "produits", recherche: produitTrouve } };
      const derniersPrix = ligne[3].filter((p) => p);
      const prixActuel = derniersPrix[derniersPrix.length - 1];
      return { reponse: () => `${produitTrouve} sur ${ligne[1]} : ${fmtEURplain(prixActuel)} (dernier prix connu 2026).`, action: { tab: "marques", sousTab: "produits", recherche: produitTrouve } };
    }
    // "combien s'est vendu" -> CA total toutes marketplaces, 2026
    const totalCa = SKU_MONTHLY.reduce((s, [pi, , an, , ca]) => (an === 2026 && SKU_PRODUIT[pi] === produitTrouve ? s + ca : s), 0);
    return { reponse: () => `${produitTrouve} — ${fmtEURplain(totalCa)} de CA en 2026, toutes marketplaces.`, action: { tab: "marques", sousTab: "produits", recherche: produitTrouve } };
  }

  const moisTrouves = [];
  MOIS_NOMS_FR.forEach((m, i) => { if (t.includes(m)) moisTrouves.push(i); });
  const anneeMatch = t.match(/20(2[4-9])/);
  const annee = anneeMatch ? Number("20" + anneeMatch[1]) : 2026;
  const MP_MOTS_CLES = { "amazon": "Amazon FR", "leroy merlin": "Leroy Merlin", "leroy": "Leroy Merlin", "cdiscount": "Cdiscount",
    "manomano": "ManoMano", "mano mano": "ManoMano", "castorama": "Castorama", "site web": "Site Web", "bricoman": "Leroy Merlin",
    "bricomarche": "Bricomarché", "maxeda": "Maxeda", "boulanger": "Boulanger", "darty": "Darty", "bol.com": "Bol.com", "bol": "Bol.com",
    "brico bravo": "Brico Bravo", "worten": "Worten" };
  const mpCle = Object.keys(MP_MOTS_CLES).sort((a, b) => b.length - a.length).find((k) => t.includes(k));
  const mpMatch = mpCle ? MP_MOTS_CLES[mpCle] : null;
  const estAds = (t.includes("depense") || t.includes("roas") || t.includes("acos") || t.includes("budget")) && (t.includes("ad") || t.includes("roas") || t.includes("acos") || t.includes("budget"));
  const estPanierMoyen = !estAds && (t.includes("panier moyen") || (t.includes("panier") && t.includes("moyen")));
  const estCa = !estAds && !estPanierMoyen && (t.includes("chiffre d'affaire") || t.includes("chiffre daffaire") || t.includes(" ca ") || t.startsWith("ca ") || t.endsWith(" ca"));
  const estQte = !estAds && !estPanierMoyen && !estCa && (t.includes("quantite") || t.includes("unite") || t.includes("vendu"));

  if (!estAds && !estPanierMoyen && !estCa && !estQte) return null; // aucune métrique reconnue, laisse la main à CHAT_QUESTIONS / CHAT_INTENTS
  if (estPanierMoyen) return { reponse: () => `Panier moyen ${annee} : ${fmtEURplain(DATA.kpi.panier_moyen_2026)} (toutes marketplaces confondues — pas de détail par marketplace disponible).`, action: { tab: "apercu" } };
  if (!mpMatch && moisTrouves.length === 0 && !estAds) return null; // ni période ni marketplace précisée : trop générique pour cette voie

  if (estAds) {
    const groupeCle = Object.keys(ADS_MP_GROUPES).find((k) => t.includes(k));
    const sousMetrique = t.includes("roas") ? "roas" : t.includes("acos") ? "acos" : t.includes("budget") ? "budget" : "depense";
    if (!groupeCle) {
      if (sousMetrique !== "depense") return null; // roas/acos/budget global n'a pas de sens agrégé simple, laisse retomber
      return { reponse: () => "Précise une marketplace (Amazon, Leroy Merlin…) pour les dépenses ads — je n'ai pas de total consolidé.", action: { tab: "ads" } };
    }
    const variantes = ADS_MP_GROUPES[groupeCle];
    const lignes = DATA.ads.filter((a) => variantes.includes(a.marketplace));
    if (!lignes.length) return { reponse: () => `Pas de données ads pour ${groupeCle}.`, action: { tab: "ads" } };
    if (sousMetrique === "depense") {
      const total = lignes.reduce((s, a) => s + (a.spend || 0), 0);
      const periodeTexte = moisTrouves.length ? ` — attention, seul un total cumulé existe dans les données (${fmtEURplain(total)} sur ${ADS_PERIODE.fr}), pas de détail mensuel pour isoler ta période.` : ` : ${fmtEURplain(total)} sur ${ADS_PERIODE.fr} (période couverte par le fichier budget marketing).`;
      return { reponse: () => `Dépenses ads ${groupeCle}${periodeTexte}`, action: { tab: "ads" } };
    }
    const totalSpend = lignes.reduce((s, a) => s + (a.spend || 0), 0);
    const totalCa = lignes.reduce((s, a) => s + (a.ca_genere || 0), 0);
    if (sousMetrique === "roas") return { reponse: () => `ROAS ${groupeCle} : ${(totalCa / totalSpend).toFixed(1)}x sur ${ADS_PERIODE.fr} (CA généré ÷ dépense).`, action: { tab: "ads" } };
    if (sousMetrique === "acos") return { reponse: () => `ACOS ${groupeCle} : ${((totalSpend / totalCa) * 100).toFixed(1)}% sur ${ADS_PERIODE.fr} (dépense ÷ CA généré).`, action: { tab: "ads" } };
    const totalBudget = lignes.reduce((s, a) => s + (a.budget_annuel || 0), 0);
    return { reponse: () => `Budget ads ${groupeCle} : ${fmtEURplain(totalSpend)} utilisés sur ${fmtEURplain(totalBudget)} (${((totalSpend / totalBudget) * 100).toFixed(0)}%) — dépenses ${ADS_PERIODE.fr} seulement, donc sous-estimé à ce jour.`, action: { tab: "ads" } };
  }

  const moisDebut = moisTrouves.length ? Math.min(...moisTrouves) : 0;
  const moisFin = moisTrouves.length ? Math.max(...moisTrouves) : 11;
  const mpIdx = mpMatch ? SKU_MPS.indexOf(mpMatch) : null;
  let total = 0, totalQte = 0;
  SKU_MONTHLY.forEach(([pi, mi, an, mo, ca, qte]) => {
    if (an !== annee) return;
    if (mo - 1 < moisDebut || mo - 1 > moisFin) return;
    if (mpIdx !== null && mi !== mpIdx) return;
    total += ca; totalQte += qte || 0;
  });
  const periodeLabel = moisTrouves.length === 0 ? `en ${annee}` : moisDebut === moisFin ? `en ${DATA.mois_labels[moisDebut]} ${annee}` : `de ${DATA.mois_labels[moisDebut]} à ${DATA.mois_labels[moisFin]} ${annee}`;
  const mpLabel = mpMatch ? ` sur ${mpMatch}` : " toutes marketplaces confondues";
  const valeur = estQte ? `${fmtNum(totalQte)} unités` : fmtEURplain(total);
  return { reponse: () => `${estQte ? "Quantité vendue" : "CA"}${mpLabel}, ${periodeLabel} : ${valeur}.`, action: { tab: "apercu", mp: mpMatch || null } };
}

function matchChatQuestion(texte) {
  const t = texte.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const q of CHAT_QUESTIONS) {
    if (q.keywords.some((k) => t.includes(k.normalize("NFD").replace(/[\u0300-\u036f]/g, "")))) return q;
  }
  return null;
}
function matchChatIntent(texte) {
  const t = texte.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  for (const intent of CHAT_INTENTS) {
    if (intent.keywords.some((k) => t.includes(k.normalize("NFD").replace(/[\u0300-\u036f]/g, "")))) return intent;
  }
  return null;
}
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
// construit, pour un produit donné (array de 12 CA mensuels 2026), le détail
// mois par mois avec statut (réel / rupture / futur / avant-lancement) et
// l'estimation saisonnière pour les mois sans vente réelle exploitable, plus
// le forecast annuel qui en découle. Le mois en cours (partiel) n'est JAMAIS
// qualifié de rupture même à 0 ou faible — on ne sait pas encore s'il finira
// la période à sec. seasonalityArray est optionnel (défaut : indice global) —
// voir seasonalityForCategory ci-dessous pour pourquoi une catégorie a besoin
// de SON PROPRE indice plutôt que celui, dominé par les radiateurs, de
// l'ensemble du catalogue.
function buildForecastMensuel(caArray, qteArray = null, seasonalityArray = SEASONALITY_INDEX) {
  const premierMoisVente = caArray.findIndex((v) => v > 0);
  const moisActifs = []; // mois avec vente réelle, hors mois en cours (trop partiel pour la moyenne)
  for (let i = 0; i < 12; i++) {
    if (i !== MOIS_EN_COURS_IDX && i <= MOIS_EN_COURS_IDX && caArray[i] > 0) moisActifs.push(i);
  }
  const moyenneReelle = moisActifs.length ? moisActifs.reduce((s, i) => s + caArray[i], 0) / moisActifs.length : 0;
  const indexMoyenActif = moisActifs.length ? moisActifs.reduce((s, i) => s + seasonalityArray[i], 0) / moisActifs.length : 1;
  // même logique pour la quantité, calculée indépendamment de son propre
  // historique plutôt que déduite du CA estimé / un prix constant — un
  // changement de prix entre les mois réels et le mois estimé fausserait
  // sinon la quantité (CA et quantité n'évoluent pas forcément au même rythme)
  const moyenneReelleQte = qteArray && moisActifs.length ? moisActifs.reduce((s, i) => s + qteArray[i], 0) / moisActifs.length : 0;

  const parMois = caArray.map((ca, i) => {
    const qte = qteArray ? qteArray[i] : null;
    if (premierMoisVente === -1 || i < premierMoisVente) return { i, statut: "avant_lancement", reel: 0, estime: null, reelQte: 0, estimeQte: null };
    if (i === MOIS_EN_COURS_IDX) return { i, statut: "en_cours", reel: ca, estime: null, reelQte: qte, estimeQte: null };
    if (i < MOIS_EN_COURS_IDX) {
      if (ca > 0) return { i, statut: "reel", reel: ca, estime: null, reelQte: qte, estimeQte: null };
      const estime = moyenneReelle * (seasonalityArray[i] / indexMoyenActif);
      const estimeQte = qteArray ? moyenneReelleQte * (seasonalityArray[i] / indexMoyenActif) : null;
      return { i, statut: "rupture", reel: 0, estime, reelQte: 0, estimeQte };
    }
    // mois futur (après le mois en cours) — pure projection saisonnière
    const estime = moyenneReelle * (seasonalityArray[i] / indexMoyenActif);
    const estimeQte = qteArray ? moyenneReelleQte * (seasonalityArray[i] / indexMoyenActif) : null;
    return { i, statut: "futur", reel: null, estime, reelQte: null, estimeQte };
  });

  const forecastAnnuel = parMois.reduce((s, m) => s + (m.reel ?? m.estime ?? 0), 0);
  const forecastAnnuelQte = qteArray ? parMois.reduce((s, m) => s + (m.reelQte ?? m.estimeQte ?? 0), 0) : null;
  return { parMois, forecastAnnuel, forecastAnnuelQte, nbMoisReels: moisActifs.length };
}

// ===== export Excel — onglet DATA. Calculs portés depuis le script Python
// utilisé pour le rapport déshumidificateurs (même logique, même structure à
// 3 onglets), mais exécutés ici côté client puisque l'app n'a plus de
// backend. ExcelJS (chargé à la demande via CDN, jamais au premier chargement
// de l'app) plutôt que la bibliothèque xlsx déjà autorisée dans les artifacts :
// seule ExcelJS permet vraiment les couleurs/polices en version gratuite,
// indispensable pour un rendu "élégant et distingué" comme demandé.
let exceljsChargement = null;
function chargerExcelJS() {
  if (window.ExcelJS) return Promise.resolve(window.ExcelJS);
  if (exceljsChargement) return exceljsChargement;
  exceljsChargement = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js";
    script.onload = () => resolve(window.ExcelJS);
    script.onerror = () => reject(new Error("Impossible de charger ExcelJS"));
    document.head.appendChild(script);
  });
  return exceljsChargement;
}

// agrège, pour un produit donné, le CA mensuel 2024/2025/2026 (depuis
// SKU_MONTHLY) et la répartition par marketplace avec prix HT/TTC (depuis
// DATA.price_tracking) — même source que partout ailleurs dans l'app
function calculerDonneesProduit(nomProduit) {
  const pi = SKU_PRODUIT.indexOf(nomProduit);
  const mensuel = { 2024: Array(12).fill(0), 2025: Array(12).fill(0), 2026: Array(12).fill(0) };
  if (pi !== -1) {
    SKU_MONTHLY.forEach(([p, mi, an, mo, ca]) => {
      if (p === pi && mensuel[an]) mensuel[an][mo - 1] += ca;
    });
  }
  const TVA = 1.20;
  const detailCanal = [];
  DATA.price_tracking.filter((r) => r[0] === nomProduit).forEach(([, mp, prix25, prix26, qte25, qte26]) => {
    [[2025, prix25, qte25], [2026, prix26, qte26]].forEach(([annee, prixArr, qteArr]) => {
      const ca = prixArr.reduce((s, p, i) => s + (p || 0) * (qteArr[i] || 0), 0);
      const qte = qteArr.reduce((s, q) => s + (q || 0), 0);
      if (qte > 0) {
        const prixHt = ca / qte;
        detailCanal.push({ annee, marketplace: mp, caHt: ca, qte, prixHt, prixTtc: prixHt * TVA });
      }
    });
  });
  return {
    produit: nomProduit,
    mensuel,
    detailCanal,
    caTotal2025: mensuel[2025].reduce((a, b) => a + b, 0),
    caMemePeriode2025: pi !== -1 ? iaN1MemePeriode(pi).ca : 0,
    caTotal2026: mensuel[2026].reduce((a, b) => a + b, 0),
    qteTotal2025: detailCanal.filter((d) => d.annee === 2025).reduce((s, d) => s + d.qte, 0),
    qteTotal2026: detailCanal.filter((d) => d.annee === 2026).reduce((s, d) => s + d.qte, 0),
  };
}

async function genererRapportExcel(produits) {
  const ExcelJS = await chargerExcelJS();
  const wb = new ExcelJS.Workbook();
  const ORANGE_HEX = "FFFF5A1F", DARK_HEX = "FF1A1A1A", GREY_LIGHT = "FFF2F2F2", GREY_MED = "FFD9D9D9", WHITE_HEX = "FFFFFFFF";
  const bordureFine = { style: "thin", color: { argb: "FFCCCCCC" } };
  const bordureToutes = { top: bordureFine, bottom: bordureFine, left: bordureFine, right: bordureFine };
  const MOIS = ["Jan","Fév","Mar","Avr","Mai","Juin","Juil","Août","Sep","Oct","Nov","Déc"];

  const donnees = produits.map(calculerDonneesProduit);

  const titrePage = (ws, titre, sousTitre, ncols) => {
    ws.mergeCells(1, 1, 1, ncols);
    const c1 = ws.getCell(1, 1); c1.value = titre;
    c1.font = { name: "Arial", size: 16, bold: true, color: { argb: WHITE_HEX } };
    c1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: DARK_HEX } };
    c1.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(1).height = 28;
    ws.mergeCells(2, 1, 2, ncols);
    const c2 = ws.getCell(2, 1); c2.value = sousTitre;
    c2.font = { name: "Arial", size: 10, italic: true, color: { argb: "FF666666" } };
    c2.alignment = { horizontal: "center" };
  };
  const styleEntete = (ws, row, ncols) => {
    for (let col = 1; col <= ncols; col++) {
      const c = ws.getCell(row, col);
      c.font = { name: "Arial", size: 10, bold: true, color: { argb: WHITE_HEX } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ORANGE_HEX } };
      c.alignment = { horizontal: "center", vertical: "middle" };
      c.border = bordureToutes;
    }
  };

  // ---- Onglet 1 : Synthèse ----
  const ws1 = wb.addWorksheet("Synthèse");
  titrePage(ws1, "EXTRACTION DATA — SYNTHÈSE", produits.join(" · ") + " — Bestherm/Thomson", 7);
  const headers1 = ["Produit", "CA HT 2025 (année)", "Qté 2025", "CA HT 2026 (à date)", "Qté 2026", "CA HT 2025 (même période)", "Évolution CA (même période)"];
  headers1.forEach((h, i) => { ws1.getCell(4, i + 1).value = h; });
  styleEntete(ws1, 4, 7);
  donnees.forEach((d, i) => {
    const row = 5 + i;
    ws1.getCell(row, 1).value = d.produit;
    ws1.getCell(row, 1).font = { name: "Arial", bold: true };
    ws1.getCell(row, 2).value = Math.round(d.caTotal2025 * 100) / 100;
    ws1.getCell(row, 2).numFmt = '#,##0.00 €';
    ws1.getCell(row, 3).value = d.qteTotal2025;
    ws1.getCell(row, 4).value = Math.round(d.caTotal2026 * 100) / 100;
    ws1.getCell(row, 4).numFmt = '#,##0.00 €';
    ws1.getCell(row, 5).value = d.qteTotal2026;
    ws1.getCell(row, 6).value = Math.round(d.caMemePeriode2025 * 100) / 100;
    ws1.getCell(row, 6).numFmt = '#,##0.00 €';
    const evoCell = ws1.getCell(row, 7);
    evoCell.value = { formula: `IFERROR((D${row}-F${row})/F${row},"n/a")` };
    evoCell.numFmt = '0.0%';
    if (i % 2 === 1) for (let c = 1; c <= 7; c++) ws1.getCell(row, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY_LIGHT } };
    for (let c = 1; c <= 7; c++) ws1.getCell(row, c).border = bordureToutes;
  });
  const totalRow = 5 + donnees.length;
  ws1.getCell(totalRow, 1).value = "TOTAL";
  ws1.getCell(totalRow, 2).value = { formula: `SUM(B5:B${totalRow - 1})` }; ws1.getCell(totalRow, 2).numFmt = '#,##0.00 €';
  ws1.getCell(totalRow, 3).value = { formula: `SUM(C5:C${totalRow - 1})` };
  ws1.getCell(totalRow, 4).value = { formula: `SUM(D5:D${totalRow - 1})` }; ws1.getCell(totalRow, 4).numFmt = '#,##0.00 €';
  ws1.getCell(totalRow, 5).value = { formula: `SUM(E5:E${totalRow - 1})` };
  ws1.getCell(totalRow, 6).value = { formula: `SUM(F5:F${totalRow - 1})` }; ws1.getCell(totalRow, 6).numFmt = '#,##0.00 €';
  ws1.getCell(totalRow, 7).value = { formula: `IFERROR((D${totalRow}-F${totalRow})/F${totalRow},"n/a")` }; ws1.getCell(totalRow, 7).numFmt = '0.0%';
  for (let c = 1; c <= 7; c++) {
    const cell = ws1.getCell(totalRow, c);
    cell.font = { name: "Arial", bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY_MED } };
    cell.border = bordureToutes;
  }
  const noteRow = totalRow + 2;
  ws1.getCell(noteRow, 1).value = "CA HT tel qu'enregistré dans les commandes (2025 année complète ; 2026 du 1er janvier au " + DMAX.split("-").reverse().join("/") + "). L'évolution compare 2026 à la MÊME période de 2025 (du 1er janvier au même jour), pas à l'année complète. Prix TTC (onglet suivant) = Prix HT × 1,20 (TVA standard France — hypothèse, à ajuster si un taux différent s'applique).";
  ws1.getCell(noteRow, 1).font = { name: "Arial", size: 9, italic: true, color: { argb: "FF666666" } };
  ws1.mergeCells(noteRow, 1, noteRow, 7);
  ws1.columns = [{ width: 22 }, { width: 16 }, { width: 10 }, { width: 16 }, { width: 10 }, { width: 18 }, { width: 18 }];

  // ---- Onglet 2 : Répartition par canal ----
  const ws2 = wb.addWorksheet("Répartition par canal");
  titrePage(ws2, "RÉPARTITION DES VENTES PAR CANAL", "Détail marketplace × produit × année — Prix HT et TTC (TVA 20%)", 6);
  const headers2 = ["Produit", "Année", "Marketplace", "CA HT", "Quantité", "Prix HT moy.", "Prix TTC moy."];
  headers2.forEach((h, i) => { ws2.getCell(4, i + 1).value = h; });
  styleEntete(ws2, 4, 7);
  let row2 = 5;
  donnees.forEach((d) => {
    const debut = row2;
    const trie = [...d.detailCanal].sort((a, b) => a.annee - b.annee || b.caHt - a.caHt);
    trie.forEach((det, j) => {
      ws2.getCell(row2, 1).value = d.produit;
      ws2.getCell(row2, 2).value = det.annee;
      ws2.getCell(row2, 3).value = det.marketplace;
      ws2.getCell(row2, 4).value = Math.round(det.caHt * 100) / 100; ws2.getCell(row2, 4).numFmt = '#,##0.00 €';
      ws2.getCell(row2, 5).value = det.qte;
      ws2.getCell(row2, 6).value = Math.round(det.prixHt * 100) / 100; ws2.getCell(row2, 6).numFmt = '#,##0.00 €';
      ws2.getCell(row2, 7).value = Math.round(det.prixTtc * 100) / 100; ws2.getCell(row2, 7).numFmt = '#,##0.00 €';
      if (j % 2 === 1) for (let c = 1; c <= 7; c++) ws2.getCell(row2, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY_LIGHT } };
      for (let c = 1; c <= 7; c++) ws2.getCell(row2, c).border = bordureToutes;
      row2++;
    });
    ws2.getCell(row2, 1).value = `Sous-total ${d.produit}`;
    ws2.getCell(row2, 4).value = { formula: `SUM(D${debut}:D${row2 - 1})` }; ws2.getCell(row2, 4).numFmt = '#,##0.00 €';
    ws2.getCell(row2, 5).value = { formula: `SUM(E${debut}:E${row2 - 1})` };
    for (let c = 1; c <= 7; c++) {
      const cell = ws2.getCell(row2, c);
      cell.font = { name: "Arial", bold: true };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: GREY_MED } };
      cell.border = bordureToutes;
    }
    row2 += 2;
  });
  ws2.columns = [{ width: 18 }, { width: 8 }, { width: 16 }, { width: 14 }, { width: 10 }, { width: 13 }, { width: 13 }];

  // ---- Onglet 3 : Évolution mensuelle ----
  const ws3 = wb.addWorksheet("Évolution mensuelle");
  titrePage(ws3, "ÉVOLUTION MENSUELLE DES VENTES (CA HT)", "2024 · 2025 · 2026 — par produit", 13);
  let row3 = 4;
  donnees.forEach((d) => {
    ws3.getCell(row3, 1).value = d.produit;
    ws3.getCell(row3, 1).font = { name: "Arial", size: 12, bold: true, color: { argb: ORANGE_HEX } };
    row3++;
    ws3.getCell(row3, 1).value = "Année";
    MOIS.forEach((m, i) => { ws3.getCell(row3, 2 + i).value = m; });
    styleEntete(ws3, row3, 13);
    row3++;
    [2024, 2025, 2026].forEach((annee) => {
      ws3.getCell(row3, 1).value = String(annee);
      d.mensuel[annee].forEach((v, i) => {
        const c = ws3.getCell(row3, 2 + i);
        c.value = Math.round(v * 100) / 100; c.numFmt = '#,##0 €'; c.border = bordureToutes;
      });
      ws3.getCell(row3, 1).border = bordureToutes;
      row3++;
    });
    row3 += 1;
  });
  ws3.columns = [{ width: 14 }, ...Array(12).fill({ width: 10 })];

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `Extraction_${produits.length === 1 ? produits[0].replace(/\s+/g, "_") : "produits"}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// somme mensuelle (précision au mois). `cutSource` = { année: montant } : ventes de l'année N-1 sur la MÊME fenêtre
// que le mois partiel de l'année en cours (du 1er au jour de DMAX). Pour une comparaison N-1, le mois
// correspondant est lu dans cette coupe et non en mois entier — sinon un octobre 2026 partiel (3 jours)
// serait comparé à un octobre 2025 complet (31 jours) et afficherait une chute artificielle.
function sumMonthSnapped(monthlySource, dateFrom, dateTo, cutSource) {
  if (!monthlySource) return 0;
  let total = 0;
  const d0 = new Date(dateFrom), d1 = new Date(dateTo);
  const dmY = Number(DMAX.slice(0, 4)), dmM = Number(DMAX.slice(5, 7)) - 1;
  for (let d = new Date(d0.getFullYear(), d0.getMonth(), 1); d <= d1; d.setMonth(d.getMonth() + 1)) {
    const y = d.getFullYear(), m = d.getMonth();
    total += (cutSource && y === dmY - 1 && m === dmM && cutSource[y] != null) ? cutSource[y] : (monthlySource[y]?.[m] || 0);
  }
  return total;
}
// n1 = true : appel pour la période N-1 (applique la coupe à date identique de DATA.cut_n1)
function sumRangeForMp(mp, dateFrom, dateTo, n1) { return sumMonthSnapped(DATA.gf.monthly_total_by_mp[mp], dateFrom, dateTo, n1 ? DATA.cut_n1?.mp?.[mp] : null); }

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
    <nav ref={containerRef} className="no-print md:hidden fixed bottom-0 left-0 right-0 z-30 flex items-stretch liquid-glass backdrop-blur-xl"
      style={{ background: "rgba(16,15,13,0.92)", borderTop: `1px solid ${PANEL_BORDER}`, paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
      <div className="absolute top-0 rounded-b-full" style={{
        left: indicator.left, width: indicator.width, height: 2.5, background: accent.primary,
        boxShadow: `0 1px 8px ${accent.primary}aa`, transition: "left 0.35s cubic-bezier(.22,1,.36,1), width 0.35s cubic-bezier(.22,1,.36,1), background 0.35s ease",
      }} />
      {NAV.map((n) => {
        const active = tab === n.id;
        return (
          <button key={n.id} ref={(el) => (btnRefs.current[n.id] = el)} onClick={() => onChange(n.id)} aria-label={t[n.labelKey]} title={t[n.labelKey]}
            className="btn-lift flex-1 flex items-center justify-center py-3 min-w-0"
            style={{ color: active ? accent.primary : FAINT }}>
            <n.icon size={20} strokeWidth={active ? 2.3 : 1.8} />
          </button>
        );
      })}
    </nav>
  );
}

// ===== ChatRouter — écran de transition entre le déverrouillage et le
// dashboard. Pas d'IA : reconnaissance de mots-clés locale (matchChatIntent),
// aucun appel réseau. Volontairement minimaliste au premier regard (un champ,
// quelques suggestions) mais avec un vrai soin d'animation à l'entrée, à la
// confirmation et à la sortie, pour ne pas donner l'impression d'un simple
// écran de chargement. =====
// ===== ASSISTANT IA — DÉBUT ====================================================
// Outils exécutés côté navigateur sur les données déjà embarquées dans l'app.
// Le modèle (appelé via le relais serveur /api/chat, qui garde la clé API
// secrète) n'a AUCUNE donnée en dur : il interroge ces outils, donc chaque
// chiffre cité vient d'un calcul réel et non de sa mémoire. Les schémas des
// outils vivent côté serveur (api/chat.mjs) : tout outil ajouté ici doit y
// être déclaré avec exactement le même nom.
const IA_FAMILLES = [...new Set(SKU_FAMILLE)];
const IA_MP_SYNONYMES = {
  "amazon": "Amazon FR", "amazon fr": "Amazon FR", "leroy merlin": "Leroy Merlin", "leroy": "Leroy Merlin", "lm": "Leroy Merlin",
  "cdiscount": "Cdiscount", "manomano": "ManoMano", "mano mano": "ManoMano", "castorama": "Castorama",
  "site web": "Site Web", "site internet": "Site Web", "site": "Site Web", "bricoman": "Leroy Merlin", "bricomarche": "Bricomarché",
  "maxeda": "Maxeda", "boulanger": "Boulanger", "darty": "Darty", "fnac darty": "Darty", "bol.com": "Bol.com", "bol": "Bol.com",
  "brico bravo": "Brico Bravo", "worten": "Worten", "but": "But", "autre": "Autre",
};
const iaNorm = (s) => normaliserTexte(String(s ?? "")).trim();
const iaCompact = (s) => iaNorm(s).replace(/[^a-z0-9]/g, "");
const iaR0 = (x) => Math.round(x);
const iaR2 = (x) => Math.round(x * 100) / 100;

function iaResoudreMp(q) {
  const n = iaNorm(q);
  if (!n) return null;
  const exact = SKU_MPS.find((m) => iaNorm(m) === n);
  if (exact) return exact;
  if (IA_MP_SYNONYMES[n]) return IA_MP_SYNONYMES[n];
  const cle = Object.keys(IA_MP_SYNONYMES).sort((a, b) => b.length - a.length).find((k) => k.length > 3 && n.includes(k));
  return cle ? IA_MP_SYNONYMES[cle] : (SKU_MPS.find((m) => iaNorm(m).includes(n)) || null);
}
function iaResoudreProduits(q) {
  const n = iaNorm(q);
  if (!n) return [];
  const exact = SKU_PRODUIT.filter((p) => iaNorm(p) === n);
  if (exact.length) return exact;
  const mots = n.split(/\s+/).filter(Boolean);
  return SKU_PRODUIT.filter((p) => { const pn = iaNorm(p); return mots.every((m) => pn.includes(m)); }).slice(0, 40);
}
function iaResoudreFamille(q) {
  const n = iaNorm(q);
  if (!n) return null;
  const syn = { deshumidificateur: "Déshum", deshum: "Déshum", radiateur: "Fixe heater", "radiateur fixe": "Fixe heater", "seche-serviettes": "Sèche-serviettes", "seche serviettes": "Sèche-serviettes", ventilateur: "Ventil", soufflant: "Soufflant", mobile: "Mobile", autre: "Autre" };
  return IA_FAMILLES.find((f) => iaNorm(f) === n) || syn[n] || IA_FAMILLES.find((f) => iaNorm(f).includes(n) || n.includes(iaNorm(f))) || null;
}
const iaUnSeulProduit = (q) => {
  const noms = iaResoudreProduits(q);
  if (noms.length === 1) return { nom: noms[0] };
  return { erreur: noms.length ? "Plusieurs produits correspondent : précise-en un seul" : `Produit introuvable : ${q}`, candidats: noms.slice(0, 15), astuce: "utilise search_products pour retrouver le nom exact" };
};
// fiche catalogue : nom exact, sinon mêmes mots dans un autre ordre / une autre casse
// (ex. « ARIA NOIR 500W » ↔ « Aria 500W Noir ») — jamais une approximation floue
const iaTokens = (s) => iaNorm(s).split(/\s+/).filter(Boolean).sort().join(" ");
function iaFiche(nom) {
  if (PRODUCT_CATALOG[nom]) return PRODUCT_CATALOG[nom];
  const cle = iaTokens(nom);
  const k = Object.keys(PRODUCT_CATALOG).find((c) => iaTokens(c) === cle);
  return k ? PRODUCT_CATALOG[k] : null;
}
let iaCacheCa2026 = null;
function iaCa2026() {
  if (!iaCacheCa2026) {
    iaCacheCa2026 = new Map();
    SKU_MONTHLY.forEach(([pi, , an, , c]) => { if (an === 2026) iaCacheCa2026.set(pi, (iaCacheCa2026.get(pi) || 0) + c); });
  }
  return iaCacheCa2026;
}
const iaMois = (p) => {
  const m1 = Math.min(12, Math.max(1, Number(p.month_from) || 1));
  return [m1, Math.min(12, Math.max(m1, Number(p.month_to) || 12))];
};
const iaSerieAn = (obj) => Object.fromEntries(Object.entries(obj || {}).map(([an, arr]) => [an, arr.map(iaR0)]));
// N-1 À DATE IDENTIQUE pour un produit (et éventuellement une marketplace) : mois complets 2025 avant le mois en
// cours + coupe SKU_CUT_N1 (1er → jour de DMAX) du mois en cours — jamais l'année 2025 complète
function iaN1MemePeriode(pi, mi = null) {
  let ca = 0, qte = 0;
  for (const r of SKU_MONTHLY) {
    if (r[0] !== pi || r[2] !== 2025 || r[3] > MOIS_EN_COURS_IDX || (mi !== null && r[1] !== mi)) continue;
    ca += r[4]; qte += r[5] || 0;
  }
  for (const r of SKU_CUT_N1) {
    if (r[0] !== pi || (mi !== null && r[1] !== mi)) continue;
    ca += r[2]; qte += r[3] || 0;
  }
  return { ca, qte };
}
// idem pour une ligne de DATA.price_tracking (produit × marketplace) : r[6] = [CA, qté] du 1er au jour de DMAX en 2025
function ptMemePeriode25(r) {
  let ca = 0, qte = 0;
  for (let i = 0; i < MOIS_EN_COURS_IDX; i++) { ca += (r[2][i] || 0) * (r[4][i] || 0); qte += r[4][i] || 0; }
  if (r[6]) { ca += r[6][0] || 0; qte += r[6][1] || 0; }
  return { ca, qte };
}

const IA_OUTILS = {
  query_sales: (p) => {
    const annee = Number(p.year) || 2026;
    const [m1, m2] = iaMois(p);
    const groupBy = ["marketplace", "product", "month", "family"].includes(p.group_by) ? p.group_by : "none";
    const triQte = p.sort_by === "qte";
    const topN = Math.min(30, Math.max(1, Number(p.top_n) || 10));
    let mpIdx = null, mpNom = null;
    if (p.marketplace) {
      mpNom = iaResoudreMp(p.marketplace);
      if (!mpNom) return { erreur: `Marketplace inconnue : ${p.marketplace}`, marketplaces_valides: SKU_MPS };
      mpIdx = SKU_MPS.indexOf(mpNom);
    }
    let idxProduits = null, noms = null;
    if (p.product) {
      noms = iaResoudreProduits(p.product);
      if (!noms.length) return { erreur: `Produit introuvable : ${p.product}`, astuce: "utilise search_products" };
      idxProduits = new Set(noms.map((n) => SKU_PRODUIT.indexOf(n)));
    }
    let famille = null;
    if (p.family) {
      famille = iaResoudreFamille(p.family);
      if (!famille) return { erreur: `Famille inconnue : ${p.family}`, familles_valides: IA_FAMILLES };
    }
    const acc = new Map();
    let ca = 0, qte = 0, lignes = 0;
    for (const [pi, mi, an, mo, c, q] of SKU_MONTHLY) {
      if (an !== annee || mo < m1 || mo > m2) continue;
      if (mpIdx !== null && mi !== mpIdx) continue;
      if (idxProduits && !idxProduits.has(pi)) continue;
      if (famille && SKU_FAMILLE[pi] !== famille) continue;
      ca += c; qte += q || 0; lignes++;
      if (groupBy !== "none") {
        const cle = groupBy === "marketplace" ? SKU_MPS[mi] : groupBy === "product" ? SKU_PRODUIT[pi] : groupBy === "family" ? SKU_FAMILLE[pi] : mo;
        const a = acc.get(cle) || { ca: 0, qte: 0 };
        a.ca += c; a.qte += q || 0; acc.set(cle, a);
      }
    }
    const res = {
      filtres: { annee, mois: `${m1} à ${m2}`, marketplace: mpNom, famille, produits: noms ? (noms.length <= 5 ? noms : `${noms.length} produits correspondants`) : null },
      ca_ht: iaR0(ca), quantite: iaR0(qte), prix_moyen_ht: qte > 0 ? iaR2(ca / qte) : null,
    };
    if (!lignes) res.note = `Aucune vente pour ces filtres (années présentes dans le détail : ${[...new Set(SKU_MONTHLY.map((r) => r[2]))].sort().join(", ")}).`;
    if (groupBy !== "none") {
      let g = [...acc.entries()].map(([cle, v]) => ({ cle, ca_ht: iaR0(v.ca), quantite: iaR0(v.qte) }));
      if (groupBy === "month") g = g.sort((a, b) => a.cle - b.cle).map((x) => ({ ...x, cle: DATA.mois_labels[x.cle - 1] }));
      else g = g.sort((a, b) => (triQte ? b.quantite - a.quantite : b.ca_ht - a.ca_ht)).slice(0, topN);
      res.groupes = g;
    }
    return res;
  },

  get_kpis: () => {
    const c = DATA.total_yoy_comparable, plan = planAttenduAuJour(DMAX), an25 = (DATA.monthly_total["2025"] || []).reduce((a, b) => a + b, 0);
    return {
      donnees_jusqu_au: DMAX,
      source: "Shopify uniquement (marketplaces BESTHERM + site bestherm.fr), actualisé chaque matin : tous les chiffres en sont recalculés. La publicité, la concurrence et les objectifs du plan ne viennent pas de Shopify.",
      note: "CA en € HT. 2026 = année en cours, du 1er janvier à la date indiquée (le mois en cours est partiel). Toutes les évolutions vs 2025 sont calculées À DATE IDENTIQUE (1er janvier → même jour en 2025), jamais contre l'année 2025 complète.",
      ca_2026_ht: iaR0(DATA.kpi.ca_total_2026), quantite_2026: DATA.kpi.qte_total_2026, panier_moyen_2026: DATA.kpi.panier_moyen_2026,
      ca_2025_meme_periode_ht: iaR0(c["2025"]), evolution_totale_vs_2025_meme_periode_pct: c["2025"] ? iaR2(((c["2026"] - c["2025"]) / c["2025"]) * 100) : null,
      ca_2025_annee_complete_ht: iaR0(an25),
      objectif_annuel: DATA.kpi.objectif_annuel_total, pct_objectif_atteint: DATA.kpi.pct_objectif_atteint,
      plan_2026_a_date: { semaine_excel: excelWeekOf(DMAX), objectif_cumule_attendu_ht: iaR0(plan), pct_objectif_attendu: iaR2((plan / OBJECTIF_2026.annuel) * 100), ecart_ca_ht: iaR0(DATA.kpi.ca_total_2026 - plan), ecart_points: iaR2(DATA.kpi.pct_objectif_atteint - (plan / OBJECTIF_2026.annuel) * 100) },
      marketplaces: DATA.mp_vs_objectif.map((m) => ({ marketplace: m.marketplace, ca_2026: iaR0(m.ca), ca_2025_meme_periode: iaR0(m.ca_2025), evolution_vs_2025_pct: m.yoy_pct, objectif: m.objectif, pct_objectif: m.pct_objectif })),
      ca_mensuel_par_annee: iaSerieAn(DATA.monthly_total), mois: DATA.mois_labels,
      meilleur_produit_2026: DATA.best_seller_2026,
      meilleur_produit_2025: { produit: DATA.best_seller_2025.produit, ca_meme_periode: DATA.best_seller_2025.ca, ca_annee_complete: DATA.best_seller_2025.annee },
    };
  },

  get_brands: (p) => {
    const cle = iaCompact(p.brand || "");
    const marques = Object.keys(DATA.brand_yoy).filter((m) => !cle || iaCompact(m).includes(cle) || cle.includes(iaCompact(m)));
    if (!marques.length) return { erreur: `Marque inconnue : ${p.brand}`, marques_valides: Object.keys(DATA.brand_yoy) };
    const mp = p.marketplace ? iaResoudreMp(p.marketplace) : null;
    return {
      note: "CA € HT par marque. L'évolution compare 2026 (du 1er janvier à la dernière donnée) à la MÊME période de 2025, pas à l'année 2025 complète (ca_2025_annee_complete, donné pour mémoire).", marketplace: mp,
      marques: marques.map((m) => {
        const y = DATA.brand_yoy[m];
        return {
          marque: m, ca_2026: iaR0(y["2026"]), ca_2025_meme_periode: iaR0(y["2025"]), ca_2025_annee_complete: iaR0(y["2025_annee"]),
          evolution_vs_2025_meme_periode_pct: y["2025"] > 0 ? iaR2(((y["2026"] - y["2025"]) / y["2025"]) * 100) : null,
          ca_mensuel: iaSerieAn(DATA.monthly_by_brand[m]),
          ...(mp && DATA.gf.brand_by_mp_month[mp] && DATA.gf.brand_by_mp_month[mp][m] ? { ca_mensuel_2026_sur_marketplace: DATA.gf.brand_by_mp_month[mp][m].map(iaR0) } : {}),
        };
      }),
    };
  },

  get_marketplace_profile: (p) => {
    const mp = iaResoudreMp(p.marketplace);
    const gf = DATA.gf;
    if (!mp) return { erreur: `Marketplace inconnue : ${p.marketplace}`, marketplaces_valides: Object.keys(gf.qte_by_mp) };
    const mv = DATA.mp_vs_objectif.find((m) => m.marketplace === mp);
    return {
      marketplace: mp, note: "evolution_vs_2025_pct = 2026 vs la MÊME période de 2025 (1er janvier → même jour)", ca_2026: mv ? iaR0(mv.ca) : null, ca_2025_meme_periode: mv ? iaR0(mv.ca_2025) : null, evolution_vs_2025_pct: mv ? mv.yoy_pct : null,
      objectif_annuel: mv ? mv.objectif : null, pct_objectif: mv ? mv.pct_objectif : null,
      quantite_2026: gf.qte_by_mp[mp] ?? null, panier_moyen: gf.panier_moyen_mp[mp] ?? null,
      meilleur_produit: gf.best_by_mp[mp] ?? null, top_produits: (gf.top_products_by_mp[mp] || []).slice(0, 8),
      ca_mensuel_par_annee: iaSerieAn(gf.monthly_total_by_mp[mp]),
      ca_mensuel_2026_par_marque: gf.brand_by_mp_month[mp] ? Object.fromEntries(Object.entries(gf.brand_by_mp_month[mp]).map(([m, arr]) => [m, arr.map(iaR0)])) : null,
    };
  },

  get_objectives: (p) => {
    const sem = excelWeekOf(DMAX), ca = DATA.kpi.ca_total_2026, attendu = planAttenduAuJour(DMAX), mois26 = DATA.monthly_total[2026] || [];
    const nbSem = Math.min(12, Math.max(1, Number(p.last_weeks) || 6));
    const joursSem = new Date(DMAX + "T00:00:00Z").getUTCDay() + 1; // jours écoulés de la semaine en cours (dimanche = 1 … samedi = 7)
    const hebdo = OBJECTIF_2026.hebdo.filter(([w]) => w > sem - nbSem && w <= sem).map(([w, obj, q]) => {
      const tw = WEEKLY_TOTALS.find((x) => x[0] === w);
      const partielle = w === sem && joursSem < 7;
      const objP = partielle ? (obj * joursSem) / 7 : obj;
      return { semaine: w, du_au: excelWeekRange(w), ...(partielle ? { partielle: true, jours_ecoules: joursSem, objectif_ca_ht_au_prorata: iaR0(objP) } : {}), objectif_ca_ht: obj, objectif_quantite: q, ca_ht_realise: tw ? iaR0(tw[1]) : null, quantite_realisee: tw ? iaR0(tw[2]) : null, pct_objectif: tw && objP ? iaR2((tw[1] / objP) * 100) : null };
    });
    const mensuel = OBJECTIF_2026.mensuel.map((obj, i) => ({
      mois: DATA.mois_labels[i], objectif_ca_ht: obj, objectif_quantite: OBJECTIF_2026.mensuel_qte[i],
      ca_ht_realise: i <= MOIS_EN_COURS_IDX ? iaR0(mois26[i] || 0) : null, pct_objectif: i <= MOIS_EN_COURS_IDX && obj ? iaR2(((mois26[i] || 0) / obj) * 100) : null,
      statut: i < MOIS_EN_COURS_IDX ? "terminé" : i === MOIS_EN_COURS_IDX ? "en cours (partiel)" : "à venir",
    }));
    return {
      note: "Plan officiel 2026 : objectif annuel 15 M€ HT réparti par mois et par semaine (semaines Excel dimanche→samedi, semaine 1 = 1er au 3 janvier). Le plan est très chargé en fin d'année : pour savoir si on est en avance ou en retard, compare à plan_a_date, pas à une règle de trois. Les objectifs par marketplace et par pays sont indicatifs : ils ne se somment pas exactement à l'objectif annuel.",
      donnees_jusqu_au: DMAX, semaine_en_cours: sem, semaine_en_cours_partielle: joursSem < 7,
      note_semaine_en_cours: joursSem < 7 ? `La semaine ${sem} est PARTIELLE (${joursSem} jour(s) sur 7, jusqu'au ${DMAX}) : son pct_objectif est calculé sur l'objectif au prorata des jours écoulés, pas sur la semaine entière.` : null,
      objectif_annuel: OBJECTIF_2026.annuel, ca_2026_ht: iaR0(ca), pct_objectif_atteint: iaR2((ca / OBJECTIF_2026.annuel) * 100),
      plan_a_date: { objectif_cumule_attendu_ht: iaR0(attendu), pct_objectif_attendu: iaR2((attendu / OBJECTIF_2026.annuel) * 100), ecart_ca_ht: iaR0(ca - attendu), ecart_points: iaR2(((ca - attendu) / OBJECTIF_2026.annuel) * 100), couverture_du_plan_pct: attendu ? iaR2((ca / attendu) * 100) : null },
      mensuel, dernieres_semaines: hebdo,
      par_marketplace: DATA.mp_vs_objectif.map((m) => ({ marketplace: m.marketplace, objectif_annuel: m.objectif, ca_2026: iaR0(m.ca), pct_objectif: m.pct_objectif })),
      par_pays: Object.entries(PAYS_OBJECTIF).map(([pays, o]) => ({ pays, objectif_annuel: o })),
    };
  },

  get_ads: (p) => {
    const cle = p.marketplace ? iaCompact(p.marketplace) : null;
    const lignes = DATA.ads.filter((a) => !cle || iaCompact(a.marketplace).includes(cle));
    if (!lignes.length) return { erreur: `Aucune donnée ads pour : ${p.marketplace}`, marketplaces_ads: DATA.ads.map((a) => a.marketplace) };
    const spend = lignes.reduce((s, a) => s + (a.spend || 0), 0), ca = lignes.reduce((s, a) => s + (a.ca_genere || 0), 0);
    return {
      note: "Totaux cumulés 2026 par marketplace issus du fichier « Dépenses budget marketing 2026 – year to date ». Au dernier import (7 octobre 2026), ce fichier ne contient des dépenses que de janvier à juin (juillet→décembre vides) : les % de budget consommé sont donc sous-estimés par rapport à la date du jour, et ces dépenses ne se comparent pas au CA total jusqu'au début octobre. Aucun détail mensuel n'est disponible dans cet outil.",
      lignes: lignes.map((a) => ({ marketplace: a.marketplace, depense: iaR0(a.spend), ca_genere: iaR0(a.ca_genere), roas: a.roas, acos_pct: a.acos, budget_annuel: a.budget_annuel, pct_budget_utilise: a.pct_budget })),
      total: { depense: iaR0(spend), ca_genere: iaR0(ca), roas: spend > 0 ? iaR2(ca / spend) : null, acos_pct: ca > 0 ? iaR2((spend / ca) * 100) : null },
      ...(cle ? {} : { par_pays: DATA.country_ads }),
    };
  },

  get_prices: (p) => {
    const noms = iaResoudreProduits(p.product);
    if (!noms.length) return { erreur: `Produit introuvable : ${p.product}`, astuce: "utilise search_products" };
    if (noms.length > 6) return { erreur: "Trop de produits correspondent : précise-en un", candidats: noms.slice(0, 15) };
    const mp = p.marketplace ? iaResoudreMp(p.marketplace) : null;
    if (p.marketplace && !mp) return { erreur: `Marketplace inconnue : ${p.marketplace}`, marketplaces_valides: SKU_MPS };
    const moy = (prix, qte) => { let s = 0, q = 0; prix.forEach((x, i) => { if (x && qte[i]) { s += x * qte[i]; q += qte[i]; } }); return q > 0 ? iaR2(s / q) : null; };
    const somme = (a) => a.reduce((s, x) => s + (x || 0), 0);
    const lignes = DATA.price_tracking.filter((r) => noms.includes(r[0]) && (!mp || r[1] === mp))
      .map((r) => { const dernier = [...r[3]].reverse().find((x) => x); return {
        produit: r[0], marketplace: r[1], dernier_prix_2026: dernier ? iaR2(dernier) : null,
        prix_moyen_2026: moy(r[3], r[5]), prix_moyen_2025: moy(r[2], r[4]),
        quantite_2026: somme(r[5]), quantite_2025_meme_periode: ptMemePeriode25(r).qte, quantite_2025_annee_complete: somme(r[4]), prix_2026_par_mois: r[3].map((x) => (x ? iaR2(x) : null)),
      }; })
      .sort((a, b) => b.quantite_2026 - a.quantite_2026).slice(0, 12);
    if (!lignes.length) return { erreur: "Aucun prix relevé pour cette combinaison" };
    return { note: "Prix HT constatés (CA HT ÷ quantité). Pour le TTC, ajouter 20 % de TVA. Pour comparer les volumes avec 2026 (du 1er janvier à la dernière donnée), utilise quantite_2025_meme_periode, pas l'année complète.", lignes };
  },

  get_elasticity: (p) => {
    const noms = iaResoudreProduits(p.product);
    if (!noms.length) return { erreur: `Produit introuvable : ${p.product}`, astuce: "utilise search_products" };
    const mp = p.marketplace ? iaResoudreMp(p.marketplace) : null;
    if (p.marketplace && !mp) return { erreur: `Marketplace inconnue : ${p.marketplace}`, marketplaces_valides: SKU_MPS };
    const lignes = ELASTICITE_DATA.filter((r) => noms.includes(r[0]) && (!mp || r[1] === mp))
      .sort((a, b) => (b[8] || 0) - (a[8] || 0)).slice(0, 10)
      .map((r) => ({ produit: r[0], marketplace: r[1], elasticite: r[2], r2: r[3], semaines_observees: r[4], fiable: !!r[7], prix_moyen: r[6], quantite_hebdo_moyenne: r[8], prix_min: r[9], prix_max: r[10] }));
    if (!lignes.length) return { erreur: "Pas d'élasticité calculée (historique de prix trop court ou trop stable)" };
    return { lecture: "Élasticité négative : quand le prix baisse, les volumes montent. |élasticité| > 1 : une baisse de prix augmente aussi le CA ; < 1 : elle le réduit. fiable=false : estimation fragile.", lignes };
  },

  simulate_price: (p) => {
    const r = iaUnSeulProduit(p.product);
    if (r.erreur) return r;
    const dp = Number(p.price_change_pct);
    if (!Number.isFinite(dp) || dp <= -100) return { erreur: "price_change_pct doit être un nombre > -100 (ex. -10 pour une baisse de 10 %)" };
    const mp = p.marketplace ? iaResoudreMp(p.marketplace) : null;
    if (p.marketplace && !mp) return { erreur: `Marketplace inconnue : ${p.marketplace}`, marketplaces_valides: SKU_MPS };
    const lignes = ELASTICITE_DATA.filter((e) => e[0] === r.nom && (!mp || e[1] === mp));
    if (!lignes.length) return { erreur: `Pas d'élasticité calculée pour ${r.nom}${mp ? " sur " + mp : ""} (historique de prix insuffisant)` };
    const l = [...lignes].sort((a, b) => (b[7] ? 1 : 0) - (a[7] ? 1 : 0) || (b[8] || 0) - (a[8] || 0))[0];
    const dv = Math.max(-100, l[2] * dp);
    const dca = ((1 + dp / 100) * (1 + dv / 100) - 1) * 100;
    return {
      produit: r.nom, marketplace: l[1], elasticite: l[2], fiable: !!l[7], variation_prix_pct: dp,
      variation_volume_estimee_pct: iaR2(dv), variation_ca_estimee_pct: iaR2(dca),
      methode: "volume = élasticité × variation de prix ; CA = (1+Δprix)×(1+Δvolume)−1. Estimation statistique, pas une garantie.",
      ...(l[7] ? {} : { avertissement: "Élasticité peu fiable (peu de variation de prix ou historique court)." }),
    };
  },

  get_competition: (p) => {
    const cat = p.category ? iaNorm(p.category) : null;
    const mpF = p.marketplace ? iaCompact(p.marketplace) : null;
    const topN = Math.min(10, Math.max(1, Number(p.top_n) || 5));
    const blocs = [];
    for (const [segNom, sv] of Object.entries(COMPETITION_DATA.segments)) {
      for (const [sc, mps] of Object.entries(sv.sous_categories)) {
        if (cat && !iaNorm(sc).includes(cat) && !iaNorm(segNom).includes(cat)) continue;
        for (const [mp, bloc] of Object.entries(mps)) {
          if (mpF && !iaCompact(mp).includes(mpF) && !mpF.includes(iaCompact(mp))) continue;
          blocs.push({
            segment: segNom, sous_categorie: sc, marketplace: mp, confiance: bloc.confiance,
            produits: bloc.produits.slice(0, topN).map((x) => ({ rang: x.rang, produit: x.produit, marque: x.marque, prix: x.prix, prix_avant: x.prix_avant, remise_pct: x.remise, note: x.note, avis: x.avis, vendeur: x.vendeur, bestherm: !!x.est_bestherm })),
          });
        }
      }
    }
    if (!blocs.length) return { erreur: "Aucun relevé concurrent pour ces filtres", sous_categories: [...new Set(Object.values(COMPETITION_DATA.segments).flatMap((s) => Object.keys(s.sous_categories)))] };
    return { date_collecte: COMPETITION_DATA.collecte_date, note: "Meilleures ventes publiques relevées à la main : le rang est celui de la marketplace, pas un CA", blocs: blocs.slice(0, 8) };
  },

  find_ruptures: () => {
    const r = scannerRupturesRapide();
    return { definition: "Produit qui vendait puis n'a aucune vente sur le dernier mois complet (rupture de stock probable, ou fin de vie/référence remplacée)", nombre: r.length, produits: r.slice(0, 20).map((x) => ({ produit: x.produit, mois_consecutifs_sans_vente: x.duree })) };
  },

  get_forecast: (p) => {
    const r = iaUnSeulProduit(p.product);
    if (r.erreur) return r;
    const idx = SKU_PRODUIT.indexOf(r.nom);
    const ca = Array(12).fill(0), qte = Array(12).fill(0);
    SKU_MONTHLY.forEach(([pi, , an, mo, c, q]) => { if (pi === idx && an === 2026) { ca[mo - 1] += c; qte[mo - 1] += q || 0; } });
    const f = buildForecastMensuel(ca, qte);
    const nz = (v) => (v === null || v === undefined ? null : iaR0(v));
    return {
      produit: r.nom, methode: "moyenne des mois réels complets × indice de saisonnalité ; le mois en cours est partiel et jamais compté comme rupture",
      mois_reels_complets: f.nbMoisReels, fiabilite: f.nbMoisReels < 3 ? "fragile (moins de 3 mois de ventes réelles)" : "correcte",
      forecast_annuel_ca_ht: iaR0(f.forecastAnnuel), forecast_annuel_quantite: iaR0(f.forecastAnnuelQte),
      mois: f.parMois.map((m) => ({ mois: DATA.mois_labels[m.i], statut: m.statut, ca_reel: nz(m.reel), ca_estime: nz(m.estime), qte_reelle: nz(m.reelQte), qte_estimee: nz(m.estimeQte) })),
    };
  },

  get_product_info: (p) => {
    const r = iaUnSeulProduit(p.product);
    if (r.erreur) return r;
    const idx = SKU_PRODUIT.indexOf(r.nom);
    const n1 = iaN1MemePeriode(idx);
    let ca25 = 0, ca26 = 0, q26 = 0;
    const parMp = {};
    SKU_MONTHLY.forEach(([pi, mi, an, , c, q]) => {
      if (pi !== idx) return;
      if (an === 2025) ca25 += c;
      if (an === 2026) { ca26 += c; q26 += q || 0; parMp[SKU_MPS[mi]] = (parMp[SKU_MPS[mi]] || 0) + c; }
    });
    const classes = ABC_BY_SKU.filter((x) => x[1] === r.nom).map((x) => x[4]);
    const classe = classes.length ? [...classes].sort((a, b) => classes.filter((x) => x === b).length - classes.filter((x) => x === a).length)[0] : null;
    const f = iaFiche(r.nom);
    return {
      produit: r.nom, famille: SKU_FAMILLE[idx], classe_abc: classe, note_abc: "A = les produits qui font l'essentiel du CA, puis B, C, D décroissant",
      ca_2025_annee_complete: iaR0(ca25), ca_2025_meme_periode: iaR0(n1.ca), ca_2026: iaR0(ca26), quantite_2026: iaR0(q26), quantite_2025_meme_periode: iaR0(n1.qte),
      evolution_ca_vs_2025_meme_periode_pct: n1.ca > 0 ? iaR0(((ca26 - n1.ca) / n1.ca) * 100) : null,
      top_marketplaces_2026: Object.entries(parMp).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([mp, c]) => ({ marketplace: mp, ca: iaR0(c) })),
      fiche: f ? { matiere: f.matiere, garantie_ans: f.garantie, made_in_france: f.madeInFrance, connecte: f.connecte, poids: f.poids, dimensions: f.dimensions } : "pas de fiche dans le catalogue",
    };
  },

  get_countries: (p) => {
    const annee = Number(p.year) || 2026;
    const [m1, m2] = iaMois(p);
    const pays = p.country ? iaNorm(p.country) : null;
    const mp = p.marketplace ? iaResoudreMp(p.marketplace) : null;
    if (p.marketplace && !mp) return { erreur: `Marketplace inconnue : ${p.marketplace}`, marketplaces_valides: SKU_MPS };
    const acc = {};
    PAYS_MONTHLY.forEach(([pa, mk, an, mo, ca]) => {
      if (an !== annee || mo < m1 || mo > m2) return;
      if (pays && !iaNorm(pa).includes(pays)) return;
      if (mp && !iaCompact(mk).includes(iaCompact(mp)) && !iaCompact(mp).includes(iaCompact(mk))) return;
      acc[pa] = (acc[pa] || 0) + ca;
    });
    const total = Object.values(acc).reduce((s, x) => s + x, 0);
    return {
      annee, mois: `${m1} à ${m2}`, total_ca_ht: iaR0(total),
      par_pays: Object.entries(acc).sort((a, b) => b[1] - a[1]).map(([pa, ca]) => ({ pays: pa, ca_ht: iaR0(ca), part_pct: total > 0 ? iaR2((ca / total) * 100) : null, objectif_annuel: PAYS_OBJECTIF[pa] ?? null })),
    };
  },

  get_categories: (p) => {
    const cbm = DATA.category_by_mp;
    const mp = p.marketplace ? iaResoudreMp(p.marketplace) : null;
    if (p.marketplace && !mp) return { erreur: `Marketplace inconnue : ${p.marketplace}`, marketplaces_valides: Object.keys(cbm.categories) };
    const cle = mp && cbm.categories[mp] ? mp : "Toutes";
    return {
      marketplace: cle, note: "CA € HT 2026 par catégorie produit (classification catalogue)",
      categories: (cbm.categories[cle] || []).slice(0, 10), sous_categories: (cbm.souscategories[cle] || []).slice(0, 12),
      couverture_pct: cbm.coverage && typeof cbm.coverage === "object" ? (cbm.coverage[cle] ?? null) : (cbm.coverage ?? null),
    };
  },

  get_basket_pairs: (p) => {
    const noms = p.product ? iaResoudreProduits(p.product) : null;
    if (p.product && !noms.length) return { erreur: `Produit introuvable : ${p.product}`, astuce: "utilise search_products" };
    const paires = BASKET_PAIRS.filter(([a, b]) => !noms || noms.includes(a) || noms.includes(b)).slice(0, 15).map(([a, b, n]) => ({ produit_a: a, produit_b: b, commandes_communes: n }));
    return { note: "Produits achetés ensemble dans une même commande (2026 uniquement)", paires };
  },

  get_unsold_products: (p) => {
    const marque = p.brand ? iaCompact(p.brand) : null;
    const l = CATALOGUE_NON_VENDU.filter(([, m]) => !marque || iaCompact(m).includes(marque));
    return { note: "Produits du catalogue sans aucune vente enregistrée", nombre: l.length, produits: l.map(([nom, m]) => ({ produit: nom, marque: m })) };
  },

  get_weekly: (p) => {
    const derniere = Math.max(...WEEKLY_TOTALS.map((w) => w[0]));
    const sem = Number(p.week) || derniere;
    const tot = WEEKLY_TOTALS.find((w) => w[0] === sem);
    if (!tot) return { erreur: `Semaine ${sem} inconnue`, semaines_disponibles: `1 à ${derniere}` };
    const mp = p.marketplace ? iaResoudreMp(p.marketplace) : null;
    if (p.marketplace && !mp) return { erreur: `Marketplace inconnue : ${p.marketplace}`, marketplaces_valides: SKU_MPS };
    const parMp = WEEKLY_BY_MP.filter((r) => r[0] === sem && (!mp || r[1] === mp)).sort((a, b) => b[2] - a[2]).slice(0, 8).map(([, m, ca, q]) => ({ marketplace: m, ca_ht: iaR0(ca), quantite: iaR0(q) }));
    const top = WEEKLY_BY_PROD.filter((r) => r[0] === sem).sort((a, b) => b[2] - a[2]).slice(0, 8).map(([, pr, ca, q]) => ({ produit: pr, ca_ht: iaR0(ca), quantite: iaR0(q) }));
    const joursSem = new Date(DMAX + "T00:00:00Z").getUTCDay() + 1; // jours écoulés de la dernière semaine (dimanche = 1 … samedi = 7)
    const partielle = sem === excelWeekOf(DMAX) && joursSem < 7;
    return {
      note: `Semaine n°${sem} de 2026 (${excelWeekRange(sem)} ; semaines dimanche→samedi ; dernière semaine disponible : ${derniere}) ; top produits = toutes marketplaces${partielle ? ` ; ATTENTION : semaine PARTIELLE (${joursSem} jour(s) sur 7, jusqu'au ${DMAX}), ne pas la comparer à une semaine complète` : ""}`,
      semaine_partielle: partielle,
      semaine: sem, ca_ht: iaR0(tot[1]), quantite: iaR0(tot[2]), objectif_ca_ht: (OBJECTIF_2026.hebdo.find((x) => x[0] === sem) || [])[1] ?? null, prix_moyen_ht: tot[2] > 0 ? iaR2(tot[1] / tot[2]) : null,
      par_marketplace: parMp, top_produits: top,
      tendance_4_semaines: WEEKLY_TOTALS.filter((w) => w[0] > sem - 4 && w[0] <= sem).map(([s, ca, q]) => ({ semaine: s, ca_ht: iaR0(ca), quantite: iaR0(q), ...(s === excelWeekOf(DMAX) && joursSem < 7 ? { partielle: true, jours_ecoules: joursSem } : {}) })),
    };
  },

  search_products: (p) => {
    let noms = iaResoudreProduits(p.query);
    if (!noms.length) {
      const premier = iaNorm(p.query).split(/\s+/)[0];
      if (premier) noms = SKU_PRODUIT.filter((n) => iaNorm(n).includes(premier)).slice(0, 40);
    }
    if (!noms.length) return { nombre: 0, produits: [], astuce: "Aucun produit ne correspond : essaie un nom de gamme (ex. ARIA, NOVA, FREYA)" };
    const ca = iaCa2026();
    return { nombre: noms.length, produits: noms.map((n) => { const i = SKU_PRODUIT.indexOf(n); return { produit: n, famille: SKU_FAMILLE[i], ca_2026: iaR0(ca.get(i) || 0) }; }).sort((a, b) => b.ca_2026 - a.ca_2026).slice(0, 15) };
  },

  get_seasonality: () => {
    const mois = DATA.mois_labels.map((m, i) => ({ mois: m, indice: SEASONALITY_INDEX[i] }));
    const tri = [...mois].sort((a, b) => b.indice - a.indice);
    return { note: "Indice de saisonnalité structurel (1 = un mois moyen), utilisé pour les prévisions", mois, pic: tri[0], creux: tri[tri.length - 1] };
  },

  proposer_dashboard: (p) => {
    const TABS = ["apercu", "marketplaces", "marques", "prix", "ads", "concurrence", "data"];
    const SOUS = { marques: ["marque", "repartitions", "produits", "classification", "radar", "puissances"], concurrence: ["synthese", "produits", "prix", "comparatif"] };
    const PERIODES = ["mois_courant", "mois_precedent", "annee_courante", "annee_passee"];
    if (!TABS.includes(p.tab)) return { erreur: "tab invalide", tabs_valides: TABS };
    const action = { tab: p.tab };
    if (p.sous_tab && (SOUS[p.tab] || []).includes(p.sous_tab)) action.sousTab = p.sous_tab;
    const mp = p.marketplace ? iaResoudreMp(p.marketplace) : null;
    if (mp) action.mp = mp;
    if (p.recherche && p.tab === "marques") { action.recherche = String(p.recherche).slice(0, 60); action.sousTab = "produits"; }
    if (PERIODES.includes(p.periode)) action.periode = p.periode;
    return { ok: true, action };
  },
};

// boucle de conversation : le navigateur relaie les messages au serveur, exécute
// localement les outils demandés par le modèle et lui renvoie les résultats,
// jusqu'à obtenir une réponse finale (8 tours maximum)
async function demanderAIA({ question, historique = [], lang = "fr", signal, onOutil }) {
  const messages = [...historique, { role: "user", content: question }];
  let action = null;
  for (let tour = 0; tour < 8; tour++) {
    const rep = await fetch("/api/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages, lang }), signal });
    if (!rep.ok) {
      let detail = "";
      try { detail = (await rep.json()).error || ""; } catch { /* corps non JSON */ }
      throw new Error(`relais IA ${rep.status} ${detail}`.trim());
    }
    const data = await rep.json();
    if (!Array.isArray(data.content)) throw new Error("réponse IA invalide");
    messages.push({ role: "assistant", content: data.content });
    if (data.stop_reason !== "tool_use") {
      return { texte: data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim(), action };
    }
    const resultats = [];
    for (const bloc of data.content.filter((b) => b.type === "tool_use")) {
      if (onOutil) onOutil(bloc.name, tour);
      let contenu, erreur = false;
      try {
        const fn = IA_OUTILS[bloc.name];
        if (!fn) throw new Error(`outil inconnu : ${bloc.name}`);
        const res = fn(bloc.input || {});
        if (bloc.name === "proposer_dashboard" && res && res.ok) action = res.action;
        contenu = JSON.stringify(res);
      } catch (e) { contenu = `Erreur : ${e.message}`; erreur = true; }
      if (contenu.length > 9000) contenu = contenu.slice(0, 9000) + "…(résultat tronqué : affine les filtres)";
      resultats.push({ type: "tool_result", tool_use_id: bloc.id, content: contenu, ...(erreur ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: resultats });
  }
  throw new Error("trop d'étapes sans réponse finale");
}
// ===== ASSISTANT IA — FIN ======================================================

// ===== RÉPARTITIONS (page Marques) — pays, marque, type de produit × mois × marketplace ====================
/* Trois découpages du même cube (repartitions.js), en CA HT et en quantités :
   · le graphique empile les entités mois par mois (valeurs ou parts) ; « Autres » regroupe au-delà de six ; une table équivalente est disponible ;
   · le classement donne les deux mesures et sert de filtre : toucher une entité isole son détail dans le tableau du dessous ;
   · le tableau croise marketplace × mois pour l'entité choisie — le montant, ou la part de l'entité dans chaque case (« la répartition
     entre Bestherm et Thomson, par mois et par marketplace ») ; le site web est isolé sous le sous-total des marketplaces ; toucher une
     marketplace filtre le graphique et le classement.
   Le filtre marketplace global verrouille la marketplace du graphique (comme l'onglet Normes & Catégories). Le filtre de dates global ne
   s'applique pas : l'onglet est mensuel, l'année se choisit ici. Aucun chiffre n'est estimé : une quantité absente (pays 2025) est dite telle. */
let REP_CACHE = null;
const REP_HORS_FRANCE = ["France"]; // « hors France » : les marchés étrangers pèsent peu à côté du marché national
const repartitions = () => (REP_CACHE ||= construireRepartitions({ SKU_PRODUIT, SKU_MARQUE, SKU_MPS, SKU_MONTHLY, PRODUCT_TO_CATEGORY, SKU_SOUS_SOUS_FAMILLE, PAYS_MONTHLY }));
const REP_FOND = "#100F0E"; // fond d'une carte (verre sur #0A0908) : séparation des segments empilés et fond des cellules figées
const REP_FOND_ACTIF = "#1F1612"; // ligne choisie (fond d'une carte + 10 % d'orange)
const REP_CHALEUR = "247,82,18"; // rampe séquentielle du tableau : une seule teinte, plus claire et plus saturée quand le montant monte
const repHexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(",");
const repPct = (x) => (x > 0 && x < 0.005 ? "< 1 %" : `${Math.round(x * 100)} %`);
// cellule du tableau : « 1,23 M », « 123 k », « 4,5 k », « 820 » en CA ; entier en quantités ; « — » quand il n'y a rien
function repCellule(v, qte) {
  const x = v * demoFactor;
  if (!(Math.abs(x) >= 0.5)) return "—";
  if (qte) return new Intl.NumberFormat("fr-FR").format(Math.round(x));
  const a = Math.abs(x);
  if (a >= 1e6) return `${(x / 1e6).toFixed(2).replace(".", ",")} M`;
  if (a >= 1e4) return `${Math.round(x / 1e3)} k`;
  if (a >= 1e3) return `${(x / 1e3).toFixed(1).replace(".", ",")} k`;
  return String(Math.round(x));
}
function repAxe(v, qte) {
  const x = v * demoFactor;
  if (!qte) return fmtEURk(v);
  return x >= 1e4 ? `${Math.round(x / 1e3)} k` : x >= 1e3 ? `${(x / 1e3).toFixed(1).replace(".", ",")} k` : String(Math.round(x));
}
function RepSegment({ options, value, onChange, attr, ariaLabel, offTitre }) {
  return (
    <div className="flex items-center gap-0.5 p-0.5 rounded-full max-w-full" role="group" aria-label={ariaLabel} data-rep={attr} style={{ background: PANEL_QUIET, border: `1px solid ${PANEL_BORDER_QUIET}` }}>
      {options.map(([k, lib, off]) => (
        <button key={k} data-k={k} aria-pressed={k === value} disabled={off} title={off ? offTitre : undefined} onClick={() => onChange(k)}
          className="btn-lift text-[11px] font-semibold px-2.5 min-[420px]:px-3 py-1 rounded-full whitespace-nowrap"
          style={{ background: k === value ? `${ORANGE}26` : "transparent", color: k === value ? ORANGE_SOFT : MUTED, opacity: off ? 0.4 : 1 }}>
          {lib}
        </button>
      ))}
    </div>
  );
}
// Grille mois × lignes (tableau du graphique et détail par marketplace). Première colonne figée ; sur petit écran le total reste collé
// au nom (les deux restent visibles pendant le défilement des mois) ; un dégradé à droite signale qu'il reste des colonnes à découvrir.
const REP_L1 = { etroit: 124, large: 176 }; // largeur de la colonne des noms (px) : les noms plus longs sont tronqués (infobulle = nom entier)
function RepGrille({ lignes, moisT, moisL, enCours, libEnCours, libPremiere, libTotal, libMix, fmt, fond, texte, attr, etroit }) {
  const avecMix = lignes.some((l) => l.mix);
  const bord = `1px solid ${PANEL_BORDER_QUIET}`;
  const L1 = etroit ? REP_L1.etroit : REP_L1.large;
  const refDefil = useRef(null);
  const [suite, setSuite] = useState(false); // il reste du contenu à droite
  useEffect(() => { // après chaque rendu : la largeur du contenu change avec la mesure choisie
    const el = refDefil.current;
    if (el) setSuite(el.scrollWidth - el.clientWidth - el.scrollLeft > 6);
  });
  useEffect(() => {
    const el = refDefil.current;
    if (!el) return undefined;
    const maj = () => setSuite(el.scrollWidth - el.clientWidth - el.scrollLeft > 6);
    el.addEventListener("scroll", maj, { passive: true });
    window.addEventListener("resize", maj);
    return () => { el.removeEventListener("scroll", maj); window.removeEventListener("resize", maj); };
  }, []);
  const colTotal = (fondLigne) => (etroit ? { position: "sticky", left: L1, zIndex: 1, background: fondLigne, borderRight: bord } : { borderLeft: bord });
  const entete = (extra) => ({ background: REP_FOND, ...extra });
  const thTotal = (
    <th key="total" scope="col" className="font-semibold py-1.5 text-right whitespace-nowrap" style={{ color: MUTED, paddingLeft: 12, paddingRight: 8, minWidth: 64, ...(etroit ? { ...colTotal(REP_FOND), zIndex: 2 } : colTotal(REP_FOND)) }}>{libTotal}</th>
  );
  const thMois = moisT.map((m, i) => (
    <th key={i} scope="col" title={i === enCours && libEnCours ? `${moisL[i]} · ${libEnCours}` : moisL[i]} className="font-semibold px-1 py-1.5 text-right whitespace-nowrap" style={{ color: i === enCours ? ORANGE_SOFT : MUTED }}>{m}{i === enCours ? " •" : ""}</th>
  ));
  return (
    <div className="relative" data-rep-defil={attr}>
      <div ref={refDefil} className="overflow-x-auto" data-rep={attr}>
        <table className="w-full text-[11px] tabular-nums" style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: avecMix ? 820 : 660 }}>
          <thead>
            <tr>
              <th scope="col" className="text-left font-semibold px-2 py-1.5 whitespace-nowrap" style={entete({ position: "sticky", left: 0, zIndex: 2, color: FAINT, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", minWidth: L1 })}>{libPremiere}</th>
              {etroit && thTotal}
              {thMois}
              {!etroit && thTotal}
              {avecMix && <th scope="col" className="font-semibold pl-3 pr-1 py-1.5 text-left whitespace-nowrap" style={{ color: FAINT, fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase" }}>{libMix}</th>}
            </tr>
          </thead>
          <tbody>
            {lignes.map((l) => {
              const fort = l.kind === "total" || l.kind === "sous";
              const fondLigne = l.actif ? REP_FOND_ACTIF : REP_FOND;
              const haut = fort || l.separe ? bord : "none";
              const nom = <>{l.pastille && <span className="inline-block w-2 h-2 rounded-sm shrink-0" style={{ background: l.pastille }} />}<span className="truncate">{l.lib}</span></>;
              const cellTotal = (
                <td key="total" data-total="1" data-v={Math.round(l.total * 100) / 100} title={texte(l, -1)} className="py-0.5 text-right font-semibold" style={{ paddingLeft: 12, paddingRight: 8, borderTop: haut, color: INK, ...colTotal(fondLigne) }}>{fmt(l.total, l.baseTotal)}</td>
              );
              return (
                <tr key={l.cle} data-rep-ligne={l.cle} data-kind={l.kind || "ligne"}>
                  <th scope="row" className="text-left px-2 py-0.5 whitespace-nowrap font-medium" style={{ position: "sticky", left: 0, zIndex: 1, background: fondLigne, borderTop: haut, boxShadow: l.actif ? `inset 2px 0 0 ${ORANGE}` : "none", color: fort ? INK : l.actif ? ORANGE_SOFT : INK, minWidth: L1 }}>
                    {l.onClick ? (
                      <button type="button" onClick={l.onClick} aria-pressed={!!l.actif} title={l.titre ? `${l.lib} · ${l.titre}` : l.lib} className="btn-lift flex items-center gap-1.5 text-left py-1" style={{ color: "inherit", fontWeight: fort ? 700 : 500, maxWidth: L1 - 16 }}>{nom}</button>
                    ) : (
                      <span title={l.lib} className="flex items-center gap-1.5 py-1" style={{ fontWeight: fort ? 700 : 500, maxWidth: L1 - 16 }}>{nom}</span>
                    )}
                  </th>
                  {etroit && cellTotal}
                  {Array.from(l.mois, (v, i) => (
                    <td key={i} data-mois={i + 1} data-v={Math.round(v * 100) / 100} title={texte(l, i)} className="px-1 py-0.5 text-right" style={{ background: l.actif && !fond ? REP_FOND_ACTIF : fond ? fond(v, l.baseMois ? l.baseMois[i] : 0, l) : "transparent", borderTop: haut, color: v ? INK : FAINT, fontWeight: fort ? 700 : 400 }}>{fmt(v, l.baseMois ? l.baseMois[i] : 0)}</td>
                  ))}
                  {!etroit && cellTotal}
                  {avecMix && <td className="pl-3 pr-1 py-0.5" style={{ borderTop: haut }}>{l.mix}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {suite && <div aria-hidden="true" data-rep="suite" style={{ position: "absolute", top: 0, bottom: 0, right: 0, width: 26, pointerEvents: "none", background: `linear-gradient(90deg, transparent, ${REP_FOND})` }} />}
    </div>
  );
}
function RepartitionsView({ t, lang, globalMp, accent, lent, onLent }) {
  const rep = useMemo(() => repartitions(), []);
  const info = useMemo(() => infoMois(DMAX), []);
  const loc = lang === "zh" ? "zh-CN" : lang;
  const annees = useMemo(() => rep.annees.slice(-2).reverse(), [rep]);
  const [niveau, setNiveau] = useState("categorie"); // type de produit : categorie | sous
  const [mesure, setMesure] = useState("ca"); // ca | qte
  const [an, setAn] = useState(() => (annees.includes(info.an) ? info.an : annees[0]));
  const [mpLocal, setMpLocal] = useState("Toutes"); // marketplace choisie en touchant une ligne du tableau (le filtre global l'emporte)
  const [focus, setFocus] = useState(null); // entité isolée dans le tableau
  const [empile, setEmpile] = useState("valeurs"); // valeurs | parts
  const [affichage, setAffichage] = useState("graphique"); // graphique | tableau
  const [modeM, setModeM] = useState("montant"); // montant | part
  const [horsFrance, setHorsFrance] = useState(false); // découpage par pays seulement
  const [larg, setLarg] = useState(() => (typeof window !== "undefined" ? window.innerWidth : 1280));
  useEffect(() => {
    const f = () => setLarg(window.innerWidth);
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  const etroit = larg < 520;

  const dimId = lent === "type" ? niveau : lent;
  const exclure = lent === "pays" && horsFrance ? REP_HORS_FRANCE : null;
  const qOk = dispoQte(rep, dimId, an);
  const mes = mesure === "qte" && !qOk ? "ca" : mesure; // jamais de quantité inventée : on affiche le CA et on le dit
  const qte = mes === "qte";
  const mpVerrou = globalMp !== "Toutes";
  const scope = mpVerrou ? globalMp : mpLocal;
  const scopeMp = scope === "Toutes" ? null : scope;
  useEffect(() => { setFocus(null); setModeM("montant"); }, [dimId]);

  const V = useMemo(() => repVue(rep, { dim: dimId, an, mesure: mes, mp: scopeMp, exclure }), [rep, dimId, an, mes, scopeMp, exclure]);
  const Vb = useMemo(() => repVue(rep, { dim: dimId, an, mesure: mes === "ca" ? "qte" : "ca", mp: scopeMp, exclure }), [rep, dimId, an, mes, scopeMp, exclure]);
  const autreMesure = useMemo(() => new Map(Vb.ents.map((e) => [e.nom, e.total])), [Vb]);
  const { visibles, autres } = useMemo(() => replier(V.ents), [V]);
  const { couleur, pile } = useMemo(() => attribuerCouleurs(dimId, visibles.map((e) => e.nom)), [dimId, visibles]);
  const entM = focus && rep.dims[dimId].ents.includes(focus) && !(exclure && exclure.includes(focus)) ? focus : null;
  const modeEff = entM ? modeM : "montant";
  const M = useMemo(() => repMatrice(rep, { dim: dimId, an, mesure: mes, ent: entM, exclure }), [rep, dimId, an, mes, entM, exclure]);
  const P = useMemo(() => repParts(rep, { dim: dimId, an, mesure: mes, exclure }), [rep, dimId, an, mes, exclure]);
  const mixC = useMemo(() => attribuerCouleurs(dimId, P.ents.slice(0, NB_SERIES)), [dimId, P]);

  const fmtMois = (opt) => Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, i, 15)).toLocaleDateString(loc, { month: opt, timeZone: "UTC" }));
  const moisAxe = useMemo(() => fmtMois(etroit ? "narrow" : "short"), [loc, etroit]);
  const moisT = useMemo(() => fmtMois("short"), [loc]);
  const moisL = useMemo(() => fmtMois("long"), [loc]);
  const fmtCourt = (iso) => new Date(iso + "T12:00:00").toLocaleDateString(loc, { day: "numeric", month: "short" });
  const enCours = an === info.an && info.partiel ? info.mois - 1 : -1;

  const libelle = (nom) => (nom === AUTRES_PRODUITS ? (dimId === "marque" ? t.rep_marque_inconnue : t.rep_autres_produits) : dimId === "pays" ? translatePays(nom, lang) : dimId === "categorie" || dimId === "sous" ? translateCat(nom, lang) : nom);
  const libMp = (mp) => (mp === SUIVI_SITE ? t.donnees_site : mp === "Autre" ? t.suivi_autres : mp);
  const fmtV = (v) => (qte ? `${fmtNum(v)} ${t.suivi_u}` : fmtEURplain(v));
  const dimLib = { pays: t.rep_pays, marque: t.rep_marque, categorie: t.rep_categorie, sous: t.rep_sous }[dimId];
  const lentLib = { pays: t.rep_pays, marque: t.rep_marque, type: t.rep_type }[lent];
  const tousLib = { pays: exclure ? t.rep_hors_france : t.rep_tous_pays, marque: t.rep_toutes_marques, categorie: t.rep_tous_types, sous: t.rep_tous_types }[dimId];
  const sourceVue = (nom) => (nom === null ? t.rep_autres.replace("{n}", autres ? autres.nb : 0) : libelle(nom));
  const choisirEntite = (nom) => setFocus((cur) => (cur === nom ? null : nom));
  const choisirMp = (mp) => { if (!mpVerrou) setMpLocal((cur) => (cur === mp ? "Toutes" : mp)); };
  const choisirPart = () => { if (!entM && V.ents.length) setFocus(V.ents[0].nom); setModeM("part"); };

  // ---- graphique : empilement fixe (l'ordre suit la palette), « Autres » au sommet
  const series = useMemo(() => [...pile.map((nom, k) => ({ cle: `k${k}`, nom, c: couleur.get(nom) || GRIS })), ...(autres ? [{ cle: "kA", nom: null, c: GRIS }] : [])], [pile, couleur, autres]);
  const donnees = useMemo(() => moisAxe.map((m, i) => {
    const r = { i, mois: m, total: V.totalMois[i], items: [] };
    pile.forEach((nom, k) => {
      const e = visibles.find((x) => x.nom === nom);
      const v = e ? e.mois[i] : 0;
      r[`k${k}`] = v; r.items.push({ nom, v, c: couleur.get(nom) || GRIS });
    });
    if (autres) { r.kA = autres.mois[i]; r.items.push({ nom: null, v: autres.mois[i], c: GRIS }); }
    return r;
  }), [moisAxe, V, pile, visibles, autres, couleur]);
  const focusCle = entM ? (pile.includes(entM) ? `k${pile.indexOf(entM)}` : autres ? "kA" : null) : null;
  const bulle = ({ active, payload }) => {
    if (!active || !payload || !payload.length) return null;
    const r = payload[0].payload;
    const lignes = r.items.filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    return (
      <div style={{ background: "#16140F", border: `1px solid ${PANEL_BORDER}`, borderRadius: 10, padding: "8px 10px", fontSize: 11.5, minWidth: 190 }}>
        <div style={{ color: INK, fontWeight: 600, marginBottom: 5 }}>{moisL[r.i]} {an} · <span className="tabular-nums">{r.total > 0 ? fmtV(r.total) : "—"}</span>{r.i === enCours && <span style={{ color: FAINT, fontWeight: 400 }}> · {t.rep_en_cours_court}</span>}</div>
        <div className="flex flex-col gap-0.5">
          {lignes.map((x) => (
            <div key={x.nom === null ? "autres" : x.nom} className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5" style={{ color: MUTED }}><span className="w-2 h-2 rounded-sm" style={{ background: x.c }} />{sourceVue(x.nom)}</span>
              <span className="tabular-nums font-semibold" style={{ color: INK }}>{fmtV(x.v)} <span style={{ color: FAINT, fontWeight: 400 }}>{repPct(x.v / r.total)}</span></span>
            </div>
          ))}
        </div>
      </div>
    );
  };
  const celles = (cle) => donnees.map((r) => <Cell key={`${cle}${r.i}`} fillOpacity={(focusCle && focusCle !== cle ? 0.25 : 1) * (r.i === enCours ? 0.6 : 1)} />);

  // ---- tableau du graphique : toutes les entités, mois par mois
  const lignesTab = useMemo(() => [
    ...V.ents.map((e) => ({ cle: e.nom, lib: libelle(e.nom), mois: e.mois, total: e.total, pastille: pile.includes(e.nom) ? couleur.get(e.nom) : null, actif: entM === e.nom, onClick: () => choisirEntite(e.nom) })),
    { cle: "__total", kind: "total", lib: t.rep_total, mois: V.totalMois, total: V.total },
  ], [V, pile, couleur, entM, lang]);

  // ---- classement : les deux mesures et la part de la mesure choisie
  const maxPart = V.total > 0 && V.ents.length ? V.ents[0].total / V.total : 0;

  // ---- détail par marketplace
  const mixDe = (mps) => {
    const lignesMix = P.lignes.filter((l) => mps === null || mps.includes(l.mp));
    const visiblesMix = mixC.pile;
    const tot = lignesMix.reduce((s, l) => s + l.total, 0);
    if (!(tot > 0)) return null;
    const vals = visiblesMix.map((nom) => { const k = P.ents.indexOf(nom); return lignesMix.reduce((s, l) => s + (l.v[k] || 0), 0); });
    const reste = tot - vals.reduce((s, v) => s + v, 0);
    const segs = [...visiblesMix.map((nom, k) => ({ nom, v: vals[k], c: mixC.couleur.get(nom) || GRIS })), ...(reste > tot * 0.0005 ? [{ nom: null, v: reste, c: GRIS }] : [])].filter((s) => s.v > 0);
    const titre = segs.map((s) => `${s.nom === null ? t.rep_autres.replace("{n}", Math.max(0, P.ents.length - visiblesMix.length)) : libelle(s.nom)} ${repPct(s.v / tot)}`).join(" · ");
    return (
      <div className="flex items-center" style={{ width: 96, height: 8, gap: 1 }} title={titre} role="img" aria-label={titre}>
        {segs.map((s) => <span key={s.nom === null ? "autres" : s.nom} style={{ flex: `${s.v} 1 0`, minWidth: 2, height: "100%", background: s.c, borderRadius: 1.5 }} />)}
      </div>
    );
  };
  const lignesMp = M.lignes.filter((l) => l.mp !== SUIVI_SITE);
  const ligneSite = M.lignes.find((l) => l.mp === SUIVI_SITE);
  const sommeLignes = (ls) => {
    const o = { mois: new Float64Array(12), baseMois: new Float64Array(12), total: 0, baseTotal: 0 };
    for (const l of ls) { for (let i = 0; i < 12; i++) { o.mois[i] += l.mois[i]; o.baseMois[i] += l.baseMois[i]; } o.total += l.total; o.baseTotal += l.baseTotal; }
    return o;
  };
  const sousTotal = ligneSite && lignesMp.length ? sommeLignes(lignesMp) : null;
  const ligneDe = (l) => ({ cle: l.mp, lib: libMp(l.mp), mois: l.mois, total: l.total, baseMois: l.baseMois, baseTotal: l.baseTotal, actif: scopeMp === l.mp, onClick: mpVerrou ? undefined : () => choisirMp(l.mp), titre: mpVerrou ? undefined : t.rep_astuce_mp, mix: mixDe([l.mp]), mp: l.mp });
  const lignesDetail = [
    ...lignesMp.map(ligneDe),
    ...(sousTotal ? [{ cle: "__sous", kind: "sous", lib: t.rep_marketplaces, ...sousTotal, mix: mixDe(lignesMp.map((l) => l.mp)) }] : []),
    ...(ligneSite ? [{ ...ligneDe(ligneSite), separe: !sousTotal }] : []),
    { cle: "__total", kind: "total", lib: t.rep_total, mois: M.total.mois, total: M.total.total, baseMois: M.total.baseMois, baseTotal: M.total.baseTotal, mix: mixDe(null) },
  ];
  const maxCell = Math.max(1, ...M.lignes.flatMap((l) => Array.from(l.mois)));
  const coulFocus = entM ? (couleur.get(entM) || mixC.couleur.get(entM) || GRIS) : ORANGE;
  const rgbFocus = repHexRgb(coulFocus === GRIS ? "#7C756A" : coulFocus);
  const fondCellule = (v, base, l) => {
    if (l.kind === "total" || l.kind === "sous") return "transparent";
    if (modeEff === "part") return base > 0 && v > 0 ? `rgba(${rgbFocus},${(0.05 + 0.6 * (v / base)).toFixed(3)})` : "transparent";
    return v > 0 ? `rgba(${REP_CHALEUR},${(0.06 + 0.56 * Math.pow(v / maxCell, 0.65)).toFixed(3)})` : "transparent";
  };
  const fmtCase = (v, base) => (modeEff === "part" ? (base > 0 && v > 0 ? repPct(v / base) : "—") : repCellule(v, qte));
  const texteCase = (l, i) => {
    const v = i < 0 ? l.total : l.mois[i], base = i < 0 ? l.baseTotal : l.baseMois[i];
    const quand = i < 0 ? `${an}` : `${moisL[i]} ${an}`;
    return `${l.lib} · ${quand} : ${fmtV(v)}${modeEff === "part" && base > 0 ? ` (${repPct(v / base)})` : ""}`;
  };
  const texteTab = (l, i) => `${l.lib} · ${i < 0 ? an : `${moisL[i]} ${an}`} : ${fmtV(i < 0 ? l.total : l.mois[i])}`;
  const nbEntites = V.ents.length;
  const note = (txt, cle) => <div key={cle} className="flex items-start gap-1.5 text-[10.5px] mt-2" style={{ color: FAINT }} data-rep={cle}><Info size={11} className="shrink-0 mt-[1px]" />{txt}</div>;
  const siteDansPerimetre = scopeMp === null || scopeMp === SUIVI_SITE;

  return (
    <div data-rep="bloc" data-lentille={lent} data-mesure={mes} data-an={an}>
      {/* choix : découpage, niveau (type de produit), mesure, année */}
      <div className="flex items-center gap-x-3 gap-y-2 flex-wrap mb-4" data-rep="commandes">
        <RepSegment attr="lentille" ariaLabel={t.rep_titre} value={lent} onChange={onLent} options={[["pays", t.rep_pays], ["marque", t.rep_marque], ["type", t.rep_type]]} />
        {lent === "pays" && (
          <button type="button" data-rep="hors-france" aria-pressed={horsFrance} onClick={() => setHorsFrance((x) => !x)} className="btn-lift text-[11px] font-semibold px-3 py-1.5 rounded-full whitespace-nowrap inline-flex items-center gap-1.5"
            style={{ background: horsFrance ? `${ORANGE}26` : PANEL_QUIET, color: horsFrance ? ORANGE_SOFT : MUTED, border: `1px solid ${horsFrance ? `${ORANGE}55` : PANEL_BORDER_QUIET}` }}>
            {horsFrance && <Check size={11} />}{t.rep_hors_france}
          </button>
        )}
        {lent === "type" && <RepSegment attr="niveau" ariaLabel={t.rep_type} value={niveau} onChange={setNiveau} options={[["categorie", t.rep_categorie], ["sous", t.rep_sous]]} />}
        <RepSegment attr="mesure" ariaLabel={`${t.rep_ca} / ${t.rep_qte}`} value={mes} onChange={setMesure} offTitre={t.rep_qte_indispo} options={[["ca", t.rep_ca], ["qte", t.rep_qte, !qOk]]} />
        <RepSegment attr="annee" ariaLabel="" value={an} onChange={setAn} options={annees.map((a) => [a, String(a)])} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] gap-5 mb-5">
        {/* évolution mensuelle */}
        <GlassCard className="p-4 sm:p-5 min-w-0" quiet scrollReveal>
          <div className="flex items-start justify-between gap-x-3 gap-y-2 flex-wrap">
            <div className="min-w-0">
              <Eyebrow tone="quiet">{t.rep_evolution} · {lentLib}{lent === "type" ? ` · ${dimLib}` : ""}</Eyebrow>
              <div className="flex items-baseline gap-x-2 gap-y-0.5 flex-wrap">
                <span className="text-[26px] sm:text-[30px] font-semibold tabular-nums leading-none" style={{ color: INK }} data-rep="total" data-valeur={Math.round(V.total * 100) / 100}>{V.total > 0 ? fmtV(V.total) : "—"}</span>
                <span className="text-[11px]" style={{ color: FAINT }}>{an} · {scopeMp === null ? t.rep_toutes : libMp(scopeMp)}</span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {affichage === "graphique" && <RepSegment attr="empile" ariaLabel="" value={empile} onChange={setEmpile} options={[["valeurs", t.rep_valeurs], ["parts", t.rep_parts]]} />}
              <RepSegment attr="affichage" ariaLabel="" value={affichage} onChange={setAffichage} options={[["graphique", t.rep_graphique], ["tableau", t.rep_tableau]]} />
            </div>
          </div>
          {scopeMp !== null && (
            <div className="mt-2">
              {mpVerrou ? (
                <span className="text-[11px] font-semibold inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ color: accent.primary, background: `${accent.primary}18` }} data-rep="filtre-mp"><Lock size={11} /> {libMp(scopeMp)}</span>
              ) : (
                <button type="button" onClick={() => setMpLocal("Toutes")} className="btn-lift text-[11px] font-semibold inline-flex items-center gap-1 pl-2.5 pr-2 py-1 rounded-full" style={{ color: ORANGE_SOFT, background: `${ORANGE}1F`, border: `1px solid ${ORANGE}40` }} data-rep="filtre-mp" title={t.rep_retirer}>
                  {libMp(scopeMp)} <X size={11} />
                </button>
              )}
            </div>
          )}
          {!nbEntites ? (
            <div className="text-[12px] py-8 text-center" style={{ color: FAINT }} data-rep="vide">{t.rep_vide}</div>
          ) : affichage === "graphique" ? (
            <>
              <div className="mt-3 h-[230px] sm:h-[330px]" data-rep="graphique" style={{ cursor: "default" }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={donnees} margin={{ top: 6, right: 6, bottom: 0, left: 0 }} stackOffset={empile === "parts" ? "expand" : "none"} barCategoryGap="14%">
                    <CartesianGrid stroke="rgba(255,255,255,0.06)" vertical={false} />
                    <XAxis dataKey="i" tickFormatter={(i) => moisAxe[i]} tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} interval={0} />
                    <YAxis tick={{ fontSize: 10, fill: MUTED }} axisLine={false} tickLine={false} width={empile === "parts" ? 38 : 44} tickFormatter={empile === "parts" ? (v) => `${Math.round(v * 100)} %` : (v) => repAxe(v, qte)} />
                    <Tooltip content={bulle} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
                    {series.map((s, k) => (
                      <Bar key={s.cle} dataKey={s.cle} stackId="r" fill={s.c} stroke={REP_FOND} strokeWidth={1.5} isAnimationActive={false} radius={k === series.length - 1 ? [4, 4, 0, 0] : undefined}
                        onClick={s.nom === null ? undefined : () => choisirEntite(s.nom)}>{celles(s.cle)}</Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-2 text-[11px]" style={{ color: MUTED }} data-rep="legende">
                {series.map((s) => (
                  <button key={s.cle} type="button" disabled={s.nom === null} onClick={() => s.nom !== null && choisirEntite(s.nom)} aria-pressed={s.nom !== null && entM === s.nom}
                    className="inline-flex items-center gap-1.5 py-0.5" style={{ opacity: focusCle && focusCle !== s.cle ? 0.45 : 1, color: s.nom !== null && entM === s.nom ? INK : MUTED, cursor: s.nom === null ? "default" : "pointer" }}>
                    <span className="w-2 h-2 rounded-sm" style={{ background: s.c }} />{sourceVue(s.nom)}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="mt-3" data-rep="tableau-entites">
              <div style={{ maxHeight: 420, overflowY: "auto" }}>
                <RepGrille attr="grille-entites" lignes={lignesTab} moisT={moisT} moisL={moisL} enCours={enCours} libEnCours={t.rep_en_cours_court} libPremiere={dimLib} libTotal={t.rep_total} fmt={(v) => repCellule(v, qte)} fond={null} texte={texteTab} etroit={etroit} />
              </div>
            </div>
          )}
          {mesure === "qte" && !qOk && note(t.rep_qte_indispo, "note-qte")}
          {an !== info.an && siteDansPerimetre && note(t.rep_site_prec, "note-site")}
          {enCours >= 0 && affichage === "graphique" && nbEntites > 0 && (
            <div className="flex items-center gap-1.5 text-[10.5px] mt-2" style={{ color: FAINT }} data-rep="note-en-cours"><span className="inline-block w-3 h-2 rounded-sm" style={{ background: GRIS, opacity: 0.6 }} />{t.rep_en_cours.replace("{d}", fmtCourt(DMAX))}</div>
          )}
        </GlassCard>

        {/* classement : CA, quantités, part */}
        <GlassCard className="p-4 sm:p-5 min-w-0" quiet scrollReveal>
          <Eyebrow tone="quiet">{t.rep_classement} · {lentLib}{lent === "type" ? ` · ${dimLib}` : ""}</Eyebrow>
          {!nbEntites ? (
            <div className="text-[12px] py-6 text-center" style={{ color: FAINT }}>{t.rep_vide}</div>
          ) : (
            <>
              <div className="grid items-center gap-x-3 text-[9.5px] uppercase tracking-[0.12em] font-semibold px-2 pb-1" style={{ gridTemplateColumns: "minmax(0,1fr) auto auto 40px", color: FAINT }}>
                <span />
                <span className="text-right" style={{ minWidth: 76, color: !qte ? MUTED : FAINT }}>{t.rep_ca}</span>
                <span className="text-right" style={{ minWidth: 52, color: qte ? MUTED : FAINT }}>{t.rep_qte}</span>
                <span className="text-right">{t.rep_col_part}</span>
              </div>
              <div style={{ maxHeight: 360, overflowY: "auto" }} data-rep="classement">
                {V.ents.map((e) => {
                  const visible = pile.includes(e.nom), c = couleur.get(e.nom);
                  const part = V.total > 0 ? e.total / V.total : 0;
                  const ca = qte ? autreMesure.get(e.nom) : e.total, q = qte ? e.total : autreMesure.get(e.nom);
                  const actif = entM === e.nom;
                  return (
                    <button key={e.nom} type="button" data-rep-ligne={e.nom} data-valeur={Math.round(e.total * 100) / 100} aria-pressed={actif} onClick={() => choisirEntite(e.nom)}
                      className="btn-lift relative grid items-center gap-x-3 w-full text-left px-2 py-1.5 rounded-lg text-[12px]"
                      style={{ gridTemplateColumns: "minmax(0,1fr) auto auto 40px", background: actif ? `${ORANGE}1A` : "transparent", boxShadow: actif ? `inset 0 0 0 1px ${ORANGE}55` : "none" }}>
                      <span aria-hidden="true" style={{ position: "absolute", left: 8, bottom: 2, height: 2, width: `calc((100% - 16px) * ${maxPart > 0 ? part / maxPart : 0})`, background: visible ? c : GRIS, opacity: 0.6, borderRadius: 1 }} />
                      <span className="flex items-center gap-1.5 min-w-0" style={{ color: INK }}>
                        <span className="w-2 h-2 rounded-sm shrink-0" style={{ background: visible ? c : "transparent", border: visible ? "none" : `1px solid ${GRIS}` }} />
                        <span className="truncate">{libelle(e.nom)}</span>
                      </span>
                      <span className="text-right tabular-nums" style={{ minWidth: 76, color: !qte ? INK : MUTED, fontWeight: !qte ? 600 : 400 }}>{ca === undefined ? "—" : fmtEURplain(ca)}</span>
                      <span className="text-right tabular-nums" style={{ minWidth: 52, color: qte ? INK : MUTED, fontWeight: qte ? 600 : 400 }}>{q === undefined || (!qOk && !qte) ? "—" : fmtNum(q)}</span>
                      <span className="text-right tabular-nums" style={{ color: MUTED }}>{repPct(part)}</span>
                    </button>
                  );
                })}
              </div>
              <div className="grid items-center gap-x-3 text-[12px] px-2 pt-2 mt-1" style={{ gridTemplateColumns: "minmax(0,1fr) auto auto 40px", borderTop: `1px solid ${PANEL_BORDER_QUIET}`, color: INK, fontWeight: 700 }} data-rep="classement-total">
                <span>{t.rep_total}</span>
                <span className="text-right tabular-nums" style={{ minWidth: 76 }}>{fmtEURplain(qte ? Vb.total : V.total)}</span>
                <span className="text-right tabular-nums" style={{ minWidth: 52 }}>{(qte ? V.dispo : Vb.dispo) && (qte || qOk) ? fmtNum(qte ? V.total : Vb.total) : "—"}</span>
                <span className="text-right tabular-nums" style={{ color: MUTED }}>100 %</span>
              </div>
              <div className="text-[10.5px] mt-2 px-0.5" style={{ color: FAINT }} data-rep="astuce">{t.rep_astuce_classement}</div>
            </>
          )}
        </GlassCard>
      </div>

      {/* détail par marketplace : montant, ou part de l'entité dans chaque case */}
      <GlassCard className="p-4 sm:p-5" quiet scrollReveal>
        <div className="flex items-start justify-between gap-x-3 gap-y-2 flex-wrap">
          <div className="min-w-0">
            <Eyebrow tone="quiet">{t.rep_detail}</Eyebrow>
            <div className="flex items-center gap-x-2 gap-y-1 flex-wrap text-[12px]" style={{ color: MUTED }}>
              {entM ? (
                <button type="button" onClick={() => setFocus(null)} className="btn-lift inline-flex items-center gap-1.5 pl-2 pr-1.5 py-1 rounded-full text-[11.5px] font-semibold" title={t.rep_retirer} data-rep="filtre-entite"
                  style={{ color: INK, background: `${coulFocus}26`, border: `1px solid ${coulFocus}66` }}>
                  <span className="w-2 h-2 rounded-sm" style={{ background: coulFocus }} />{libelle(entM)}<X size={11} style={{ color: MUTED }} />
                </button>
              ) : <span className="font-semibold" style={{ color: INK }}>{tousLib}</span>}
              <span style={{ color: FAINT }}>· {qte ? t.rep_qte : t.rep_ca} · {an}</span>
            </div>
          </div>
          <RepSegment attr="mode" ariaLabel="" value={modeEff} onChange={(k) => (k === "part" ? choisirPart() : setModeM("montant"))} options={[["montant", t.rep_montant], ["part", t.rep_part]]} />
        </div>
        {modeEff === "part" && entM && <div className="text-[10.5px] mt-1.5" style={{ color: FAINT }} data-rep="legende-part">{t.rep_part_de.replace("{x}", libelle(entM))}</div>}
        <div className="mt-3">
          {!M.dispo || !M.lignes.length ? (
            <div className="text-[12px] py-6 text-center" style={{ color: FAINT }}>{t.rep_vide}</div>
          ) : (
            <RepGrille attr="grille-mp" lignes={lignesDetail} moisT={moisT} moisL={moisL} enCours={enCours} libEnCours={t.rep_en_cours_court} libPremiere={t.rep_marketplace} libTotal={t.rep_total} libMix={t.rep_mix} fmt={fmtCase} fond={fondCellule} texte={texteCase} etroit={etroit} />
          )}
        </div>
        {!mpVerrou && <div className="text-[10.5px] mt-2 px-0.5" style={{ color: FAINT }} data-rep="astuce-mp">{t.rep_astuce_mp}</div>}
      </GlassCard>
    </div>
  );
}

function ChatRouter({ onComplete, lang: langInitiale = "fr" }) {
  const [texte, setTexte] = useState("");
  const [etat, setEtat] = useState("saisie"); // saisie | trouve | perdu | sortie
  const [etape, setEtape] = useState("theme"); // theme | marketplace
  const [intentTrouve, setIntentTrouve] = useState(null);
  const [reponseTexte, setReponseTexte] = useState(null);
  const [reponseAction, setReponseAction] = useState(null);
  const [secousse, setSecousse] = useState(false);
  const [lang, setLang] = useState(langInitiale); // modifiable ici — passé ensuite au dashboard via l'URL
  const [iaDispo, setIaDispo] = useState(null); // null = sonde en cours · true = assistant IA connecté · false = mode local
  const [historique, setHistorique] = useState([]); // derniers échanges (texte seul), pour les questions de suivi
  const [statutReflexion, setStatutReflexion] = useState("");
  const [messagePerdu, setMessagePerdu] = useState(null);
  const [derniereQuestion, setDerniereQuestion] = useState("");
  const sondeRef = useRef(null);
  const abortRef = useRef(null);
  const sortieRef = useRef(false);
  const perduTimerRef = useRef(null);

  // sonde de disponibilité : le relais /api/chat répond {configured:true} seulement
  // si la clé API est définie côté serveur ; toute autre réponse (404, page HTML
  // d'un déploiement sans le dossier api, réseau coupé…) = mode local, sans erreur
  useEffect(() => {
    const ctrl = new AbortController();
    const chrono = setTimeout(() => ctrl.abort(), 3000);
    sondeRef.current = fetch("/api/chat", { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => Boolean(j && j.configured))
      .catch(() => false)
      .then((ok) => { clearTimeout(chrono); setIaDispo(ok); return ok; });
    return () => { ctrl.abort(); clearTimeout(chrono); if (abortRef.current) abortRef.current.abort(); };
  }, []);

  const naviguerVers = (intent) => {
    sortieRef.current = true;
    if (abortRef.current) abortRef.current.abort();
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("tab", intent.tab);
      if (intent.mp) url.searchParams.set("marketplace", intent.mp); else url.searchParams.delete("marketplace");
      if (intent.periode) url.searchParams.set("periode", intent.periode);
      if (intent.sousTab) url.searchParams.set("sousTab", intent.sousTab); else url.searchParams.delete("sousTab");
      if (intent.recherche) url.searchParams.set("recherche", intent.recherche); else url.searchParams.delete("recherche");
      url.searchParams.set("lang", lang);
      window.history.replaceState({}, "", url);
    } catch { /* navigation privée ou URL indisponible — on continue quand même */ }
    setEtat("sortie");
    setTimeout(onComplete, 620);
  };

  const confirmerEtNaviguer = (intent) => {
    setIntentTrouve(intent);
    setEtat("trouve");
    setTimeout(() => naviguerVers(intent), 900);
  };

  // choix d'un thème — le dashboard général ouvre l'étape marketplace
  // puisque c'est la seule destination où ce filtre change vraiment toute la
  // vue ; les autres thèmes ont leurs propres filtres internes et naviguent
  // directement
  const choisirTheme = (theme) => {
    if (theme.tab === "apercu" && !theme.mp) {
      setEtape("marketplace");
    } else {
      confirmerEtNaviguer(theme);
    }
  };

  const repondreLocalement = (saisie) => {
    const rs = parseRequeteStructuree(saisie);
    if (rs) return { type: "reponse", texte: rs.reponse(), action: rs.action };
    const q = matchChatQuestion(saisie);
    if (q) return { type: "reponse", texte: q.reponse(), action: q.action };
    // matchChatIntent fait un simple test de mot-clé, sans jugement de longueur ou de
    // complexité — une vraie question qui mentionne juste une marketplace ou une marque
    // ("quelle stratégie pour booster HOM'Y ?") ne doit pas être réduite à une simple
    // navigation. On ne l'accepte que pour une saisie courte, sans marque de question.
    const ressembleANavigation = !saisie.includes("?") && saisie.trim().split(/\s+/).length <= 4;
    if (ressembleANavigation) {
      const intent = matchChatIntent(saisie);
      if (intent) return { type: "navigation", intent };
    }
    return { type: "perdu" };
  };
  const afficherPerdu = (message) => {
    setSecousse(true); setEtat("perdu"); setMessagePerdu(message || null); setTexte("");
    setTimeout(() => setSecousse(false), 420);
    clearTimeout(perduTimerRef.current);
    perduTimerRef.current = setTimeout(() => { setEtat("saisie"); setMessagePerdu(null); }, message ? 3400 : 1600);
  };
  const appliquerLocal = (r, messagePerduSpecifique) => {
    if (r.type === "reponse") { setReponseTexte(r.texte); setReponseAction(r.action); setEtat("reponse"); }
    else if (r.type === "navigation") confirmerEtNaviguer(r.intent);
    else afficherPerdu(messagePerduSpecifique);
  };
  const soumettre = async (texteChoisi) => {
    const saisie = (texteChoisi ?? texte).trim();
    if (!saisie || etat === "reflexion") return;
    clearTimeout(perduTimerRef.current);
    setMessagePerdu(null);
    setDerniereQuestion(saisie);
    // le système local (instantané) répond toujours en premier — CA, prix, ads,
    // marques, produits, navigation... tout ce qu'il couvre déjà. L'IA (plus lente,
    // aller-retour serveur) ne prend le relais que pour ce que le local ne reconnaît pas.
    const local = repondreLocalement(saisie);
    if (local.type !== "perdu") { appliquerLocal(local); return; }
    let ia = iaDispo;
    if (ia === null && sondeRef.current) ia = await sondeRef.current;
    if (!ia) { afficherPerdu(); return; }
    setEtat("reflexion"); setStatutReflexion(tx.reflechit); setTexte("");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const chrono = setTimeout(() => ctrl.abort(), 45000);
    let nbOutils = 0;
    try {
      const { texte: rep, action } = await demanderAIA({
        question: saisie, historique, lang, signal: ctrl.signal,
        onOutil: () => { nbOutils++; setStatutReflexion(nbOutils > 2 ? tx.analyse : tx.consulte); },
      });
      if (sortieRef.current) return;
      if (!rep) throw new Error("réponse vide");
      setHistorique((h) => [...h, { role: "user", content: saisie }, { role: "assistant", content: rep }].slice(-12));
      if (/^\s*oulah/i.test(rep)) { afficherPerdu(rep); return; }
      setReponseTexte(rep); setReponseAction(action || { tab: "apercu" }); setEtat("reponse");
    } catch (e) {
      if (sortieRef.current) return;
      afficherPerdu(tx.iaIndisponible);
    } finally { clearTimeout(chrono); }
  };

  const suggestionsRapides = [
    { label: "Dashboard", tab: "apercu" },
    { label: "Analyse des prix", tab: "prix" },
    { label: "Concurrence", tab: "concurrence" },
    { label: "Marques", tab: "marques" },
    { label: "Marketplaces", tab: "marketplaces" },
  ];
  const marketplacesRapides = ["Toutes", "Amazon FR", "Leroy Merlin", "Cdiscount", "ManoMano", "Castorama"];
  const languesDisponibles = [{ id: "fr", label: "FR" }, { id: "en", label: "EN" }, { id: "es", label: "ES" }, { id: "zh", label: "中文" }];

  const textesEtat = {
    fr: { placeholder: "Meilleur produit ? Amazon, prix…", placeholderMp: "Nom de la marketplace…", uneAutreQuestion: "Une autre question", voirPlus: "Voir le dashboard →", passer: "Passer au dashboard", trouve: (l) => `${l}`, perdu: "Oulah ! Question de fripon 🙈", introTheme: "Pose ta question, ou choisis une destination", introMp: "Quelle marketplace ?", retour: "← Retour", toutes: "Toutes les marketplaces", placeholderIA: "Pose n'importe quelle question sur tes données…", questionSuivi: "Une question de suivi…", reflechit: "Je réfléchis…", consulte: "Je consulte tes données…", analyse: "J'analyse les résultats…", iaActive: "Assistant IA connecté à tes données", iaLocale: "Mode local — assistant IA non connecté", iaIndisponible: "L'assistant IA ne répond pas pour le moment et je n'ai pas de réponse toute prête à ça — réessaie dans un instant." },
    en: { placeholder: "Best product? Amazon, prices…", placeholderMp: "Marketplace name…", uneAutreQuestion: "Ask another question", voirPlus: "See the dashboard →", passer: "Skip to dashboard", trouve: (l) => `${l}`, perdu: "Whoa! Cheeky question 🙈", introTheme: "Ask a question, or pick a destination", introMp: "Which marketplace?", retour: "← Back", toutes: "All marketplaces", placeholderIA: "Ask anything about your data…", questionSuivi: "A follow-up question…", reflechit: "Thinking…", consulte: "Checking your data…", analyse: "Analysing the results…", iaActive: "AI assistant connected to your data", iaLocale: "Local mode — AI assistant not connected", iaIndisponible: "The AI assistant isn't responding right now and I have no ready-made answer for that — try again in a moment." },
    zh: { placeholder: "最佳产品？亚马逊、价格…", placeholderMp: "平台名称…", uneAutreQuestion: "问另一个问题", voirPlus: "查看仪表盘 →", passer: "跳到仪表盘", trouve: (l) => `${l}`, perdu: "哦呀！调皮的问题 🙈", introTheme: "提出问题，或选择目的地", introMp: "哪个平台？", retour: "← 返回", toutes: "所有平台", placeholderIA: "随便问任何关于你数据的问题…", questionSuivi: "继续提问…", reflechit: "思考中…", consulte: "正在查询数据…", analyse: "正在分析结果…", iaActive: "AI助手已连接你的数据", iaLocale: "本地模式 — AI助手未连接", iaIndisponible: "AI助手暂时没有响应，我也没有现成的答案 — 请稍后再试。" },
    es: { placeholder: "¿Mejor producto? Amazon, precios…", placeholderMp: "Nombre del marketplace…", uneAutreQuestion: "Otra pregunta", voirPlus: "Ver el dashboard →", passer: "Ir al dashboard", trouve: (l) => `${l}`, perdu: "¡Vaya! Pregunta traviesa 🙈", introTheme: "Haz una pregunta, o elige un destino", introMp: "¿Qué marketplace?", retour: "← Atrás", toutes: "Todos los marketplaces", placeholderIA: "Pregunta lo que quieras sobre tus datos…", questionSuivi: "Una pregunta de seguimiento…", reflechit: "Pensando…", consulte: "Consultando tus datos…", analyse: "Analizando los resultados…", iaActive: "Asistente de IA conectado a tus datos", iaLocale: "Modo local — asistente de IA no conectado", iaIndisponible: "El asistente de IA no responde ahora y no tengo una respuesta lista para eso — inténtalo en un momento." },
  };
  const tx = textesEtat[lang] || textesEtat.fr;

  return (
    <div className={`fixed inset-0 flex items-center justify-center overflow-hidden chat-router ${etat === "sortie" ? "chat-sortie" : ""}`} style={{ background: "#0A0908" }}>
      <div className="absolute rounded-full chat-orb" style={{ width: 420, height: 420, background: "radial-gradient(circle, #FF5A1F22, transparent 70%)", top: "-10%", left: "-10%", animation: "chatDrift1 9s ease-in-out infinite" }} />
      <div className="absolute rounded-full chat-orb" style={{ width: 360, height: 360, background: "radial-gradient(circle, #4A9EFF1a, transparent 70%)", bottom: "-12%", right: "-8%", animation: "chatDrift2 11s ease-in-out infinite" }} />

      {etat !== "sortie" && etat !== "trouve" && (
        <div className="absolute top-5 right-6 z-20 flex items-center gap-1 rounded-full p-0.5" style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)", animation: "chatFadeUp 0.5s cubic-bezier(.22,1,.36,1) both 0.05s" }}>
          {languesDisponibles.map((l) => (
            <button key={l.id} onClick={() => setLang(l.id)} className="btn-lift text-[9.5px] font-semibold px-2 py-1 rounded-full"
              style={{ background: lang === l.id ? "linear-gradient(135deg, #FF5A1F, #FF8A50)" : "transparent", color: lang === l.id ? "#0A0908" : "#6B6459" }}>
              {l.label}
            </button>
          ))}
        </div>
      )}

      <div className="relative z-10 w-full max-w-sm px-6 max-h-[90vh] overflow-y-auto" style={{ animation: "chatFadeUp 0.7s cubic-bezier(.22,1,.36,1) both" }}>
        {etat === "saisie" || etat === "perdu" ? (
          <>
            <div className="text-center mb-5 mt-6" style={{ animation: "chatFadeUp 0.5s cubic-bezier(.22,1,.36,1) both 0.1s" }}>
              <span className="text-[15px] font-medium" style={{ color: "#F5F1EA" }}>{etape === "marketplace" ? tx.introMp : tx.introTheme}</span>
            </div>

            <div className={`relative mb-4 ${secousse ? "chat-shake" : ""}`} style={{ animation: "chatFadeUp 0.5s cubic-bezier(.22,1,.36,1) both 0.16s" }}>
              <input
                autoFocus value={texte} onChange={(e) => setTexte(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") soumettre(); }}
                placeholder={etape === "marketplace" ? tx.placeholderMp : historique.length ? tx.questionSuivi : iaDispo ? tx.placeholderIA : tx.placeholder}
                className="w-full text-[14px] px-5 py-3.5 rounded-full outline-none chat-input"
                style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.1)", color: "#F5F1EA" }}
              />
            </div>

            {etape === "theme" && iaDispo !== null && (
              <div className="flex items-center justify-center gap-1.5 mb-3 text-[10.5px]" style={{ color: FAINT }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: iaDispo ? GREEN : FAINT }} />
                {iaDispo ? tx.iaActive : tx.iaLocale}
              </div>
            )}
            <div className="flex flex-wrap justify-center gap-1.5 mb-2">
              {(etape === "theme" ? suggestionsRapides : marketplacesRapides).map((item, i) => {
                const label = etape === "theme" ? item.label : item;
                const onClick = etape === "theme" ? () => choisirTheme(item) : () => confirmerEtNaviguer({ tab: "apercu", mp: item === "Toutes" ? null : item });
                return (
                  <button key={label} onClick={onClick}
                    className="text-[11px] font-medium px-3 py-1.5 rounded-full btn-lift"
                    style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)", color: "#948C7E", animation: `chatFadeUp 0.5s cubic-bezier(.22,1,.36,1) both ${0.24 + i * 0.04}s` }}>
                    {label}
                  </button>
                );
              })}
            </div>

            <div className="text-center flex flex-col items-center gap-2 mb-4" style={{ animation: "chatFadeUp 0.5s cubic-bezier(.22,1,.36,1) both 0.5s" }}>
              {etat === "perdu" && <span className="text-[12px] font-medium" style={{ color: ORANGE_SOFT }}>{messagePerdu || tx.perdu}</span>}
              <div className="flex items-center justify-center gap-4">
                {etape === "marketplace" && (
                  <button onClick={() => setEtape("theme")} className="text-[11.5px] btn-lift" style={{ color: "#6B6459" }}>{tx.retour}</button>
                )}
                <button onClick={() => naviguerVers({ tab: "apercu" })} className="text-[11.5px] btn-lift" style={{ color: "#6B6459" }}>{tx.passer} →</button>
              </div>
            </div>
          </>
        ) : etat === "trouve" ? (
          <div className="text-center" style={{ animation: "chatPop 0.45s cubic-bezier(.34,1.56,.64,1) both" }}>
            <div className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: "rgba(255,90,31,0.12)" }}>
              <ChevronRight size={20} color="#FF5A1F" />
            </div>
            <span className="text-[16px] font-semibold" style={{ color: "#F5F1EA" }}>{tx.trouve(intentTrouve.label || intentTrouve.mp || intentTrouve.tab)}</span>
          </div>
        ) : etat === "reflexion" ? (
          <div className="text-center" style={{ animation: "chatFadeUp 0.4s cubic-bezier(.22,1,.36,1) both" }}>
            <div className="text-[11.5px] mb-4 px-4 truncate" style={{ color: FAINT }}>{derniereQuestion}</div>
            <div className="w-11 h-11 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: `${ORANGE}18` }}>
              <Sparkles size={17} color={ORANGE} className="chat-pulse" />
            </div>
            <div className="flex items-center justify-center gap-1.5 mb-3">
              {[0, 1, 2].map((i) => <span key={i} className="chat-dot w-1.5 h-1.5 rounded-full" style={{ background: ORANGE, animationDelay: `${i * 0.16}s` }} />)}
            </div>
            <span className="text-[12.5px]" style={{ color: "#948C7E" }}>{statutReflexion}</span>
          </div>
        ) : etat === "reponse" ? (
          <div className="text-center" style={{ animation: "chatPop 0.4s cubic-bezier(.34,1.56,.64,1) both" }}>
            <div className="w-11 h-11 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: `${ORANGE}18` }}>
              <Sparkles size={17} color={ORANGE} />
            </div>
            {derniereQuestion && <div className="text-[11px] mb-3 px-4 truncate" style={{ color: FAINT }}>{derniereQuestion}</div>}
            <p className={`text-[14px] font-medium mb-5 px-2 max-h-[38vh] overflow-y-auto ${reponseTexte && reponseTexte.length > 150 ? "text-left" : ""}`} style={{ color: "#F5F1EA", lineHeight: 1.5, whiteSpace: "pre-line" }}>{reponseTexte}</p>
            <div className="flex items-center justify-center gap-4">
              <button onClick={() => { setEtat("saisie"); setTexte(""); }} className="text-[11.5px] btn-lift" style={{ color: "#6B6459" }}>{tx.uneAutreQuestion}</button>
              <button onClick={() => confirmerEtNaviguer(reponseAction)} className="btn-lift text-[11.5px] font-semibold px-4 py-1.5 rounded-full" style={{ background: `linear-gradient(135deg, ${ORANGE}, ${ORANGE_SOFT})`, color: "#0A0908" }}>
                {tx.voirPlus}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <style>{`
        @keyframes chatDrift1 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(30px,-24px)} }
        @keyframes chatDrift2 { 0%,100%{transform:translate(0,0)} 50%{transform:translate(-26px,20px)} }
        @keyframes chatFadeUp { from{opacity:0; transform:translateY(10px)} to{opacity:1; transform:translateY(0)} }
        @keyframes chatPop { 0%{opacity:0; transform:scale(0.85)} 100%{opacity:1; transform:scale(1)} }
        @keyframes chatShakeKf { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-6px)} 75%{transform:translateX(6px)} }
        .chat-shake { animation: chatShakeKf 0.4s ease-in-out; }
        @keyframes chatDot { 0%,80%,100%{opacity:0.25; transform:translateY(0)} 40%{opacity:1; transform:translateY(-4px)} }
        @keyframes chatPulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.18)} }
        .chat-dot { animation: chatDot 1.2s ease-in-out infinite; }
        .chat-pulse { animation: chatPulse 1.4s ease-in-out infinite; }
        @media (prefers-reduced-motion: reduce) { .chat-dot, .chat-pulse, .chat-shake { animation: none !important; } }
        .chat-input:focus { border-color: rgba(255,90,31,0.5) !important; box-shadow: 0 0 0 3px rgba(255,90,31,0.1); transition: border-color 0.25s, box-shadow 0.25s; }
        .chat-router { transition: opacity 0.6s ease; }
        .chat-router.chat-sortie { opacity: 0; }
      `}</style>
    </div>
  );
}

function DashboardApp() {
  // tab/datePreset/dates personnalisées initialisés depuis l'URL si présents
  // (même pattern que globalMp ci-dessous) — permet au routeur conversationnel
  // (ChatRouter, avant ce composant) de préremplir le bon écran avant même le
  // premier rendu, en construisant l'URL puis en montant DashboardApp dessus
  const [tab, setTab] = useState(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("tab");
      return fromUrl && NAV.some((n) => n.id === fromUrl) ? fromUrl : "apercu";
    } catch { return "apercu"; }
  });
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
  const [datePreset, setDatePreset] = useState(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("periode");
      return fromUrl && DATE_PRESETS.some((d) => d.id === fromUrl) ? fromUrl : "annee_courante";
    } catch { return "annee_courante"; }
  });
  const [customFrom, setCustomFrom] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("du") || "2026-01-01"; } catch { return "2026-01-01"; }
  });
  const [customTo, setCustomTo] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("au") || DMAX; } catch { return DMAX; }
  });
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
  const [lang, setLang] = useState(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("lang");
      if (fromUrl && ["fr", "en", "es", "zh"].includes(fromUrl)) return fromUrl;
      // sans paramètre d'URL : langue du navigateur si l'app la gère, sinon français
      // (c'était le rôle de l'écran de conversation, retiré du parcours le 14/10/2026)
      const nav = ((typeof navigator !== "undefined" && navigator.language) || "fr").slice(0, 2).toLowerCase();
      return ["fr", "en", "es", "zh"].includes(nav) ? nav : "fr";
    } catch { return "fr"; }
  });
  const [selectedMonth, setSelectedMonth] = useState(null);
  const [visibleYears, setVisibleYears] = useState({ 2024: true, 2025: true, 2026: true });
  const [concTab, setConcTab] = useState(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("sousTab");
      return fromUrl && ["synthese", "produits", "prix", "comparatif"].includes(fromUrl) ? fromUrl : "synthese";
    } catch { return "synthese"; }
  });
  const [concMpFilter, setConcMpFilter] = useState("Toutes");
  const t = I18N[lang];
  const [catMpFilter, setCatMpFilter] = useState("Toutes");
  const [priceSearch, setPriceSearch] = useState("");
  const [simProduit, setSimProduit] = useState(null);
  const [simMp, setSimMp] = useState(null);
  const [simPrix, setSimPrix] = useState(null);
  const [simRecherche, setSimRecherche] = useState("");
  const [apSearch, setApSearch] = useState(() => {
    try { return new URLSearchParams(window.location.search).get("recherche") || ""; } catch { return ""; }
  });
  const [apExpanded, setApExpanded] = useState(() => new Set());
  const [apSort, setApSort] = useState("ca"); // "ca" | "qte" | "produit"
  const [dataSearch, setDataSearch] = useState("");
  const [dataSelected, setDataSelected] = useState(() => new Set());
  const [dataGenerating, setDataGenerating] = useState(false);
  const [dataErreur, setDataErreur] = useState(false);
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
    const n1 = n1From_ok ? (globalMp === "Toutes" ? sumMonthSnapped(DATA.monthly_total, n1From, n1To, DATA.cut_n1?.total) : sumRangeForMp(globalMp, n1From, n1To, true)) : null;
    return { current, n1, yoy: n1 ? ((current - n1) / n1) * 100 : null, from, to, n1From, n1To };
  }, [dateRange.from, dateRange.to, globalMp, datePreset]);

  // ===== valeurs sensibles au filtre marketplace ET au filtre de date =====
  const mpObjectifRow = DATA.mp_vs_objectif.find((m) => m.marketplace === globalMp);
  const filteredCaTotal = periodStats.current;
  const filteredObjectif = globalMp === "Toutes" ? DATA.kpi.objectif_annuel_total : (mpObjectifRow?.objectif ?? null);
  const filteredPct = filteredObjectif ? (filteredCaTotal / filteredObjectif) * 100 : 0;

  // ===== rythme réel vs PLAN 2026 — compare le % d'objectif annuel atteint à celui que le plan officiel
  // (onglet « Objectif » du dashboard : objectifs hebdomadaires S1→S52, très chargés en fin d'année)
  // prévoyait à la date des dernières données. Écart négatif = en retard sur le plan, pas sur une moyenne. =====
  const planPace = useMemo(() => {
    if (!filteredObjectif || datePreset !== "annee_courante") return null;
    const attendu = planAttenduAuJour(dateRange.to);
    const pctPoidsEcoule = (attendu / OBJECTIF_2026.annuel) * 100;
    const ecart = filteredPct - pctPoidsEcoule;
    return { pctPoidsEcoule, ecart, attendu: filteredObjectif * (attendu / OBJECTIF_2026.annuel), semaine: excelWeekOf(dateRange.to), statut: ecart > 2 ? "avance" : ecart < -2 ? "retard" : "pile" };
  }, [filteredObjectif, filteredPct, datePreset, dateRange.to]);
  // avancement global vs plan à la dernière donnée (indépendant du filtre) — résumés et carte hebdomadaire
  const planStatus = useMemo(() => {
    const attendu = planAttenduAuJour(DMAX), ca = DATA.kpi.ca_total_2026;
    const pctPlan = (attendu / OBJECTIF_2026.annuel) * 100, pctReel = (ca / OBJECTIF_2026.annuel) * 100;
    return { attendu, pctPlan, pctReel, ecart: pctReel - pctPlan, ecartEUR: ca - attendu, couverture: attendu ? (ca / attendu) * 100 : 0, semaine: excelWeekOf(DMAX) };
  }, []);

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
      const besthermN1 = n1From >= DMIN ? sumMonthSnapped(DATA.monthly_by_brand.Bestherm, n1From, n1To, DATA.cut_n1?.brand?.Bestherm) : null;
      const thomsonN1 = n1From >= DMIN ? sumMonthSnapped(DATA.monthly_by_brand.Thomson, n1From, n1To, DATA.cut_n1?.brand?.Thomson) : null;
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

  // objectif mensuel — plan officiel 2026 (onglet « Objectif ») : objectif du mois pour le total ; pour une
  // marketplace, son objectif annuel est réparti selon la forme du plan mensuel (part du mois dans l'annuel).
  // Mois en cours (partiel) : on ajoute la part attendue à ce jour, au prorata des jours écoulés.
  const monthlyObjectif = useMemo(() => {
    if (!filteredObjectif) return null;
    const dTo = dateRange.to ? new Date(dateRange.to) : new Date();
    if (dTo.getFullYear() !== 2026) return null; // le plan mensuel ne concerne que 2026
    const curMonthIdx = dTo.getMonth();
    const target = filteredObjectif * (OBJECTIF_2026.mensuel[curMonthIdx] / OBJECTIF_2026.annuel);
    const curCa = globalMp === "Toutes" ? (DATA.monthly_total[2026]?.[curMonthIdx] || 0) : (DATA.gf.monthly_total_by_mp[globalMp]?.["2026"]?.[curMonthIdx] || 0);
    let attendu = null;
    if (curMonthIdx === MOIS_EN_COURS_IDX) attendu = target * (Number(DMAX.slice(8, 10)) / new Date(2026, curMonthIdx + 1, 0).getDate());
    const pct = target ? (curCa / target) * 100 : 0;
    return { target, curCa, pct, pctRef: attendu ? (curCa / attendu) * 100 : pct, attendu, monthLabel: moisLabels[curMonthIdx], monthIdx: curMonthIdx };
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
        const ca_n1 = n1Ok ? sumRangeForMp(m.marketplace, n1From, n1To, true) : null;
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
    const mv = DATA.mp_vs_objectif.find((m) => m.marketplace === globalMp); // évolution à date identique, déjà calculée
    return mv && mv.yoy_pct !== undefined ? mv.yoy_pct : null;
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
      rows.forEach(([, mp, prix25, prix26, qte25, qte26, cut25]) => {
        if (EXCLUDE_MP_PRICE.has(mp)) return;
        const totalQty = qte26.reduce((s, q) => s + (q || 0), 0);
        if (totalQty <= 0) return;
        let totalVal = 0;
        for (let i = 0; i < 12; i++) { if (prix26[i] && qte26[i]) totalVal += prix26[i] * qte26[i]; }
        const avgPrice = totalQty > 0 ? totalVal / totalQty : null;
        if (!avgPrice || avgPrice <= 0) return;
        // N-1 à date identique : mois complets avant le mois en cours + coupe du 1er au jour de DMAX (cut25 = [CA, qté])
        let ca25 = 0;
        for (let i = 0; i < MOIS_EN_COURS_IDX; i++) { if (prix25[i] && qte25[i]) ca25 += prix25[i] * qte25[i]; }
        if (cut25) ca25 += cut25[0] || 0;
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
  const [repLent, setRepLent] = useState("pays"); // découpage de l'onglet Répartitions (retrouvé au retour, choisi par le lien depuis « Marque »)
  const [marquesTab, setMarquesTab] = useState(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("sousTab");
      return fromUrl && ["marque", "repartitions", "produits", "classification", "radar", "puissances"].includes(fromUrl) ? fromUrl : "marque";
    } catch { return "marque"; }
  });
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
  // ===== vue exhaustive tous produits — CA + quantité, année 2026 complète
  // (year-to-date), toutes marketplaces ou une seule si globalMp filtré.
  // Inclut le déstockage (contrairement à Tops/Flops) car l'objectif ici est
  // la visibilité complète, pas la performance "propre" — badge dédié pour
  // signaler les références concernées plutôt que les cacher. =====
  // préfixes de pièces détachées/accessoires — distinct de WATTAGE_RE (Tops/Flops) :
  // ici on veut garder les ventilateurs et déshumidificateurs (pas de "W" dans
  // leur nom), donc exclusion ciblée par préfixe plutôt que par présence de puissance
  const ACCESSOIRE_RE = /^(ATTACHES-|Filtre|GD12-10R-12R-FILTRE|GDM-5R|HJEE-ATTACHES|MOTOR -|TELECOMMANDE|THERMOSTAT|Livraison|Ajustements Shopify|Sans référence)/i;
  // liste de produits filtrée pour l'onglet DATA — noms distincts de
  // SKU_PRODUIT, indépendant du filtre marketplace global (l'export porte sur
  // l'historique complet du produit, toutes marketplaces confondues, comme le
  // rapport déshumidificateurs construit précédemment)
  const dataProduitsFiltres = useMemo(() => {
    const noms = [...new Set(SKU_PRODUIT)].sort();
    const q = dataSearch.trim().toLowerCase();
    return q ? noms.filter((n) => n.toLowerCase().includes(q)) : noms;
  }, [dataSearch]);

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

  // ===== Cycle de vie produit — compare les 3 derniers mois ENTIERS de 2026 (juil-sept au 03/10/2026) à la même période 2025
  // (pas les mois qui précèdent immédiatement, sinon la comparaison capte la
  // saisonnalité elle-même plutôt qu'une vraie tendance — un produit qui recule
  // de l'été au pic de novembre "décline" toujours mécaniquement, ce n'est pas
  // le signal recherché). Respecte le filtre marketplace global. =====
  // ===== courbe mensuelle par produit (toutes marketplaces), 2025 vs 2026,
  // pour la fiche produit détaillée — agrège SKU_MONTHLY par nom de produit =====
  // indice de saisonnalité propre à chaque catégorie, dérivé de SES PROPRES
  // mois réels 2025 (pas de l'indice global, dominé à 85%+ par les radiateurs
  // fixes — l'appliquer tel quel à des ventilateurs de plafond ou un
  // déshumidificateur donnerait un pic hivernal inventé sur des produits dont
  // le vrai profil saisonnier peut être totalement différent, voire inconnu).
  // Seuil : au moins 6 mois actifs en 2025 pour qu'un indice soit jugé
  // exploitable ; en dessous (catégorie trop récente ou lancée en 2026), repli
  // neutre (1 partout) — une simple projection au rythme actuel plutôt qu'une
  // fausse saisonnalité empruntée à une autre famille de produits.
  // seuil commun : en dessous, un indice dérivé de si peu de mois serait plus
  // bruit que signal — mieux vaut remonter d'un niveau que de l'inventer
  const SEUIL_MOIS_SAISONNALITE = 6;
  const indiceDepuisMensuel = (arr) => {
    const nbMoisActifs = arr.filter((v) => v > 0).length;
    if (nbMoisActifs < SEUIL_MOIS_SAISONNALITE) return null; // pas assez de signal propre
    const moyenne = arr.reduce((s, v) => s + v, 0) / 12;
    return moyenne > 0 ? arr.map((v) => v / moyenne) : null;
  };
  const seasonalityByCategory = useMemo(() => {
    const parCat = {};
    SKU_MONTHLY.forEach(([pi, mi, an, mo, ca]) => {
      if (an !== 2025) return;
      const cat = PRODUCT_TO_CATEGORY[SKU_PRODUIT[pi]];
      if (!cat) return;
      if (!parCat[cat]) parCat[cat] = Array(12).fill(0);
      parCat[cat][mo - 1] += ca;
    });
    const result = {};
    Object.entries(parCat).forEach(([cat, arr]) => { result[cat] = indiceDepuisMensuel(arr) || Array(12).fill(1); });
    return result;
  }, []);
  // même principe UN CRAN PLUS FIN, par référence précise plutôt que par
  // catégorie entière : ARIA 1000W et FREYA 1000W sont toutes deux des
  // "Radiateur électrique fixe" mais n'atteignent pas forcément leur pic le
  // même mois — la courbe de catégorie lisse cette différence, celle du
  // produit la préserve, quand il y a assez d'historique pour la dériver
  // sans bruit (même seuil : 6 mois actifs en 2025).
  const seasonalityByProduct = useMemo(() => {
    const parProduit = {};
    SKU_MONTHLY.forEach(([pi, mi, an, mo, ca]) => {
      if (an !== 2025) return;
      const produit = SKU_PRODUIT[pi];
      if (!parProduit[produit]) parProduit[produit] = Array(12).fill(0);
      parProduit[produit][mo - 1] += ca;
    });
    const result = {};
    Object.entries(parProduit).forEach(([produit, arr]) => {
      const indice = indiceDepuisMensuel(arr);
      if (indice) result[produit] = indice; // sinon : pas d'entrée, on retombe sur la catégorie
    });
    return result;
  }, []);
  // cascade : saisonnalité propre au produit si assez fiable, sinon celle de
  // sa catégorie (qui retombe elle-même sur neutre si la catégorie est trop
  // récente) — jamais d'estimation construite sur moins de 6 mois réels.
  const seasonalityForProduct = (produit) => {
    if (seasonalityByProduct[produit]) return seasonalityByProduct[produit];
    const cat = PRODUCT_TO_CATEGORY[produit];
    return (cat && seasonalityByCategory[cat]) || Array(12).fill(1); // catégorie inconnue (accessoire) : neutre également
  };

  const monthlyCaByProduct = useMemo(() => {
    const map = {};
    SKU_MONTHLY.forEach(([pi, mi, an, mois, ca, qte]) => {
      const produit = SKU_PRODUIT[pi];
      if (!map[produit]) map[produit] = { 2025: Array(12).fill(0), 2026: Array(12).fill(0), qte2025: Array(12).fill(0), qte2026: Array(12).fill(0) };
      if (an === 2025 || an === 2026) { map[produit][an][mois - 1] += ca; map[produit][`qte${an}`][mois - 1] += qte; }
    });
    return map;
  }, []);

  // potentiel annuel par référence : 2025 = déjà entièrement réalisé (simple
  // somme des 12 mois, aucune estimation nécessaire) ; 2026 = projection de fin
  // d'année (buildForecastMensuel avec la saisonnalité DE LA CATÉGORIE du
  // produit, pas l'indice global — voir seasonalityByCategory ci-dessus).
  // buildForecastMensuel suppose l'année EN COURS (traite tout mois après
  // MOIS_EN_COURS_IDX comme "futur") : l'appliquer tel quel à 2025, une année
  // déjà terminée, écraserait ses vrais mois d'octobre à décembre par une
  // estimation — d'où les deux méthodes distinctes plutôt qu'un seul appel
  // réutilisé pour les deux années.
  const potentielAnnuelByProduct = useMemo(() => {
    const map = {};
    Object.entries(monthlyCaByProduct).forEach(([produit, m]) => {
      const potentiel2025 = m[2025].reduce((s, v) => s + v, 0);
      const f2026 = buildForecastMensuel(m[2026], m.qte2026, seasonalityForProduct(produit));
      map[produit] = { potentiel2025, potentiel2026: f2026.forecastAnnuel, nbMoisReels2026: f2026.nbMoisReels };
    });
    return map;
  }, [monthlyCaByProduct, seasonalityByCategory, seasonalityByProduct]);

  // même principe agrégé par catégorie (mapping catalogue PRODUCT_TO_CATEGORY,
  // inchangé) — somme des potentiels par référence, pas une nouvelle estimation
  // indépendante au niveau catégorie
  const potentielAnnuelByCategory = useMemo(() => {
    const parCat = {};
    Object.entries(potentielAnnuelByProduct).forEach(([produit, p]) => {
      const cat = PRODUCT_TO_CATEGORY[produit];
      if (!cat) return; // accessoires/pièces détachées sans catégorie connue, exclus
      if (!parCat[cat]) parCat[cat] = { categorie: cat, potentiel2025: 0, potentiel2026: 0, nbProduits: 0, saisonnaliteFiable: seasonalityByCategory[cat] ? seasonalityByCategory[cat].some((v) => v !== 1) : false };
      parCat[cat].potentiel2025 += p.potentiel2025;
      parCat[cat].potentiel2026 += p.potentiel2026;
      parCat[cat].nbProduits += 1;
    });
    return Object.values(parCat).map((c) => ({ ...c, evolutionPct: c.potentiel2025 > 0 ? ((c.potentiel2026 - c.potentiel2025) / c.potentiel2025) * 100 : null }))
      .sort((a, b) => b.potentiel2026 - a.potentiel2026);
  }, [potentielAnnuelByProduct, seasonalityByCategory, seasonalityByProduct]);

  const lifecycleData = useMemo(() => {
    const caByProduit = {}; // index -> {c25:[12], c26:[12]}
    SKU_MONTHLY.forEach(([pi, mi, an, mo, ca, qte]) => {
      if (SKU_DESTOCKAGE[pi]) return;
      if (globalMp !== "Toutes" && SKU_MPS[mi] !== globalMp) return;
      if (!caByProduit[pi]) caByProduit[pi] = { c25: Array(12).fill(0), c26: Array(12).fill(0) };
      caByProduit[pi][an === 2025 ? "c25" : "c26"][mo - 1] += ca;
    });
    const buckets = { lancement: [], croissance: [], mature: [], declin: [] };
    // 3 derniers mois ENTIERS (le mois en cours, partiel, est exclu) — libellés cycle_vie_hint à tenir à jour avec cette fenêtre
    const MR = [MOIS_EN_COURS_IDX - 3, MOIS_EN_COURS_IDX - 2, MOIS_EN_COURS_IDX - 1];
    Object.entries(caByProduit).forEach(([piStr, s]) => {
      const pi = Number(piStr);
      const produit = SKU_PRODUIT[pi];
      if (!WATTAGE_RE.test(produit)) return; // exclut accessoires
      const recent = MR.reduce((a, i) => a + s.c26[i], 0); // juil-août-sept 2026
      const sameLastYear = MR.reduce((a, i) => a + s.c25[i], 0);
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

  // ===== anticipation avec fourchette basse/haute, pas un chiffre unique —
  // la croissance mois par mois 2026 vs 2025 est très volatile (de -9% à +138%
  // selon le mois), un seul taux appliqué donnerait une fausse précision.
  // Basse/haute = le plus faible / le plus fort de deux taux : croissance YTD
  // complète (janvier → dernier mois entier, plus stable car lissée) et
  // croissance récente (moyenne des 3 derniers mois entiers, plus réactive
  // mais plus bruitée). Les deux sont de vraies méthodes, pas une fourchette
  // arbitraire — voir le détail affiché dans l'app. =====
  const computeAnticipation = (m26, m25) => {
    // les taux de croissance sont calculés sur les mois ENTIERS écoulés
    // (MOIS_EN_COURS_IDX = index du mois en cours, partiel : exclu — le comparer
    // à un mois complet de l'an dernier ferait croire à une chute artificielle)
    const nEntiers = MOIS_EN_COURS_IDX;
    const ytd26 = m26.slice(0, nEntiers).reduce((a, b) => a + b, 0), ytd25 = m25.slice(0, nEntiers).reduce((a, b) => a + b, 0);
    const growthYtd = ytd25 ? (ytd26 - ytd25) / ytd25 : 0;
    const recentMonths = [nEntiers - 3, nEntiers - 2, nEntiers - 1].filter((i) => i >= 0 && m25[i] > 0).map((i) => (m26[i] - m25[i]) / m25[i]);
    const growthRecent = recentMonths.length ? recentMonths.reduce((a, b) => a + b, 0) / recentMonths.length : growthYtd;
    const growthBas = Math.min(growthYtd, growthRecent), growthHaut = Math.max(growthYtd, growthRecent);
    // le mois en cours (octobre, partiel) est anticipé en mois ENTIER : ses jours déjà
    // connus sont dans le CA réel affiché ailleurs, ils ne s'ajoutent pas ici
    const moisAnticipes = Array.from({ length: 12 - nEntiers }, (_, k) => nEntiers + k);
    const base = moisAnticipes.reduce((s, i) => s + m25[i], 0);
    const parMois = moisAnticipes.map((i) => ({ bas: m25[i] * (1 + growthBas), haut: m25[i] * (1 + growthHaut) }));
    const bas = parMois.reduce((s, x) => s + x.bas, 0), haut = parMois.reduce((s, x) => s + x.haut, 0);
    return { base, bas, haut, growthYtd, growthRecent, milieu: (bas + haut) / 2, parMois };
  };
  const anticipation = useMemo(() => computeAnticipation(DATA.monthly_total["2026"], DATA.monthly_total["2025"]), []);
  // estimation fin d'année complète = YTD réel (mois entiers connus, jan-sept) + fourchette
  // anticipée (mois en cours + mois à venir, oct-déc) — répond directement à "vais-je atteindre l'objectif ?"
  const estimationAnnuelle = useMemo(() => {
    // s'adapte à la marketplace sélectionnée — recalcule directement via
    // computeAnticipation plutôt que de dépendre d'anticipationByMp (défini
    // plus bas dans le fichier), pour éviter tout risque d'ordre de déclaration
    const m26Source = globalMp === "Toutes" ? DATA.monthly_total["2026"] : (DATA.gf.monthly_total_by_mp[globalMp]?.["2026"] || Array(12).fill(0));
    const m25Source = globalMp === "Toutes" ? DATA.monthly_total["2025"] : (DATA.gf.monthly_total_by_mp[globalMp]?.["2025"] || Array(12).fill(0));
    const anticipationMp = computeAnticipation(m26Source, m25Source);
    const ytdReel = m26Source.slice(0, MOIS_EN_COURS_IDX).reduce((a, b) => a + b, 0);
    const mpObjectifEntry = globalMp !== "Toutes" ? DATA.mp_vs_objectif.find((m) => m.marketplace === globalMp) : null;
    const objectifRef = globalMp === "Toutes" ? DATA.kpi.objectif_annuel_total : (mpObjectifEntry?.objectif_fiable ? mpObjectifEntry.objectif : null);
    // décomposition mois par mois — jan-sept réel connu (mois entiers),
    // oct-déc fourchette anticipée (octobre partiel inclus en mois entier)
    const parMois = moisLabels.map((label, i) => {
      if (i < MOIS_EN_COURS_IDX) return { mois: label, reel: m26Source[i], bas: null, haut: null };
      return { mois: label, reel: null, bas: anticipationMp.parMois[i - MOIS_EN_COURS_IDX].bas, haut: anticipationMp.parMois[i - MOIS_EN_COURS_IDX].haut };
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
  // du code existant qui fonctionne. Le dernier mois ENTIER réel (septembre)
  // sert de point de jonction pour que la zone anticipée démarre visuellement
  // sans coupure ; le mois en cours (partiel) n'est pas tracé en réel : il est
  // couvert, en mois entier, par la fourchette anticipée. =====
  const trendWithForecast = useMemo(() => {
    // objectif mensuel du plan 2026 (courbe pointillée), ramené à la marketplace filtrée au prorata de son objectif annuel
    const objRef = estimationAnnuelle.objectifRef;
    const objMois = (i) => (objRef ? Math.round(objRef * (OBJECTIF_2026.mensuel[i] / OBJECTIF_2026.annuel)) : null);
    return trendCombined.map((row, i) => {
      if (i < MOIS_EN_COURS_IDX - 1) return { ...row, bas: null, haut: null, objectif: objMois(i) };
      if (i === MOIS_EN_COURS_IDX - 1) return { ...row, bas: row[2026], haut: row[2026], objectif: objMois(i) }; // jonction sur le dernier point réel
      const est = estimationAnnuelle.parMois[i];
      return { ...row, 2026: null, bas: est?.bas ?? null, haut: est?.haut ?? null, objectif: objMois(i) };
    });
  }, [trendCombined, estimationAnnuelle]);
  // l'axe Y doit aussi couvrir la fourchette haute anticipée, sinon la zone se
  // fait couper en haut du graphique quand l'estimation dépasse l'historique
  const maxYearlyMonthWithForecast = Math.max(maxYearlyMonth, estimationAnnuelle.maxMois, ...trendWithForecast.map((r) => r.objectif || 0));

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
        @import url('https://fonts.googleapis.com/css2?family=Baloo+2:wght@600;700&family=Quicksand:wght@600;700&family=Archivo+Black&family=Inter:wght@300;400;500;600;700;800;900&display=swap');
        ::selection{background:${ORANGE}55}
        input[type=date]::-webkit-calendar-picker-indicator{filter:invert(0.6)}
        /* "liquid glass" — bordure en dégradé diagonal qui capte la lumière,
           inspirée du modèle de maquette fourni. Un pseudo-élément ::before
           masqué en anneau (impossible à faire en style inline React, d'où
           cette classe globale) plutôt qu'une bordure pleine classique. */
        .liquid-glass { position: relative; overflow: hidden; }
        .liquid-glass::before {
          content: ''; position: absolute; inset: 0; border-radius: inherit; padding: 1.4px;
          background: linear-gradient(180deg,
            rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 20%,
            rgba(255,255,255,0) 40%, rgba(255,255,255,0) 60%,
            rgba(255,255,255,0.06) 80%, rgba(255,255,255,0.22) 100%);
          -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
          -webkit-mask-composite: xor; mask-composite: exclude;
          pointer-events: none;
        }
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
            <DonneesFraicheurCard t={t} lang={lang} mpF={globalMp === "Toutes" ? null : globalMp} accent={mpAccent} />
            <PeriodSummaryCard key={`apercu-${globalMp}-${datePreset}`} items={summaryApercu} t={t} />
            {SOUS_INFOS && (<div className="flex items-center gap-2 mb-4 px-1 text-[11px]" style={{ color: FAINT }}>
              <CalendarDays size={12} />
              <span className="tabular-nums">{periodStats.from} → {periodStats.to}</span>
              {periodStats.n1 !== null && <span className="tabular-nums">· vs {periodStats.n1From} → {periodStats.n1To}</span>}
            </div>)}

            <div className="grid grid-cols-2 gap-3 mb-6">
              <TiltCard className="p-5 col-span-2" glow glowColor={mpAccent.primary} scrollReveal>
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <Eyebrow hint={t.ca_cumule_hint}>{globalMp === "Toutes" ? `${t.ca_cumule} — ${t.toutes_marketplaces_suffix}` : `${t.ca_cumule} — ${globalMp}`}</Eyebrow>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full tabular-nums" style={{ background: `${mpAccent.primary}18`, color: mpAccent.primary }}>{dateRangeLabel}</span>
                </div>
                <div className={`gradient-text tabular-nums font-bold leading-none ${caPunch ? "punch" : ""}`} style={{ fontSize: "clamp(38px, 9vw, 58px)", backgroundImage: `linear-gradient(135deg, ${INK}, ${mpAccent.primary} 130%)`, WebkitBackgroundClip: "text", backgroundClip: "text", color: "transparent", textShadow: `0 2px 24px ${mpAccent.primary}30`, transition: "background-image 0.4s ease" }}>{fmtEUR(caAnimated)}</div>
                <div className="flex items-center gap-2 mt-2.5 flex-wrap">
                  <YoyBadge pct={periodStats.yoy} size="big" lang={lang} />
                  <span className="text-[12px] tabular-nums" style={{ color: FAINT }}>{periodStats.n1 !== null ? `vs ${fmtEURplain(periodStats.n1)} ${t.en_2025.replace("2025", String(periodStats.n1To).slice(0, 4))}` : t.sum_comparatif_n1_indispo}</span>
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
            {SOUS_INFOS && (<div className="flex items-center gap-1.5 mb-5 px-1 text-[10.5px]" style={{ color: FAINT }}>
              <Info size={11} /> Panier moyen et meilleure vente ne suivent pas le filtre de date — pas de détail mensuel disponible pour ces deux indicateurs
            </div>)}

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
                      <span className="text-[10.5px] w-8 shrink-0" style={{ color: FAINT }}>{m.mois}</span>
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

                {SOUS_INFOS && (<div className="flex items-center gap-1.5 mt-3 pt-3 text-[10.5px]" style={{ color: FAINT, borderTop: `1px solid ${PANEL_BORDER_QUIET}` }}>
                  <Info size={11} /> CA réel de {MOIS_FR[0]} à {MOIS_FR[MOIS_EN_COURS_IDX - 1]} (mois entiers) + fourchette anticipée de {MOIS_FR[MOIS_EN_COURS_IDX]} à {MOIS_FR[11]} ({MOIS_FR[MOIS_EN_COURS_IDX]} n'est connu que jusqu'au {DMAX.split("-").reverse().join("/")} : il est compris dans la fourchette) — pas un chiffre unique qui ferait semblant d'être certain.
                </div>)}
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
                    {/* dernier tracé : sinon le masque opaque de la fourchette anticipée le cache dès que l'anticipé dépasse le plan */}
                    {estimationAnnuelle.objectifRef && (
                      <Area type="monotone" dataKey="objectif" name={t.obj_2026_nom} stroke={GREEN} strokeWidth={2} strokeDasharray="6 4" fill="none" fillOpacity={0} connectNulls animationDuration={800}
                        dot={{ r: 2.5, fill: GREEN, fillOpacity: 1, strokeDasharray: "none" }} activeDot={{ r: 5, fill: GREEN, fillOpacity: 1, strokeDasharray: "none" }} />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              </GlassCard>
              {(visibleYears[2026] || estimationAnnuelle.objectifRef) && (
                <div className="flex items-center gap-4 mt-1.5 text-[10px] flex-wrap" style={{ color: FAINT }}>
                  {visibleYears[2026] && (<span className="flex items-center gap-1.5"><span className="inline-block w-3 border-t border-dashed" style={{ borderColor: YEAR_COLORS[2026] }} /> {t.legende_anticipe} {MOIS_FR[MOIS_EN_COURS_IDX]}–{MOIS_FR[11]}</span>)}
                  {estimationAnnuelle.objectifRef && (<span className="flex items-center gap-1.5"><span className="inline-block w-3 border-t-2 border-dashed" style={{ borderColor: GREEN }} /> {t.obj_2026_mensuel}</span>)}
                </div>
              )}

              {monthlyObjectif && (
                <GlassCard className="p-4 mt-3 reveal-d1" quiet scrollReveal>
                  <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                    <span className="text-[11px] uppercase tracking-wider font-semibold" style={{ color: MUTED }}>{t.objectif_du_mois} — {monthlyObjectif.monthLabel} 2026</span>
                    {SOUS_INFOS && <span className="text-[10px]" style={{ color: FAINT }}>{t.reparti_saisonnier}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.05)" }}>
                      <div className="h-full rounded-full transition-all duration-700" style={{ width: `${Math.min(100, monthlyObjectif.pct)}%`, background: monthlyObjectif.pctRef >= 90 ? GREEN : monthlyObjectif.pctRef >= 50 ? AMBER : RED }} />
                    </div>
                    <span className="tabular-nums text-[13px] font-bold shrink-0" style={{ color: monthlyObjectif.pctRef >= 90 ? GREEN : monthlyObjectif.pctRef >= 50 ? AMBER : RED }}>{monthlyObjectif.pct.toFixed(0)}%</span>
                  </div>
                  <div className="text-[11px] mt-1.5 tabular-nums" style={{ color: FAINT }}>{fmtEURplain(monthlyObjectif.curCa)} {t.realises_sur} {fmtEURplain(monthlyObjectif.target)} {t.vises}{monthlyObjectif.attendu !== null && <> · {t.attendu_a_ce_jour} ≈ {fmtEURplain(monthlyObjectif.attendu)}</>}</div>
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
            {SOUS_INFOS && (<div className="flex items-center gap-2 px-1 py-2 text-[11.5px]" style={{ color: FAINT }}><Info size={12} /> {t.tous_montants_ht}</div>)}
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
                  {planPace && (
                    <div className="text-[12.5px] px-3 py-2 rounded-xl" style={{ background: PANEL_QUIET, border: `1px solid ${PANEL_BORDER_QUIET}`, color: MUTED }}>
                      <div className="tabular-nums">
                        <span style={{ color: planPace.statut === "avance" ? GREEN : planPace.statut === "retard" ? RED : AMBER }}>
                          {planPace.statut === "avance" ? "▲" : planPace.statut === "retard" ? "▼" : "●"} {planPace.ecart >= 0 ? "+" : ""}{planPace.ecart.toFixed(1)} pt
                        </span>
                        {" "}{t.vs_plan_a_date}
                      </div>
                      <div className="text-[10px] mt-0.5" style={{ color: FAINT }}>{planPace.pctPoidsEcoule.toFixed(1)}% {t.plan_pct_attendu} · S{planPace.semaine}</div>
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
                    const alerteDeclin = m.yoy_pct !== null && m.yoy_pct < -10 && m.marketplace !== "Autre";
                    const alerteObjectif = !alerteDeclin && m.objectif_fiable && m.yoy_pct !== null && m.yoy_pct > 100 && m.pct_objectif < 30;
                    const alerte = alerteDeclin || alerteObjectif;
                    const alerteColor = alerteDeclin ? RED : AMBER;
                    return (
                    <StaggerRow key={m.marketplace} index={i} className="flex items-center gap-2 sm:gap-3 px-3 py-2.5" style={{ borderBottom: i < restMp.length - 1 ? `1px solid ${PANEL_BORDER_QUIET}` : "none", borderLeft: alerte ? `2px solid ${alerteColor}` : "2px solid transparent", paddingLeft: alerte ? "10px" : "12px", background: alerte ? `${alerteColor}0a` : "transparent" }}>
                      <span className="text-[12.5px] min-w-0 flex-1 sm:flex-none sm:w-28 truncate flex items-center gap-1" style={{ color: MUTED }} title={alerteObjectif ? t.forte_croissance_objectif_bas : undefined}>{alerte && <AlertTriangle size={11} color={alerteColor} />}{m.marketplace}</span>
                      <div className="hidden sm:block flex-1 h-4 rounded-full relative overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}><div className="h-full rounded-full" style={{ width: `${Math.max(2, (m.ca / maxMpCa) * 100)}%`, background: FAINT, transition: "width 0.6s cubic-bezier(.22,1,.36,1)" }} /></div>
                      <span className="text-[11.5px] tabular-nums w-14 sm:w-16 text-right shrink-0" style={{ color: MUTED }}>{fmtEURk(m.ca)}</span>
                      <span className="text-[11px] tabular-nums w-12 whitespace-nowrap text-right shrink-0" style={{ color: m.objectif_fiable ? FAINT : "#4A453E" }}>{m.objectif_fiable ? fmtPct(m.pct_objectif).replace('+','') : t.nd}</span>
                      <span className="min-w-[76px] text-right shrink-0 whitespace-nowrap"><YoyBadge pct={m.yoy_pct} naLabel={t.nouveau} lang={lang} /></span>
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
            {SOUS_INFOS && (<div className="flex items-center gap-1.5 mb-6 px-1 text-[10.5px]" style={{ color: FAINT }}>
              <Info size={11} /> {internationalData.nbPays} pays sur cette sélection · {fmtEUR(internationalData.totalCa)} au total · % = part de l'objectif annuel du pays déjà atteinte
            </div>)}

            {globalMp === "Toutes" && (
              <>
                <ZoneLabel>{t.pub_par_pays}</ZoneLabel>
                <Eyebrow tone="quiet" hint={t.pub_par_pays_hint}>{t.detail_pays} ({t.depense_ads})</Eyebrow>
                <GlassCard className="p-1.5" quiet scrollReveal>
                  {DATA.country_ads.map((c, i) => (
                    <div key={c.pays} className="flex items-center gap-2 sm:gap-3 px-2 sm:px-3 py-2" style={{ borderBottom: i < DATA.country_ads.length - 1 ? `1px solid ${PANEL_BORDER_QUIET}` : "none" }}>
                      <span className="text-[12px] min-w-0 flex-1 sm:flex-none sm:w-32 truncate" style={{ color: INK }}>{translatePays(c.pays, lang)}</span>
                      <span className="text-[11px] tabular-nums w-[68px] sm:w-20 text-right shrink-0" style={{ color: MUTED }}>{fmtEURplain(c.spend)}</span>
                      <span className="text-[11px] tabular-nums w-[72px] sm:w-20 text-right shrink-0" style={{ color: ORANGE_SOFT }}>{fmtEURplain(c.ca)}</span>
                      <span className="text-[10.5px] tabular-nums w-11 sm:w-14 text-right shrink-0 font-semibold" style={{ color: c.roas > 8 ? GREEN : c.roas > 3 ? AMBER : c.roas ? RED : FAINT }}>{c.roas ? `${c.roas}x` : "N/A"}</span>
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
                { id: "marque", label: t.zone_marque }, { id: "repartitions", label: t.rep_tab }, { id: "produits", label: t.zone_produits_titre },
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
              {globalMp === "Toutes" && SOUS_INFOS && <div className="flex items-center gap-1.5 mt-2 text-[11px]" style={{ color: FAINT }}><Info size={11} /> {t.thomson_hint.replace("{ca}", fmtEURplain(DATA.brand_yoy.Thomson["2025"]))}</div>}
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
              {SOUS_INFOS && (<div className="flex items-center gap-1.5 mt-2 text-[11px]" style={{ color: FAINT }}><Info size={11} /> {t.marque_reconstituee} {DATA.brand_coverage_pct["2026"]}%</div>)}
              <div className="flex justify-end mt-2"><button type="button" data-rep="lien-marque" onClick={() => { setRepLent("marque"); setMarquesTab("repartitions"); }} className="btn-lift inline-flex items-center gap-1 text-[11.5px] font-semibold px-2.5 py-1 rounded-full" style={{ color: ORANGE_SOFT, background: `${ORANGE}14`, border: `1px solid ${ORANGE}33` }}>{t.rep_lien_marque} <ChevronRight size={13} /></button></div>
            </GlassCard>
            </>
            )}

            {marquesTab === "repartitions" && (
            <>
            <ZoneLabel first>{t.rep_titre}</ZoneLabel>
            <RepartitionsView t={t} lang={lang} globalMp={globalMp} accent={mpAccent} lent={repLent} onLent={setRepLent} />
            </>
            )}

            {marquesTab === "produits" && (
            <>
            <div>
              <ZoneLabel first>{t.zone_produits_titre}</ZoneLabel>
            </div>

            <SectionHeader hint={t.cat_potentiel_hint} essentiel>{t.cat_potentiel_titre}</SectionHeader>
            <GlassCard className="p-3 mb-3" scrollReveal>
              <div className="grid gap-2" style={{ gridTemplateColumns: "1fr repeat(2, auto)" }}>
                {potentielAnnuelByCategory.map((c) => (
                  <React.Fragment key={c.categorie}>
                    <div className="text-[11.5px] flex items-center gap-1.5 min-w-0" style={{ color: INK }}>
                      <span className="truncate">{c.categorie}</span>
                      <span className="text-[9px] shrink-0" style={{ color: FAINT }}>({c.nbProduits})</span>
                      {!c.saisonnaliteFiable && <Info size={9} className="shrink-0" style={{ color: FAINT }} title={t.cat_saisonnalite_limitee} />}
                    </div>
                    <div className="text-[11px] text-right tabular-nums" style={{ color: FAINT }}>
                      {fmtEURk(c.potentiel2025)} <span className="text-[8.5px]">’25</span>
                    </div>
                    <div className="text-[11.5px] text-right tabular-nums font-semibold flex items-center justify-end gap-1" style={{ color: mpAccent.primary }}>
                      {fmtEURk(c.potentiel2026)} <span className="text-[8.5px] font-normal" style={{ color: FAINT }}>’26</span>
                      {c.evolutionPct !== null && (
                        <span className="text-[9px] font-semibold" style={{ color: c.evolutionPct >= 0 ? GREEN : RED }}>
                          {c.evolutionPct >= 0 ? "+" : ""}{c.evolutionPct.toFixed(0)}%
                        </span>
                      )}
                    </div>
                  </React.Fragment>
                ))}
              </div>
            </GlassCard>

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
                            <div className="flex items-center justify-between mb-2">
                              <div className="text-[9px] uppercase tracking-wider font-semibold" style={{ color: ORANGE_SOFT }}>{t.pd_courbe_titre}</div>
                            </div>
                            {(() => {
                              const m = monthlyCaByProduct[p.produit];
                              if (!m) return <div className="text-[10px]" style={{ color: FAINT }}>{t.pd_prix_non_dispo}</div>;
                              const forecast = buildForecastMensuel(m[2026], m.qte2026, seasonalityForProduct(p.produit));
                              const chartData = DATA.mois_labels.map((mois, i) => {
                                const fm = forecast.parMois[i];
                                const estJonction = i === MOIS_EN_COURS_IDX ? fm.reel : (fm.estime !== null ? Math.round(fm.estime) : null);
                                const qteAffichee = fm.reelQte ?? (fm.estimeQte !== null && fm.estimeQte !== undefined ? Math.round(fm.estimeQte) : null);
                                return {
                                  mois, "2025": Math.round(m[2025][i]) || null,
                                  reel: (fm.statut === "reel" || fm.statut === "en_cours") ? fm.reel : null,
                                  estime: estJonction,
                                  rupture: fm.statut === "rupture" ? (fm.estime ? Math.round(fm.estime) : 0) : null,
                                  qte: qteAffichee, qteEstimee: fm.statut === "rupture" || fm.statut === "futur",
                                };
                              });
                              const nbRuptures = forecast.parMois.filter((fm) => fm.statut === "rupture").length;
                              return (
                                <>
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
                                      <Tooltip contentStyle={{ background: "#16140F", border: `1px solid ${PANEL_BORDER}`, borderRadius: 8, fontSize: 11 }}
                                        formatter={(v, nom, item) => {
                                          if (nom === "qte") return [null, null];
                                          const suffixe = nom !== "2025" && item.payload.qte !== null ? ` · ${fmtNum(item.payload.qte)} u.${item.payload.qteEstimee ? " (est.)" : ""}` : "";
                                          return [fmtEURplain(v) + suffixe, nom === "estime" ? t.pd_estime_saison : nom === "rupture" ? t.pd_rupture : nom];
                                        }} />
                                      <Area type="monotone" dataKey="2025" stroke={FAINT} strokeWidth={1.5} fill="none" strokeDasharray="3 3" dot={false} />
                                      <Area type="monotone" dataKey="estime" stroke={MUTED} strokeWidth={1.5} strokeDasharray="4 3" fill="none" dot={false} />
                                      <Area type="monotone" dataKey="reel" stroke={mpAccent.primary} strokeWidth={2} fill={`url(#grad2026-${p.produit})`} dot={false} />
                                      <Area type="monotone" dataKey="rupture" stroke="none" fill="none" dot={{ r: 3, fill: RED, strokeWidth: 0 }} />
                                    </AreaChart>
                                  </ResponsiveContainer>
                                  <div className="flex items-center justify-between mt-2 flex-wrap gap-2">
                                    <div className="flex items-center gap-3 text-[9.5px]" style={{ color: FAINT }}>
                                      <span className="flex items-center gap-1"><span className="w-2 h-0.5 rounded-full" style={{ background: mpAccent.primary }} /> {t.pd_reel}</span>
                                      <span className="flex items-center gap-1"><span className="w-2 h-0.5 rounded-full" style={{ background: MUTED, opacity: 0.7 }} /> {t.pd_estime_saison}</span>
                                      {nbRuptures > 0 && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full" style={{ background: RED }} /> {t.pd_rupture} ({nbRuptures})</span>}
                                    </div>
                                    <div className="text-right">
                                      <div className="text-[8.5px] uppercase tracking-wider mb-0.5" style={{ color: FAINT }}>{t.pd_potentiel_titre}</div>
                                      <div className="flex items-center justify-end gap-2.5">
                                        <span className="text-[11px]" style={{ color: MUTED }}>
                                          {fmtEURk(potentielAnnuelByProduct[p.produit]?.potentiel2025 ?? 0)} <span className="text-[8.5px]" style={{ color: FAINT }}>{t.pd_potentiel_2025}</span>
                                        </span>
                                        <span className="text-[12px] font-semibold" style={{ color: mpAccent.primary }}>
                                          {fmtEURk(forecast.forecastAnnuel)} <span className="text-[8.5px] font-normal" style={{ color: FAINT }}>{t.pd_potentiel_2026}</span>
                                        </span>
                                      </div>
                                      <div className="text-[9.5px]" style={{ color: FAINT }}>{fmtNum(Math.round(forecast.forecastAnnuelQte))} u.</div>
                                    </div>
                                  </div>
                                  {forecast.nbMoisReels > 0 && forecast.nbMoisReels < 3 && (
                                    <div className="flex items-start gap-1.5 mt-2 text-[9.5px]" style={{ color: FAINT }}>
                                      <Info size={10} className="mt-0.5 shrink-0" /> {t.pd_forecast_fragile}
                                    </div>
                                  )}
                                </>
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
            {SOUS_INFOS && (<div className="flex items-center gap-1.5 mb-6 text-[10.5px]" style={{ color: FAINT }}>
              <Info size={11} /> {allProductsYTDFiltered.length} {allProductsYTDFiltered.length > 1 ? t.resultats : t.resultat} · {mpLabel} · {t.sum_annee_complete}
            </div>)}

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
                <StaggerRow key={p.produit} index={i} className="flex items-center gap-2 sm:gap-3 px-3 py-2.5" style={{ borderBottom: i < restProd.length - 1 ? `1px solid ${PANEL_BORDER_QUIET}` : "none" }}>
                  <span className="text-[12px] min-w-0 flex-1 sm:flex-none sm:w-40 truncate" style={{ color: MUTED }}>{p.produit}</span>
                  <div className="hidden sm:block flex-1 h-4 rounded-full relative overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}><div className="h-full rounded-full" style={{ width: `${Math.max(2, (p.ca / maxProdCa) * 100)}%`, background: FAINT, transition: "width 0.6s cubic-bezier(.22,1,.36,1)" }} /></div>
                  <span className="text-[11.5px] tabular-nums w-14 text-right shrink-0" style={{ color: MUTED }}>{fmtEURk(p.ca)}</span>
                  <span className="text-[11px] tabular-nums w-14 sm:w-16 text-right shrink-0 whitespace-nowrap" style={{ color: FAINT }}>{p.qte !== null ? `${fmtNum(p.qte)} u.` : t.nd}</span>
                  <span className="min-w-[76px] text-right shrink-0 whitespace-nowrap"><YoyBadge pct={p.yoy_pct} naLabel={t.nouveau} lang={lang} /></span>
                </StaggerRow>
              ))}
            </GlassCard>

            <Eyebrow tone="quiet" hint={t.ca_mois_top6_hint}>{t.ca_mois_top6}</Eyebrow>
            <GlassCard className="p-4" scrollReveal>
              <div className="overflow-x-auto">
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
            {SOUS_INFOS && (<div className="flex items-center gap-1.5 mb-6 text-[10.5px]" style={{ color: FAINT }}>
              <Info size={11} /> Donnée globale (2025+2026), pas encore filtrable par marketplace ou période — les paires viennent des numéros de commande réels.
            </div>)}
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
                {SOUS_INFOS && (<div className="flex items-center gap-1.5 mb-4 text-[10.5px]" style={{ color: FAINT }}>
                  <Info size={11} /> Profil pondéré par le CA réel des références vendues sur cette marketplace (déstockage exclu du profil) — pas une invention, un reflet de ce qui se vend vraiment.
                </div>)}
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
            {SOUS_INFOS && (<div className="flex items-center gap-1.5 mb-3 text-[11px]" style={{ color: FAINT }}>
              <Info size={11} /> {DATA.category_by_mp.coverage[catMpFilter] ?? 0}% {t.rattache_catalogue}{catMpFilter === "Toutes" ? "" : ` (${catMpFilter})`}
            </div>)}
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
                  {SOUS_INFOS && (<div className="flex items-center gap-1.5 mt-4 pt-3 text-[10.5px]" style={{ color: FAINT, borderTop: `1px solid ${PANEL_BORDER_QUIET}` }}>
                    <Info size={11} /> {wattageAnalysis.couverturePct.toFixed(0)}% des unités vendues sur cette sélection ont une puissance identifiable dans leur nom produit.
                  </div>)}
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

            <GlassCard className="p-5 mb-4 text-center" scrollReveal>
              <div className="w-11 h-11 rounded-full mx-auto mb-3 flex items-center justify-center" style={{ background: `${ORANGE}18` }}>
                <ExternalLink size={18} color={ORANGE} />
              </div>
              <div className="text-[13px] font-semibold mb-1.5" style={{ color: INK }}>{t.promo_titre}</div>
              <p className="text-[11.5px] mb-4 max-w-sm mx-auto" style={{ color: FAINT, lineHeight: 1.5 }}>{t.promo_externe_desc}</p>
              <a href="https://claude.ai/artifact/Fx2ku3X3zFsSFN6gDeegBy" target="_blank" rel="noopener noreferrer"
                className="btn-lift inline-flex items-center gap-2 text-[12px] font-semibold px-5 py-2.5 rounded-full"
                style={{ background: `linear-gradient(135deg, ${ORANGE}, ${ORANGE_SOFT})`, color: "#0A0908" }}>
                {t.promo_ouvrir_outil} <ExternalLink size={13} />
              </a>
            </GlassCard>

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

            {priceTotalMatches > 40 && (
              <div className="flex items-center gap-1.5 mb-3 text-[11.5px]" style={{ color: FAINT }}>
                <Info size={12} /> {t.affine_recherche}
              </div>
            )}


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
              <GlassCard className="p-4">
                <div className="overflow-x-auto">
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
            <div className="flex items-center gap-1.5 mb-3 text-[11px]" style={{ color: FAINT }}>
              <Info size={11} /> {lang === "en" ? `Data from the marketing budget file: ${ADS_PERIODE.en} (no spend entered after June) — share of budget used is understated as of today.`
                : lang === "es" ? `Datos del archivo de presupuesto de marketing: ${ADS_PERIODE.es} (sin gasto registrado después de junio) — el % de presupuesto consumido está subestimado a día de hoy.`
                : lang === "zh" ? `数据来自营销预算文件：${ADS_PERIODE.zh}（6月之后未录入支出）— 预算使用率按当前日期被低估。`
                : `Données du fichier budget marketing : ${ADS_PERIODE.fr} (aucune dépense saisie après juin) — la part de budget consommée est sous-estimée à ce jour.`}
            </div>
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
                <StaggerRow key={a.marketplace} index={i} className="flex items-center gap-2 sm:gap-3 px-3 py-2.5" style={{ borderBottom: i < restAdsList.length - 1 ? `1px solid ${PANEL_BORDER_QUIET}` : "none" }}>
                  <span className="text-[12.5px] min-w-0 flex-1 sm:flex-none sm:w-28 truncate" style={{ color: MUTED }}>{a.marketplace}</span>
                  <span className="text-[11.5px] tabular-nums w-14 sm:w-16 text-right shrink-0" style={{ color: FAINT }}>{fmtEURk(a.spend)}</span>
                  <span className="text-[11.5px] tabular-nums w-14 sm:w-16 text-right shrink-0" style={{ color: MUTED }}>{fmtEURk(a.ca_genere)}</span>
                  <span className="text-[11px] tabular-nums w-10 text-right shrink-0 font-semibold" style={{ color: a.roas > 8 ? GREEN : a.roas > 3 ? AMBER : FAINT }}>{a.roas ? `${a.roas}x` : "N/A"}</span>
                  <div className="hidden sm:block flex-1 h-3 rounded-full relative overflow-hidden" style={{ background: "rgba(255,255,255,0.04)" }}>
                    {a.pct_budget !== null && <div className="h-full rounded-full" style={{ width: `${Math.min(100, a.pct_budget)}%`, background: a.pct_budget > 60 ? RED : a.pct_budget > 35 ? AMBER : GREEN, transition: "width 0.8s cubic-bezier(.22,1,.36,1)" }} />}
                  </div>
                  <span className="text-[10.5px] tabular-nums w-10 text-right shrink-0" style={{ color: FAINT }}>{a.pct_budget !== null ? `${a.pct_budget.toFixed(0)}%` : "n/d"}</span>
                </StaggerRow>
              ))}
            </GlassCard>
            {SOUS_INFOS && (<div className="flex items-center gap-1.5 mt-2 text-[11px]" style={{ color: FAINT }}><Info size={11} /> {t.pas_budget_n1}</div>)}
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
                {SOUS_INFOS && (<div className="flex items-center gap-1.5 mt-4 pt-3 text-[10.5px]" style={{ color: FAINT, borderTop: `1px solid ${PANEL_BORDER_QUIET}` }}>
                  <Info size={11} /> Estimation de quantité annuelle des concurrents non disponible — cette donnée n'est jamais publiée par les revendeurs, aucune source ne la fournit.
                </div>)}
              </GlassCard>
            )}

            {/* repère de fraîcheur + comment mettre à jour — informatif, pas un faux bouton
                qui prétendrait déclencher une action qu'il ne peut pas accomplir */}
            <div className="flex items-center gap-1.5 mb-5 text-[11px] flex-wrap" style={{ color: FAINT }}>
              <CalendarDays size={12} /> Dernière collecte : {COMPETITION_DATA.collecte_date}
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

        {tab === "data" && (
          <>
            <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
              <SectionHeader hint={t.data_hint}>{t.data_titre}</SectionHeader>
            </div>
            {SOUS_INFOS && (<div className="flex items-center gap-1.5 mb-6 text-[11px]" style={{ color: FAINT }}>
              <Info size={11} /> {t.data_intro}
            </div>)}

            <GlassCard className="p-4 mb-4" scrollReveal>
              <div className="relative mb-3">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: FAINT }} />
                <input type="text" value={dataSearch} onChange={(e) => setDataSearch(e.target.value)} placeholder={t.data_recherche_placeholder}
                  className="w-full text-[13px] pl-9 pr-3 py-2.5 rounded-xl outline-none" style={{ background: PANEL, border: `1px solid ${PANEL_BORDER}`, color: INK }} />
              </div>

              <div className="max-h-64 overflow-y-auto rounded-xl mb-3" style={{ border: `1px solid ${PANEL_BORDER_QUIET}` }}>
                {dataProduitsFiltres.length === 0 ? (
                  <div className="p-4 text-center text-[11px]" style={{ color: FAINT }}>{t.data_aucun_resultat}</div>
                ) : dataProduitsFiltres.map((nom, i) => {
                  const coche = dataSelected.has(nom);
                  return (
                    <button key={nom} onClick={() => setDataSelected((prev) => { const next = new Set(prev); if (next.has(nom)) next.delete(nom); else next.add(nom); return next; })}
                      className="w-full flex items-center gap-2.5 px-3 py-2 text-left btn-lift"
                      style={{ borderBottom: i < dataProduitsFiltres.length - 1 ? `1px solid ${PANEL_BORDER_QUIET}` : "none", background: coche ? `${mpAccent.primary}12` : "transparent" }}>
                      <span className="w-4 h-4 rounded flex items-center justify-center shrink-0" style={{ background: coche ? mpAccent.primary : "transparent", border: `1px solid ${coche ? mpAccent.primary : PANEL_BORDER}` }}>
                        {coche && <Check size={11} color="#0A0908" strokeWidth={3} />}
                      </span>
                      <span className="text-[12.5px] truncate" style={{ color: INK }}>{nom}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-[11px]" style={{ color: FAINT }}>
                  {dataSelected.size === 0 ? t.data_aucune_selection : `${dataSelected.size} ${dataSelected.size > 1 ? t.data_produits_selectionnes_pl : t.data_produits_selectionnes_sg}`}
                </span>
                <div className="flex items-center gap-2">
                  {dataSelected.size > 0 && (
                    <button onClick={() => setDataSelected(new Set())} className="text-[11px] btn-lift" style={{ color: FAINT }}>{t.data_tout_deselectionner}</button>
                  )}
                  <button
                    disabled={dataSelected.size === 0 || dataGenerating}
                    onClick={async () => {
                      setDataGenerating(true); setDataErreur(false);
                      try { await genererRapportExcel([...dataSelected]); }
                      catch (e) { setDataErreur(true); }
                      finally { setDataGenerating(false); }
                    }}
                    className="btn-lift flex items-center gap-2 text-[12px] font-semibold px-4 py-2 rounded-full"
                    style={{ background: dataSelected.size === 0 ? PANEL_QUIET : `linear-gradient(135deg, ${ORANGE}, ${ORANGE_SOFT})`, color: dataSelected.size === 0 ? FAINT : "#0A0908", opacity: dataGenerating ? 0.7 : 1 }}>
                    <Download size={13} /> {dataGenerating ? t.data_generation_en_cours : t.data_generer_excel}
                  </button>
                </div>
              </div>
              {dataErreur && <div className="text-[11px] mt-2" style={{ color: RED }}>{t.data_erreur_generation}</div>}
            </GlassCard>

            {SOUS_INFOS && (<div className="flex items-start gap-1.5 text-[10.5px]" style={{ color: FAINT }}>
              <Info size={10} className="mt-0.5 shrink-0" /> {t.data_note_contenu}
            </div>)}
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
          <span className="text-[11px]" style={{ color: FAINT }}>{t.tous_montants_ht}</span>
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

// Écran affiché à la place du tableau de bord quand les ventes Shopify sont illisibles ou incomplètes (voir « DONNÉES »)
function DonneesIndisponibles() {
  const browserLang = (typeof navigator !== "undefined" && navigator.language || "fr").slice(0, 2);
  const et = I18N[browserLang] && I18N[browserLang].donnees_indispo_titre ? I18N[browserLang] : I18N.fr;
  return (
    <div role="alert" className="fixed inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center" style={{ background: BG, color: INK }}>
      <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: `${ORANGE}22` }}>
        <AlertTriangle size={18} color={ORANGE_SOFT} />
      </div>
      <p className="text-[14px] font-semibold">{et.donnees_indispo_titre}</p>
      <p className="text-[12.5px] max-w-sm" style={{ color: MUTED }}>{et.donnees_indispo_msg}</p>
      {(SOCLE.erreurs || []).slice(0, 3).map((e, k) => <p key={k} className="text-[11px] max-w-sm" style={{ color: FAINT }}>{e}</p>)}
      <button onClick={() => window.location.reload()} className="btn-lift text-[12px] font-semibold px-5 py-2 rounded-full mt-1"
        style={{ background: `linear-gradient(135deg, ${ORANGE}, ${ORANGE_SOFT})`, color: "#0A0908" }}>
        {et.recharger}
      </button>
    </div>
  );
}

// "se souvenir de moi" — persistance légère côté client (localStorage), sans
// backend pour la valider : cohérent avec le choix déjà fait de sécuriser
// l'accès uniquement via Vercel/le mot de passe partagé, pas via ce mécanisme
// (qui ne vise que le confort — éviter de retaper le mot de passe à chaque
// visite sur le même appareil — pas une vraie barrière de sécurité)
const REMEMBER_KEY = "homy_remember_until";
const REMEMBER_DAYS = 30;
function aUneSessionMemorisee() {
  try {
    const val = Number(localStorage.getItem(REMEMBER_KEY));
    return Number.isFinite(val) && val > Date.now();
  } catch { return false; }
}
function memoriserSession() {
  try { localStorage.setItem(REMEMBER_KEY, String(Date.now() + REMEMBER_DAYS * 86400000)); } catch { /* stockage indisponible (navigation privée) — tant pis, pas bloquant */ }
}

// Écran de conversation retiré du parcours le 14/10/2026 à la demande du propriétaire :
// ses deux étapes (« Pose ta question, ou choisis une destination » puis « Quelle marketplace ? »)
// ne s'affichent plus, l'app ouvre directement le dashboard après l'écran d'accès.
// Le composant ChatRouter (et l'assistant IA qu'il porte) reste défini plus haut, inutilisé.
// Pour le remettre : réintroduire un état chatDone et l'étape ChatRouter entre EntryGate et
// DashboardApp (voir le commit précédent dans l'historique git).
export default function App() {
  const [unlocked, setUnlocked] = useState(() => aUneSessionMemorisee());
  return (
    <ErrorBoundary>
      {!unlocked ? <EntryGate onUnlock={() => setUnlocked(true)} /> : (SOCLE.appliquee ? <DashboardApp /> : <DonneesIndisponibles />)}
    </ErrorBoundary>
  );
}
