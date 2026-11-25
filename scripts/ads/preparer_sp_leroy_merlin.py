#!/usr/bin/env python3
"""Prépare data/ads/leroy_merlin_fr.json (détail « Campagnes Ads » de Leroy Merlin France).

Entrée : un dossier contenant les rapports Sponsored Products (.xlsx) de la plateforme Retail Media
Leroy Merlin France, tels que reçus par mail (« Bilan de campagne mensuel / hebdomadaire ») :
  - les rapports MENSUELS de chaque campagne (3P et 1P) ;
  - les rapports HEBDOMADAIRES du mois en cours (ils complètent le dernier mois, partiel).
Le nom des fichiers n'a pas d'importance : la campagne, la période et le type (mois / semaine)
sont lus dans l'onglet « header » de chaque rapport.

Usage :
  python3 scripts/ads/preparer_sp_leroy_merlin.py <dossier_rapports> [--rallonge 17000 --rallonge-date 2026-10-30] [--ecrire]

Sans --ecrire, le script affiche les contrôles et n'écrit rien. Il refuse d'écrire si le cumul
2026 recalculé s'écarte de plus de 5 € (ou 0,01 %) du le « cumul de la campagne » du rapport le plus
récent (onglet overall_statistics).

Dépendance : openpyxl (pip install openpyxl).
"""
import argparse, datetime as dt, glob, json, math, os, re, sys
from collections import defaultdict

import openpyxl

SORTIE = os.path.join(os.path.dirname(__file__), "..", "..", "data", "ads", "leroy_merlin_fr.json")
COL = {"Budget dépensé (€)": "spend", "CA Web (€)": "sales", "Clics": "clicks", "Impressions": "impr", "Conversion": "conv"}
NUM = ["spend", "sales", "clicks", "impr", "conv"]


def lignes(wb, feuille):
    if feuille not in wb.sheetnames:
        return []
    out, hdr = [], None
    for r in wb[feuille].iter_rows(values_only=True):
        if hdr is None:
            if r and r[0] is not None:
                hdr = list(r)
            continue
        if not r or r[0] is None:
            continue
        out.append({hdr[i]: r[i] for i in range(min(len(hdr), len(r))) if hdr[i]})
    return out


def d(s):
    return dt.datetime.strptime(s.strip(), "%d/%m/%Y").date()


def num(r):
    return {COL[k]: float(r.get(k) or 0) for k in COL}


def lire_rapports(dossier):
    rapports = []
    for f in sorted(glob.glob(os.path.join(dossier, "*.xlsx"))):
        wb = openpyxl.load_workbook(f, read_only=True, data_only=True)
        if "header" not in wb.sheetnames:
            continue
        h = lignes(wb, "header")[0]
        if "Sponsored Products" not in str(h.get("Offre")) or "France" not in str(h.get("Site web")):
            continue
        d0, d1 = [d(x) for x in h["Période"].split("-")]
        pf = "1P" if "1P" in h["Annonceur"] else "3P"
        rapports.append({
            "fichier": os.path.basename(f), "pf": pf, "campagne": h["Portefeuille"], "debut": d0, "fin": d1,
            "semaine": (d1 - d0).days < 8, "budget": h.get("Budget (€)"), "debut_campagne": h.get("Date de début de campagne"),
            "statut": h.get("Statut de campagne"),
            "produits": lignes(wb, "products"), "categories": lignes(wb, "categories"), "mots_cles": lignes(wb, "keywords"),
            "jours": lignes(wb, "daily_statistics"), "passe": lignes(wb, "past_statistics"),
            "global": (lignes(wb, "overall_statistics") or [None])[0],
            "periode": (lignes(wb, "statistics") or [None])[0],
        })
    return rapports


def r2(v, n=2):
    return None if v is None or (isinstance(v, float) and (math.isnan(v) or math.isinf(v))) else round(v, n)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dossier")
    ap.add_argument("--rallonge", type=float, default=None)
    ap.add_argument("--rallonge-date", default=None)
    ap.add_argument("--ecrire", action="store_true")
    a = ap.parse_args()

    R = lire_rapports(a.dossier)
    mens = [r for r in R if not r["semaine"]]
    hebdo = [r for r in R if r["semaine"]]
    if not mens:
        sys.exit("Aucun rapport mensuel Sponsored Products Leroy Merlin France dans ce dossier.")

    # ---- mensuel : historique « performances passées » du rapport mensuel le plus récent de chaque campagne
    par_mois = defaultdict(lambda: dict.fromkeys(NUM, 0.0))
    for camp in {r["campagne"] for r in mens}:
        dernier = max((r for r in mens if r["campagne"] == camp), key=lambda r: r["fin"])
        for p in dernier["passe"]:
            mois = d(p["Mois"]).strftime("%Y-%m")
            v = num(p)
            for k in NUM:
                par_mois[(mois, dernier["pf"])][k] += v[k]
    # ---- mois en cours (partiel) : semaines complètes des rapports hebdomadaires + jours du mois pris dans la semaine à cheval
    mois_hebdo = None
    if hebdo:
        fin = max(r["fin"] for r in hebdo)
        mois_hebdo = fin.strftime("%Y-%m")
        jours_mensuels = {}
        for r in mens:
            for j in r["jours"]:
                jours_mensuels[(r["pf"], d(j["Date"]))] = num(j)
        for pf in ("3P", "1P"):
            hs = [r for r in hebdo if r["pf"] == pf]
            if not hs:
                continue
            for r in hs:
                if r["debut"].strftime("%Y-%m") == mois_hebdo:
                    for k in NUM:
                        par_mois[(mois_hebdo, pf)][k] += num(r["periode"])[k]
            # semaine à cheval (commence le mois précédent) : total de la semaine − jours déjà dans le rapport mensuel
            dernier = max(hs, key=lambda r: r["fin"])
            for p in dernier["passe"]:
                debut = d(p["Semaine"])
                fin_s = debut + dt.timedelta(days=6)
                if debut.strftime("%Y-%m") != mois_hebdo and fin_s.strftime("%Y-%m") == mois_hebdo:
                    v = num(p)
                    for k in NUM:
                        deja = sum(jours_mensuels.get((pf, debut + dt.timedelta(days=i)), {}).get(k, 0) for i in range(7))
                        par_mois[(mois_hebdo, pf)][k] += max(0.0, v[k] - deja)
    mensuel = [{"mois": m, "pf": pf, **{k: r2(v[k]) for k in NUM}} for (m, pf), v in sorted(par_mois.items())]

    # ---- contrôle : cumul 2026 3P et 1P = cumul de campagne du rapport le plus récent
    for pf in ("3P", "1P"):
        tous = [r for r in R if r["pf"] == pf and r["campagne"].endswith("2026")]
        if not tous:
            continue
        dernier = max(tous, key=lambda r: r["fin"])
        g = dernier["global"]
        attendu = float(g["Budget dépensé (€)"])
        calc = sum(x["spend"] for x in mensuel if x["pf"] == pf and x["mois"] >= "2026")
        ecart = calc - attendu
        print(f"{pf} : dépense 2026 recalculée {calc:,.2f} € · cumul officiel {attendu:,.2f} € · écart {ecart:+.2f} €")
        if abs(ecart) > max(5.0, attendu * 1e-4):  # tolérance : la journée reconstituée à cheval sur deux mois (arrondis des rapports)
            sys.exit(f"ÉCART sur {pf} : rien n'est écrit.")

    # ---- produits (2026) et top 15 par mois
    def mois_rapport(r):
        return r["debut"].strftime("%Y-%m")
    couvert = {(r["pf"], mois_rapport(r)) for r in mens}
    R = [r for r in R if not (r["semaine"] and (r["pf"], mois_rapport(r)) in couvert)]  # une semaine à cheval reste comptée par le rapport mensuel
    prod = {}
    prod_mois = defaultdict(lambda: {"spend": 0.0, "sales": 0.0})
    for r in sorted(R, key=lambda r: r["debut"]):
        m = mois_rapport(r)
        if m < "2026":
            continue
        for p in r["produits"]:
            pid = str(p["Identifiant"])
            e = prod.setdefault(pid, {"id": pid, "produit": p["Nom du produit"], "pf": r["pf"], **dict.fromkeys(NUM, 0.0), "nov_spend": 0.0, "nov_sales": 0.0})
            e["produit"] = p["Nom du produit"]  # nom le plus récent
            v = num(p)
            for k in NUM:
                e[k] += v[k]
            prod_mois[(pid, m)]["spend"] += v["spend"]
            prod_mois[(pid, m)]["sales"] += v["sales"]
            if mois_hebdo and m == mois_hebdo:
                e["nov_spend"] += v["spend"]; e["nov_sales"] += v["sales"]
    for e in prod.values():
        e["categorie"] = categorie(e["produit"]); e["marque"] = marque(e["produit"]); e["gamme"] = gamme(e["produit"])
    produits = sorted(prod.values(), key=lambda e: -e["spend"])
    top = [e["id"] for e in produits[:15]]
    produits_mois = [{"id": pid, "mois": m, "spend": r2(v["spend"]), "sales": r2(v["sales"])} for (pid, m), v in sorted(prod_mois.items()) if pid in top]
    produits = [{**{k: (r2(v) if isinstance(v, float) else v) for k, v in e.items()}} for e in produits]

    # ---- catégories par mois (au niveau produit)
    cat = defaultdict(lambda: dict.fromkeys(NUM, 0.0))
    for r in R:
        m = mois_rapport(r)
        for p in r["produits"]:
            v = num(p)
            for k in NUM:
                cat[(m, categorie(p["Nom du produit"]))][k] += v[k]
    categories = [{"mois": m, "categorie": c, **{k: r2(v[k]) for k in ("spend", "sales", "clicks", "conv")}} for (m, c), v in sorted(cat.items())]

    # ---- jour par jour
    jours = defaultdict(lambda: dict.fromkeys(NUM, 0.0))
    vus = set()
    for r in R:
        for j in r["jours"]:
            cle = (r["pf"], j["Date"])
            if cle in vus:
                continue
            vus.add(cle)
            v = num(j)
            for k in NUM:
                jours[d(j["Date"]).isoformat()][k] += v[k]
    quotidien = [[jj, r2(v["spend"]), r2(v["sales"]), int(v["clicks"]), int(v["conv"])] for jj, v in sorted(jours.items())]

    # ---- mots-clés 2026
    kw = defaultdict(lambda: dict.fromkeys(NUM, 0.0))
    for r in R:
        if mois_rapport(r) < "2026":
            continue
        for p in r["mots_cles"]:
            v = num(p)
            for k in NUM:
                kw[str(p["Mot clé"])][k] += v[k]
    kw_tri = sorted(kw.items(), key=lambda x: -x[1]["spend"])
    mots_cles = [{"mot_cle": k, **{c: r2(v[c]) for c in ("spend", "sales", "clicks", "conv")}} for k, v in kw_tri[:40]]
    resume_kw = {"spend": r2(sum(v["spend"] for _, v in kw_tri)), "spend_sans_conv": r2(sum(v["spend"] for _, v in kw_tri if v["conv"] == 0)),
                 "n": len(kw_tri), "n_sans_conv": sum(1 for _, v in kw_tri if v["conv"] == 0)}

    # ---- budgets 2026 (en-tête du rapport le plus récent de chaque campagne 2026)
    budgets = []
    for pf in ("3P", "1P"):
        tous = [r for r in R if r["pf"] == pf and r["campagne"].endswith("2026")]
        if not tous:
            continue
        dernier = max(tous, key=lambda r: r["fin"])
        budgets.append({"pf": pf, "campagne": dernier["campagne"], "budget": dernier["budget"], "depense": r2(float(dernier["global"]["Budget dépensé (€)"])),
                        "au": dernier["fin"].isoformat(), "debut": dernier["debut_campagne"]})
    au = max(r["fin"] for r in R).isoformat()
    sortie = {
        "schema": 1, "marketplace": "LEROY MERLIN FR", "titre": "Leroy Merlin France", "dispositif": "Sponsored Products (3P + 1P)",
        "source": "Rapports Sponsored Products de la plateforme Retail Media Leroy Merlin France reçus par mail (mensuels + hebdomadaires du mois en cours)",
        "donnees_au": au, "prepare_le": dt.date.today().isoformat(), "mois_partiel": mois_hebdo,
        "campagnes": sorted({(r["campagne"], r["pf"]) for r in R}),
        "budgets": budgets,
        "rallonge": {"montant": a.rallonge, "signee": a.rallonge_date} if a.rallonge else None,
        "black_friday": {"2025": "2025-11-28", "2026": "2026-11-27", "2027": "2027-11-26"},
        "mensuel": mensuel, "categories": categories, "produits": produits, "produits_mois": produits_mois,
        "quotidien": quotidien, "mots_cles": mots_cles, "mots_cles_resume": resume_kw,
    }
    taille = len(json.dumps(sortie, ensure_ascii=False, separators=(",", ":")))
    print(f"{len(mensuel)} lignes mensuelles · {len(produits)} produits · {len(quotidien)} jours · {len(mots_cles)} mots-clés · {taille/1024:.0f} Ko · données au {au}")
    if a.ecrire:
        os.makedirs(os.path.dirname(SORTIE), exist_ok=True)
        with open(SORTIE, "w", encoding="utf-8") as fh:
            json.dump(sortie, fh, ensure_ascii=False, separators=(",", ":"))
        print("écrit :", os.path.normpath(SORTIE))


def categorie(n):
    u = n.lower()
    if "ventilateur" in u:
        return "Ventilateurs plafond" if "plafond" in u else "Ventilateurs"
    if re.search(r"s[èe]che[- ]?serviette", u):
        return "Sèche-serviettes"
    if any(x in u for x in ("mobile", "bain d", "soufflant", "convecteur")):
        return "Chauffage mobile/appoint"
    if "radiateur" in u:
        return "Radiateurs inertie"
    return "Autres"


def marque(n):
    u = n.upper()
    if "BESTHERM" in u:
        return "Bestherm"
    if "THOMSON" in u:
        return "Thomson"
    if "HOM'Y" in u or "HOMY" in u:
        return "HOM'Y"
    return "Autre"


STOP = {"BESTHERM", "THOMSON", "HOM'Y", "WIFI", "CONNECT", "FSC", "ABS", "W", "LED", "H", "L"}


def gamme(n):
    toks = [t for t in re.findall(r"\b[A-ZÉÈ][A-ZÉÈ'’]{2,}\b", n) if t not in STOP]
    if toks:
        return toks[0].title()
    m = re.search(r"(\w+)\s+(?:BESTHERM|Bestherm)", n)
    if m and m.group(1).lower() not in ("w", "blanc", "noir"):
        return m.group(1)
    return n[:20]


if __name__ == "__main__":
    main()
