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

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  try {
    const data = JSON.parse(event.body);

    // Validation
    if (!data.firstName || !data.lastName || !data.email || !data.company) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Vul alle verplichte velden in.' }) };
    }
    if (!Array.isArray(data.revitVersions) || data.revitVersions.length === 0) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Selecteer minimaal één Revit versie.' }) };
    }

    // Load existing demo signups
    const signups = await getEnv('DEMO_SIGNUPS') || [];

    // Check duplicates
    const existing = signups.find(s => s.email.toLowerCase() === data.email.toLowerCase());
    if (existing && existing.status !== 'rejected') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Dit e-mailadres heeft al een aanvraag ingediend.' }) };
    }

    // Add new signup
    const signup = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      firstName: data.firstName,
      lastName: data.lastName,
      company: data.company,
      email: data.email,
      role: data.role || '',
      revitVersions: data.revitVersions,
      notes: data.notes || '',
      date: new Date().toISOString(),
      status: 'pending', // pending, sent, rejected
      sentAt: null,
      assignedCode: null
    };

    signups.push(signup);
    await setEnv('DEMO_SIGNUPS', signups);

    return { statusCode: 200, headers, body: JSON.stringify({ success: true, message: 'Aanvraag ontvangen.' }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
