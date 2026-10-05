#!/usr/bin/env python3
"""Combine the per-location daily emails into one message.

Usage: python3 tools/combine_email.py tools/out/salem tools/out/swan
Writes tools/out/email.html, tools/out/email.txt and tools/out/summary.json (with "subject").
"""
import json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
dirs = sys.argv[1:]
html_parts, txt_parts, totals = [], [], {"new": 0, "price": 0}
for d in dirs:
    d = os.path.join(ROOT, d) if not os.path.isabs(d) else d
    if not os.path.exists(os.path.join(d, "email.html")):
        continue
    html_parts.append(open(os.path.join(d, "email.html")).read())
    txt_parts.append(open(os.path.join(d, "email.txt")).read())
    s = json.load(open(os.path.join(d, "summary.json")))
    totals["new"] += s["new"]; totals["price"] += s["price"]
out = os.path.join(ROOT, "tools", "out")
open(os.path.join(out, "email.html"), "w").write('<div style="height:10px"></div>'.join(html_parts))
open(os.path.join(out, "email.txt"), "w").write("\n\n".join(txt_parts))
n, p = totals["new"], totals["price"]
subject = f"Barn Finder: {n} new, {p} price change{'s' if p != 1 else ''}" if (n or p) else "Barn Finder: no changes today"
json.dump({"subject": subject, **totals}, open(os.path.join(out, "summary.json"), "w"), indent=1)
print(subject)
