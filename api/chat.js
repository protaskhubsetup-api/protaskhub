// api/chat.js — Multilingual assistant with ZIP pricing, safe fallbacks

import OpenAI from "openai";

const BOOKING_URL = "https://handyfixnow.com/protaskhub-Book-a-pro";
const OPENAI_MODEL = "gpt-4.1";
const OPENAI_TIMEOUT_MS = 20000;

let sendgrid = null;
if (process.env.SENDGRID_API_KEY) {
  try {
    sendgrid = await import("@sendgrid/mail");
    sendgrid.default.setApiKey(process.env.SENDGRID_API_KEY);
  } catch (_) {}
}

async function sendQuoteEmail({ to, quote, lang, bookingUrl }) {
  const business = "ProTaskHubsetup@gmail.com";
  const subject =
    (lang || "").toLowerCase().startsWith("es") ? "Tu presupuesto de ProTaskHub" :
    (lang || "").toLowerCase().startsWith("ht") ? "Estimasyon ProTaskHub ou" :
    "Your ProTaskHub Quote";

  const bodyText = [
    `Quote total: $${Number(quote?.total ?? 0).toFixed(2)}`,
    ...(quote?.lineItems || []).map(li => `- ${li.label}: $${Number(li.amount).toFixed(2)}`),
    "",
    `Book Now: ${bookingUrl}`
  ].join("\n");

  if (sendgrid) {
    try {
      await sendgrid.default.send([
        { to, from: "no-reply@protaskhub.ai", subject, text: bodyText },
        { to: business, from: "no-reply@protaskhub.ai", subject: `[COPY] ${subject}`, text: bodyText }
      ]);
      return { ok: true, provider: "sendgrid", sentTo: [to, business] };
    } catch (e) {
      return { ok: false, provider: "sendgrid", error: String(e?.message || e) };
    }
  }
  return { ok: true, provider: "none", sentTo: [to, business] };
}

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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `
You are the official ProTaskHub AI Assistant.
- Detect the user's language (English, Spanish, or Haitian Creole) and reply in that language.
- Collect service, ZIP, sqft/details, name, phone, email.
- Use tools to compute a quote, then (optionally) send an email confirmation.
- ALWAYS include: Book Now → ${BOOKING_URL}
- Be concise and mobile-friendly with bullet points for totals.
`;

const tools = [
  {
    type: "function",
    function: {
      name: "compute_quote",
      description: "Generate an instant quote for a service using job details.",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string" },
          zip: { type: "string" },
          sqft: { type: "number" },
          extras: { type: "array", items: { type: "string" } }
        },
        required: ["service", "zip"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "send_quote_email",
      description: "Email the final quote to the customer and ProTaskHub.",
      parameters: {
        type: "object",
        properties: {
          to: { type: "string" },
          quote: { type: "object" },
          lang: { type: "string" },
          bookingUrl: { type: "string" }
        },
        required: ["to", "quote", "bookingUrl"]
      }
    }
  }
];

async function runWithTimeout(promise, ms) {
  let t;
  const timer = new Promise((_, rej) => (t = setTimeout(() => rej(new Error("OpenAI timeout")), ms)));
  try { return await Promise.race([promise, timer]); }
  finally { clearTimeout(t); }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = req.body || {};
    const { name = "", email = "", phone = "", service = "", zip = "", sqft = 0 } = user;

    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ name, email, phone, service, zip, sqft, text: user.text || "" }) }
    ];

    // Ask OpenAI; if anything goes wrong, fall back to deterministic pricing reply
    let r;
    try {
      r = await runWithTimeout(
        openai.chat.completions.create({ model: OPENAI_MODEL, messages, tools, tool_choice: "auto" }),
        OPENAI_TIMEOUT_MS
      );
    } catch {
      const quote = await computeQuoteSafe({ service, zip: String(zip), sqft: Number(sqft) || 0, extras: [] });
      const lines = (quote.lineItems || []).map(li => `• ${li.label}: $${Number(li.amount).toFixed(2)}`).join("\n");
      const text = `Here is your instant quote:\n\n${lines}\n\nSubtotal: $${Number(quote.subtotal).toFixed(2)}\nTax: $${Number(quote.tax).toFixed(2)}\nTotal: $${Number(quote.total).toFixed(2)}\n\nBook Now: ${BOOKING_URL}`;
      return res.status(200).json({ reply: text, quote, meta: { mode: "fallback" } });
    }

    // Tool loop
    while (r.choices?.[0]?.message?.tool_calls?.length) {
      const call = r.choices[0].message.tool_calls[0];
      const args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      let result;

      if (call.function.name === "compute_quote") {
        result = await computeQuoteSafe(args);
      } else if (call.function.name === "send_quote_email") {
        result = await sendQuoteEmail(args);
      } else {
        result = { error: "Unknown tool" };
      }

      r = await runWithTimeout(
        openai.chat.completions.create({
          model: OPENAI_MODEL,
          messages: [
            ...messages,
            r.choices[0].message,
            { role: "tool", tool_call_id: call.id, content: JSON.stringify(result) }
          ],
          tools,
          tool_choice: "auto"
        }),
        OPENAI_TIMEOUT_MS
      );
    }

    res.status(200).json({ reply: r.choices?.[0]?.message?.content ?? "OK" });
  } catch (e) {
    // Panic fallback; never hang
    try {
      const { service = "", zip = "", sqft = 0 } = req.body || {};
      const quote = await fallbackQuote({ service, zip, sqft });
      const lines = (quote.lineItems || []).map(li => `• ${li.label}: $${Number(li.amount).toFixed(2)}`).join("\n");
      const text = `Here is your instant quote:\n\n${lines}\n\nSubtotal: $${Number(quote.subtotal).toFixed(2)}\nTax: $${Number(quote.tax).toFixed(2)}\nTotal: $${Number(quote.total).toFixed(2)}\n\nBook Now: ${BOOKING_URL}`;
      return res.status(200).json({ reply: text, quote, meta: { mode: "panic-fallback", error: String(e?.message || e) } });
    } catch {
      return res.status(500).json({ error: e.message || "Server error" });
    }
  }
}
