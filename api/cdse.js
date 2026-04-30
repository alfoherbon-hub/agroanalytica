// Proxy serverless para Copernicus Data Space Ecosystem.
// Las credenciales viven en Vercel Environment Variables — nunca en el navegador.
// Variables requeridas: CDSE_CLIENT_ID, CDSE_CLIENT_SECRET

let tokenCache = { value: null, expiresAt: 0 };

const TOKEN_URL = "https://identity.dataspace.copernicus.eu/auth/realms/CDSE/protocol/openid-connect/token";
const STATS_URL = "https://sh.dataspace.copernicus.eu/api/v1/statistics";

async function getToken(){
  if (tokenCache.value && Date.now() < tokenCache.expiresAt - 30000) return tokenCache.value;
  const cid  = process.env.CDSE_CLIENT_ID;
  const csec = process.env.CDSE_CLIENT_SECRET;
  if (!cid || !csec) throw new Error("Variables CDSE_CLIENT_ID / CDSE_CLIENT_SECRET no configuradas en Vercel.");
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: cid, client_secret: csec });
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error("CDSE rechazó las credenciales (" + r.status + "): " + t.slice(0, 200));
  }
  const j = await r.json();
  tokenCache = { value: j.access_token, expiresAt: Date.now() + (j.expires_in || 600) * 1000 };
  return tokenCache.value;
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    const configured = !!(process.env.CDSE_CLIENT_ID && process.env.CDSE_CLIENT_SECRET);
    return res.status(200).json({ proxy: true, configured });
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const action = req.body && req.body.action;

    if (action === "ping") {
      await getToken();
      return res.status(200).json({ ok: true });
    }

    if (action === "statistics") {
      const token = await getToken();
      const r = await fetch(STATS_URL, {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + token,
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify(req.body.payload || {})
      });
      const text = await r.text();
      console.log("[CDSE statistics] status=" + r.status + " bytes=" + text.length);
      if (r.status >= 400) console.log("[CDSE statistics] error body:", text.slice(0, 500));
      res.status(r.status);
      res.setHeader("Content-Type", "application/json");
      return res.send(text);
    }

    return res.status(400).json({ error: "Unknown action: " + action });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
