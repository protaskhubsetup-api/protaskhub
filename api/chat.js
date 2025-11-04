// api/chat.js — ProTaskHub Instant Quote (multilingual + SendGrid email + safe fallbacks)

import OpenAI from "openai";

// ---------- CONFIG ----------
const BOOKING_URL = "https://handyfixnow.com/protaskhub-Book-a-pro";
const OPENAI_MODEL = "gpt-4.1";           // change to a model you have if needed, e.g. "gpt-4o-mini"
const OPENAI_TIMEOUT_MS = 20000;

// ---------- DYNAMIC SENDGRID (only loads if key exists) ----------
let sendgrid = null;
const FROM_EMAIL = process.env.SENDGRID_FROM_EMAIL || ""; // MUST be a verified sender in SendGrid
const FROM_NAME  = process.env.SENDGRID_FROM_NAME  || "ProTaskHub Quotes";

if (process.env.SENDGRID_API_KEY) {
  try {
    sendgrid = await import("@sendgrid/mail");
    sendgrid.default.setApiKey(process.env.SENDGRID_API_KEY);
  } catch (_) {
    // ignore; we'll stub-send below
  }
}

// ---------- UTILITIES ----------
function currency(n) {
  return `$${Number(n || 0).toFixed(2)}`;
}

function detectLang({ service = "", text = "" }) {
  const s = `${service} ${text}`.toLowerCase();
  const esHits = ["pint", "baño", "cocina", "techo", "pared", "pies", "cuadrados", "color", "yeso"];
  const htHits = ["wi", "non", "penti", "plonbri", "kay", "twalèt", "met", "travay"];
  if (esHits.some(w => s.includes(w))) return "es";
  if (htHits.some(w => s.includes(w))) return "ht";
  return "en";
}

function plainReply({ lang, name, service, zip, sqft, quote }) {
  const lines = (quote.lineItems || [])
    .map(li => `• ${li.label}: ${currency(li.amount)}`)
    .join("\n");

  if (lang === "es") {
    return (
`¡Gracias ${name || ""}! Aquí tienes tu presupuesto instantáneo:

Servicio: ${service || "-"}
ZIP: ${zip || "-"}
Pies²/Cantidad: ${sqft || "-"}

${lines}

Subtotal: ${currency(quote.subtotal)}
Impuestos: ${currency(quote.tax)}
Total: ${currency(quote.total)}

Reservar ahora: ${BOOKING_URL}`
    );
  }
  if (lang === "ht") {
    return (
`Mèsi ${name || ""}! Men estimasyon w lan:

Sèvis: ${service || "-"}
ZIP: ${zip || "-"}
Pye kare/Kantite: ${sqft || "-"}

${lines}

Sou-total: ${currency(quote.subtotal)}
Taks: ${currency(quote.tax)}
Total: ${currency(quote.total)}

Rezève kounye a: ${BOOKING_URL}`
    );
  }
  return (
`Thanks ${name || ""}! Here’s your instant quote:

Service: ${service || "-"}
ZIP: ${zip || "-"}
Sqft/Qty: ${sqft || "-"}

${lines}

Subtotal: ${currency(quote.subtotal)}
Tax: ${currency(quote.tax)}
Total: ${currency(quote.total)}

Book Now: ${BOOKING_URL}`
  );
}

// ---------- EMAIL (HTML + text). Never blocks the response ----------
function emailSubject(lang = "en") {
  const L = (lang || "en").toLowerCase();
  if (L.startsWith("es")) return "Tu presupuesto de ProTaskHub — Listo para reservar";
  if (L.startsWith("ht")) return "Estimasyon ProTaskHub ou — Pare pou rezève";
  return "Your ProTaskHub Quote — Ready to Book";
}

function buildEmailHTML({ lang = "en", quote, bookingUrl, customerName = "", service = "", zip = "", sqft = "" }) {
  const items = (quote?.lineItems || [])
    .map(li => `<tr><td style="padding:8px 0;color:#111;">${li.label}</td><td style="text-align:right;color:#111;">${currency(li.amount)}</td></tr>`)
    .join("");

  const hi =
    lang === "es" ? `Hola ${customerName || ""},` :
    lang === "ht" ? `Bonjou ${customerName || ""},` :
    `Hi ${customerName || ""},`;

  const subtitle =
    lang === "es" ? "Presupuesto instantáneo para tu proyecto" :
    lang === "ht" ? "Estimasyon imedya pou pwojè ou" :
    "Instant estimate for your project";

  const btn =
    lang === "es" ? "Reservar ahora" :
    lang === "ht" ? "Rezève kounye a" :
    "Book Now";

  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f7fb;font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f7fb;padding:24px 0;">
      <tr><td align="center">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;padding:24px;">
          <tr><td style="text-align:center;padding-bottom:8px;">
            <div style="font-size:20px;font-weight:700;color:#111;">ProTaskHub Quote</div>
            <div style="font-size:13px;color:#666;">${subtitle}</div>
          </td></tr>
          <tr><td style="font-size:14px;color:#111;padding:12px 0;">${hi}
            <br/>Here’s your instant quote. You can book immediately with the button below.
          </td></tr>
          <tr><td style="background:#f2f3f7;padding:12px;border-radius:8px;font-size:13px;color:#333;">
            <div><strong>Service:</strong> ${service || "-"}</div>
            <div><strong>ZIP:</strong> ${zip || "-"}</div>
            <div><strong>Sqft/Qty:</strong> ${sqft || "-"}</div>
          </td></tr>
          <tr><td style="height:12px;"></td></tr>
          <tr><td>
            <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
              ${items}
              <tr><td style="border-top:1px solid #eee;padding-top:8px;color:#111;">Subtotal</td><td style="text-align:right;border-top:1px solid #eee;padding-top:8px;color:#111;">${currency(quote?.subtotal)}</td></tr>
              <tr><td style="color:#111;">Tax</td><td style="text-align:right;color:#111;">${currency(quote?.tax)}</td></tr>
              <tr><td style="font-weight:700;color:#111;">Total</td><td style="text-align:right;font-weight:700;color:#111;">${currency(quote?.total)}</td></tr>
            </table>
          </td></tr>
          <tr><td style="height:18px;"></td></tr>
          <tr><td align="center">
            <a href="${bookingUrl}" style="background:#0ea5e9;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:700;display:inline-block;">
              ${btn}
            </a>
          </td></tr>
          <tr><td style="height:8px;"></td></tr>
          <tr><td style="font-size:12px;color:#666;text-align:center;">
            If you have photos or notes, reply to this email and we’ll fine-tune the quote.
          </td></tr>
        </table>
        <div style="font-size:11px;color:#9aa1ac;padding:12px;">ProTaskHub • HandyFixNow</div>
      </td></tr>
    </table>
  </body>
</html>`;
}

async function sendQuoteEmail({ to, quote, lang, bookingUrl, customerName, service, zip, sqft }) {
  const businessCopy = "ProTaskHubsetup@gmail.com";
  const subject = emailSubject(lang);
  const text = [
    `Quote total: ${currency(quote?.total)}`,
    ...(quote?.lineItems || []).map(li => `- ${li.label}: ${currency(li.amount)}`),
    "",
    `Book Now: ${bookingUrl}`
  ].join("\n");
  const html = buildEmailHTML({ lang, quote, bookingUrl, customerName, service, zip, sqft });

  // If SendGrid isn't available or sender isn't configured, don't fail — return ok stub
  if (!sendgrid || !FROM_EMAIL) return { ok: true, provider: "none", note: "No SENDGRID_API_KEY or SENDGRID_FROM_EMAIL set" };

  try {
    const from = { email: FROM_EMAIL, name: FROM_NAME };
    await sendgrid.default.send([
      { to,        from, subject, text, html },
      { to: businessCopy, from, subject: `[COPY] ${subject}`, text, html }
    ]);
    return { ok: true, provider: "sendgrid", sentTo: [to, businessCopy] };
  } catch (e) {
    return { ok: false, provider: "sendgrid", error: String(e?.message || e) };
  }
}

// ---------- PRICING (real engine with safe fallback) ----------
async function fallbackQuote({ service, zip, sqft }) {
  const n = Number(sqft) || 0;
  const baseRate = 1.9, materialsPct = 0.18, prepPct = 0.12, taxRate = 0.07, minJob = 350;
  const labor = baseRate * n;
  const materials = baseRate * materialsPct * n;
  const prep = (labor + materials) * prepPct;
  let subtotal = labor + materials + prep;
  if (subtotal < minJob) subtotal = minJob;
  const tax = +(subtotal * taxRate).toFixed(2);
  const total = +(subtotal + tax).toFixed(2);
  return {
    currency: "USD",
    subtotal: +subtotal.toFixed(2),
    tax, total,
    lineItems: [{ label: `${service || "Interior paint"} — ${n} ft² @ ZIP ${zip}`, amount: +(labor + materials + prep).toFixed(2) }],
    notes: "Fallback pricing used."
  };
}

async function computeQuoteSafe(args) {
  try {
    const mod = await import("../lib/zip_pricing.js");
    if (!mod || !mod.computeQuote) throw new Error("computeQuote not exported");
    return await mod.computeQuote(args);
  } catch {
    return await fallbackQuote(args);
  }
}

// ---------- OPTIONAL OpenAI polish (never blocks) ----------
const openai = process.env.OPENAI_API_KEY ? new OpenAI({ apiKey: process.env.OPENAI_API_KEY }) : null;

async function withTimeout(promise, ms) {
  let t;
  const timer = new Promise((_, rej) => (t = setTimeout(() => rej(new Error("timeout")), ms)));
  try { return await Promise.race([promise, timer]); }
  finally { clearTimeout(t); }
}

// ---------- HANDLER ----------
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name = "", email = "", phone = "", service = "", zip = "", sqft = 0, text = "" } = req.body || {};

    // 1) Compute quote
    const quote = await computeQuoteSafe({
      service: String(service),
      zip: String(zip),
      sqft: Number(sqft) || 0,
      extras: []
    });

    // 2) Pick language & build reply (plain)
    const lang = detectLang({ service, text });
    let reply = plainReply({ lang, name, service, zip, sqft, quote });

    // 3) Try to ask OpenAI to polish the text (if configured). If it fails, keep plain reply.
    if (openai) {
      try {
        const sys =
`You are ProTaskHub's assistant. Rewrite the user's draft into a crisp, friendly message in the user's language (English/Spanish/Haitian Creole).
Always include the Book Now link: ${BOOKING_URL}. Keep bullets for line items and totals.`;
        const userDraft = reply;
        const r = await withTimeout(
          openai.chat.completions.create({
            model: OPENAI_MODEL,
            messages: [
              { role: "system", content: sys },
              { role: "user", content: userDraft }
            ]
          }),
          OPENAI_TIMEOUT_MS
        );
        const polished = r?.choices?.[0]?.message?.content;
        if (polished) reply = polished;
      } catch (_) { /* keep plain reply */ }
    }

    // 4) Fire-and-forget email (only if email present). Never block the response.
    if (email) {
      sendQuoteEmail({
        to: email,
        quote,
        lang,
        bookingUrl: BOOKING_URL,
        customerName: name,
        service, zip, sqft
      }).catch(() => {});
    }

    // 5) Respond to client immediately
    return res.status(200).json({ reply, quote, meta: { lang } });
  } catch (e) {
    // Panic fallback
    return res.status(200).json({
      reply: "Your quote is ready, but there was an internal error formatting it. Please try again.",
      error: String(e?.message || e)
    });
  }
}
