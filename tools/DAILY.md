# Daily update runbook

The scheduled task follows these steps every afternoon. The task prompt supplies the home
coordinates (`HOME_LL`); they are deliberately not stored in this public repo.

## 1. Collect today's search results (LandSearch, syndicated from the Utah MLS)

WebFetch each county search (price ≤ $1.5M, 5+ acres). Ask for every card's listing id
(the number at the end of the URL), price, acres, city, status text and URL:

- https://www.landsearch.com/properties/utah-county-ut/filter/price[max]=1500000,size[min]=5
- https://www.landsearch.com/properties/juab-county-ut/filter/price[max]=1500000,size[min]=5
- https://www.landsearch.com/properties/wasatch-county-ut/filter/price[max]=1500000,size[min]=5
- https://www.landsearch.com/properties/sanpete-county-ut/filter/price[max]=1500000,size[min]=5
- https://www.landsearch.com/properties/salt-lake-county-ut/filter/price[max]=1500000,size[min]=5

If a page says more than 50 properties, also fetch `/p2` (insert before `/filter`, e.g.
`.../utah-county-ut/p2/filter/...`). Write every id seen to `tools/seen.txt`.

Skip ids for towns well past an hour (Kamas, Woodland, Oakley, Manti, Mayfield, Ephraim,
Gunnison, Tooele, Vernon) to save time.

## 2. Price/status checks for known listings

For ids already in `listings.json`, add `{"id","price","status"}` lines to `tools/incoming.jsonl`.

## 3. Full details for new ids

WebFetch the listing page with this prompt and turn the answer into one JSON line:

> Output ONE line of minified JSON only, keys: price, acres, addr, city, zip, lat, lng, mls (exact string), posted (date of 'New listing' in price history, YYYY-MM-DD), type, beds, baths, sqft, zoning (string, all values joined), hoa (fee text or "None" or null), water (short quote of any culinary/well/irrigation/water shares/water rights text), power (short quote of electricity/power text), sewer, parcel (first parcel number), broker, desc (max 220 chars), status, history (array of [YYYY-MM-DD, event, price]), imgs (array, up to 15 cdn.landsearch.com image URLs). null when not stated.

Add `id`, `url`, and `type` normalized to one of: "Land", "House on acreage", "House with barn",
"Land with barn", "Barn / equestrian facility". Write the description in plain words.

Missing lat/lng: query the Utah parcel layer with a SHORT url (WebFetch rejects long ones), e.g.
`https://services1.arcgis.com/99lidPhWCzftIe9K/arcgis/rest/services/UtahStatewideParcels/FeatureServer/0/query?where=PARCEL_ID=%27351040016%27&outFields=County&returnCentroid=true&returnGeometry=false&outSR=4326&f=json`
(Utah County ids drop the dashes; Juab ids use `PARCEL_ID+like+%27XD00-3412%25%27`). If that fails,
use the town's coordinates and set `"approx": true`.

Drive time: `https://router.project-osrm.org/table/v1/driving/<homeLng>,<homeLat>;<lng>,<lat>;...?sources=0`
with 3-decimal coordinates and at most 10 destinations per request. Put the raw seconds in `osrmSec`.

## 4. MLS alert emails

Search Gmail for alert emails from the last day (`newer_than:1d (from:utahrealestate.com OR subject:(listing OR "new listings" OR "price change"))`).
For each property in them, match by MLS # to `listings.json`; add price checks for matches and full
records (fetch the linked page if needed) for new ones, with `"source": "MLS alert"` and an id of `mls-<number>`.

## 5. Merge, publish, email

```
HOME_LL="<lat>,<lng>" python3 tools/update.py tools/incoming.jsonl --seen tools/seen.txt
git add listings.json && git commit -m "Daily update <date>" && git push
```

Send `tools/out/email.html` (htmlBody) with `tools/out/email.txt` (body) and the subject from
`tools/out/summary.json` to the address in the task prompt. Do not commit `tools/out/`,
`tools/incoming.jsonl` or `tools/seen.txt`.
