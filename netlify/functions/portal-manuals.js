const ACCOUNT_SLUG = 'LorenzoRCU';

async function getEnv(key) {
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

const VALID_TOOLS = [
  'cable_tray_support',
  'cable_tray_clearance',
  'conduit_id',
  'cable_tray_id',
  'fill_rate'
];

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const authHeader = event.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Niet ingelogd.' }) };

  const session = await getSession(token);
  if (!session) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Ongeldige sessie.' }) };

  // Only admin can manage manuals
  if (session.role !== 'admin') {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Alleen admin kan handleidingen beheren.' }) };
  }

  const manuals = await getEnv('TOOL_MANUALS') || {};

  // GET specific manual
  if (event.httpMethod === 'GET') {
    const tool = (event.queryStringParameters || {}).tool;
    if (!tool || !VALID_TOOLS.includes(tool)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldige tool.' }) };
    }
    const manual = manuals[tool] || { tool, title: '', version: 'v1.0', content: '', lastUpdated: null };
    return { statusCode: 200, headers, body: JSON.stringify(manual) };
  }

  // POST save manual
  if (event.httpMethod === 'POST') {
    const data = JSON.parse(event.body);
    if (!data.tool || !VALID_TOOLS.includes(data.tool)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldige tool.' }) };
    }

    manuals[data.tool] = {
      tool: data.tool,
      title: data.title || '',
      version: data.version || 'v1.0',
      content: data.content || '',
      lastUpdated: new Date().toISOString(),
      updatedBy: session.email || 'admin'
    };

    await setEnv('TOOL_MANUALS', manuals);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, manual: manuals[data.tool] }) };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
