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

async function getAccessToken() {
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

async function sendEmailWithAttachments(token, to, subject, htmlBody, attachments) {
  const sender = process.env.SENDER_EMAIL;
  const message = {
    subject,
    body: { contentType: 'HTML', content: htmlBody },
    toRecipients: [{ emailAddress: { address: to } }]
  };

  if (attachments && attachments.length > 0) {
    message.attachments = attachments.map(att => ({
      '@odata.type': '#microsoft.graph.fileAttachment',
      name: att.name,
      contentType: att.contentType || 'application/pdf',
      contentBytes: att.contentBase64
    }));
  }

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${sender}/sendMail`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message, saveToSentItems: true })
  });

  if (res.status !== 202) {
    const err = await res.text();
    throw new Error(`SendMail failed: ${res.status} ${err}`);
  }
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };

  const authHeader = event.headers.authorization || '';
  const sessionToken = authHeader.replace('Bearer ', '');
  if (!sessionToken) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Niet ingelogd.' }) };

  const session = await getSession(sessionToken);
  if (!session || session.role !== 'admin') {
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Alleen admin.' }) };
  }

  // GET — list all demo signups
  if (event.httpMethod === 'GET') {
    const signups = await getEnv('DEMO_SIGNUPS') || [];
    return { statusCode: 200, headers, body: JSON.stringify({ signups }) };
  }

  // POST — send demo email manually
  if (event.httpMethod === 'POST') {
    try {
      const data = JSON.parse(event.body);

      if (!data.signupId || !data.code) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'signupId en code verplicht' }) };
      }

      const signups = await getEnv('DEMO_SIGNUPS') || [];
      const signup = signups.find(s => s.id === data.signupId);
      if (!signup) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Aanvraag niet gevonden' }) };
      }

      // Build email
      const subject = data.subject || 'Je LYNK Electrical Demo v1.0 staat klaar';
      const installerLink = data.installerLink || 'https://bimlynk.netlify.app/downloads/LYNK_Electrical_Demo_v1.0_Setup.exe';
      const htmlBody = `
<!DOCTYPE html>
<html><body style="font-family: Inter, Arial, sans-serif; color: #1C1C1E; max-width: 600px; margin: 0 auto;">
  <div style="background: #20433e; color: white; padding: 24px; text-align: center;">
    <h1 style="margin: 0; font-size: 22px;">BIM LYNK</h1>
    <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.8;">LYNK Electrical Demo v1.0</p>
  </div>
  <div style="padding: 32px 24px;">
    <p>Hi ${signup.firstName},</p>
    <p>Bedankt voor je interesse in <strong>LYNK Electrical Demo v1.0</strong>! Je 14-dagen demo staat klaar.</p>

    <h3 style="color: #20433e; margin-top: 24px;">Jouw activatiecode</h3>
    <div style="background: #F2F2F7; padding: 16px; border-radius: 8px; font-family: Consolas, monospace; font-size: 16px; font-weight: bold; text-align: center; letter-spacing: 1px;">
      ${data.code}
    </div>
    <p style="font-size: 13px; color: #8E8E93;">Deze code kun je één keer gebruiken op één computer. Vanaf de eerste activatie heb je 14 dagen toegang.</p>

    <h3 style="color: #20433e; margin-top: 24px;">Installatie</h3>
    <p>Download de installer en start hem als administrator:</p>
    <p><a href="${installerLink}" style="display: inline-block; background: #20433e; color: white; padding: 12px 24px; border-radius: 6px; text-decoration: none;">Download installer (.exe)</a></p>
    <p style="font-size: 13px; color: #8E8E93;">Of zie de bijlage voor de installer.</p>

    <h3 style="color: #20433e; margin-top: 24px;">Wat zit er in?</h3>
    <ul style="font-size: 14px; line-height: 1.6;">
      <li><strong>Cable Tray Support tool</strong> — automatisch ophangbeugels plaatsen</li>
      <li><strong>Cable Tray Clearance tool</strong> — clearance hulls rondom kabelgoten</li>
      <li><strong>Tag Generator</strong> — Conduit ID en Cable Tray ID generators</li>
    </ul>
    <p style="font-size: 13px; color: #8E8E93;">Handleidingen per tool zitten als PDF in de bijlage.</p>

    ${data.message ? `<div style="margin-top: 20px; padding: 16px; background: #E8F0EE; border-left: 3px solid #20433e; border-radius: 4px;"><p style="margin: 0; font-size: 14px;">${data.message.replace(/\n/g, '<br>')}</p></div>` : ''}

    <p style="margin-top: 24px;">Vragen? Reply gewoon op deze e-mail of stuur een bericht naar info@bimlynk.com.</p>
    <p>Veel succes met testen!</p>
    <p>— BIM LYNK Team</p>
  </div>
  <div style="background: #F2F2F7; padding: 16px; text-align: center; font-size: 12px; color: #8E8E93; border-top: 1px solid #E5E5EA;">
    © BIM LYNK - part of CVL SOLUTIONS<br>
    <a href="https://bimlynk.netlify.app" style="color: #20433e;">bimlynk.netlify.app</a>
  </div>
</body></html>`;

      // Send email
      const graphToken = await getAccessToken();
      await sendEmailWithAttachments(graphToken, signup.email, subject, htmlBody, data.attachments || []);

      // Update signup status
      signup.status = 'sent';
      signup.sentAt = new Date().toISOString();
      signup.assignedCode = data.code;
      await setEnv('DEMO_SIGNUPS', signups);

      return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
    } catch (err) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
    }
  }

  return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
};
