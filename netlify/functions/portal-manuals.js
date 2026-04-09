const fs = require('fs');
const path = require('path');

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
    if (data.values && data.values[0]) {
      try { return JSON.parse(data.values[0].value); }
      catch { return data.values[0].value; }
    }
    return null;
  } catch { return null; }
}

async function setEnvRaw(key, rawValue) {
  const siteId = process.env.MY_SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN;
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  const base = `https://api.netlify.com/api/v1/accounts/${ACCOUNT_SLUG}/env`;
  await fetch(`${base}/${key}?site_id=${siteId}`, { method: 'DELETE', headers });
  const res = await fetch(`${base}?site_id=${siteId}`, {
    method: 'POST', headers,
    body: JSON.stringify([{ key, values: [{ value: rawValue, context: 'all' }] }])
  });
  return res.ok;
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

// Load default manuals from file (used as fallback when env var doesn't exist yet)
function loadDefaultManuals() {
  try {
    const file = path.join(__dirname, '_data', 'default_manuals.json');
    if (fs.existsSync(file)) {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
  } catch (e) {
    console.error('Failed to load default manuals:', e.message);
  }
  return {};
}

const DEFAULT_MANUALS = loadDefaultManuals();

// Per-tool env var key (each under 5000 char limit)
function envKey(tool) {
  return `MANUAL_${tool.toUpperCase()}`;
}

async function loadManual(tool) {
  // Try env var first (admin edits)
  const stored = await getEnv(envKey(tool));
  if (stored) return stored;

  // Fallback to default
  return DEFAULT_MANUALS[tool] || { tool, title: '', version: 'v1.0', content: '', lastUpdated: null };
}

async function saveManual(tool, data) {
  const manual = {
    tool,
    title: data.title || '',
    version: data.version || 'v1.0',
    content: data.content || '',
    lastUpdated: new Date().toISOString(),
    updatedBy: data.updatedBy || 'admin'
  };

  const value = JSON.stringify(manual);
  if (value.length > 4900) {
    throw new Error(`Handleiding te groot (${value.length} chars). Maximum is 4900 chars per tool.`);
  }
  await setEnvRaw(envKey(tool), value);
  return manual;
}

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

  if (session.role !== 'admin') {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Alleen admin kan handleidingen beheren.' }) };
  }

  // GET specific manual
  if (event.httpMethod === 'GET') {
    const tool = (event.queryStringParameters || {}).tool;
    if (!tool || !VALID_TOOLS.includes(tool)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldige tool.' }) };
    }
    try {
      const manual = await loadManual(tool);
      return { statusCode: 200, headers, body: JSON.stringify(manual) };
    } catch (e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  // POST save manual
  if (event.httpMethod === 'POST') {
    try {
      const data = JSON.parse(event.body);
      if (!data.tool || !VALID_TOOLS.includes(data.tool)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldige tool.' }) };
      }
      data.updatedBy = session.email || 'admin';
      const manual = await saveManual(data.tool, data);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true, manual }) };
    } catch (e) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
