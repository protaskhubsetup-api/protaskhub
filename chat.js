
import OpenAI from "openai";
import { computeQuote } from "../lib/zip_pricing.js";

// Optional email via SendGrid
let sendgrid = null;
try {
  sendgrid = await import("@sendgrid/mail");
  sendgrid.default.setApiKey(process.env.SENDGRID_API_KEY || "");
} catch (e) {
  // SendGrid not configured
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `
You are the official ProTaskHub AI Assistant.

Purpose: help customers get instant quotes for painting, drywall, flooring, remodeling and related work; and help technicians apply to join the network.

Rules:
1) Auto-detect language (English/Spanish/Haitian Creole) and reply in that language.
2) Keep replies short, mobile-friendly, and professional; use friendly emojis only when helpful.
3) For customers, collect: service, ZIP & city, job size/details, name, phone, email.
4) For technicians, collect: name, ZIPs or areas, skills, years of experience, phone, email.
5) Use tools when ready:
   - match_zip_to_techs(zip)
   - compute_quote(service, zip, sqft?, extras[])
   - send_quote_email(to, quote, lang, bookingUrl)
6) Always include the “Book Now” link: https://handyfixnow.com/protaskhub-Book-a-pro
7) Confirm main details before sending quote. Keep focus on booking or applying.
8) If off-topic, politely refocus on ProTaskHub’s services.
`;

// --- Simple ZIP-to-tech mapping stub (replace with your data source) ---
async function matchZipToTechs(zip) {
  // TODO: connect to your DB/Sheet/CRM
  return [
    { name: "Carlos Pérez", email: "carlos.perez@protaskhub.tech", zip_radius: ["33428","33433","33434"], score: 0.92 },
    { name: "Maria Gonzalez", email: "maria.g@protaskhub.tech", zip_radius: ["33428","33431"], score: 0.88 }
  ];
}

async function sendQuoteEmail({ to, quote, lang, bookingUrl }) {
  const business = "ProTaskHubsetup@gmail.com";
  const subject = lang?.toLowerCase().startsWith("es")
    ? "Tu presupuesto de ProTaskHub"
    : lang?.toLowerCase().startsWith("ht")
    ? "Estimasyon ProTaskHub ou"
    : "Your ProTaskHub Quote";

  const text = `
Quote total: $${quote.total}
Details:
${quote.lineItems.map(li => `- ${li.label}: $${li.amount}`).join("\n")}

Book Now: ${bookingUrl}
  `.trim();

  // If SendGrid is configured, send real email
  if (sendgrid && process.env.SENDGRID_API_KEY) {
    try {
      await sendgrid.default.send([
        { to, from: "no-reply@protaskhub.ai", subject, text },
        { to: business, from: "no-reply@protaskhub.ai", subject: `[COPY] ${subject}`, text }
      ]);
      return { ok: true, sentTo: [to, business], provider: "sendgrid" };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // Fallback: pretend success (no provider configured)
  return { ok: true, sentTo: [to, business], provider: "none" };
}

// ---- Tool schemas for function calling ----
const tools = [
  {
    type: "function",
    function: {
      name: "match_zip_to_techs",
      description: "Find available ProTaskHub technicians near a customer's ZIP code.",
      parameters: {
        type: "object",
        properties: { zip: { type: "string", description: "Customer ZIP code" } },
        required: ["zip"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "compute_quote",
      description: "Generate an instant quote for a service using job details.",
      parameters: {
        type: "object",
        properties: {
          service: { type: "string", description: "Service name" },
          zip: { type: "string", description: "ZIP where job will be done" },
          sqft: { type: "number", description: "Estimated square footage, if available" },
          extras: { type: "array", items: { type: "string" }, description: "Optional add-ons" }
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
          to: { type: "string", description: "Customer email address" },
          quote: { type: "object", description: "Quote details produced by compute_quote" },
          lang: { type: "string", description: "Language used in the conversation" },
          bookingUrl: { type: "string", description: "Booking page URL" }
        },
        required: ["to", "quote", "bookingUrl"]
      }
    }
  }
];

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const userPayload = req.body || {}; // { text, service, zip, sqft, extras[], email, phone, name }
    const messages = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify(userPayload) }
    ];

    let response = await openai.chat.completions.create({
      model: "gpt-4.1",
      messages,
      tools,
      tool_choice: "auto"
    });

    // Tool-call loop
    while (response.choices?.[0]?.message?.tool_calls?.length) {
      const call = response.choices[0].message.tool_calls[0];
      const args = call.function?.arguments ? JSON.parse(call.function.arguments) : {};
      let result;

      switch (call.function.name) {
        case "match_zip_to_techs":
          result = await matchZipToTechs(args.zip);
          break;
        case "compute_quote":
          result = await computeQuote(args);
          break;
        case "send_quote_email":
          result = await sendQuoteEmail(args);
          break;
        default:
          result = { error: "Unknown tool" };
      }

      response = await openai.chat.completions.create({
        model: "gpt-4.1",
        messages: [
          ...messages,
          response.choices[0].message,
          { role: "tool", tool_call_id: call.id, content: JSON.stringify(result) }
        ],
        tools,
        tool_choice: "auto"
      });
    }

    res.status(200).json({ reply: response.choices?.[0]?.message?.content ?? "OK" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e?.message || "Server error" });
  }
}
