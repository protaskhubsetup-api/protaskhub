// lib/zip_pricing.js
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

/**
 * Resolve geo rule chain (zip → county → msa → state → defaults).
 * If ZIP is in Florida range (320–349) and metadata has no state, assume FL.
 */
function resolveGeo(zip) {
  const meta = PRICEBOOK.lookup?.[zip] || {};
  const zipNum = Number(String(zip || "").slice(0, 3));
  const assumedState = (!meta.state && zipNum >= 320 && zipNum <= 349) ? "FL" : meta.state;

  const chain = [
    PRICEBOOK.rules?.[`zip:${zip}`],
    PRICEBOOK.rules?.[`county:${meta.county}`],
    PRICEBOOK.rules?.[`msa:${meta.msa}`],
    PRICEBOOK.rules?.[`state:${assumedState}`],
    PRICEBOOK.defaults
  ].filter(Boolean);

  return chain.reduce((acc, cur) => ({ ...acc, ...cur }), {});
}

/**
 * Map free-text service to a configured service key.
 * Order matters: check specific categories first.
 */
function parseServiceKey(service) {
  const s = (service || "").toLowerCase();

  // Plumbing / fixtures (each)
  if (s.includes("toilet") || s.includes("wc") || s.includes("commode")) return "plumbing_toilet_replace";

  // Painting
  if (s.includes("exterior") && s.includes("paint")) return "painting_exterior";
  if (s.includes("pint") || s.includes("paint")) return "painting_interior";

  // Drywall
  if (s.includes("drywall") || s.includes("patch") || s.includes("yeso")) return "drywall_repair";

  // Flooring
  if (s.includes("floor")) return "flooring_install";

  // Default
  return "painting_interior";
}

/**
 * Compute an instant quote using service definition + geo indices/rules.
 * - Guards multipliers so 0/NaN become 1 (prevents $0 lines).
 * - Supports "sqft" unit or "each" unit (quantity).
 * - Applies travel, min job, extras, and tax.
 */
export async function computeQuote({ service, zip, sqft = 0, extras = [] }) {
  const geo = resolveGeo(zip);
  const key = parseServiceKey(service);
  const svc = PRICEBOOK.services?.[key];
  if (!svc) throw new Error(`Service not configured: ${service}`);

  // Guard indices (0/NaN => 1)
  const laborIx = (Number(geo.labor_index) > 0 ? Number(geo.labor_index) : 1);
  const matIx   = (Number(geo.materials_index) > 0 ? Number(geo.materials_index) : 1);
  const travel  = Number(geo.travel_fee) || 0;

  let subtotal = 0;
  const lines = [];

  if (svc.unit === "sqft") {
    const n = Math.max(0, Number(sqft) || 0);
    const baseRate = Number(svc.base_rate) || 0;
    const materialsPct = Number(svc.materials_pct) || 0;
    const prepPct = Number(svc.prep_addon_pct) || 0;

    const base = (baseRate * laborIx + baseRate * materialsPct * matIx) * n;
    const prep = base * prepPct;
    subtotal = base + prep + travel;

    lines.push({ label: `${service} — ${n} ft² @ ZIP ${zip}`, amount: +(base + prep).toFixed(2) });
    if (travel) lines.push({ label: "Local travel/dispatch", amount: +travel.toFixed(2) });

  } else if (svc.unit === "each") {
    // Treat "sqft" input as quantity for per-item services
    const qty = Math.max(1, Number(sqft) || 1);

    // First tier rate (simple model)
    const firstTier = svc.tiers?.[0];
    const baseEach = Number(firstTier?.rate) || 200;

    // Labor multiplier only for per-item (materials built into rate)
    const eachRate = baseEach * laborIx;
    const itemsCost = qty * eachRate;
    subtotal = itemsCost + travel;

    lines.push({ label: `${service} — ${qty} item(s) @ ZIP ${zip}`, amount: +itemsCost.toFixed(2) });
    if (travel) lines.push({ label: "Local travel/dispatch", amount: +travel.toFixed(2) });

    if (qty > 1 && svc.trip_bundle_discount_pct) {
      const disc = +(subtotal * Number(svc.trip_bundle_discount_pct)).toFixed(2);
      subtotal -= disc;
      lines.push({ label: "Multiple-item bundle discount", amount: -disc });
    }
  } else {
    throw new Error(`Unsupported unit for service "${key}"`);
  }

  // Minimum job threshold (service → geo → defaults)
  const minJob =
    (svc.min_job ?? geo.min_job ?? PRICEBOOK.defaults?.min_job ?? 0);
  if (subtotal < minJob) {
    const diff = +(minJob - subtotal).toFixed(2);
    lines.push({ label: "Minimum job threshold", amount: diff });
    subtotal = minJob;
  }

  // Optional extras as percentage add-ons (example flags)
  for (const e of extras || []) {
    if (e === "primer") {
      const add = +(0.25 * subtotal).toFixed(2);
      lines.push({ label: "Primer & sealing", amount: add });
      subtotal += add;
    }
    if (e === "ceilings") {
      const add = +(0.15 * subtotal).toFixed(2);
      lines.push({ label: "Ceilings", amount: add });
      subtotal += add;
    }
  }

  // Tax
  const taxRate = Number(geo.tax_rate ?? PRICEBOOK.defaults?.tax_rate ?? 0) || 0;
  const tax = +(subtotal * taxRate).toFixed(2);
  const total = +(subtotal + tax).toFixed(2);

  return {
    zip,
    geo_applied: {
      labor_index: laborIx,
      materials_index: matIx,
      travel_fee: travel,
      min_job: minJob
    },
    currency: "USD",
    subtotal: +subtotal.toFixed(2),
    tax,
    total,
    lineItems: lines,
    notes: "Rates reflect current local market multipliers for this ZIP and service category."
  };
}
