const BETA_CODES = [
  'LYNK-H3GS-A6LS','LYNK-ELY1-OS2S','LYNK-KOSH-8XGL','LYNK-YCSH-8ZVF','LYNK-2JRH-LL6W',
  'LYNK-7PMB-QN4T','LYNK-XF9A-D3KE','LYNK-V8WC-M2HJ','LYNK-4RYP-S6NB','LYNK-GAHT-W5QL',
  'LYNK-N3DJ-F8RV','LYNK-B6KM-Y2XS','LYNK-9CTW-P4GA','LYNK-L5HN-E7JB','LYNK-Z2QF-K8MC',
  'LYNK-T7WX-R3DL','LYNK-J4PA-V6NH','LYNK-M8FS-G2YK','LYNK-Q5BT-X9CE','LYNK-D3NW-H7PJ',
  'LYNK-W6KR-A4FL','LYNK-F9GS-N2TB','LYNK-C7YH-J5QM','LYNK-P4XD-L8WA','LYNK-S2MK-T6RE',
  'LYNK-H8NB-V3GF','LYNK-X5QJ-D7YC','LYNK-K3WP-M9HA','LYNK-R6TA-F4NL','LYNK-A9LS-W2XK',
  'LYNK-G4JE-Q7BT','LYNK-Y7MD-S5KH','LYNK-E2XN-P8WR','LYNK-N5GA-C3FJ','LYNK-B8HK-L6YQ',
  'LYNK-T3PW-R9DM','LYNK-V6NF-X4SA','LYNK-J9CB-G2TL','LYNK-L4YS-H7QE','LYNK-Q7KD-A5MN',
  'LYNK-W2RF-T8BJ','LYNK-D5XH-N3PG','LYNK-M8AL-V6KC','LYNK-F3GQ-Y9WS','LYNK-S6JT-E4HB',
  'LYNK-K9NM-Q2XD','LYNK-P4WR-J7FA','LYNK-X7BL-G5TS','LYNK-C2HE-M8NK','LYNK-R5YA-D3QW',
  'LYNK-A8TK-S6LF','LYNK-G3PJ-W9HB','LYNK-Y6NQ-E4XM','LYNK-H9CD-F7KR','LYNK-N4WS-B2GA',
  'LYNK-T7XL-P5JE','LYNK-V2MH-Q8DK','LYNK-J5FR-X3NW','LYNK-L8BA-G6YT','LYNK-Q3KS-R9HM',
  'LYNK-W6PD-A4FN','LYNK-D9TJ-V7CB','LYNK-M2HL-Y5QX','LYNK-F5NK-S8WG','LYNK-S8XE-J3BA',
  'LYNK-K3GM-T6DR','LYNK-P6YW-N9HF','LYNK-X9AQ-L4KJ','LYNK-C4FS-E7MB','LYNK-R7JH-Q2XT',
  'LYNK-A2BD-W5NK','LYNK-G5TL-D8PA','LYNK-Y8HM-F3RS','LYNK-H3KW-V6QG','LYNK-N6XJ-S9YE',
  'LYNK-T9PA-M4CB','LYNK-V4GR-H7LD','LYNK-J7NE-X2WK','LYNK-L2QS-A5TF','LYNK-Q5DB-G8NM',
  'LYNK-W8FK-R3YH','LYNK-D3HS-P6AJ','LYNK-M6WN-E9XQ','LYNK-F9BT-K4GL','LYNK-S4YD-V7MR',
  'LYNK-K7AH-J2NW','LYNK-P2LF-T5XB','LYNK-X5QG-N8DK','LYNK-C8MJ-W3HA','LYNK-R3TE-F6YS',
  'LYNK-A6KN-Q9PL','LYNK-G9WB-S4JD','LYNK-Y4FH-M7XR','LYNK-H7NQ-E2GA','LYNK-N2ST-K5WB',
  'LYNK-T5XD-R8HF','LYNK-V8BJ-A3MN','LYNK-J3GK-Y6QL','LYNK-L6HS-D9TW','LYNK-Q9PE-V4XA'
];

const BETA_START = new Date('2026-04-14');
const BETA_END = '14 juli 2026';

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

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Token failed: ${res.status} ${err}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function sendEmail(token, to, subject, htmlBody) {
  const sender = process.env.SENDER_EMAIL;
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${sender}/sendMail`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: htmlBody },
        toRecipients: [{ emailAddress: { address: to } }]
      },
      saveToSentItems: true
    })
  });

  if (res.status !== 202) {
    const err = await res.text();
    throw new Error(`SendMail failed: ${res.status} ${err}`);
  }
}

// Persistent storage via Netlify env API
const ACCOUNT_SLUG = 'LorenzoRCU';

async function getSignups() {
  try {
    const siteId = process.env.MY_SITE_ID;
    const token = process.env.NETLIFY_API_TOKEN;
    if (!token || !siteId) return JSON.parse(process.env.BETA_SIGNUPS || '[]');

    const res = await fetch(`https://api.netlify.com/api/v1/accounts/${ACCOUNT_SLUG}/env/BETA_SIGNUPS?site_id=${siteId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return JSON.parse(process.env.BETA_SIGNUPS || '[]');
    const data = await res.json();
    if (data.values && data.values[0]) return JSON.parse(data.values[0].value);
    return [];
  } catch { return []; }
}

async function saveSignups(signups) {
  const siteId = process.env.MY_SITE_ID;
  const token = process.env.NETLIFY_API_TOKEN;
  if (!token || !siteId) return;

  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  const base = `https://api.netlify.com/api/v1/accounts/${ACCOUNT_SLUG}/env`;

  // Delete existing then recreate with new data
  await fetch(`${base}/BETA_SIGNUPS?site_id=${siteId}`, { method: 'DELETE', headers });
  await fetch(`${base}?site_id=${siteId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify([{ key: 'BETA_SIGNUPS', values: [{ value: JSON.stringify(signups), context: 'all' }] }])
  });
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let data;
  try { data = JSON.parse(event.body); } catch { return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldige data.' }) }; }

  const { firstName, lastName, company, email, role, revitVersion, whatsappOptIn, phone } = data;
  if (!firstName || !lastName || !company || !email) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Vul alle verplichte velden in.' }) };
  }

  try {
    const signups = await getSignups();

    if (signups.find(s => s.email.toLowerCase() === email.toLowerCase())) {
      return { statusCode: 409, headers, body: JSON.stringify({ error: 'Dit e-mailadres is al aangemeld.' }) };
    }

    if (signups.length >= BETA_CODES.length) {
      return { statusCode: 410, headers, body: JSON.stringify({ error: 'Het maximale aantal beta testers (100) is bereikt.' }) };
    }

    const code = BETA_CODES[signups.length];
    const now = new Date();
    const isBetaLive = now >= BETA_START;

    signups.push({ firstName, lastName, company, email, role, revitVersion, code, date: now.toISOString(), whatsappOptIn: !!whatsappOptIn, phone: phone || '' });
    await saveSignups(signups);

    let emailSent = false;
    try {
      const graphToken = await getAccessToken();
      const subject = isBetaLive ? 'Uw Fill Rate Light NL Beta activatiecode' : 'Aanmelding bevestigd - Fill Rate Light NL Beta';
      const html = isBetaLive ? getBetaLiveEmail(firstName, code) : getPreBetaEmail(firstName, code);
      await sendEmail(graphToken, email, subject, html);
      emailSent = true;

      // Admin notificatie bij whatsapp opt-in
      if (whatsappOptIn && phone) {
        await sendEmail(graphToken, 'info@bimlynk.com',
          `Nieuwe beta tester wil in groepsapp: ${firstName} ${lastName}`,
          `<p><strong>${firstName} ${lastName}</strong> (${company}) wil worden toegevoegd aan de WhatsApp groepsapp.</p>
           <p>Telefoonnummer: <strong>${phone}</strong></p>
           <p>E-mail: ${email}</p>
           <p>Code: ${code}</p>`
        );
      }
    } catch (mailErr) {
      console.error('Graph mail error:', mailErr.message);
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true, isBetaLive, emailSent,
        message: emailSent
          ? (isBetaLive ? 'Uw activatiecode is verzonden per e-mail.' : 'Aanmelding ontvangen. U ontvangt uw code op 14 april.')
          : 'Aanmelding opgeslagen. De bevestigingsmail wordt zo snel mogelijk verstuurd.'
      })
    };
  } catch (error) {
    console.error('Error:', error.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Er is een fout opgetreden: ' + error.message }) };
  }
};

function getPreBetaEmail(firstName) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F2F2F7;padding:40px 20px;">
<div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;">
<div style="background:#20433e;padding:32px;text-align:center;">
<h1 style="color:white;margin:0;font-size:24px;">BIM LYNK</h1>
<p style="color:rgba(255,255,255,0.7);margin:8px 0 0;font-size:14px;">Voor (BIM-)Engineers, door BIM-Engineers</p></div>
<div style="padding:32px;">
<h2 style="color:#1C1C1E;margin:0 0 16px;">Hallo ${firstName},</h2>
<p style="color:#3C3C43;line-height:1.7;">Bedankt voor je aanmelding voor de <strong>Fill Rate Light NL Beta</strong>!</p>
<p style="color:#3C3C43;line-height:1.7;">De beta start op <strong>14 april 2026</strong>. Op die datum ontvang je automatisch een e-mail met je persoonlijke activatiecode en downloadlink.</p>
<div style="background:#E8F0EE;border-radius:8px;padding:20px;margin:24px 0;">
<p style="margin:0;color:#20433e;font-weight:600;">Je persoonlijke code is gereserveerd</p>
<p style="margin:8px 0 0;color:#3C3C43;font-size:14px;">Tot 14 april hoef je niets te doen. Wij sturen je alles wat je nodig hebt.</p></div>
<p style="color:#3C3C43;line-height:1.7;">De beta tester met de meest waardevolle feedback maakt kans op een <strong>lifetime license</strong> voor LYNK Electrical!</p>
<p style="color:#8E8E93;font-size:13px;margin-top:32px;">Vragen? Mail naar <a href="mailto:info@bimlynk.com" style="color:#20433e;">info@bimlynk.com</a>. Reactie binnen twee werkdagen.</p>
</div>
<div style="background:#F2F2F7;padding:20px;text-align:center;">
<p style="color:#8E8E93;font-size:12px;margin:0;">&copy; 2026 BIM LYNK - onderdeel van CVL Solutions</p>
</div></div></body></html>`;
}

function getBetaLiveEmail(firstName, code) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#F2F2F7;padding:40px 20px;">
<div style="max-width:560px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;">
<div style="background:#20433e;padding:32px;text-align:center;">
<h1 style="color:white;margin:0;font-size:24px;">BIM LYNK</h1>
<p style="color:rgba(255,255,255,0.7);margin:8px 0 0;font-size:14px;">Voor (BIM-)Engineers, door BIM-Engineers</p></div>
<div style="padding:32px;">
<h2 style="color:#1C1C1E;margin:0 0 16px;">Welkom bij de Beta, ${firstName}!</h2>
<p style="color:#3C3C43;line-height:1.7;">Bedankt voor je aanmelding. Hieronder vind je je persoonlijke activatiecode voor <strong>Fill Rate Light NL</strong>.</p>
<div style="background:#20433e;border-radius:12px;padding:24px;margin:24px 0;text-align:center;">
<p style="color:rgba(255,255,255,0.7);font-size:13px;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px;">Je activatiecode</p>
<p style="color:white;font-size:32px;font-weight:700;margin:0;letter-spacing:3px;font-family:'Courier New',monospace;">${code}</p>
<p style="color:rgba(255,255,255,0.5);font-size:12px;margin:12px 0 0;">Geldig tot ${BETA_END}</p></div>
<h3 style="color:#1C1C1E;margin:24px 0 12px;">Aan de slag</h3>
<ol style="color:#3C3C43;line-height:2;padding-left:20px;">
<li>Download Fill Rate Light NL (link volgt separaat)</li>
<li>Installeer de tool in Revit (2023, 2024, 2025 of 2026)</li>
<li>Voer bovenstaande activatiecode in bij het eerste gebruik</li>
<li>Start met vulgraadberekeningen!</li></ol>
<div style="background:#E8F0EE;border-radius:8px;padding:20px;margin:24px 0;">
<p style="margin:0;color:#20433e;font-weight:600;">Lifetime license kans</p>
<p style="margin:8px 0 0;color:#3C3C43;font-size:14px;">De beta tester met de meest waardevolle feedback maakt kans op een lifetime license voor LYNK Electrical!</p></div>
<p style="color:#8E8E93;font-size:13px;margin-top:32px;">Feedback of vragen? Mail naar <a href="mailto:info@bimlynk.com" style="color:#20433e;">info@bimlynk.com</a>. Reactie binnen twee werkdagen.</p>
</div>
<div style="background:#F2F2F7;padding:20px;text-align:center;">
<p style="color:#8E8E93;font-size:12px;margin:0;">&copy; 2026 BIM LYNK - onderdeel van CVL Solutions</p>
</div></div></body></html>`;
}
