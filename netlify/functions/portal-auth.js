const crypto = require('crypto');
const ACCOUNT_SLUG = 'LorenzoRCU';

async function getSignups() {
  try {
    const siteId = process.env.MY_SITE_ID;
    const token = process.env.NETLIFY_API_TOKEN;
    const res = await fetch(`https://api.netlify.com/api/v1/accounts/${ACCOUNT_SLUG}/env/BETA_SIGNUPS?site_id=${siteId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (data.values && data.values[0]) return JSON.parse(data.values[0].value);
    return [];
  } catch { return []; }
}

async function getSessions() {
  try {
    const siteId = process.env.MY_SITE_ID;
    const token = process.env.NETLIFY_API_TOKEN;
    const res = await fetch(`https://api.netlify.com/api/v1/accounts/${ACCOUNT_SLUG}/env/PORTAL_SESSIONS?site_id=${siteId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return {};
    const data = await res.json();
    if (data.values && data.values[0]) return JSON.parse(data.values[0].value);
    return {};
  } catch { return {}; }
}

async function saveSessions(sessions) {
  const siteId = process.env.MY_SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN;
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  const base = `https://api.netlify.com/api/v1/accounts/${ACCOUNT_SLUG}/env`;
  await fetch(`${base}/PORTAL_SESSIONS?site_id=${siteId}`, { method: 'DELETE', headers });
  await fetch(`${base}?site_id=${siteId}`, {
    method: 'POST', headers,
    body: JSON.stringify([{ key: 'PORTAL_SESSIONS', values: [{ value: JSON.stringify(sessions), context: 'all' }] }])
  });
}

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const path = event.path.replace('/.netlify/functions/portal-auth', '');

  // LOGIN
  if (event.httpMethod === 'POST' && (path === '' || path === '/')) {
    const { email, password } = JSON.parse(event.body);

    // Admin check
    if (email.toLowerCase() === process.env.ADMIN_EMAIL.toLowerCase() && password === process.env.ADMIN_PASS) {
      const token = crypto.randomBytes(32).toString('hex');
      const sessions = await getSessions();
      sessions[token] = { email, role: 'admin', created: new Date().toISOString() };
      await saveSessions(sessions);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, token, role: 'admin', name: 'Admin' }) };
    }

    // Beta tester check (email + beta code as password)
    const signups = await getSignups();
    const user = signups.find(s => s.email.toLowerCase() === email.toLowerCase() && s.code === password);
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const sessions = await getSessions();
      const testerIndex = signups.findIndex(s => s.email.toLowerCase() === email.toLowerCase());
      const testerTag = `Betatester${String(testerIndex + 1).padStart(2, '0')}`;
      sessions[token] = { email, role: 'tester', testerTag, firstName: user.firstName, created: new Date().toISOString() };
      await saveSessions(sessions);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, token, role: 'tester', name: user.firstName, testerTag }) };
    }

    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Onjuiste inloggegevens. Gebruik je e-mail en activatiecode.' }) };
  }

  // VERIFY TOKEN
  if (event.httpMethod === 'GET') {
    const authHeader = event.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Geen token.' }) };

    const sessions = await getSessions();
    const session = sessions[token];
    if (!session) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Ongeldige sessie.' }) };

    // For admin, include all signups
    if (session.role === 'admin') {
      const signups = await getSignups();
      return { statusCode: 200, headers, body: JSON.stringify({ valid: true, role: 'admin', name: 'Admin', signups }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ valid: true, role: 'tester', name: session.firstName, testerTag: session.testerTag }) };
  }

  return { statusCode: 404, headers, body: JSON.stringify({ error: 'Not found' }) };
};
