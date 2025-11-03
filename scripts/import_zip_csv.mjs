// scripts/import_zip_csv.mjs
// Usage: node scripts/import_zip_csv.mjs scripts/fl_zip_master.csv
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputCsv = process.argv[2];
if (!inputCsv) {
  console.error("Usage: node scripts/import_zip_csv.mjs <path/to/fl_zip_master.csv>");
  process.exit(1);
}

const pricebookPath = path.join(__dirname, "..", "data", "prices_by_zip.json");
const pb = JSON.parse(fs.readFileSync(pricebookPath, "utf8"));

function parseCSV(text) {
  const lines = text.replace(/\r/g,"").split("\n").filter(Boolean);
  const header = lines.shift().split(",").map(s=>s.trim());
  return lines.map(line => {
    const parts = line.split(",").map(s=>s.trim());
    const row = {};
    header.forEach((h,i)=> row[h] = parts[i] ?? "");
    return row;
  });
}

const csvText = fs.readFileSync(path.resolve(inputCsv), "utf8");
const rows = parseCSV(csvText);

// Reset lookup/rules for zip: entries (keep county/msa/state/defaults/services as-is)
pb.lookup = pb.lookup || {};
for (const key of Object.keys(pb.rules)) {
  if (key.startsWith("zip:")) delete pb.rules[key];
}

for (const r of rows) {
  const zip = (r.zip || "").padStart(5,"0");
  if (!zip) continue;
  pb.lookup[zip] = {
    county: r.county || "",
    msa: r.msa || "",
    state: r.state || "",
    city: r.city || ""
  };
  const rule = {};
  if (r.labor_index) rule.labor_index = Number(r.labor_index);
  if (r.materials_index) rule.materials_index = Number(r.materials_index);
  if (r.travel_fee) rule.travel_fee = Number(r.travel_fee);
  if (r.min_job) rule.min_job = Number(r.min_job);
  pb.rules[`zip:${zip}`] = rule;
}

fs.writeFileSync(pricebookPath, JSON.stringify(pb, null, 2));
console.log(`Updated ${pricebookPath} with ${rows.length} ZIP rows.`);
