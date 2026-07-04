// Admin-triggered: notify ALL beta testers that a new version is available,
// with the changelog and the scheidingsschot family attached.
// POST with admin Bearer token. Body (optional): { version, changelog }.
// Falls back to fillrate-version.json on the site for version/changelog.

const { getData } = require('./_storage');

const FAMILY_FILES = [
  'Cable Tray_scheidingsschot_LYNK.rfa'
];
const DOWNLOAD_URL = 'https://www.bimlynk.com/fillrate-download.html';

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
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function buildHtml(firstName, version, changelogLines) {
  const items = (changelogLines && changelogLines.length)
    ? changelogLines.map(l => `<li style="margin:4px 0;">${escapeHtml(l)}</li>`).join('')
    : '<li>Diverse verbeteringen en bugfixes.</li>';
  return `<!DOCTYPE html>
<html><body style="font-family: Inter, Arial, sans-serif; color:#1C1C1E; max-width:640px; margin:0 auto;">
  <div style="background:#20433e; color:white; padding:24px; text-align:center;">
    <h1 style="margin:0; font-size:22px;">BIM LYNK</h1>
    <p style="margin:4px 0 0; font-size:13px; opacity:0.85;">Fill Rate Light NL — update beschikbaar</p>
  </div>
  <div style="padding:32px 24px;">
    <p>Hi ${escapeHtml(firstName) || 'daar'},</p>
    <p>Er is een nieuwe versie van <strong>Fill Rate Light NL</strong> beschikbaar: <strong>v${escapeHtml(version)}</strong>.</p>

    <h3 style="color:#20433e; margin-top:24px;">Wat is er nieuw</h3>
    <ul style="font-size:14px; line-height:1.6;">${items}</ul>

    <h3 style="color:#20433e; margin-top:24px;">Updaten</h3>
    <p>Sluit Revit af en download de nieuwe versie via de downloadpagina. Je bestaande activatiecode blijft geldig.</p>
    <p style="text-align:center; margin:18px 0;"><a href="${DOWNLOAD_URL}" style="display:inline-block; background:#20433e; color:white; padding:14px 28px; border-radius:6px; text-decoration:none; font-weight:600;">Ga naar download pagina</a></p>

    <div style="background:#E8F0EE; border-left:3px solid #20433e; border-radius:4px; padding:16px; margin:24px 0;">
      <p style="margin:0 0 6px; color:#20433e; font-weight:600;">📎 Scheidingsschot-familie</p>
      <p style="margin:0; font-size:14px; color:#3C3C43;">In de bijlage zit de nieuwe <strong>Cable Tray_scheidingsschot_LYNK</strong> familie. Laad 'm in je project of template om scheidingsschotten te kunnen plaatsen via de Fill Rate-tool (stap 5b).</p>
    </div>

    <p style="font-size:13px; color:#8E8E93;">Bestaande projecten met de oude <code>NLRS_E_</code>-parameters worden bij de eerste klik automatisch en zonder dataverlies omgezet naar <code>LYNK_E_</code>.</p>

    <p style="margin-top:24px;">Vragen of feedback? Reply op deze e-mail of gebruik het <a href="https://www.bimlynk.com/portal" style="color:#20433e;">Beta Portaal</a>. De tester met de meest waardevolle feedback wint een lifetime license voor LYNK Electrical.</p>
    <p>— BIM LYNK Team</p>
  </div>
  <div style="background:#F2F2F7; padding:16px; text-align:center; font-size:12px; color:#8E8E93;">
    © 2026 BIM LYNK · <a href="https://www.bimlynk.com" style="color:#20433e;">www.bimlynk.com</a>
  </div>
</body></html>`;
}

async function fetchFamilies() {
  const out = [];
  for (const fname of FAMILY_FILES) {
    try {
      const url = 'https://www.bimlynk.com/downloads/fillrate-light/families/' + encodeURIComponent(fname);
      const res = await fetch(url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        out.push({ name: fname, b64: buf.toString('base64') });
      }
    } catch {}
  }
  return out;
}

async function sendUpdateMail(graphToken, to, firstName, version, changelogLines, families) {
  const sender = process.env.SENDER_EMAIL;
  const graphBase = `https://graph.microsoft.com/v1.0/users/${sender}`;
  const html = buildHtml(firstName, version, changelogLines);

  const draftRes = await fetch(`${graphBase}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${graphToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: `Fill Rate Light NL — update v${version} beschikbaar`,
      body: { contentType: 'HTML', content: html },
      toRecipients: [{ emailAddress: { address: to } }]
    })
  });
  if (!draftRes.ok) throw new Error(`Draft failed: ${draftRes.status}`);
  const draft = await draftRes.json();

  for (const fam of families) {
    await fetch(`${graphBase}/messages/${draft.id}/attachments`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${graphToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: fam.name, contentType: 'application/octet-stream', contentBytes: fam.b64
      })
    });
  }

  const sendRes = await fetch(`${graphBase}/messages/${draft.id}/send`, {
    method: 'POST', headers: { 'Authorization': `Bearer ${graphToken}` }
  });
  if (sendRes.status !== 202) throw new Error(`Send failed: ${sendRes.status}`);
}

exports.handler = async (event) => {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  // Admin auth via portal session
  const token = (event.headers.authorization || '').replace('Bearer ', '');
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Niet ingelogd.' }) };
  const sessions = (await getData('PORTAL_SESSIONS')) || {};
  const session = sessions[token];
  if (!session || session.role !== 'admin')
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Alleen admin.' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}

  // Version + changelog: from body, else from the site's fillrate-version.json
  let version = body.version;
  let changelogLines = Array.isArray(body.changelog) ? body.changelog : null;
  if (!version || !changelogLines) {
    try {
      const vRes = await fetch('https://www.bimlynk.com/fillrate-version.json');
      if (vRes.ok) {
        const vj = await vRes.json();
        version = version || vj.version;
        if (!changelogLines && vj.changelog) {
          // split on " — " bullet markers, fall back to single line
          const parts = String(vj.changelog).split(/—|,/).map(s => s.trim()).filter(Boolean);
          changelogLines = parts.length > 1 ? parts.slice(1) : [vj.changelog];
        }
      }
    } catch {}
  }
  version = version || '1.1';

  const signups = (await getData('BETA_SIGNUPS')) || [];
  if (signups.length === 0)
    return { statusCode: 200, headers, body: JSON.stringify({ sent: 0, total: 0, message: 'Geen testers.' }) };

  let graphToken;
  try { graphToken = await getAccessToken(); }
  catch (e) { return { statusCode: 500, headers, body: JSON.stringify({ error: 'Token: ' + e.message }) }; }

  const families = await fetchFamilies();

  let sent = 0;
  const errors = [];
  for (const s of signups) {
    if (!s.email) continue;
    try {
      await sendUpdateMail(graphToken, s.email, s.firstName, version, changelogLines, families);
      sent++;
    } catch (e) {
      errors.push(`${s.email}: ${e.message}`);
    }
  }

  return {
    statusCode: 200, headers,
    body: JSON.stringify({ sent, total: signups.length, version, familiesAttached: families.length, errors })
  };
};
