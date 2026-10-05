#!/usr/bin/env python3
"""Merge today's scraped listings into listings.json and write the daily email.

Usage:
  HOME_LL="lat,lng" python3 tools/update.py tools/incoming.jsonl --seen tools/seen.txt [--today YYYY-MM-DD]

incoming.jsonl  one JSON object per line. Two shapes are accepted:
  * price check:  {"id": "...", "price": 123000, "status": "Active"}   (id already in listings.json)
  * full record:  the same fields as listings.json entries (id, price, acres, addr, city, zip, lat, lng,
                  mls, posted, type, zoning, hoa, water, power, sewer, parcel, broker, desc, status,
                  history, imgs or seq, url, source) plus "osrmSec" (raw OSRM drive seconds from home)
                  and optional "approx": true when lat/lng is a town-level guess.
seen.txt        every LandSearch listing id present in today's county search results (one per line).
                Listings from LandSearch that are missing two runs in a row are dropped as "no longer listed".

Writes listings.json, tools/out/email.html, tools/out/email.txt and tools/out/summary.json.
"""
import json, math, os, re, sys, argparse, datetime, html
from zoneinfo import ZoneInfo

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
APP_URL = "https://shawnjspencer.github.io/barn-finder/"
MAX_PRICE, MIN_ACRES, MAX_DRIVE = 1_500_000, 5, 75     # drive = estimated minutes
DRIVE_FACTOR = 0.7                                      # OSRM demo runs ~40% slow vs. real-world

def hav(a, b):
    R = 3958.8
    p1, p2 = math.radians(a[0]), math.radians(b[0])
    dp, dl = p2 - p1, math.radians(b[1] - a[1])
    return 2 * R * math.asin(math.sqrt(math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2))

def expand_imgs(d):
    if "seq" in d:
        k, slug, n, c = d.pop("seq")
        return [f"https://cdn.landsearch.com/listings/{k}/large/{slug}-{n + i}.jpg" for i in range(c)]
    return [u.replace("/small/", "/large/") for u in d.get("imgs") or []]

def flags(d):
    w = (d.get("water") or "").lower()
    if not w: wf = "unknown"
    elif re.search(r"\bno water|none;|^none|need to acquire|no water rights", w): wf = "no"
    elif re.search(r"permit|sold separately|available", w) and not re.search(r"drilled|installed|included|in place|on site|stub|share|well runs|ready|culinary|public", w): wf = "partial"
    else: wf = "yes"
    p = (d.get("power") or "").lower()
    if not p: pf = "unknown"
    elif re.search(r"no utilities|no power|none", p): pf = "no"
    elif re.search(r"no electrical|off.?grid|solar|generator", p) and not re.search(r"grid available|grid power", p): pf = "off-grid"
    elif re.search(r"available|nearby|borders|along|further|lot line|at road|need|pull|bring|extend|to be run", p) and not re.search(r"stub|on site|in place|panel|connected", p): pf = "nearby"
    else: pf = "yes"
    h = d.get("hoa")
    hf = "unknown" if not h else ("none" if str(h).lower().startswith("none") else "yes")
    t = (d.get("type") or "").lower()
    cat = "barn" if "barn" in t or "equestrian" in t else ("house" if "house" in t or "residence" in t or "home" in t else "land")
    return wf, pf, hf, cat

COUNTY_BY_ZIP = {"Utah": "84651 84655 84660 84663 84633 84013 84626 84043 84653 84664 84062 84003 84005 84045 84004".split(),
                 "Juab": "84639 84648 84645 84628".split(), "Wasatch": "84032 84049 84082".split(), "Salt Lake": "84096 84065 84020".split()}
ZIP_COUNTY_ID_WY = {
    "Bonneville, ID": "83428 83449 83401 83402 83404 83406 83427".split(),
    "Teton, ID": "83422 83452 83455 83424".split(),
    "Jefferson, ID": "83442 83444 83434 83443 83450".split(),
    "Madison, ID": "83440 83448 83445".split(),
    "Lincoln, WY": "83110 83111 83112 83118 83119 83120 83122 83123 83126 83127 83128".split(),
    "Teton, WY": "83414 83001 83014".split()}
def county(z):
    for c, zs in COUNTY_BY_ZIP.items():
        if z in zs: return c
    for c, zs in ZIP_COUNTY_ID_WY.items():
        if z in zs: return c
    return "Sanpete"

def money(n): return "${:,.0f}".format(n)

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("incoming"); ap.add_argument("--seen"); ap.add_argument("--today")
    ap.add_argument("--data", default="listings.json"); ap.add_argument("--out", default="tools/out"); ap.add_argument("--label", default="Salem, UT")
    a = ap.parse_args()
    now = datetime.datetime.now(ZoneInfo("America/Denver"))
    today = a.today or now.date().isoformat()
    home = tuple(float(x) for x in os.environ["HOME_LL"].split(","))
    path = os.path.join(ROOT, a.data)
    J = json.load(open(path))
    by_id = {d["id"]: d for d in J["listings"]}
    by_mls = {d["mls"]: d for d in J["listings"] if d.get("mls")}
    changes, skipped = [], []

    incoming = [json.loads(l) for l in open(a.incoming) if l.strip()] if os.path.exists(a.incoming) else []
    for r in incoming:
        cur = by_id.get(r["id"]) or (by_mls.get(r.get("mls")) if r.get("mls") else None)
        if cur:
            cur["missCount"] = 0
            if r.get("price") and r["price"] != cur["price"]:
                old = cur["price"]
                cur["history"] = (cur.get("history") or []) + [[today, "Price drop" if r["price"] < old else "Price increase", r["price"]]]
                cur["price"] = r["price"]
                changes.append({"date": today, "kind": "price", "id": cur["id"], "old": old, "new": r["price"]})
            if r.get("status") and r["status"] != cur.get("status"):
                if re.search(r"contract|pending", r["status"], re.I) and not re.search(r"contract|pending", cur.get("status") or "", re.I):
                    changes.append({"date": today, "kind": "pending", "id": cur["id"]})
                cur["status"] = r["status"]
            for k in ("water", "power", "zoning", "hoa", "mls", "sewer", "desc"):
                if r.get(k) and not cur.get(k): cur[k] = r[k]
            if r.get("imgs") or r.get("seq"):
                imgs = expand_imgs(r)
                if len(imgs) > len(cur.get("imgs") or []): cur["imgs"] = imgs
            if cur["price"] > MAX_PRICE:
                changes.append({"date": today, "kind": "removed", "id": cur["id"], "why": f"price raised to {money(cur['price'])}"})
                J["listings"].remove(cur); by_id.pop(cur["id"], None)
            continue
        # new listing
        need = ("price", "acres", "lat", "lng", "osrmSec", "url")
        if any(r.get(k) is None for k in need):
            skipped.append({"id": r.get("id"), "why": "missing " + ",".join(k for k in need if r.get(k) is None)}); continue
        drive = round(r.pop("osrmSec") / 60 * DRIVE_FACTOR)
        acres_hi = r.get("acresMax") or r["acres"]
        if r["price"] > MAX_PRICE or acres_hi < MIN_ACRES or drive > MAX_DRIVE:
            skipped.append({"id": r["id"], "why": f"outside criteria ({money(r['price'])}, {r['acres']} ac, ~{drive} min)"}); continue
        r["imgs"] = expand_imgs(r)
        r["driveMin"], r["miles"] = drive, round(hav(home, (r["lat"], r["lng"])), 1)
        r["waterFlag"], r["powerFlag"], r["hoaFlag"], r["cat"] = flags(r)
        r.setdefault("county", county(r.get("zip", "")))
        r.setdefault("source", "LandSearch (MLS)")
        r["firstSeen"], r["missCount"] = today, 0
        r.setdefault("history", [[r.get("posted") or today, "New listing", r["price"]]])
        for k in ("beds", "baths", "sqft", "sewer", "approx", "priceMax", "acresMax", "mls", "zoning", "hoa", "water", "power", "parcel", "broker", "addr"):
            r.setdefault(k, None)
        J["listings"].append(r); by_id[r["id"]] = r
        changes.append({"date": today, "kind": "new", "id": r["id"]})

    # no-longer-listed detection (LandSearch-sourced only)
    if a.seen and os.path.exists(a.seen):
        seen = {l.strip() for l in open(a.seen) if l.strip()}
        if len(seen) >= 20:   # guard against a failed scrape wiping everything
            for d in list(J["listings"]):
                if not str(d.get("source", "")).startswith("LandSearch"): continue
                if d["id"] in seen: d["missCount"] = 0; continue
                d["missCount"] = d.get("missCount", 0) + 1
                if d["missCount"] >= 2:
                    changes.append({"date": today, "kind": "removed", "id": d["id"], "why": "no longer listed",
                                    "snap": {k: d.get(k) for k in ("city", "price", "acres", "url")}})
                    J["listings"].remove(d)

    # keep 30 days of change events
    cutoff = (datetime.date.fromisoformat(today) - datetime.timedelta(days=30)).isoformat()
    J["changes"] = [c for c in J.get("changes", []) if c["date"] >= cutoff] + changes
    J["updated"] = now.isoformat(timespec="minutes")
    J["listings"].sort(key=lambda d: d["driveMin"])
    json.dump(J, open(path, "w"), separators=(",", ":"))

    write_email(J, changes, skipped, today, os.path.join(ROOT, a.out), a.label)

def write_email(J, changes, skipped, today, out=None, label="Salem, UT"):
    out = out or os.path.join(ROOT, "tools", "out"); os.makedirs(out, exist_ok=True)
    by_id = {d["id"]: d for d in J["listings"]}
    new = [by_id[c["id"]] for c in changes if c["kind"] == "new" and c["id"] in by_id]
    price = [(by_id[c["id"]], c) for c in changes if c["kind"] == "price" and c["id"] in by_id]
    pend = [by_id[c["id"]] for c in changes if c["kind"] == "pending" and c["id"] in by_id]
    gone = [c for c in changes if c["kind"] == "removed"]
    e = html.escape
    S = {"wrap": "font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#22281F;background:#EEF0E8;padding:18px",
         "card": "background:#FBFBF7;border:1px solid #D3D8C8;border-radius:10px;margin:0 0 14px;overflow:hidden",
         "h": "font-family:Rockwell,Georgia,serif;color:#4E6248;margin:18px 0 8px;font-size:19px"}
    def row(d, note=""):
        img = f'<img src="{e(d["imgs"][0])}" width="560" style="width:100%;max-width:560px;height:auto;display:block" alt="">' if d.get("imgs") else ""
        util = f'Water: {d["waterFlag"]} · Power: {d["powerFlag"]} · HOA: {e(d.get("hoa") or "not stated")}'
        return f'''<div style="{S["card"]}">{img}<div style="padding:12px 14px">
<div style="font-size:20px;font-weight:700">{money(d["price"])} <span style="font-size:15px;color:#4E6248">· {d["acres"]} ac</span></div>
{f'<div style="color:#B65E3C;font-weight:600">{note}</div>' if note else ''}
<div style="color:#626B5B">{e(d["city"])}{" · " + e(d["addr"]) if d.get("addr") else ""} · ~{d["driveMin"]} min drive</div>
<div style="font-size:13px;margin-top:4px">{e(d.get("mls") or "No MLS #")} · Zoning: {e(d.get("zoning") or "not stated")}</div>
<div style="font-size:13px;color:#626B5B">{util}</div>
<p style="font-size:14px;margin:8px 0">{e(d.get("desc") or "")}</p>
<a href="{e(d["url"])}" style="color:#2F6B8F;font-weight:600">View listing</a> &nbsp;·&nbsp; <a href="{APP_URL}#list" style="color:#2F6B8F;font-weight:600">Open Barn Finder</a></div></div>'''
    parts = [f'<div style="{S["wrap"]}"><div style="max-width:600px;margin:0 auto">',
             f'<h1 style="font-family:Rockwell,Georgia,serif;color:#4E6248;margin:0 0 4px;font-size:24px">Barn Finder · {e(label)} · {datetime.date.fromisoformat(today):%b %-d}</h1>',
             f'<p style="margin:0 0 6px;color:#626B5B">{len(new)} new · {len(price)} price change{"s" if len(price)!=1 else ""} · {len(pend)} under contract · {len(gone)} off the list · {len(J["listings"])} tracked</p>']
    if new:
        parts.append(f'<h2 style="{S["h"]}">New listings</h2>'); parts += [row(d) for d in sorted(new, key=lambda d: d["driveMin"])]
    if price:
        parts.append(f'<h2 style="{S["h"]}">Price changes</h2>')
        parts += [row(d, f'{"Dropped" if c["new"] < c["old"] else "Raised"} {money(abs(c["new"]-c["old"]))} (was {money(c["old"])})') for d, c in price]
    if pend:
        parts.append(f'<h2 style="{S["h"]}">Went under contract</h2>'); parts += [row(d) for d in pend]
    if gone:
        parts.append(f'<h2 style="{S["h"]}">No longer on the list</h2><ul>')
        parts += [f'<li>{e((c.get("snap") or {}).get("city") or c["id"])} — {e(c.get("why",""))}</li>' for c in gone]
        parts.append("</ul>")
    if not (new or price or pend or gone):
        parts.append('<p style="font-size:15px">No new listings or price changes today. Everything in the app is current.</p>')
    parts.append(f'<p style="font-size:12px;color:#626B5B;margin-top:18px">Criteria: up to $1.5M, 5+ acres, within about an hour of {e(label)}. <a href="{APP_URL}" style="color:#2F6B8F">Open the app</a></p></div></div>')
    open(os.path.join(out, "email.html"), "w").write("\n".join(parts))
    txt = [f"Barn Finder ({label}) {today}: {len(new)} new, {len(price)} price changes, {len(pend)} under contract, {len(gone)} removed."]
    for d in new: txt.append(f"NEW  {money(d['price'])}  {d['acres']} ac  {d['city']}  ~{d['driveMin']} min  {d['url']}")
    for d, c in price: txt.append(f"PRICE {money(c['old'])} -> {money(c['new'])}  {d['acres']} ac  {d['city']}  {d['url']}")
    for d in pend: txt.append(f"UNDER CONTRACT  {d['city']}  {d['url']}")
    txt.append(APP_URL)
    open(os.path.join(out, "email.txt"), "w").write("\n".join(txt))
    json.dump({"new": len(new), "price": len(price), "pending": len(pend), "removed": len(gone), "skipped": skipped,
               "subject": f"Barn Finder: {len(new)} new, {len(price)} price change{'s' if len(price)!=1 else ''}" if (new or price) else "Barn Finder: no changes today"},
              open(os.path.join(out, "summary.json"), "w"), indent=1)

if __name__ == "__main__":
    main()
