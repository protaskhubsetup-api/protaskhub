# ProTaskHub — ZIP Pricing (Florida-ready, nationwide-scalable)

## Bulk load all Florida ZIP codes
1) Open `scripts/fl_zip_master.csv` and add **every FL ZIP** (one per row).
   - Columns: zip, city, county, msa, state, labor_index, materials_index, travel_fee, min_job
   - Keep `state` as `FL` for Florida rows.
2) Run:
```bash
npm install
node scripts/import_zip_csv.mjs scripts/fl_zip_master.csv
```
This merges your CSV into `data/prices_by_zip.json` so the API uses real ZIP rules.

## Go nationwide
- Create another CSV for other states (e.g., `us_zip_master.csv`) using the same columns.
- Run the same import script with that file — it will add rules/lookups for those ZIPs.
- You can keep Florida plus new states in **one combined CSV** if you prefer.

## Deploy
- Set env vars in Vercel: OPENAI_API_KEY, (optional) SENDGRID_API_KEY, ADMIN_KEY
- Deploy the repo; your public URL goes live.
