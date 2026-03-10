// Beehiiv subscribe proxy worker
// API_KEY and PUB_ID are set as Cloudflare Worker secrets (never hardcoded here)
// Deploy: wrangler deploy
// Set secrets: wrangler secret put API_KEY  →  paste your Beehiiv API key
//              wrangler secret put PUB_ID   →  paste your Beehiiv publication ID

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: CORS_HEADERS });
    }

    let email;
    try {
      const body = await request.json();
      email = body.email?.trim().toLowerCase();
    } catch {
      return json({ error: 'Invalid request body' }, 400);
    }

    if (!email || !email.includes('@')) {
      return json({ error: 'Invalid email address' }, 400);
    }

    const res = await fetch(
      `https://api.beehiiv.com/v2/publications/${env.PUB_ID}/subscriptions`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email,
          reactivate_existing: true,
          send_welcome_email: true,
          utm_source: 'heydex-website',
        }),
      }
    );

    const data = await res.json();

    if (!res.ok) {
      console.error('Beehiiv error:', JSON.stringify(data));
      return json({ error: 'Subscription failed. Please try again.' }, 500);
    }

    return json({ success: true }, 200);
  },
};

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}
