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

exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const authHeader = event.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '');
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Niet ingelogd.' }) };

  const session = await getSession(token);
  if (!session) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Ongeldige sessie.' }) };

  const feedback = await getEnv('BETA_FEEDBACK') || [];

  // GET feedback
  if (event.httpMethod === 'GET') {
    // Admin sees everything including names
    if (session.role === 'admin') {
      return { statusCode: 200, headers, body: JSON.stringify({ feedback }) };
    }
    // Testers see feedback but only tester tags, not real names
    const publicFeedback = feedback.map(f => ({
      id: f.id,
      testerTag: f.testerTag,
      tool: f.tool,
      category: f.category,
      message: f.message,
      date: f.date,
      replies: (f.replies || []).map(r => ({
        message: r.message,
        date: r.date,
        isAdmin: r.isAdmin,
        author: r.isAdmin ? 'BIM LYNK Team' : r.testerTag
      }))
    }));
    return { statusCode: 200, headers, body: JSON.stringify({ feedback: publicFeedback }) };
  }

  // POST new feedback or reply
  if (event.httpMethod === 'POST') {
    const data = JSON.parse(event.body);

    // Reply to existing feedback (admin only for admin replies, testers can also reply)
    if (data.replyTo) {
      const item = feedback.find(f => f.id === data.replyTo);
      if (!item) return { statusCode: 404, headers, body: JSON.stringify({ error: 'Feedback niet gevonden.' }) };

      item.replies = item.replies || [];
      item.replies.push({
        message: data.message,
        date: new Date().toISOString(),
        isAdmin: session.role === 'admin',
        testerTag: session.role === 'admin' ? 'Admin' : session.testerTag,
        email: session.email
      });

      await setEnv('BETA_FEEDBACK', feedback);
      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // New feedback (testers only)
    if (session.role !== 'tester') {
      return { statusCode: 403, headers, body: JSON.stringify({ error: 'Alleen beta testers kunnen feedback plaatsen.' }) };
    }

    if (!data.message || !data.tool) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Vul een tool en bericht in.' }) };
    }

    feedback.push({
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      testerTag: session.testerTag,
      email: session.email,
      firstName: session.firstName,
      tool: data.tool,
      category: data.category || 'Algemeen',
      message: data.message,
      date: new Date().toISOString(),
      replies: []
    });

    await setEnv('BETA_FEEDBACK', feedback);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
