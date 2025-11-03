import OpenAI from "openai";

// ---------- CONFIG ----------
const BOOKING_URL = "https://handyfixnow.com/protaskhub-Book-a-pro";
const OPENAI_MODEL = "gpt-4.1"; // use a model your account has access to
const OPENAI_TIMEOUT_MS = 20000; // safety timeout

// ---------- OPTIONAL EMAIL (auto-on if SENDGRID_API_KEY exists) ----------
let sendgrid = null;
if (process.env.SENDGRID_API_KEY) {
  try {
    // dynamic import keeps cold start lean if no key present
    sendgrid = await import("@sendgrid/mail");
    sendgrid.default.setApiKey(process.env.SENDGRID_API_KEY);
  } catch (_) { /* ignore; stub will be used */ }
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
      // fall through to stub result
      return { ok: false, provider: "sendgrid", error: String(e?.message || e) };
    }
  }
  // Stub (works even with no provider)
  return { ok: true, provider: "none", sentTo: [to, business] };
}

// ---------- PRICING: real ZIP pricing if available; safe fallback if not ----------
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
    tax,
    total,
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

// ---------- OPENAI (guarded with timeout + fallback language) ----------
const systemPrompt = `
You are the official ProTaskHub AI Assistant.

Goals:
- Detect the user's language (English/Spanish/Haitian Creole) and reply in that language.
- Collect service, ZIP, sqft/details, name, phone, email.
- Use tools to compute a quote; then send a confirmation email.
- ALWAYS include this "Book Now" link: ${BOOKING_URL}
- Be concise and mobile-friendly; use clear bullets for totals.

If tool calls are not available or fail, compose a helpful reply using any provided totals and include the Book Now link.
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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function runWithTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, rej) => (t = setTimeout(() => rej(new Error("OpenAI timeout")), ms)));
  try { return await Promise.race([promise, timeout]); }
  finally { clearTimeout(t); }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const user = req.body || {};
    const { name = "", email = "", phone = "", service = "", zip = "", sqft = 0 } = user;

    const messages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: JSON.stringify({ name, email, phone, service, zip, sqft, text: user.text || "" }) }
    ];

    // Step 1: Ask model; if OpenAI key missing or times out, we still produce a reply.
    let r;
    try {
      r = await runWithTimeout(
        openai.chat.completions.create({ model: OPENAI_MODEL, messages, tools, tool_choice: "auto" }),
        OPENAI_TIMEOUT_MS
      );
    } catch (_) {
      // Compose a deterministic fallback using pricing directly
      const quote = await computeQuoteSafe({ service, zip: String(zip), sqft: Number(sqft) || 0, extras: [] });
      const lines = (quote.lineItems || []).map(li => `• ${li.label}: $${Number(li.amount).toFixed(2)}`).join("\n");
      const text =
`Here is your instant quote:

${lines}

Subtotal: $${Number(quote.subtotal).toFixed(2)}
Tax: $${Number(quote.tax).toFixed(2)}
Total: $${Number(quote.total).toFixed(2)}

Book Now: ${BOOKING_URL}`;
      return res.status(200).json({ reply: text, quote, meta: { mode: "fallback" } });
    }

    // Step 2: Tool loop (compute_quote → send_quote_email)
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

    // Step 3: Final reply
    return res.status(200).json({ reply: r.choices?.[0]?.message?.content ?? "OK" });
  } catch (e) {
    // Absolute last-resort safety
    try {
      const { service = "", zip = "", sqft = 0 } = req.body || {};
      const quote = await fallbackQuote({ service, zip, sqft });
      const lines = (quote.lineItems || []).map(li => `• ${li.label}: $${Number(li.amount).toFixed(2)}`).join("\n");
      const text =
`Here is your instant quote:

${lines}

Subtotal: $${Number(quote.subtotal).toFixed(2)}
Tax: $${Number(quote.tax).toFixed(2)}
Total: $${Number(quote.total).toFixed(2)}

Book Now: ${BOOKING_URL}`;
      return res.status(200).json({ reply: text, quote, meta: { mode: "panic-fallback", error: String(e?.message || e) } });
    } catch {
      return res.status(500).json({ error: e.message || "Server error" });
    }
  }
}

