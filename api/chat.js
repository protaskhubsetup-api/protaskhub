import { computeQuote } from "../lib/zip_pricing.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name, email, phone, service, zip, sqft } = req.body || {};

    // 1) Compute quote via your ZIP pricing engine
    const quote = await computeQuote({
      service: String(service || ""),
      zip: String(zip || ""),
      sqft: Number(sqft || 0),
      extras: []
    });

    // 2) Build a simple human-readable reply
    const lines = (quote.lineItems || [])
      .map(li => `• ${li.label}: $${Number(li.amount).toFixed(2)}`)
      .join("\n");

    const msg =
`Thanks ${name || ""}! Here’s your instant quote:

Service: ${service || "-"}
ZIP: ${zip || "-"}
Sqft: ${sqft || "-"}

${lines}

Subtotal: $${quote.subtotal.toFixed(2)}
Tax: $${quote.tax.toFixed(2)}
Total: $${quote.total.toFixed(2)}

Book Now: https://handyfixnow.com/protaskhub-Book-a-pro
(We’ll also email a copy to you and ProTaskHubsetup@gmail.com.)`;

    return res.status(200).json({ reply: msg, quote });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Server error" });
  }
}


