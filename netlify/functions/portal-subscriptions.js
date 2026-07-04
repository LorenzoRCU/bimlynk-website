// Admin-only CRUD for LYNK Electrical subscriptions.
// GET  → list all subs (with IBAN masked)
// PATCH → update status / paymentStatus / notes / licenseActivated
// DELETE → remove a subscription

const ACCOUNT_SLUG = 'LorenzoRCU';
const { getData, setData, isBlobKey } = require('./_storage');

async function getEnv(key) {
  if (isBlobKey(key)) return await getData(key);
  try {
    const siteId = process.env.MY_SITE_ID;
    const token = process.env.NETLIFY_API_TOKEN;
    const res = await fetch(`https://api.netlify.com/api/v1/accounts/${ACCOUNT_SLUG}/env/${key}?site_id=${siteId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data.values && data.values[0]) return JSON.parse(data.values[0].value);
    return null;
  } catch { return null; }
}

async function setEnv(key, value) {
  if (isBlobKey(key)) return setData(key, value);
  const siteId = process.env.MY_SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN;
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  const base = `https://api.netlify.com/api/v1/accounts/${ACCOUNT_SLUG}/env`;
  await fetch(`${base}/${key}?site_id=${siteId}`, { method: 'DELETE', headers });
  await fetch(`${base}?site_id=${siteId}`, {
    method: 'POST', headers,
    body: JSON.stringify([{ key, values: [{ value: JSON.stringify(value), context: 'all' }] }])
  });
}

async function getSession(token) {
  const sessions = await getEnv('PORTAL_SESSIONS') || {};
  return sessions[token] || null;
}

// Allowed fields for PATCH (whitelist to prevent tampering)
const UPDATABLE_FIELDS = new Set([
  'status', 'paymentStatus', 'notes', 'licenseActivated', 'licenseActivatedAt',
  'paymentProvider', 'paymentProviderId', 'nextPaymentDate'
]);
const ALLOWED_STATUS = ['pending', 'active', 'suspended', 'cancelled'];
const ALLOWED_PAYMENT_STATUS = ['awaiting_invoice', 'invoiced', 'paid', 'failed', 'refunded'];

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, PATCH, DELETE, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const authHeader = event.headers.authorization || '';
  const sessionToken = authHeader.replace('Bearer ', '');
  if (!sessionToken) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Niet ingelogd.' }) };
  const session = await getSession(sessionToken);
  if (!session || session.role !== 'admin') {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Alleen admin.' }) };
  }

  // GET — list subs (admin sees full IBAN since they need it for SEPA)
  if (event.httpMethod === 'GET') {
    const list = await getEnv('LYNK_SUBSCRIPTIONS') || [];
    // Basic stats
    const stats = {
      total: list.length,
      pending: list.filter(s => s.status === 'pending').length,
      active: list.filter(s => s.status === 'active').length,
      suspended: list.filter(s => s.status === 'suspended').length,
      cancelled: list.filter(s => s.status === 'cancelled').length,
      mrr: list.filter(s => s.status === 'active').reduce((sum, s) => {
        if (s.billingCycle === 'yearly') return sum + (s.price / 12);
        if (s.billingCycle === 'monthly') return sum + s.price;
        return sum;
      }, 0),
      arr: list.filter(s => s.status === 'active').reduce((sum, s) => {
        if (s.billingCycle === 'yearly') return sum + s.price;
        if (s.billingCycle === 'monthly') return sum + (s.price * 12);
        return sum;
      }, 0)
    };
    return { statusCode: 200, headers, body: JSON.stringify({ subscriptions: list, stats }) };
  }

  // PATCH — update a subscription
  if (event.httpMethod === 'PATCH') {
    try {
      const data = JSON.parse(event.body);
      if (!data.id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id verplicht' }) };

      const list = await getEnv('LYNK_SUBSCRIPTIONS') || [];
      const sub = list.find(s => s.id === data.id);
      if (!sub) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Abonnement niet gevonden' }) };

      // Apply updates (whitelisted)
      for (const [k, v] of Object.entries(data.updates || {})) {
        if (!UPDATABLE_FIELDS.has(k)) continue;
        if (k === 'status' && !ALLOWED_STATUS.includes(v)) continue;
        if (k === 'paymentStatus' && !ALLOWED_PAYMENT_STATUS.includes(v)) continue;
        sub[k] = v;
      }
      sub.updatedAt = new Date().toISOString();
      sub.updatedBy = session.email || 'admin';

      // Auto-set licenseActivatedAt when activating
      if (data.updates && data.updates.licenseActivated === true && !sub.licenseActivatedAt) {
        sub.licenseActivatedAt = new Date().toISOString();
      }

      await setEnv('LYNK_SUBSCRIPTIONS', list);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, subscription: sub }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  // DELETE — remove a subscription
  if (event.httpMethod === 'DELETE') {
    try {
      const data = JSON.parse(event.body || '{}');
      if (!data.id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'id verplicht' }) };
      const list = await getEnv('LYNK_SUBSCRIPTIONS') || [];
      const next = list.filter(s => s.id !== data.id);
      await setEnv('LYNK_SUBSCRIPTIONS', next);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, removed: list.length - next.length }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
