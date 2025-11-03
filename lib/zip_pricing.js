import fs from "fs";
import path from "path";

const pricebookPath = path.join(process.cwd(), "data", "prices_by_zip.json");
let PRICEBOOK = JSON.parse(fs.readFileSync(pricebookPath, "utf8"));

export function getPricebook() {
  return PRICEBOOK;
}

export function setPricebook(pb) {
  PRICEBOOK = pb;
}

function resolveGeo(zip) {
  const meta = PRICEBOOK.lookup[zip] || {};

  // Fallback: if ZIP looks like Florida (prefix 320–349) and no lookup.state exists, assume FL
  const zipNum = Number(String(zip || "").slice(0, 3));
  const assumedState = (!meta.state && zipNum >= 320 && zipNum <= 349) ? "FL" : meta.state;

  const chain = [
    PRICEBOOK.rules[`zip:${zip}`],
    PRICEBOOK.rules[`county:${meta.county}`],
    PRICEBOOK.rules[`msa:${meta.msa}`],
    PRICEBOOK.rules[`state:${assumedState}`],
    PRICEBOOK.defaults
  ].filter(Boolean);

  return chain.reduce((acc, cur) => ({ ...acc, ...cur }), {});
}

function parseServiceKey(service) {
  const s = (service || "").toLowerCase();
  if (s.includes("exterior") && s.includes("paint")) return "painting_exterior";
  if (s.includes("pint") || s.includes("paint")) return "painting_interior";
  if (s.includes("drywall") || s.includes("patch") || s.includes("yeso")) return "drywall_repair";
  if (s.includes("floor")) return "flooring_install";
  return "painting_interior";
}

export async function computeQuote({ service, zip, sqft = 0, extras = [] }) {
  const geo = resolveGeo(zip);
  const key = parseServiceKey(service);
  const svc = PRICEBOOK.services[key];
  if (!svc) throw new Error(`Service not configured: ${service}`);

  const laborIx = geo.labor_index ?? 1;
  const matIx   = geo.materials_index ?? 1;
  const travel  = geo.travel_fee ?? 0;

  let subtotal = 0;
  const lines = [];

  if (svc.unit === "sqft") {
    const base = (svc.base_rate * laborIx + svc.base_rate * (svc.materials_pct ?? 0) * matIx) * (sqft || 0);
    let prep = 0;
    if (svc.prep_addon_pct) prep = base * svc.prep_addon_pct;
    subtotal = base + prep + travel;
    lines.push({ label: `${service} — ${sqft || 0} ft² @ ZIP ${zip}`, amount: +(base + prep).toFixed(2) });
    if (travel) lines.push({ label: "Local travel/dispatch", amount: travel });
  } else if (svc.unit === "each") {
    const qty = Math.max(1, Number(sqft) || 1);
    const firstTier = svc.tiers?.[0];
    const eachRate = (firstTier?.rate || 200) * laborIx;
    subtotal = qty * eachRate + travel;
    lines.push({ label: `${service} — ${qty} item(s) @ ZIP ${zip}`, amount: +(qty * eachRate).toFixed(2) });
    if (travel) lines.push({ label: "Local travel/dispatch", amount: travel });
    if (qty > 1 && svc.trip_bundle_discount_pct) {
      const disc = +(subtotal * svc.trip_bundle_discount_pct).toFixed(2);
      subtotal -= disc;
      lines.push({ label: `Multiple-patch bundle discount`, amount: -disc });
    }
  }

  const minJob = svc.min_job ?? geo.min_job ?? PRICEBOOK.defaults.min_job ?? 0;
  if (subtotal < minJob) {
    const diff = +(minJob - subtotal).toFixed(2);
    lines.push({ label: `Minimum job threshold`, amount: diff });
    subtotal = minJob;
  }

  for (const e of extras || []) {
    if (e === "primer") { const add = +(0.25 * subtotal).toFixed(2); lines.push({ label: "Primer & sealing", amount: add }); subtotal += add; }
    if (e === "ceilings") { const add = +(0.15 * subtotal).toFixed(2); lines.push({ label: "Ceilings", amount: add }); subtotal += add; }
  }

  const taxRate = geo.tax_rate ?? PRICEBOOK.defaults.tax_rate ?? 0;
  const tax = +(subtotal * taxRate).toFixed(2);
  const total = +(subtotal + tax).toFixed(2);

  return {
    zip,
    geo_applied: { labor_index: laborIx, materials_index: matIx, travel_fee: travel, min_job: minJob },
    currency: "USD",
    subtotal: +subtotal.toFixed(2),
    tax,
    total,
    lineItems: lines,
    notes: "Rates reflect current local market multipliers for this ZIP and service category."
  };
}
