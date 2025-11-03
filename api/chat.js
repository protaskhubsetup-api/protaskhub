export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  try {
    const body = req.body || {};
    res.status(200).json({
      reply: `OK – received: service=${body.service || ""}, zip=${body.zip || ""}, sqft=${body.sqft || ""}`
    });
  } catch (e) {
    res.status(500).json({ error: e.message || "Server error" });
  }
}

