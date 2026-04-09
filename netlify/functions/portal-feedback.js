const ACCOUNT_SLUG = 'LorenzoRCU';

async function getGraphToken() {
  const url = `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.AZURE_CLIENT_ID,
    client_secret: process.env.AZURE_CLIENT_SECRET,
    scope: 'https://graph.microsoft.com/.default'
  });
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });
  if (!res.ok) throw new Error(`Token failed: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

async function sendGraphEmail(token, to, subject, htmlBody) {
  const sender = process.env.SENDER_EMAIL;
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${sender}/sendMail`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: htmlBody },
        toRecipients: [{ emailAddress: { address: to } }]
      },
      saveToSentItems: true
    })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Send failed: ${res.status} ${err}`);
  }
}

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
      const replyObj = {
        message: data.message,
        date: new Date().toISOString(),
        isAdmin: session.role === 'admin',
        testerTag: session.role === 'admin' ? 'Admin' : session.testerTag,
        email: session.email
      };
      item.replies.push(replyObj);

      await setEnv('BETA_FEEDBACK', feedback);

      // Notify the original feedback author when an admin replies
      if (session.role === 'admin' && item.email) {
        try {
          const graphToken = await getGraphToken();
          const subject = `Reactie op je beta feedback: ${item.tool}`;
          const html = `
            <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1C1C1E;">
              <div style="background: linear-gradient(135deg, #162e2b 0%, #20433e 100%); padding: 32px; border-radius: 14px 14px 0 0; color: white;">
                <h1 style="margin: 0; font-size: 1.4rem;">BIM LYNK heeft gereageerd</h1>
                <p style="margin: 8px 0 0; opacity: 0.85;">Op je feedback in het Beta Portaal</p>
              </div>
              <div style="background: white; padding: 32px; border: 1px solid #E5E5EA; border-top: none; border-radius: 0 0 14px 14px;">
                <p>Hoi ${item.firstName || 'beta tester'},</p>
                <p>We hebben gereageerd op je feedback over <strong>${item.tool}</strong>:</p>
                <div style="background: #F2F2F7; padding: 16px; border-radius: 10px; border-left: 3px solid #8E8E93; margin: 16px 0;">
                  <p style="margin: 0; color: #3C3C43; font-size: 0.9rem;"><em>Je feedback:</em></p>
                  <p style="margin: 8px 0 0; color: #1C1C1E;">${item.message.substring(0, 200)}${item.message.length > 200 ? '...' : ''}</p>
                </div>
                <div style="background: #E8F0EE; padding: 16px; border-radius: 10px; border-left: 3px solid #20433e; margin: 16px 0;">
                  <p style="margin: 0; color: #20433e; font-size: 0.9rem;"><strong>Reactie BIM LYNK Team:</strong></p>
                  <p style="margin: 8px 0 0; color: #1C1C1E;">${data.message}</p>
                </div>
                <div style="text-align: center; margin-top: 24px;">
                  <a href="https://bimlynk.com/portal.html" style="display: inline-block; background: #20433e; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">Bekijk in het portaal</a>
                </div>
                <p style="color: #8E8E93; font-size: 0.85rem; margin-top: 24px; text-align: center;">
                  BIM LYNK — Voor (BIM-)Engineers, door BIM-Engineers
                </p>
              </div>
            </div>`;
          await sendGraphEmail(graphToken, item.email, subject, html);
        } catch (e) {
          console.log('Reply notify email failed:', e.message);
        }
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    }

    // Admin proxy feedback: admin plaatst feedback namens een beta tester
    if (data.onBehalfOf && session.role === 'admin') {
      if (!data.message || !data.tool) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Vul een tool en bericht in.' }) };
      }

      // Find the beta tester by email
      const signups = await getEnv('BETA_SIGNUPS') || [];
      const tester = signups.find(s => s.email.toLowerCase() === data.onBehalfOf.toLowerCase());
      if (!tester) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Beta tester niet gevonden. Controleer het e-mailadres.' }) };
      }

      // Generate tester tag (same format as login)
      const idx = signups.indexOf(tester);
      const testerTag = `BetaGebruiker${String(idx + 1).padStart(3, '0')}`;

      feedback.push({
        id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
        testerTag: testerTag,
        email: tester.email,
        firstName: tester.firstName,
        tool: data.tool,
        category: data.category || 'Algemeen',
        message: data.message,
        date: new Date().toISOString(),
        postedByAdmin: true,
        replies: []
      });

      await setEnv('BETA_FEEDBACK', feedback);

      // Email the beta tester that admin posted feedback on their behalf
      try {
        const graphToken = await getGraphToken();
        const subject = `Feedback namens jou geplaatst in BIM LYNK Beta Portaal`;
        const html = `
          <div style="font-family: Inter, Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1C1C1E;">
            <div style="background: linear-gradient(135deg, #162e2b 0%, #20433e 100%); padding: 32px; border-radius: 14px 14px 0 0; color: white;">
              <h1 style="margin: 0; font-size: 1.4rem;">Feedback geplaatst namens jou</h1>
              <p style="margin: 8px 0 0; opacity: 0.85;">BIM LYNK Beta Portaal</p>
            </div>
            <div style="background: white; padding: 32px; border: 1px solid #E5E5EA; border-top: none; border-radius: 0 0 14px 14px;">
              <p>Hoi ${tester.firstName},</p>
              <p>Je feedback is zojuist voor je geplaatst in het BIM LYNK Beta Portaal. Op basis van je bericht hebben we het volgende als ${testerTag} (geplaatst door admin) geregistreerd:</p>
              <div style="background: #F2F2F7; padding: 16px; border-radius: 10px; border-left: 3px solid #20433e; margin: 16px 0;">
                <p style="margin: 0; color: #8E8E93; font-size: 0.85rem; text-transform: uppercase; letter-spacing: 0.5px;">${data.tool} — ${data.category || 'Algemeen'}</p>
                <p style="margin: 8px 0 0; color: #1C1C1E;">${data.message}</p>
              </div>
              <p>Je kunt in het portaal inloggen om reacties te bekijken of verder te reageren.</p>
              <div style="text-align: center; margin-top: 24px;">
                <a href="https://bimlynk.com/portal.html" style="display: inline-block; background: #20433e; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 600;">Open het portaal</a>
              </div>
              <p style="color: #8E8E93; font-size: 0.8rem; margin-top: 24px; text-align: center; line-height: 1.5;">
                Klopt er iets niet? Stuur een mailtje naar <a href="mailto:info@bimlynk.com" style="color: #20433e;">info@bimlynk.com</a><br>
                BIM LYNK — Voor (BIM-)Engineers, door BIM-Engineers
              </p>
            </div>
          </div>`;
        await sendGraphEmail(graphToken, tester.email, subject, html);
      } catch (e) {
        console.log('Admin proxy feedback email failed:', e.message);
      }

      return { statusCode: 200, headers, body: JSON.stringify({ success: true, testerTag }) };
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
