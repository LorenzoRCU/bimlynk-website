// Shared library for demo sending — used by both demo-send.js (interactive)
// and demo-scheduler.js (cron). Underscore prefix prevents Netlify from
// deploying this as a standalone function.

const DEMO_VERSIONS = require('./demo_versions');
const DEMO_CODES = require('./demo_codes');
const DEFAULT_MANUALS = require('./default_manuals_data');
const { jsPDF } = require('jspdf');
const { getData, setData, isBlobKey } = require('./_storage');

const ACCOUNT_SLUG = 'LorenzoRCU';
const SITE_BASE_URL = 'https://www.bimlynk.com';
const TEST_CODE = 'DEMO-TEST-TEST-TEST';
const INFO_ADDRESS = 'info@bimlynk.com';

// ============================================================
// Storage helpers
// ============================================================
// Large/mutable data lives in Netlify Blobs. Small config-style values
// (MANUAL_<tool>) still come from Netlify env vars.

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
    if (data.values && data.values[0]) {
      try { return JSON.parse(data.values[0].value); }
      catch { return data.values[0].value; }
    }
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

// ============================================================
// Demo code allocation (uniqueness guaranteed)
// ============================================================

async function allocateCode(signupId, email) {
  const assigned = await getEnv('DEMO_ASSIGNED_CODES') || {};
  for (const [code, info] of Object.entries(assigned)) {
    if (info.signupId === signupId) return code;
  }
  const usedSet = new Set(Object.keys(assigned));
  const next = DEMO_CODES.find(c => !usedSet.has(c));
  if (!next) throw new Error('Geen demo codes meer beschikbaar (alle 500 zijn vergeven).');
  assigned[next] = { signupId, email, assignedAt: new Date().toISOString() };
  await setEnv('DEMO_ASSIGNED_CODES', assigned);
  // Read-after-write race protection
  const verify = await getEnv('DEMO_ASSIGNED_CODES') || {};
  if (verify[next] && verify[next].signupId !== signupId) {
    return allocateCode(signupId, email);
  }
  return next;
}

async function reserveExplicitCode(signupId, email, code) {
  if (!DEMO_CODES.includes(code)) {
    throw new Error(`Code ${code} bestaat niet in de demo code pool.`);
  }
  const assigned = await getEnv('DEMO_ASSIGNED_CODES') || {};
  const existing = assigned[code];
  if (existing) {
    if (existing.signupId === signupId) return code;
    throw new Error(`Code ${code} is al toegewezen aan een andere aanvraag.`);
  }
  assigned[code] = { signupId, email, assignedAt: new Date().toISOString() };
  await setEnv('DEMO_ASSIGNED_CODES', assigned);
  return code;
}

// ============================================================
// Manual loading (env var + default fallback)
// ============================================================

async function loadManual(toolId) {
  const stored = await getEnv(`MANUAL_${toolId.toUpperCase()}`);
  if (stored) return stored;
  return DEFAULT_MANUALS[toolId] || null;
}

// ============================================================
// File fetching
// ============================================================

async function fetchAsAttachment(url, filename) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Kon ${filename} niet ophalen (${res.status}) van ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ext = (filename.split('.').pop() || '').toLowerCase();
  let contentType = 'application/octet-stream';
  if (ext === 'exe') contentType = 'application/vnd.microsoft.portable-executable';
  else if (ext === 'pdf') contentType = 'application/pdf';
  return { name: filename, contentType, contentBase64: buf.toString('base64'), sizeBytes: buf.length };
}

// ============================================================
// Microsoft Graph
// ============================================================

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

async function sendMailViaDraft({ token, to, cc, subject, htmlBody, attachments }) {
  const sender = process.env.SENDER_EMAIL;
  const graphBase = `https://graph.microsoft.com/v1.0/users/${sender}`;

  const draftPayload = {
    subject,
    body: { contentType: 'HTML', content: htmlBody },
    toRecipients: [{ emailAddress: { address: to } }]
  };
  if (cc && cc.length) {
    draftPayload.ccRecipients = cc.map(addr => ({ emailAddress: { address: addr } }));
  }

  const draftRes = await fetch(`${graphBase}/messages`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(draftPayload)
  });
  if (!draftRes.ok) throw new Error(`Draft create failed: ${draftRes.status} ${await draftRes.text()}`);
  const draft = await draftRes.json();
  const messageId = draft.id;

  for (const att of (attachments || [])) {
    const rawBytes = att.sizeBytes != null ? att.sizeBytes : Math.floor((att.contentBase64.length * 3) / 4);
    if (rawBytes < 3 * 1024 * 1024) {
      const r = await fetch(`${graphBase}/messages/${messageId}/attachments`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: att.name,
          contentType: att.contentType || 'application/octet-stream',
          contentBytes: att.contentBase64
        })
      });
      if (!r.ok) throw new Error(`Attach ${att.name} failed: ${r.status} ${await r.text()}`);
    } else {
      const sessionRes = await fetch(`${graphBase}/messages/${messageId}/attachments/createUploadSession`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          AttachmentItem: {
            attachmentType: 'file',
            name: att.name,
            size: rawBytes,
            contentType: att.contentType || 'application/octet-stream'
          }
        })
      });
      if (!sessionRes.ok) throw new Error(`Upload session failed for ${att.name}: ${sessionRes.status} ${await sessionRes.text()}`);
      const session = await sessionRes.json();
      const uploadUrl = session.uploadUrl;
      const buf = Buffer.from(att.contentBase64, 'base64');
      const chunkSize = 3 * 1024 * 1024;
      for (let offset = 0; offset < buf.length; offset += chunkSize) {
        const end = Math.min(offset + chunkSize, buf.length);
        const chunk = buf.subarray(offset, end);
        const range = `bytes ${offset}-${end - 1}/${buf.length}`;
        const putRes = await fetch(uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Length': String(chunk.length), 'Content-Range': range },
          body: chunk
        });
        if (![200, 201, 202].includes(putRes.status)) {
          throw new Error(`Chunk upload failed for ${att.name} at ${range}: ${putRes.status} ${await putRes.text()}`);
        }
      }
    }
  }

  const sendRes = await fetch(`${graphBase}/messages/${messageId}/send`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (sendRes.status !== 202) throw new Error(`Send failed: ${sendRes.status} ${await sendRes.text()}`);
}

// ============================================================
// Markdown → simple HTML (matches the manual content shape we author)
// ============================================================

function escapeHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function markdownToHtml(md) {
  if (!md) return '';
  const lines = md.split('\n');
  let html = '';
  let inList = false;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^###\s+/.test(line)) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h4 style="color:#20433e;margin:14px 0 4px;font-size:14px;">${escapeHtml(line.replace(/^###\s+/, ''))}</h4>`;
    } else if (/^##\s+/.test(line)) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h3 style="color:#20433e;margin:18px 0 6px;font-size:15px;">${escapeHtml(line.replace(/^##\s+/, ''))}</h3>`;
    } else if (/^#\s+/.test(line)) {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<h2 style="color:#20433e;margin:22px 0 8px;font-size:17px;">${escapeHtml(line.replace(/^#\s+/, ''))}</h2>`;
    } else if (/^(\*|-)\s+/.test(line)) {
      if (!inList) { html += '<ul style="margin:6px 0 6px 18px;padding:0;font-size:13px;line-height:1.55;">'; inList = true; }
      html += `<li>${escapeHtml(line.replace(/^(\*|-)\s+/, ''))}</li>`;
    } else if (/^\d+\.\s+/.test(line)) {
      if (!inList) { html += '<ol style="margin:6px 0 6px 18px;padding:0;font-size:13px;line-height:1.55;">'; inList = true; }
      html += `<li>${escapeHtml(line.replace(/^\d+\.\s+/, ''))}</li>`;
    } else if (line === '') {
      if (inList) { html += '</ul>'; inList = false; }
    } else {
      if (inList) { html += '</ul>'; inList = false; }
      html += `<p style="margin:4px 0;font-size:13px;line-height:1.55;">${escapeHtml(line)}</p>`;
    }
  }
  if (inList) html += '</ul>';
  return html;
}

// ============================================================
// PDF generation (same BIMLYNK style as portal jsPDF render)
// ============================================================

function renderManualPdf(title, version, content) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 20;
  const teal = [32, 67, 62];
  const grayMid = [142, 142, 147];

  function addFooter() {
    doc.setDrawColor(teal[0], teal[1], teal[2]);
    doc.setLineWidth(0.3);
    doc.line(margin, pageH - 18, pageW - margin, pageH - 18);
    doc.setFontSize(8);
    doc.setTextColor(142, 142, 147);
    doc.setFont('helvetica', 'normal');
    doc.text('© BIM LYNK - part of CVL SOLUTIONS', margin, pageH - 12);
    doc.text('www.bimlynk.com', pageW - margin, pageH - 12, { align: 'right' });
    const pageNum = doc.internal.getCurrentPageInfo().pageNumber;
    doc.text('Pagina ' + pageNum, pageW / 2, pageH - 12, { align: 'center' });
  }

  // Header bar
  doc.setFillColor(teal[0], teal[1], teal[2]);
  doc.rect(0, 0, pageW, 30, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text('BIM LYNK', margin, 18);
  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.text('LYNK Electrical', margin, 25);
  doc.setFontSize(9);
  doc.text('part of CVL SOLUTIONS', pageW - margin, 25, { align: 'right' });

  // Title block
  let y = 50;
  doc.setTextColor(teal[0], teal[1], teal[2]);
  doc.setFontSize(22);
  doc.setFont('helvetica', 'bold');
  doc.text(title, margin, y);
  y += 8;
  doc.setFontSize(11);
  doc.setTextColor(grayMid[0], grayMid[1], grayMid[2]);
  doc.setFont('helvetica', 'normal');
  doc.text(version + '  •  ' + new Date().toLocaleDateString('nl-NL'), margin, y);
  y += 12;

  // Divider
  doc.setDrawColor(teal[0], teal[1], teal[2]);
  doc.setLineWidth(0.5);
  doc.line(margin, y, pageW - margin, y);
  y += 10;

  // Body — markdown rendering
  const lines = (content || '').split('\n');
  doc.setTextColor(28, 28, 30);

  for (const rawLine of lines) {
    if (y > pageH - 25) {
      addFooter();
      doc.addPage();
      y = margin;
    }
    const line = rawLine.trimEnd();
    if (line.startsWith('# ')) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
      doc.setTextColor(teal[0], teal[1], teal[2]);
      doc.text(line.substring(2), margin, y); y += 9;
      doc.setTextColor(28, 28, 30);
    } else if (line.startsWith('## ')) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
      doc.setTextColor(teal[0], teal[1], teal[2]);
      doc.text(line.substring(3), margin, y); y += 7;
      doc.setTextColor(28, 28, 30);
    } else if (line.startsWith('### ')) {
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
      doc.text(line.substring(4), margin, y); y += 6;
    } else if (line.startsWith('- ') || line.startsWith('* ')) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      const wrapped = doc.splitTextToSize('• ' + line.substring(2), pageW - 2 * margin - 5);
      doc.text(wrapped, margin + 5, y); y += wrapped.length * 5;
    } else if (/^\d+\.\s/.test(line)) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      const wrapped = doc.splitTextToSize(line, pageW - 2 * margin - 5);
      doc.text(wrapped, margin + 5, y); y += wrapped.length * 5;
    } else if (line === '') {
      y += 4;
    } else {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
      const wrapped = doc.splitTextToSize(line, pageW - 2 * margin);
      doc.text(wrapped, margin, y); y += wrapped.length * 5;
    }
  }
  addFooter();

  // Get raw bytes → base64
  const arrBuf = doc.output('arraybuffer');
  const buf = Buffer.from(arrBuf);
  return { contentBase64: buf.toString('base64'), sizeBytes: buf.length };
}

// ============================================================
// Email body — full package, all manuals embedded inline
// ============================================================

const TOOL_NAMES = {
  cable_tray_support: 'Cable Tray Support',
  cable_tray_clearance: 'Cable Tray Clearance',
  conduit_id: 'Conduit ID Generator',
  cable_tray_id: 'Cable Tray ID Generator',
  fill_rate: 'Fill Rate Tool'
};

async function buildEmailBody({ firstName, code, installerLink, manifest, extraMessage }) {
  const versionLabel = manifest.label;
  const isTest = code === TEST_CODE;

  // Render manual sections inline
  let manualsHtml = '';
  for (const toolId of (manifest.manuals || [])) {
    const manual = await loadManual(toolId);
    if (!manual || !manual.content) continue;
    manualsHtml += `
      <div style="border:1px solid #E5E5EA;border-radius:8px;padding:18px;margin:14px 0;background:#FAFAFA;">
        <div style="display:flex;justify-content:space-between;align-items:baseline;border-bottom:2px solid #20433e;padding-bottom:6px;margin-bottom:8px;">
          <strong style="color:#20433e;font-size:15px;">${escapeHtml(manual.title || TOOL_NAMES[toolId] || toolId)}</strong>
          <span style="font-size:11px;color:#8E8E93;">${escapeHtml(manual.version || 'v1.0')}</span>
        </div>
        ${markdownToHtml(manual.content)}
      </div>`;
  }

  return `<!DOCTYPE html>
<html><body style="font-family: Inter, Arial, sans-serif; color: #1C1C1E; max-width: 640px; margin: 0 auto;">
  <div style="background: #20433e; color: white; padding: 24px; text-align: center;">
    <h1 style="margin: 0; font-size: 22px;">BIM LYNK</h1>
    <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.85;">${escapeHtml(versionLabel)}</p>
  </div>
  <div style="padding: 32px 24px;">
    <p>Hi ${escapeHtml(firstName) || 'daar'},</p>
    <p>Bedankt voor je interesse in <strong>${escapeHtml(versionLabel)}</strong>! Je 14-dagen demo staat klaar — alles wat je nodig hebt zit in deze mail.</p>

    <h3 style="color: #20433e; margin-top: 24px;">Jouw activatiecode</h3>
    <div style="background: #F2F2F7; padding: 16px; border-radius: 8px; font-family: Consolas, monospace; font-size: 16px; font-weight: bold; text-align: center; letter-spacing: 1px;">
      ${escapeHtml(code)}
    </div>
    <p style="font-size: 13px; color: #8E8E93;">${isTest
      ? 'TEST code — verloopt na 15 minuten, alleen voor verificatie.'
      : 'Deze code kun je één keer gebruiken op één computer. Vanaf de eerste activatie heb je 14 dagen toegang.'}</p>

    <h3 style="color: #20433e; margin-top: 24px;">Installatie</h3>
    <p>Download de installer via onze website. Daar vind je ook installatie-instructies en tips als je browser een waarschuwing geeft.</p>
    <p style="text-align:center;margin:18px 0;"><a href="${installerLink}" style="display:inline-block; background:#20433e; color:white; padding:14px 28px; border-radius:6px; text-decoration:none; font-weight:600;">Ga naar download pagina</a></p>
    <p style="font-size:12px;color:#8E8E93;">De .exe wordt niet als bijlage meegestuurd omdat mailservers .exe bestanden standaard blokkeren. De link hierboven is direct van bimlynk.com.</p>

    <h3 style="color: #20433e; margin-top: 28px;">Wat zit erin?</h3>
    <ul style="font-size: 14px; line-height: 1.6;">
      <li><strong>Cable Tray Support tool</strong> — automatisch ophangbeugels plaatsen onder kabelgoten</li>
      <li><strong>Cable Tray Clearance tool</strong> — clearance hulls rondom kabelgoten voor clash detection</li>
      <li><strong>Tag Generator</strong> — Conduit ID en Cable Tray ID generators</li>
    </ul>
    <p style="font-size:14px;">In de bijlage vind je de demo Revit families (.rfa) plus alle handleidingen als PDF om te bewaren of printen.</p>

    <h3 style="color: #20433e; margin-top: 28px;">Handleidingen per tool</h3>
    <p style="font-size:13px;color:#8E8E93;">Hieronder per tool een korte uitleg. Voor uitgebreide info bezoek <a href="https://www.bimlynk.com" style="color:#20433e;">www.bimlynk.com</a>.</p>
    ${manualsHtml || '<p style="color:#8E8E93;font-size:13px;">Geen handleidingen geconfigureerd.</p>'}

    ${extraMessage ? `<div style="margin-top: 20px; padding: 16px; background: #E8F0EE; border-left: 3px solid #20433e; border-radius: 4px;"><p style="margin: 0; font-size: 14px;">${escapeHtml(extraMessage).replace(/\n/g,'<br>')}</p></div>` : ''}

    <p style="margin-top: 24px;">Vragen of feedback? Reply op deze e-mail of stuur een bericht naar <a href="mailto:info@bimlynk.com" style="color: #20433e;">info@bimlynk.com</a>.</p>
    <p>Veel succes met testen!</p>
    <p>— BIM LYNK Team</p>
  </div>
  <div style="background: #F2F2F7; padding: 16px; text-align: center; font-size: 12px; color: #8E8E93; border-top: 1px solid #E5E5EA;">
    © BIM LYNK - part of CVL SOLUTIONS<br>
    <a href="https://www.bimlynk.com" style="color: #20433e;">www.bimlynk.com</a>
  </div>
</body></html>`;
}

// ============================================================
// High-level: execute one demo send
// ============================================================

/**
 * Build the package and actually send it.
 * Returns { code, recipient, cc, attachmentCount }.
 */
async function executeDemoSend({ signup, demoVersionId, recipientOverride, message, subject, codeOverride }) {
  const versionId = demoVersionId || 'lynk-electrical-demo-v1.0';
  const manifest = DEMO_VERSIONS[versionId];
  if (!manifest) throw new Error(`Onbekende demo versie: ${versionId}`);

  const isTestSend = !!recipientOverride;
  const recipient = recipientOverride || signup.email;

  // Allocate code
  let code;
  if (isTestSend) code = TEST_CODE;
  else if (codeOverride) code = await reserveExplicitCode(signup.id, signup.email, codeOverride.toUpperCase());
  else code = await allocateCode(signup.id, signup.email);

  // Assemble files. The installer .exe is intentionally NOT attached:
  // Exchange Online and most recipient mail servers block .exe attachments
  // outright (NDR / undeliverable). Recipients get it via the download
  // button in the email body instead. The families (.rfa) are fine.
  const attachments = [];
  for (const fam of (manifest.families || [])) {
    attachments.push(await fetchAsAttachment(SITE_BASE_URL + fam.url, fam.filename));
  }

  // Generate one PDF per tool manual and attach
  for (const toolId of (manifest.manuals || [])) {
    const manual = await loadManual(toolId);
    if (!manual || !manual.content) continue;
    const title = manual.title || `${TOOL_NAMES[toolId] || toolId} Handleiding`;
    const version = manual.version || 'v1.0';
    const pdf = renderManualPdf(title, version, manual.content);
    const safeName = title.replace(/[^a-z0-9\-_ ]/gi, '_');
    attachments.push({
      name: `${safeName}_${version}.pdf`,
      contentType: 'application/pdf',
      contentBase64: pdf.contentBase64,
      sizeBytes: pdf.sizeBytes
    });
  }

  const installerLink = SITE_BASE_URL + '/demo-download.html';
  const htmlBody = await buildEmailBody({
    firstName: signup.firstName,
    code,
    installerLink,
    manifest,
    extraMessage: message
  });
  const finalSubject = subject || `Je ${manifest.label} staat klaar`;
  const cc = isTestSend ? [] : [INFO_ADDRESS];

  const token = await getAccessToken();
  await sendMailViaDraft({ token, to: recipient, cc, subject: finalSubject, htmlBody, attachments });

  return { code, recipient, cc, attachmentCount: attachments.length, isTestSend };
}

module.exports = {
  // env
  getEnv, setEnv,
  // constants
  TEST_CODE, INFO_ADDRESS, DEMO_CODES,
  // operations
  executeDemoSend,
  // for portal display
  manifestFor: id => DEMO_VERSIONS[id]
};
