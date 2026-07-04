// Admin-triggered: notify ALL beta testers that a new version is available,
// with the changelog and the scheidingsschot family attached.
// POST with admin Bearer token. Body (optional): { version, changelog, feedbackMessage, scheduledFor }.
// Falls back to fillrate-version.json on the site for version/changelog.
// If scheduledFor (ISO string) is given, the send is queued instead of sent
// immediately — beta-scheduler.js picks it up when due.

const { getData, setData } = require('./_storage');

const FAMILY_FILES = [
  'Cable Tray_scheidingsschot_LYNK.rfa'
];
const DOWNLOAD_URL = 'https://www.bimlynk.com/fillrate-download.html';
const SCHEDULED_JOB_KEY = 'BETA_UPDATE_SCHEDULED_JOB';

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

function buildHtml(firstName, version, changelogLines, feedbackMessage) {
  const items = (changelogLines && changelogLines.length)
    ? changelogLines.map(l => `<li style="margin:4px 0;">${escapeHtml(l)}</li>`).join('')
    : '<li>Diverse verbeteringen en bugfixes.</li>';

  const feedbackBlock = feedbackMessage ? `
    <div style="background:#FFF8E1; border-left:3px solid #F5A623; border-radius:4px; padding:16px; margin:24px 0;">
      <p style="margin:0 0 6px; color:#8a5b00; font-weight:600;">💬 Laatste feedback gevraagd</p>
      <p style="margin:0; font-size:14px; color:#3C3C43; white-space:pre-line;">${escapeHtml(feedbackMessage)}</p>
    </div>` : '';

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
${feedbackBlock}
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

async function sendUpdateMail(graphToken, to, firstName, version, changelogLines, feedbackMessage, families) {
  const sender = process.env.SENDER_EMAIL;
  const graphBase = `https://graph.microsoft.com/v1.0/users/${sender}`;
  const html = buildHtml(firstName, version, changelogLines, feedbackMessage);

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

// Resolves version/changelog from explicit args, else from the site's fillrate-version.json.
async function resolveVersionAndChangelog(version, changelogLines) {
  if (!version || !changelogLines) {
    try {
      const vRes = await fetch('https://www.bimlynk.com/fillrate-version.json');
      if (vRes.ok) {
        const vj = await vRes.json();
        version = version || vj.version;
        if (!changelogLines && vj.changelog) {
          const parts = String(vj.changelog).split(/—|,/).map(s => s.trim()).filter(Boolean);
          changelogLines = parts.length > 1 ? parts.slice(1) : [vj.changelog];
        }
      }
    } catch {}
  }
  return { version: version || '1.1', changelogLines };
}

// Sends the update mail to every beta signup. Used for both immediate
// (HTTP-triggered) and scheduled (cron-triggered) sends.
async function sendToAllTesters({ version, changelogLines, feedbackMessage }) {
  const resolved = await resolveVersionAndChangelog(version, changelogLines);
  version = resolved.version;
  changelogLines = resolved.changelogLines;

  const signups = (await getData('BETA_SIGNUPS')) || [];
  if (signups.length === 0) return { sent: 0, total: 0, version, familiesAttached: 0, errors: [] };

  const graphToken = await getAccessToken();
  const families = await fetchFamilies();

  let sent = 0;
  const errors = [];
  for (const s of signups) {
    if (!s.email) continue;
    try {
      await sendUpdateMail(graphToken, s.email, s.firstName, version, changelogLines, feedbackMessage, families);
      sent++;
    } catch (e) {
      errors.push(`${s.email}: ${e.message}`);
    }
  }

  return { sent, total: signups.length, version, familiesAttached: families.length, errors };
}

// Called by beta-scheduler.js on its 5-minute cron. Processes the single
// pending scheduled job, if any, once its scheduledFor time has passed.
async function processScheduledJob() {
  const job = await getData(SCHEDULED_JOB_KEY);
  if (!job || job.status !== 'pending') return null;
  if (new Date(job.scheduledFor).getTime() > Date.now()) return null;

  try {
    const result = await sendToAllTesters({
      version: job.version,
      changelogLines: job.changelogLines,
      feedbackMessage: job.feedbackMessage
    });
    await setData(SCHEDULED_JOB_KEY, { ...job, status: 'sent', sentAt: new Date().toISOString(), result });
    return result;
  } catch (e) {
    await setData(SCHEDULED_JOB_KEY, { ...job, status: 'failed', failedAt: new Date().toISOString(), error: e.message });
    throw e;
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

  // Admin auth via portal session
  const token = (event.headers.authorization || '').replace('Bearer ', '');
  if (!token) return { statusCode: 401, headers, body: JSON.stringify({ error: 'Niet ingelogd.' }) };
  const sessions = (await getData('PORTAL_SESSIONS')) || {};
  const session = sessions[token];
  if (!session || session.role !== 'admin')
    return { statusCode: 403, headers, body: JSON.stringify({ error: 'Alleen admin.' }) };

  // GET — check status of the current scheduled job (if any)
  if (event.httpMethod === 'GET') {
    const job = await getData(SCHEDULED_JOB_KEY);
    return { statusCode: 200, headers, body: JSON.stringify({ job }) };
  }

  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch {}

  const changelogLines = Array.isArray(body.changelog) ? body.changelog : null;
  const feedbackMessage = body.feedbackMessage || null;

  // Scheduled path — store the job, beta-scheduler.js sends it when due.
  if (body.scheduledFor) {
    const when = new Date(body.scheduledFor);
    if (isNaN(when.getTime()))
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldige scheduledFor datum/tijd' }) };

    const resolved = await resolveVersionAndChangelog(body.version, changelogLines);
    const job = {
      version: resolved.version,
      changelogLines: resolved.changelogLines,
      feedbackMessage,
      scheduledFor: when.toISOString(),
      createdAt: new Date().toISOString(),
      createdBy: session.email || 'admin',
      status: 'pending'
    };
    await setData(SCHEDULED_JOB_KEY, job);
    return { statusCode: 200, headers, body: JSON.stringify({ success: true, scheduled: true, job }) };
  }

  // Immediate send path
  try {
    const result = await sendToAllTesters({ version: body.version, changelogLines, feedbackMessage });
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};

exports.processScheduledJob = processScheduledJob;
