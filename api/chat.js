export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const { name = "", service = "", zip = "", sqft = 0 } = req.body || {};
    const nSqft = Number(sqft) || 0;

    // Super-simple inline pricing so nothing can hang:
    // (interior paint baseline)
    const baseRate = 1.9;
    const materialsPct = 0.18;
    const prepPct = 0.12;
    const taxRate = 0.07;
    const minJob = 350;

    const labor = baseRate * nSqft;
    const materials = baseRate * materialsPct * nSqft;
    const prep = (labor + materials) * prepPct;
    let subtotal = labor + materials + prep;

    if (subtotal < minJob) subtotal = minJob;
    const tax = +(subtotal * taxRate).toFixed(2);
    const total = +(subtotal + tax).toFixed(2);

    const lines = [
      `• ${service || "Interior paint"} — ${nSqft} ft² @ ZIP ${zip}: $${(labor + materials + prep).toFixed(2)}`
    ].join("\n");

    const msg =
`Thanks ${name || ""}! Here’s your instant quote:

Service: ${service || "-"}
ZIP: ${zip || "-"}
Sqft: ${nSqft || "-"}

${lines}

Subtotal: $${subtotal.toFixed(2)}
Tax: $${tax.toFixed(2)}
Total: $${total.toFixed(2)}

Book Now: https://handyfixnow.com/protaskhub-Book-a-pro
(Email sending is disabled for this quick test.)`;

    return res.status(200).json({ reply: msg, quote: { subtotal, tax, total } });
  } catch (e) {
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
