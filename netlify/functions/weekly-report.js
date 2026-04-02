const ACCOUNT_SLUG = 'LorenzoRCU';

async function getAccessToken() {
  const url = `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    grant_type: 'client_credentials', client_id: process.env.AZURE_CLIENT_ID,
    client_secret: process.env.AZURE_CLIENT_SECRET, scope: 'https://graph.microsoft.com/.default'
  });
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params.toString() });
  return (await res.json()).access_token;
}

async function sendEmail(token, to, subject, html) {
  await fetch(`https://graph.microsoft.com/v1.0/users/${process.env.SENDER_EMAIL}/sendMail`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: { subject, body: { contentType: 'HTML', content: html }, toRecipients: [{ emailAddress: { address: to } }] }, saveToSentItems: true })
  });
}

async function getSignups() {
  try {
    const res = await fetch(`https://api.netlify.com/api/v1/accounts/${ACCOUNT_SLUG}/env/BETA_SIGNUPS?site_id=${process.env.MY_SITE_ID}`, {
      headers: { 'Authorization': `Bearer ${process.env.NETLIFY_API_TOKEN}` }
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (data.values && data.values[0]) return JSON.parse(data.values[0].value);
    return [];
  } catch { return []; }
}

exports.handler = async (event) => {
  // Only run on Monday and Thursday (triggered by Netlify scheduled function or manual call)
  const today = new Date();
  const day = today.getDay(); // 0=Sun, 1=Mon, 4=Thu

  // Allow manual trigger via POST, or check if it's Mon/Thu
  if (event.httpMethod !== 'POST' && day !== 1 && day !== 4) {
    return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'Not Monday or Thursday' }) };
  }

  try {
    const signups = await getSignups();
    if (!signups.length) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'No signups yet' }) };
    }

    // Find new testers since last report (last 3-4 days)
    const daysBack = day === 1 ? 4 : 3; // Mon looks back 4 days (from Thu), Thu looks back 3 (from Mon)
    const cutoff = new Date(today.getTime() - daysBack * 24 * 60 * 60 * 1000);
    const newTesters = signups.filter(s => new Date(s.date) >= cutoff);

    // No new testers = no mail
    if (!newTesters.length) {
      return { statusCode: 200, body: JSON.stringify({ skipped: true, reason: 'No new testers' }) };
    }

    const whatsappRequests = newTesters.filter(s => s.whatsappOptIn);

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:-apple-system,sans-serif;background:#F2F2F7;padding:40px 20px;">
<div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;">
<div style="background:#20433e;padding:24px;text-align:center;">
<h1 style="color:white;margin:0;font-size:20px;">BIM LYNK Beta Update</h1>
<p style="color:rgba(255,255,255,0.7);margin:4px 0 0;font-size:13px;">${today.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
</div>
<div style="padding:24px;">
<h2 style="font-size:16px;margin:0 0 16px;">Overzicht</h2>
<table style="width:100%;border-collapse:collapse;margin-bottom:20px;">
<tr><td style="padding:8px 0;border-bottom:1px solid #eee;"><strong>Totaal aanmeldingen</strong></td><td style="text-align:right;padding:8px 0;border-bottom:1px solid #eee;">${signups.length} / 100</td></tr>
<tr><td style="padding:8px 0;border-bottom:1px solid #eee;"><strong>Nieuw sinds vorige update</strong></td><td style="text-align:right;padding:8px 0;border-bottom:1px solid #eee;">${newTesters.length}</td></tr>
<tr><td style="padding:8px 0;"><strong>Codes beschikbaar</strong></td><td style="text-align:right;padding:8px 0;">${100 - signups.length}</td></tr>
</table>

<h2 style="font-size:16px;margin:0 0 12px;">Nieuwe testers</h2>
<table style="width:100%;border-collapse:collapse;font-size:13px;">
<tr style="background:#F2F2F7;"><th style="padding:8px;text-align:left;">Naam</th><th style="padding:8px;text-align:left;">Bedrijf</th><th style="padding:8px;text-align:left;">E-mail</th><th style="padding:8px;text-align:left;">WhatsApp</th></tr>
${newTesters.map(s => `<tr><td style="padding:8px;border-bottom:1px solid #eee;">${s.firstName} ${s.lastName}</td><td style="padding:8px;border-bottom:1px solid #eee;">${s.company}</td><td style="padding:8px;border-bottom:1px solid #eee;">${s.email}</td><td style="padding:8px;border-bottom:1px solid #eee;">${s.whatsappOptIn ? s.phone || 'Ja' : '-'}</td></tr>`).join('')}
</table>

${whatsappRequests.length ? `<div style="background:#E8F0EE;border-radius:8px;padding:16px;margin-top:20px;">
<p style="margin:0 0 8px;font-weight:600;color:#20433e;">WhatsApp groepsapp verzoeken (${whatsappRequests.length})</p>
${whatsappRequests.map(s => `<p style="margin:4px 0;font-size:13px;">${s.firstName} ${s.lastName}: <strong>${s.phone}</strong></p>`).join('')}
</div>` : ''}
</div>
<div style="background:#F2F2F7;padding:16px;text-align:center;">
<p style="color:#8E8E93;font-size:11px;margin:0;">Automatische update van BIM LYNK Beta systeem</p>
</div></div></body></html>`;

    const graphToken = await getAccessToken();
    await sendEmail(graphToken, 'info@bimlynk.com', `Beta Update: ${newTesters.length} nieuwe tester${newTesters.length > 1 ? 's' : ''} (${today.toLocaleDateString('nl-NL')})`, html);

    return { statusCode: 200, body: JSON.stringify({ sent: true, newTesters: newTesters.length }) };
  } catch (error) {
    console.error('Report error:', error.message);
    return { statusCode: 500, body: JSON.stringify({ error: error.message }) };
  }
};
