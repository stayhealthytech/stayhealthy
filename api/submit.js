/**
 * api/submit.js  —  Vercel serverless function
 *
 * Problem solved: Airtable webhook URLs block direct browser calls with a
 * CORS error because the browser sends a preflight OPTIONS request that
 * Airtable's webhook endpoint doesn't respond to.
 *
 * Solution: the browser posts to THIS function (same-origin or CORS-allowed),
 * and this function forwards the request server-side to Airtable — where
 * there is no browser and therefore no CORS restriction.
 *
 * Flow:
 *   Browser → POST /api/submit → (server) → POST Airtable webhook URL
 *
 * Environment variable to set in Vercel dashboard:
 *   AIRTABLE_WEBHOOK_URL  — the full webhook URL from your Airtable automation
 *                           e.g. https://hooks.airtable.com/workflows/v1/genericWebhook/...
 *   ALLOWED_ORIGIN        — your survey's domain, e.g. https://yoursite.com
 *                           use * during local dev only
 */

// ─── CORS — allows the browser to reach this function ────────────────────────

function setCors(res, origin) {
  const allowed = process.env.ALLOWED_ORIGIN || '*';
  const isAllowed = allowed === '*' || origin === allowed;
  res.setHeader('Access-Control-Allow-Origin', isAllowed ? (origin || '*') : allowed);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  const origin = req.headers.origin || '';
  setCors(res, origin);

  // Preflight
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body;
  if (!body || typeof body !== 'object') {
    return res.status(400).json({ error: 'Body must be { }' });
  }


  const webhookUrl = process.env.AIRTABLE_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('[submit] AIRTABLE_WEBHOOK_URL is not set');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // Forward to Airtable webhook — server-side, so no CORS restriction applies
  try {
    const upstream = await fetch(webhookUrl, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    body,   // webhook expects a flat object, not { fields: {} }
    });

    // Airtable webhooks return 200 with an empty or minimal body — any 2xx is success
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      console.error(`[submit] Webhook returned ${upstream.status}:`, text);
      return res.status(502).json({ error: `Airtable webhook error: ${upstream.status}` });
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('[submit] Fetch to webhook failed:', err.message);
    return res.status(500).json({ error: 'Could not reach Airtable' });
  }
}
