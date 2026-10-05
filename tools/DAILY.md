# Daily update runbook

The app has two search locations, each with its own data file. Run steps 1-3 once per location,
then merge, publish and email once. The task prompt supplies each location's coordinates
(`HOME_LL`); they are deliberately not stored in this public repo.

| Location | Data file | Out folder | County search pages (price ≤ $1.5M, 5+ acres) |
|---|---|---|---|
| Salem, UT | `listings.json` | `tools/out/salem` | utah-county-ut, juab-county-ut, wasatch-county-ut, sanpete-county-ut, salt-lake-county-ut |
| Swan Valley, ID | `listings-swan.json` | `tools/out/swan` | bonneville-county-id, teton-county-id, jefferson-county-id, madison-county-id, lincoln-county-wy (2 pages), teton-county-wy |

Page 2 of a county search: put `/p2` AFTER the filter, e.g.
`.../lincoln-county-wy/filter/price[max]=1500000,size[min]=5/p2` (before the filter it drops the filter).
Listing details: `https://www.landsearch.com/properties/x/<id>` redirects to the full page.
LandSearch rate-limits bursts: fetch details 3-4 at a time with ~15 s pauses. If a page is refused
with a rate-limit error, don't retry that page today; note it and move on.

Skip towns well past an hour. Salem: Kamas, Woodland, Oakley, Manti, Mayfield, Ephraim, Gunnison,
Tooele, Vernon. Swan Valley: Kemmerer, La Barge, Cokeville, Moran, Smoot's Thomas Fork canyon.
Drop "Under contract" listings that aren't already tracked.

## 1. Collect today's search results (LandSearch, syndicated from the MLS)

WebFetch each county search for the location. Ask for every card's listing id
(the number at the end of the URL), price, acres, city, status text and URL. Salem pages:

- https://www.landsearch.com/properties/utah-county-ut/filter/price[max]=1500000,size[min]=5
- https://www.landsearch.com/properties/juab-county-ut/filter/price[max]=1500000,size[min]=5
- https://www.landsearch.com/properties/wasatch-county-ut/filter/price[max]=1500000,size[min]=5
- https://www.landsearch.com/properties/sanpete-county-ut/filter/price[max]=1500000,size[min]=5
- https://www.landsearch.com/properties/salt-lake-county-ut/filter/price[max]=1500000,size[min]=5

Swan Valley pages use the same pattern with the county slugs from the table above.
If a page says more than 50 properties, also fetch page 2 (`/p2` after the filter, as above).
Write every id seen to `tools/seen-<location>.txt` (one file per location).


## 2. Price/status checks for known listings

For ids already in that location's data file, add `{"id","price","status"}` lines to `tools/incoming-<location>.jsonl`.

## 3. Full details for new ids

WebFetch the listing page with this prompt and turn the answer into one JSON line:

> Output ONE line of minified JSON only, keys: price, acres, addr, city, zip, lat, lng, mls (exact string), posted (date of 'New listing' in price history, YYYY-MM-DD), type, beds, baths, sqft, zoning (string, all values joined), hoa (fee text or "None" or null), water (short quote of any culinary/well/irrigation/water shares/water rights text), power (short quote of electricity/power text), sewer, parcel (first parcel number), broker, desc (max 220 chars), status, history (array of [YYYY-MM-DD, event, price]), imgs (array, up to 15 cdn.landsearch.com image URLs). null when not stated.

Add `id`, `url`, and `type` normalized to one of: "Land", "House on acreage", "House with barn",
"Land with barn", "Barn / equestrian facility". Write the description in plain words.

Missing lat/lng (Utah): query the Utah parcel layer with a SHORT url (WebFetch rejects long ones), e.g.
`https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/UtahStatewideParcels/FeatureServer/0/query?where=PARCEL_ID=%27351040016%27&outFields=County&returnCentroid=true&returnGeometry=false&outSR=4326&f=json`
(Utah County ids drop the dashes; Juab ids use `PARCEL_ID+like+%27XD00-3412%25%27`). In Idaho and
Wyoming, or if the lookup fails, use the town's coordinates and set `"approx": true`.

Drive time: `https://router.project-osrm.org/table/v1/driving/<homeLng>,<homeLat>;<lng>,<lat>;...?sources=0`
with 3-decimal coordinates and at most 10 destinations per request. Put the raw seconds in `osrmSec`.

## 4. MLS alert emails

Search Gmail for alert emails from the last day (`newer_than:1d (from:utahrealestate.com OR subject:(listing OR "new listings" OR "price change"))`).
For each property in them, match by MLS # to `listings.json`; add price checks for matches and full
records (fetch the linked page if needed) for new ones, with `"source": "MLS alert"` and an id of `mls-<number>`.

## 5. Merge, publish, email

```
HOME_LL="<salem lat>,<lng>" python3 tools/update.py tools/incoming-salem.jsonl --seen tools/seen-salem.txt --out tools/out/salem
HOME_LL="<swan lat>,<lng>"  python3 tools/update.py tools/incoming-swan.jsonl --seen tools/seen-swan.txt \
    --data listings-swan.json --out tools/out/swan --label "Swan Valley, ID"
python3 tools/combine_email.py tools/out/salem tools/out/swan
git add listings.json listings-swan.json && git commit -m "Daily update <date>" && git push
```

Send `tools/out/email.html` (htmlBody) with `tools/out/email.txt` (body) and the subject from
`tools/out/summary.json` to the address in the task prompt. Do not commit `tools/out/` or the
`tools/incoming-*.jsonl` / `tools/seen-*.txt` files.
