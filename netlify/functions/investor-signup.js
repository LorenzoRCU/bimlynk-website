const ACCOUNT_SLUG = 'LorenzoRCU';
const ADMIN_NOTIFY_ADDRESS = 'info@bimlynk.com';
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
  return (await res.json()).access_token;
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function notifyAdminOfInvestor(entry) {
  try {
    const token = await getAccessToken();
    const sender = process.env.SENDER_EMAIL;
    const html = `<!DOCTYPE html>
<html><body style="font-family: Inter, Arial, sans-serif; color: #1C1C1E; max-width: 600px; margin: 0 auto;">
  <div style="background: #20433e; color: white; padding: 20px; text-align: center;">
    <h2 style="margin: 0; font-size: 18px;">💰 Nieuwe investeerder-interesse</h2>
    <p style="margin: 4px 0 0; font-size: 12px; opacity: 0.85;">BIM LYNK</p>
  </div>
  <div style="padding: 24px;">
    <p style="margin-top:0;">Er heeft iemand interesse getoond om te investeren. Reply direct op deze mail of neem binnen 2 werkdagen persoonlijk contact op.</p>

    <table style="width:100%; border-collapse: collapse; font-size: 14px; margin: 16px 0;">
      <tr><td style="padding:6px 0; color:#8E8E93; width: 35%;">Naam</td><td style="padding:6px 0;"><strong>${escapeHtml(entry.firstName)} ${escapeHtml(entry.lastName)}</strong></td></tr>
      <tr><td style="padding:6px 0; color:#8E8E93;">Organisatie / fonds</td><td style="padding:6px 0;">${escapeHtml(entry.organization)}</td></tr>
      <tr><td style="padding:6px 0; color:#8E8E93;">E-mail</td><td style="padding:6px 0;"><a href="mailto:${escapeHtml(entry.email)}" style="color:#20433e;">${escapeHtml(entry.email)}</a></td></tr>
      ${entry.phone ? `<tr><td style="padding:6px 0; color:#8E8E93;">Telefoon</td><td style="padding:6px 0;"><a href="tel:${escapeHtml(entry.phone)}" style="color:#20433e;">${escapeHtml(entry.phone)}</a></td></tr>` : ''}
      ${entry.ticket ? `<tr><td style="padding:6px 0; color:#8E8E93;">Indicatief ticket</td><td style="padding:6px 0;"><strong>${escapeHtml(entry.ticket)}</strong></td></tr>` : ''}
      <tr><td style="padding:6px 0; color:#8E8E93;">Datum</td><td style="padding:6px 0;">${new Date(entry.date).toLocaleString('nl-NL')}</td></tr>
    </table>

    ${entry.message ? `<div style="background:#F2F2F7; padding:12px; border-radius:6px; font-size:13px; margin-bottom:16px;"><strong>Bericht:</strong><br>${escapeHtml(entry.message).replace(/\n/g,'<br>')}</div>` : ''}

    <div style="background:#E8F5E9; border-left:3px solid #34C759; padding:12px; border-radius:6px; font-size:13px; margin-bottom:16px;">
      <strong style="color:#20A84D;">🎁 Lifetime toegang belofte</strong><br>
      Deze investeerder heeft recht op levenslange toegang tot de complete LYNK Electrical suite (incl. alle toekomstige tools) zodra de investering rond is. Registreer handmatig een lifetime-licentie in het portaal na afronding van de deal.
    </div>

    <p style="font-size:12px; color:#8E8E93; margin-top:24px;">Reply op deze mail om direct met de investeerder in gesprek te gaan — reply-to staat ingesteld op hun e-mailadres.</p>
  </div>
  <div style="background:#F2F2F7; padding:12px; text-align:center; font-size:11px; color:#8E8E93;">
    BIM LYNK - part of CVL SOLUTIONS · <a href="https://www.bimlynk.com" style="color:#20433e;">www.bimlynk.com</a>
  </div>
</body></html>`;

    const message = {
      subject: `💰 Investeerder-interesse: ${entry.firstName} ${entry.lastName} (${entry.organization})`,
      body: { contentType: 'HTML', content: html },
      toRecipients: [{ emailAddress: { address: ADMIN_NOTIFY_ADDRESS } }],
      replyTo: [{ emailAddress: { address: entry.email } }]
    };

    const res = await fetch(`https://graph.microsoft.com/v1.0/users/${sender}/sendMail`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, saveToSentItems: true })
    });
    if (res.status !== 202) {
      console.warn('Investor notification failed:', res.status, await res.text());
    }
  } catch (e) {
    console.warn('notifyAdminOfInvestor error:', e.message);
  }
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

    if (!data.firstName || !data.lastName || !data.email || !data.organization) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Vul alle verplichte velden in.' }) };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldig e-mailadres.' }) };
    }

    const entry = {
      id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
      firstName: data.firstName,
      lastName: data.lastName,
      organization: data.organization,
      email: data.email,
      phone: data.phone || '',
      ticket: data.ticket || '',
      message: data.message || '',
      date: new Date().toISOString()
    };

    const list = await getEnv('INVESTOR_SIGNUPS') || [];
    list.push(entry);
    await setEnv('INVESTOR_SIGNUPS', list);

    // Notify admin (best-effort — never fail the user's submit if mail breaks)
    await notifyAdminOfInvestor(entry);

    return { statusCode: 200, headers, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
