// Mail Relay — accepts mail requests from sibling sites (Lynk3D, future ones)
// and sends them via the existing BIM LYNK Graph API setup.
//
// Auth: shared secret in MAIL_RELAY_SECRET env var. Body must include
// { secret, subject, html, to, replyTo?, attachments? } where attachments is
// [{ name, contentBase64, contentType }].

async function getAccessToken() {
    const url = `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}/oauth2/v2.0/token`;
    const params = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.AZURE_CLIENT_ID,
        client_secret: process.env.AZURE_CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default',
    });
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params.toString(),
    });
    if (!res.ok) throw new Error(`Graph token failed: ${res.status} ${await res.text()}`);
    return (await res.json()).access_token;
}

exports.handler = async (event) => {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    let payload;
    try { payload = JSON.parse(event.body || '{}'); }
    catch { return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) }; }

    const expectedSecret = process.env.MAIL_RELAY_SECRET;
    if (!expectedSecret) {
        return { statusCode: 500, body: JSON.stringify({ error: 'MAIL_RELAY_SECRET not configured on server' }) };
    }
    if (payload.secret !== expectedSecret) {
        return { statusCode: 401, body: JSON.stringify({ error: 'Invalid secret' }) };
    }

    const { subject, html, to, replyTo, attachments } = payload;
    if (!subject || !html || !to) {
        return { statusCode: 422, body: JSON.stringify({ error: 'subject, html and to are required' }) };
    }

    const sender = process.env.SENDER_EMAIL || 'info@bimlynk.com';
    const toList = Array.isArray(to) ? to : [to];

    let token;
    try { token = await getAccessToken(); }
    catch (e) { return { statusCode: 502, body: JSON.stringify({ error: 'Graph auth failed: ' + e.message }) }; }

    const message = {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: toList.map(addr => ({ emailAddress: { address: addr } })),
    };
    if (replyTo) {
        const r = typeof replyTo === 'string' ? { address: replyTo } : replyTo;
        message.replyTo = [{ emailAddress: r }];
    }
    if (Array.isArray(attachments) && attachments.length) {
        message.attachments = attachments.map(a => ({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: a.name,
            contentType: a.contentType || 'application/octet-stream',
            contentBytes: a.contentBase64,
        }));
    }

    const sendRes = await fetch(
        `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
        {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ message, saveToSentItems: 'true' }),
        },
    );

    if (!sendRes.ok) {
        const errText = await sendRes.text();
        return {
            statusCode: 502,
            body: JSON.stringify({ error: `Graph sendMail failed (${sendRes.status})`, detail: errText.slice(0, 500) }),
        };
    }

    return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ok: true, sentTo: toList, subject }),
    };
};
