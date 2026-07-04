// Subscription intake — receives the checkout form, stores the subscription
// with status=pending, generates a license code + SEPA mandate reference,
// notifies admin by email so they can process payment manually, and sends
// a confirmation to the customer.
//
// Data shape is forward-compatible with Mollie / Stripe / GoCardless
// integration: the `paymentProvider`, `paymentProviderId`, `mandateReference`,
// `firstPaymentDate` fields are placeholders the provider can fill in later.

const ACCOUNT_SLUG = 'LorenzoRCU';
const ADMIN_NOTIFY_ADDRESS = 'info@bimlynk.com';
const PORTAL_URL = 'https://www.bimlynk.com/portal-dashboard.html';

// Product catalog — keep in sync with subscribe.html
const PRODUCTS = {
  'lynk-electrical-yearly': {
    id: 'lynk-electrical-yearly',
    name: 'LYNK Electrical — Jaarabonnement',
    sku: 'LYNK-EL-Y',
    price: 179,
    currency: 'EUR',
    billingCycle: 'yearly',
    description: 'Cable Tray Clearance + Support Generator + alle toekomstige LYNK Electrical tools (incl. Fill Rate Pro & Light)'
  },
  'fillrate-light-yearly': {
    id: 'fillrate-light-yearly',
    name: 'Fill Rate Light NL — Jaarabonnement',
    sku: 'FR-L-Y',
    price: 79,
    currency: 'EUR',
    billingCycle: 'yearly',
    description: 'Standalone Fill Rate Light NL — Excel workflow + 3D kleurvisualisatie'
  }
};

// ============================================================
// Netlify env helpers
// ============================================================

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

// ============================================================
// IBAN validation (ISO 13616 mod-97)
// ============================================================

function ibanIsValid(iban) {
  iban = String(iban || '').replace(/\s+/g, '').toUpperCase();
  if (iban.length < 15 || iban.length > 34) return false;
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const numeric = rearranged.split('').map(c => {
    if (c >= 'A' && c <= 'Z') return (c.charCodeAt(0) - 55).toString();
    return c;
  }).join('');
  let rem = '';
  for (const ch of numeric) {
    rem = rem + ch;
    if (rem.length > 9) rem = (parseInt(rem, 10) % 97).toString();
  }
  return parseInt(rem, 10) % 97 === 1;
}

function maskIban(iban) {
  iban = String(iban || '').replace(/\s+/g, '');
  if (iban.length < 8) return iban;
  return iban.slice(0, 4) + ' **** **** ' + iban.slice(-4);
}

// ============================================================
// License + mandate reference generation
// ============================================================

function randomSegment(len = 4) {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/O/1/I
  let out = '';
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function generateLicenseCode() {
  return `LYNK-${randomSegment()}-${randomSegment()}-${randomSegment()}`;
}

function generateMandateReference(subscriptionId) {
  // Format: BL-YYYYMMDD-XXXXXX (BL = BIM LYNK)
  const d = new Date();
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
  const suffix = subscriptionId.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(-6).padStart(6, 'X');
  return `BL-${ymd}-${suffix}`;
}

// ============================================================
// Microsoft Graph (reuse the same pattern as demo-signup / investor-signup)
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

function escapeHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function sendSimpleMail({ to, subject, html, replyTo, cc }) {
  const token = await getAccessToken();
  const sender = process.env.SENDER_EMAIL;
  const message = {
    subject,
    body: { contentType: 'HTML', content: html },
    toRecipients: [{ emailAddress: { address: to } }]
  };
  if (cc) message.ccRecipients = [{ emailAddress: { address: cc } }];
  if (replyTo) message.replyTo = [{ emailAddress: { address: replyTo } }];

  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${sender}/sendMail`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, saveToSentItems: true })
  });
  if (res.status !== 202) {
    console.warn('sendSimpleMail failed:', res.status, await res.text());
  }
}

// ============================================================
// Email templates
// ============================================================

function buildAdminNotificationHtml(sub, product) {
  return `<!DOCTYPE html>
<html><body style="font-family: Inter, Arial, sans-serif; color: #1C1C1E; max-width: 640px; margin: 0 auto;">
  <div style="background: linear-gradient(135deg,#20433e,#2a5a53); color: white; padding: 22px; text-align: center;">
    <h2 style="margin: 0; font-size: 19px;">💶 Nieuwe betaalde aanmelding</h2>
    <p style="margin: 4px 0 0; font-size: 12px; opacity: 0.85;">${escapeHtml(product.name)}</p>
  </div>
  <div style="padding: 24px;">
    <p style="margin-top:0;">Er is zojuist een nieuw abonnement afgesloten. Verwerk de eerste factuur en de SEPA machtiging.</p>

    <h3 style="color:#20433e; font-size:14px; margin-top:20px; margin-bottom:6px;">Abonnement</h3>
    <table style="width:100%; border-collapse: collapse; font-size: 13px;">
      <tr><td style="padding:4px 0; color:#8E8E93; width: 40%;">Product</td><td style="padding:4px 0;"><strong>${escapeHtml(product.name)}</strong></td></tr>
      <tr><td style="padding:4px 0; color:#8E8E93;">Prijs</td><td style="padding:4px 0;"><strong>€ ${product.price} / ${product.billingCycle === 'yearly' ? 'jaar' : 'maand'}</strong></td></tr>
      <tr><td style="padding:4px 0; color:#8E8E93;">Licentiecode</td><td style="padding:4px 0; font-family: Consolas, monospace;"><strong>${escapeHtml(sub.licenseCode)}</strong></td></tr>
      <tr><td style="padding:4px 0; color:#8E8E93;">Machtigingskenmerk</td><td style="padding:4px 0; font-family: Consolas, monospace;">${escapeHtml(sub.mandateReference)}</td></tr>
      <tr><td style="padding:4px 0; color:#8E8E93;">Status</td><td style="padding:4px 0;"><span style="background:#FF9500;color:white;padding:2px 8px;border-radius:10px;font-size:11px;">${escapeHtml(sub.status)}</span></td></tr>
    </table>

    <h3 style="color:#20433e; font-size:14px; margin-top:20px; margin-bottom:6px;">Bedrijfsgegevens</h3>
    <table style="width:100%; border-collapse: collapse; font-size: 13px;">
      <tr><td style="padding:4px 0; color:#8E8E93; width: 40%;">Bedrijf</td><td style="padding:4px 0;"><strong>${escapeHtml(sub.companyName)}</strong></td></tr>
      ${sub.kvkNumber ? `<tr><td style="padding:4px 0; color:#8E8E93;">KvK</td><td style="padding:4px 0;">${escapeHtml(sub.kvkNumber)}</td></tr>` : ''}
      ${sub.vatNumber ? `<tr><td style="padding:4px 0; color:#8E8E93;">BTW</td><td style="padding:4px 0;">${escapeHtml(sub.vatNumber)}</td></tr>` : ''}
      <tr><td style="padding:4px 0; color:#8E8E93;">Factuuradres</td><td style="padding:4px 0;">${escapeHtml(sub.street)} ${escapeHtml(sub.houseNumber)}<br>${escapeHtml(sub.postalCode)} ${escapeHtml(sub.city)}<br>${escapeHtml(sub.country)}</td></tr>
    </table>

    <h3 style="color:#20433e; font-size:14px; margin-top:20px; margin-bottom:6px;">Contactpersoon</h3>
    <table style="width:100%; border-collapse: collapse; font-size: 13px;">
      <tr><td style="padding:4px 0; color:#8E8E93; width: 40%;">Naam</td><td style="padding:4px 0;"><strong>${escapeHtml(sub.firstName)} ${escapeHtml(sub.lastName)}</strong>${sub.jobRole ? ' · ' + escapeHtml(sub.jobRole) : ''}</td></tr>
      <tr><td style="padding:4px 0; color:#8E8E93;">E-mail</td><td style="padding:4px 0;"><a href="mailto:${escapeHtml(sub.email)}" style="color:#20433e;">${escapeHtml(sub.email)}</a></td></tr>
      <tr><td style="padding:4px 0; color:#8E8E93;">Telefoon</td><td style="padding:4px 0;"><a href="tel:${escapeHtml(sub.phone)}" style="color:#20433e;">${escapeHtml(sub.phone)}</a></td></tr>
    </table>

    <h3 style="color:#20433e; font-size:14px; margin-top:20px; margin-bottom:6px;">SEPA Machtiging</h3>
    <table style="width:100%; border-collapse: collapse; font-size: 13px;">
      <tr><td style="padding:4px 0; color:#8E8E93; width: 40%;">IBAN</td><td style="padding:4px 0; font-family: Consolas, monospace;"><strong>${escapeHtml(sub.iban)}</strong></td></tr>
      <tr><td style="padding:4px 0; color:#8E8E93;">Tenaamstelling</td><td style="padding:4px 0;">${escapeHtml(sub.accountHolder)}</td></tr>
      <tr><td style="padding:4px 0; color:#8E8E93;">Akkoord op</td><td style="padding:4px 0;">${new Date(sub.consentTimestamp).toLocaleString('nl-NL')}</td></tr>
      <tr><td style="padding:4px 0; color:#8E8E93;">IP adres (log)</td><td style="padding:4px 0; font-family: Consolas, monospace; font-size: 11px;">${escapeHtml(sub.consentIp || '—')}</td></tr>
    </table>

    <p style="text-align:center; margin: 24px 0;">
      <a href="${PORTAL_URL}" style="display:inline-block; background:#20433e; color:white; padding:12px 24px; border-radius:6px; text-decoration:none; font-weight:600;">Open portaal &amp; beheer licentie</a>
    </p>

    <p style="font-size:12px; color:#8E8E93;">Reply op deze mail om direct contact op te nemen met de klant (reply-to is ingesteld).</p>
  </div>
  <div style="background:#F2F2F7; padding:12px; text-align:center; font-size:11px; color:#8E8E93;">
    BIM LYNK - onderdeel van CVL Solutions
  </div>
</body></html>`;
}

function buildCustomerConfirmationHtml(sub, product) {
  return `<!DOCTYPE html>
<html><body style="font-family: Inter, Arial, sans-serif; color: #1C1C1E; max-width: 640px; margin: 0 auto;">
  <div style="background: #20433e; color: white; padding: 24px; text-align: center;">
    <h1 style="margin: 0; font-size: 22px;">BIM LYNK</h1>
    <p style="margin: 4px 0 0; font-size: 13px; opacity: 0.85;">Bevestiging van je abonnement</p>
  </div>
  <div style="padding: 32px 24px;">
    <p>Hi ${escapeHtml(sub.firstName)},</p>
    <p>Bedankt voor je aanmelding voor <strong>${escapeHtml(product.name)}</strong>. We hebben je gegevens ontvangen en gaan nu je factuur opmaken.</p>

    <h3 style="color: #20433e; margin-top: 24px;">Overzicht</h3>
    <table style="width:100%; border-collapse: collapse; font-size: 14px;">
      <tr><td style="padding:6px 0; color:#8E8E93; width: 40%;">Product</td><td style="padding:6px 0;"><strong>${escapeHtml(product.name)}</strong></td></tr>
      <tr><td style="padding:6px 0; color:#8E8E93;">Prijs</td><td style="padding:6px 0;"><strong>€ ${product.price} / ${product.billingCycle === 'yearly' ? 'jaar' : 'maand'}</strong></td></tr>
      <tr><td style="padding:6px 0; color:#8E8E93;">Licentiecode</td><td style="padding:6px 0; font-family: Consolas, monospace;"><strong>${escapeHtml(sub.licenseCode)}</strong></td></tr>
      <tr><td style="padding:6px 0; color:#8E8E93;">Machtigingskenmerk</td><td style="padding:6px 0; font-family: Consolas, monospace;">${escapeHtml(sub.mandateReference)}</td></tr>
      <tr><td style="padding:6px 0; color:#8E8E93;">IBAN</td><td style="padding:6px 0; font-family: Consolas, monospace;">${escapeHtml(maskIban(sub.iban))}</td></tr>
    </table>

    <h3 style="color: #20433e; margin-top: 24px;">Hoe nu verder?</h3>
    <ol style="font-size: 14px; line-height: 1.65;">
      <li><strong>Factuur per e-mail</strong> — binnen 1 werkdag ontvang je de eerste factuur in je inbox.</li>
      <li><strong>Automatische incasso</strong> — wij schrijven het bedrag na de betalingstermijn automatisch af van de door jou opgegeven rekening.</li>
      <li><strong>Licentie activatie</strong> — zodra de betaling binnen is activeren we je licentie en ontvang je de installer + handleidingen.</li>
    </ol>

    <p style="font-size: 13px; color: #8E8E93;">Je licentiecode <strong>${escapeHtml(sub.licenseCode)}</strong> is nu geregistreerd in ons systeem. Bewaar hem goed — je hebt hem nodig voor installatie.</p>

    <p style="margin-top: 24px;">Vragen? Reply op deze e-mail of stuur een bericht naar <a href="mailto:info@bimlynk.com" style="color: #20433e;">info@bimlynk.com</a>.</p>
    <p>— BIM LYNK Team</p>
  </div>
  <div style="background: #F2F2F7; padding: 16px; text-align: center; font-size: 12px; color: #8E8E93; border-top: 1px solid #E5E5EA;">
    © BIM LYNK - onderdeel van CVL Solutions<br>
    <a href="https://www.bimlynk.com" style="color: #20433e;">www.bimlynk.com</a>
  </div>
</body></html>`;
}

// ============================================================
// Handler
// ============================================================

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

    // Product
    const product = PRODUCTS[data.productId];
    if (!product) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Onbekend product' }) };

    // Required fields (KvK is optional)
    const required = ['companyName','firstName','lastName','email','phone','postalCode','street','houseNumber','city','country','iban','accountHolder'];
    for (const f of required) {
      if (!data[f] || String(data[f]).trim() === '') {
        return { statusCode: 400, headers, body: JSON.stringify({ error: `Veld ontbreekt: ${f}` }) };
      }
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldig e-mailadres' }) };
    }
    if (!ibanIsValid(data.iban)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Ongeldig IBAN' }) };
    }
    // SEPA mandate is legally part of the terms — one acceptance covers both.
    if (!data.consentTerms) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Akkoord met voorwaarden is verplicht' }) };
    }

    // Build subscription record
    const now = new Date();
    const subscriptionId = now.getTime().toString(36) + Math.random().toString(36).substr(2, 6);
    const licenseCode = generateLicenseCode();
    const mandateReference = generateMandateReference(subscriptionId);

    // Compute subscription dates (annual billing)
    const startDate = now.toISOString();
    const endDate = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate()).toISOString();
    const firstPaymentDate = new Date(now.getTime() + 2 * 24 * 60 * 60 * 1000).toISOString(); // +2 days

    const sub = {
      id: subscriptionId,
      // product
      productId: product.id,
      productName: product.name,
      productSku: product.sku,
      price: product.price,
      currency: product.currency,
      billingCycle: product.billingCycle,
      // company
      companyName: data.companyName.trim(),
      kvkNumber: (data.kvkNumber || '').trim(),
      vatNumber: (data.vatNumber || '').trim(),
      // contact
      firstName: data.firstName.trim(),
      lastName: data.lastName.trim(),
      email: data.email.trim().toLowerCase(),
      phone: data.phone.trim(),
      jobRole: (data.jobRole || '').trim(),
      // address
      postalCode: data.postalCode.trim(),
      street: data.street.trim(),
      houseNumber: data.houseNumber.trim(),
      city: data.city.trim(),
      country: data.country,
      // SEPA
      iban: data.iban.replace(/\s+/g, '').toUpperCase(),
      accountHolder: data.accountHolder.trim(),
      mandateReference,
      consentSepa: true,
      consentTerms: true,
      consentTimestamp: now.toISOString(),
      consentIp: event.headers['x-forwarded-for'] || event.headers['x-nf-client-connection-ip'] || '',
      // dates
      createdAt: now.toISOString(),
      startDate,
      endDate,
      firstPaymentDate,
      nextPaymentDate: firstPaymentDate,
      // status
      status: 'pending', // pending | active | suspended | cancelled
      paymentStatus: 'awaiting_invoice', // awaiting_invoice | invoiced | paid | failed | refunded
      // licensing
      licenseCode,
      licenseActivated: false,
      licenseActivatedAt: null,
      // payment provider hook (future: mollie/stripe/gocardless)
      paymentProvider: null,
      paymentProviderId: null,
      // admin notes
      notes: ''
    };

    // Persist
    const list = await getEnv('LYNK_SUBSCRIPTIONS') || [];
    list.push(sub);
    await setEnv('LYNK_SUBSCRIPTIONS', list);

    // Notify admin (best-effort)
    try {
      await sendSimpleMail({
        to: ADMIN_NOTIFY_ADDRESS,
        subject: `💶 Nieuwe aanmelding: ${sub.companyName} — ${product.name}`,
        html: buildAdminNotificationHtml(sub, product),
        replyTo: sub.email
      });
    } catch (e) {
      console.warn('admin notification failed:', e.message);
    }

    // Confirmation to customer (best-effort)
    try {
      await sendSimpleMail({
        to: sub.email,
        subject: `Bevestiging: ${product.name}`,
        html: buildCustomerConfirmationHtml(sub, product),
        cc: ADMIN_NOTIFY_ADDRESS
      });
    } catch (e) {
      console.warn('customer confirmation failed:', e.message);
    }

    return {
      statusCode: 200, headers,
      body: JSON.stringify({
        success: true,
        subscriptionId: sub.id,
        licenseCode: sub.licenseCode,
        mandateReference: sub.mandateReference
      })
    };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
