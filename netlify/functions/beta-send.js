// Beta Send — auto-sends Fill Rate Light NL beta codes to testers.
// Called by:
//   1. beta-scheduler (cron) at 8:15 on April 14 for all existing signups
//   2. beta-signup.js immediately for new signups after 8:15 April 14

const ACCOUNT_SLUG = 'LorenzoRCU';
const INFO_ADDRESS = 'info@bimlynk.com';
const DOWNLOAD_URL = 'https://www.bimlynk.com/fillrate-download.html';

// Beta codes pool — same as BetaLicense.cs (excluding TEST code)
const BETA_CODES = [
  "FRLB-2A3B-4C5D", "FRLB-6E7F-8G9H", "FRLB-AJ2K-BL3M",
  "FRLB-CN4P-DQ5R", "FRLB-ES6T-FU7V", "FRLB-GW8X-HY9Z",
  "FRLB-JA2B-KC3D", "FRLB-LE4F-MG5H", "FRLB-NJ6K-PL7M",
  "FRLB-QN8P-RQ9R", "FRLB-ST2U-TV3W", "FRLB-UX4Y-VZ5A",
  "FRLB-WB6C-XD7E", "FRLB-YF8G-ZH9J", "FRLB-AK2L-BM3N",
  "FRLB-CP4Q-DR5S", "FRLB-ET6U-FV7W", "FRLB-GX8Y-HZ9A",
  "FRLB-JB2C-KD3E", "FRLB-LF4G-MH5J", "FRLB-NK6L-PM7N",
  "FRLB-QP8R-RS9T", "FRLB-TU2V-UW3X", "FRLB-VY4Z-WA5B",
  "FRLB-XC6D-YE7F", "FRLB-ZG8H-AJ9K", "FRLB-BL2M-CN3P",
  "FRLB-DQ4R-ES5T", "FRLB-FU6V-GW7X", "FRLB-HY8Z-JA9B",
  "FRLB-KC2D-LE3F", "FRLB-MG4H-NJ5K", "FRLB-PL6M-QN7P",
  "FRLB-RQ8R-ST9U", "FRLB-TV2W-UX3Y", "FRLB-VZ4A-WB5C",
  "FRLB-XD6E-YF7G", "FRLB-ZH8J-AK9L", "FRLB-BM2N-CP3Q",
  "FRLB-DR4S-ET5U", "FRLB-FV6W-GX7Y", "FRLB-HZ8A-JB9C",
  "FRLB-KD2E-LF3G", "FRLB-MH4J-NK5L", "FRLB-PM6N-QP7R",
  "FRLB-RS8T-TU9V", "FRLB-UW2X-VY3Z", "FRLB-WA4B-XC5D",
  "FRLB-YE6F-ZG7H"
];

const DEFAULT_MANUALS = require('./default_manuals_data');
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

function markdownToHtml(md) {
  if (!md) return '';
  let html = '';
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    if (/^###\s+/.test(line)) html += `<h4 style="color:#20433e;margin:12px 0 4px;font-size:14px;">${escapeHtml(line.replace(/^###\s+/, ''))}</h4>`;
    else if (/^##\s+/.test(line)) html += `<h3 style="color:#20433e;margin:16px 0 6px;font-size:15px;">${escapeHtml(line.replace(/^##\s+/, ''))}</h3>`;
    else if (/^#\s+/.test(line)) html += `<h2 style="color:#20433e;margin:20px 0 8px;font-size:17px;">${escapeHtml(line.replace(/^#\s+/, ''))}</h2>`;
    else if (/^(\*|-)\s+/.test(line)) html += `<li style="font-size:13px;line-height:1.5;">${escapeHtml(line.replace(/^(\*|-)\s+/, ''))}</li>`;
    else if (/^\d+\.\s+/.test(line)) html += `<li style="font-size:13px;line-height:1.5;">${escapeHtml(line.replace(/^\d+\.\s+/, ''))}</li>`;
    else if (line === '') html += '<br>';
    else html += `<p style="margin:4px 0;font-size:13px;line-height:1.5;">${escapeHtml(line)}</p>`;
  }
  return html;
}

// Allocate a unique beta code for a signup
async function allocateBetaCode(signupId, email) {
  const assigned = await getEnv('BETA_ASSIGNED_CODES') || {};
  // Check if already assigned
  for (const [code, info] of Object.entries(assigned)) {
    if (info.signupId === signupId) return code;
  }
  const usedSet = new Set(Object.keys(assigned));
  const next = BETA_CODES.find(c => !usedSet.has(c));
  if (!next) throw new Error('Geen beta codes meer beschikbaar');
  assigned[next] = { signupId, email, assignedAt: new Date().toISOString() };
  await setEnv('BETA_ASSIGNED_CODES', assigned);
  return next;
}

// Send beta mail to one tester
async function sendBetaMail(graphToken, signup, code) {
  const sender = process.env.SENDER_EMAIL;
  const manual = DEFAULT_MANUALS['fill_rate'] || {};
  const manualHtml = markdownToHtml(manual.content || '');

  // Fetch families for attachment
  const FAMILY_FILES = [
    'NLRS_61_TAG_CT_UN_afm-peilm ok-4vakken ss_CVZ_gen_LYNK.rfa',
    'Cable Tray_scheidingsschot_LYNK.rfa'
  ];
  const familyAttachments = [];
  for (const fname of FAMILY_FILES) {
    try {
      const url = 'https://www.bimlynk.com/downloads/fillrate-light/families/' + encodeURIComponent(fname);
      const famRes = await fetch(url);
      if (famRes.ok) {
        const buf = Buffer.from(await famRes.arrayBuffer());
        familyAttachments.push({ name: fname, b64: buf.toString('base64'), size: buf.length });
      }
    } catch {}
  }

  // Generate PDF manual
  let pdfAttachment = null;
  try {
    const { jsPDF } = require('jspdf');
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 20;
    const teal = [32, 67, 62];
    doc.setFillColor(teal[0], teal[1], teal[2]);
    doc.rect(0, 0, pageW, 30, 'F');
    doc.setTextColor(255, 255, 255); doc.setFontSize(18); doc.setFont('helvetica', 'bold');
    doc.text('BIM LYNK', margin, 18);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text('Fill Rate Light NL', margin, 25);
    let y = 50;
    doc.setTextColor(teal[0], teal[1], teal[2]); doc.setFontSize(20); doc.setFont('helvetica', 'bold');
    doc.text(manual.title || 'Fill Rate Light NL Handleiding', margin, y); y += 10;
    doc.setFontSize(10); doc.setTextColor(142, 142, 147); doc.setFont('helvetica', 'normal');
    doc.text('v1.0', margin, y); y += 12;
    doc.setDrawColor(teal[0], teal[1], teal[2]); doc.setLineWidth(0.5);
    doc.line(margin, y, pageW - margin, y); y += 8;
    doc.setTextColor(28, 28, 30);
    for (const rawLine of (manual.content || '').split('\n')) {
      if (y > pageH - 20) { doc.addPage(); y = 20; }
      const line = rawLine.trimEnd();
      if (line.startsWith('## ')) { doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(teal[0], teal[1], teal[2]); doc.text(line.substring(3), margin, y); y += 7; doc.setTextColor(28, 28, 30); }
      else if (line.startsWith('### ')) { doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(line.substring(4), margin, y); y += 6; }
      else if (line.startsWith('- ')) { doc.setFont('helvetica', 'normal'); doc.setFontSize(10); const w = doc.splitTextToSize('• ' + line.substring(2), pageW - 2 * margin - 5); doc.text(w, margin + 5, y); y += w.length * 5; }
      else if (line === '') { y += 3; }
      else { doc.setFont('helvetica', 'normal'); doc.setFontSize(10); const w = doc.splitTextToSize(line, pageW - 2 * margin); doc.text(w, margin, y); y += w.length * 5; }
    }
    const buf = Buffer.from(doc.output('arraybuffer'));
    pdfAttachment = { name: 'Fill_Rate_Light_NL_Handleiding_v1.0.pdf', b64: buf.toString('base64'), size: buf.length };
  } catch {}

  const html = `<!DOCTYPE html>
<html><body style="font-family: Inter, Arial, sans-serif; color: #1C1C1E; max-width: 640px; margin: 0 auto;">
  <div style="background: #20433e; color: white; padding: 24px; text-align: center;">
    <h1 style="margin: 0; font-size: 22px;">BIM LYNK</h1>
    <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.85;">Fill Rate Light NL — Beta v1.0</p>
  </div>
  <div style="padding: 32px 24px;">
    <p>Hi ${escapeHtml(signup.firstName)},</p>
    <p>Bedankt voor je aanmelding als beta tester voor <strong>Fill Rate Light NL</strong>! Je beta-toegang staat klaar.</p>

    <h3 style="color: #20433e; margin-top: 24px;">Jouw beta-code</h3>
    <div style="background: #F2F2F7; padding: 16px; border-radius: 8px; font-family: Consolas, monospace; font-size: 16px; font-weight: bold; text-align: center; letter-spacing: 1px;">
      ${escapeHtml(code)}
    </div>
    <p style="font-size: 13px; color: #8E8E93;">Deze code is geldig tot 14 juli 2026 en werkt op één computer.</p>

    <h3 style="color: #20433e; margin-top: 24px;">Installatie</h3>
    <p>Download de installer via onze website:</p>
    <p style="text-align:center;margin:18px 0;"><a href="${DOWNLOAD_URL}" style="display:inline-block; background:#20433e; color:white; padding:14px 28px; border-radius:6px; text-decoration:none; font-weight:600;">Ga naar download pagina</a></p>
    <p style="font-size:12px;color:#8E8E93;">Op de downloadpagina vind je de installer, installatie-instructies en tips als je browser een waarschuwing geeft.</p>

    <h3 style="color: #20433e; margin-top: 28px;">Handleiding</h3>
    <p style="font-size:13px;color:#8E8E93;">Hieronder de volledige handleiding. Een PDF versie zit als bijlage.</p>
    <div style="border:1px solid #E5E5EA;border-radius:8px;padding:18px;margin:14px 0;background:#FAFAFA;">
      ${manualHtml}
    </div>

    <p style="font-size: 14px; margin-top: 20px;">In de bijlage vind je ook de Revit families (.rfa) die bij de tool horen: de tag-family en de scheidingsschot-family voor het plaatsen van compartiment-schotten.</p>

    <p style="margin-top: 24px;">Vragen of feedback? Reply op deze e-mail of gebruik het <a href="https://www.bimlynk.com/portal.html" style="color: #20433e;">Beta Portaal</a>.</p>
    <p>Veel succes met testen!</p>
    <p>— BIM LYNK Team</p>
  </div>
  <div style="background: #F2F2F7; padding: 16px; text-align: center; font-size: 12px; color: #8E8E93;">
    Beta periode: 14 april – 14 juli 2026<br>
    © BIM LYNK - onderdeel van CVL Solutions · <a href="https://www.bimlynk.com" style="color: #20433e;">www.bimlynk.com</a>
  </div>
</body></html>`;

  // Create draft + attachments + send (draft path for large attachments)
  const graphBase = `https://graph.microsoft.com/v1.0/users/${sender}`;
  const draftRes = await fetch(`${graphBase}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${graphToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject: `Fill Rate Light NL — Je beta-code staat klaar`,
      body: { contentType: 'HTML', content: html },
      toRecipients: [{ emailAddress: { address: signup.email } }],
      ccRecipients: [{ emailAddress: { address: INFO_ADDRESS } }]
    })
  });
  if (!draftRes.ok) throw new Error(`Draft failed: ${draftRes.status}`);
  const draft = await draftRes.json();

  // Attach PDF
  if (pdfAttachment) {
    await fetch(`${graphBase}/messages/${draft.id}/attachments`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${graphToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: pdfAttachment.name, contentType: 'application/pdf', contentBytes: pdfAttachment.b64
      })
    });
  }

  // Attach families
  for (const fam of familyAttachments) {
    await fetch(`${graphBase}/messages/${draft.id}/attachments`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${graphToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: fam.name, contentType: 'application/octet-stream', contentBytes: fam.b64
      })
    });
  }

  // Send
  const sendRes = await fetch(`${graphBase}/messages/${draft.id}/send`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${graphToken}` }
  });
  if (sendRes.status !== 202) throw new Error(`Send failed: ${sendRes.status}`);
}

// Main: process all pending beta signups
async function processAllPending() {
  const signups = await getEnv('BETA_SIGNUPS') || [];
  const graphToken = await getAccessToken();
  let sent = 0;
  const errors = [];

  for (const signup of signups) {
    if (signup.betaSent) continue; // already sent
    try {
      const code = await allocateBetaCode(signup.code || signup.email, signup.email);
      await sendBetaMail(graphToken, signup, code);
      signup.betaSent = true;
      signup.betaSentAt = new Date().toISOString();
      signup.betaCode = code;
      sent++;
    } catch (e) {
      errors.push(`${signup.email}: ${e.message}`);
    }
  }

  if (sent > 0) await setEnv('BETA_SIGNUPS', signups);
  return { sent, errors, total: signups.length };
}

// Send to a single new signup (called from beta-signup.js)
async function sendToOne(signup) {
  const graphToken = await getAccessToken();
  const code = await allocateBetaCode(signup.code || signup.email, signup.email);
  await sendBetaMail(graphToken, signup, code);
  return code;
}

module.exports = { processAllPending, sendToOne };

// Also works as HTTP handler (for manual trigger from portal)
exports.handler = async (event) => {
  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  try {
    const result = await processAllPending();
    return { statusCode: 200, headers, body: JSON.stringify(result) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: e.message }) };
  }
};
