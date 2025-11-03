// api/chat.js — guaranteed fast, no OpenAI, shows any internal error back to the UI

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name = "", email = "", phone = "", service = "", zip = "", sqft = 0 } = req.body || {};

    let quote, debug = {};
    try {
      // Import pricing engine safely; if it fails, we'll show why
      const mod = await import("../lib/zip_pricing.js");
      if (!mod || !mod.computeQuote) throw new Error("computeQuote not exported from lib/zip_pricing.js");

      quote = await mod.computeQuote({
        service: String(service),
        zip: String(zip),
        sqft: Number(sqft) || 0,
        extras: []
      });
    } catch (e) {
      debug.zip_pricing_error = String(e?.message || e);
      // Minimal inline fallback so the user STILL gets a quote
      const n = Number(sqft) || 0;
      const baseRate = 1.9, materialsPct = 0.18, prepPct = 0.12, taxRate = 0.07, minJob = 350;
      const labor = baseRate * n;
      const materials = baseRate * materialsPct * n;
      const prep = (labor + materials) * prepPct;
      let subtotal = labor + materials + prep;
      if (subtotal < minJob) subtotal = minJob;
      const tax = +(subtotal * taxRate).toFixed(2);
      const total = +(subtotal + tax).toFixed(2);
      quote = {
        currency: "USD",
        subtotal: +subtotal.toFixed(2),
        tax, total,
        lineItems: [
          { label: `${service || "Interior paint"} — ${n} ft² @ ZIP ${zip}`, amount: +(labor + materials + prep).toFixed(2) }
        ],
        notes: "Fallback pricing used (see debug.zip_pricing_error)."
      };
    }

    const lines = (quote.lineItems || []).map(li => `• ${li.label}: $${Number(li.amount).toFixed(2)}`).join("\n");
    const reply =
`Thanks ${name || ""}! Here’s your instant quote:

Service: ${service || "-"}
ZIP: ${zip || "-"}
Sqft: ${sqft || "-"}

${lines}

Subtotal: $${Number(quote.subtotal).toFixed(2)}
Tax: $${Number(quote.tax).toFixed(2)}
Total: $${Number(quote.total).toFixed(2)}

Book Now: https://handyfixnow.com/protaskhub-Book-a-pro`;

    // Always return quickly with any debug info attached (visible in DevTools → Network)
    return res.status(200).json({ reply, quote, debug });
  } catch (e) {
    // Last-resort: show the error text so nothing hangs
    return res.status(200).json({ reply: "An error occurred.", error: String(e?.message || e) });
  }
}
