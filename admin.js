
import fs from "fs";
import path from "path";
import { setPricebook, getPricebook } from "../lib/zip_pricing.js";

export default async function adminHandler(req, res) {
  if (req.method === "GET") {
    return res.json(getPricebook());
  }
  if (req.method !== "POST") return res.status(405).end();

  if (req.headers["x-admin-key"] !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  try {
    const pb = req.body;
    const pricebookPath = path.join(process.cwd(), "data", "prices_by_zip.json");
    fs.writeFileSync(pricebookPath, JSON.stringify(pb, null, 2));
    setPricebook(pb);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}
