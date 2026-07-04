// Shared persistent storage for BIM LYNK functions, backed by Netlify Blobs.
// Underscore prefix prevents Netlify from deploying this as a standalone function.
//
// Previously data lived in Netlify env vars but exceeded AWS Lambda's 4KB limit.
// Blobs has no such limit, no scope quirks, and integrates natively with the runtime.

const { getStore } = require('@netlify/blobs');

const STORE_NAME = 'bimlynk-data';

// Stable mapping from legacy env-var keys → Blob keys (kebab-case).
const KEY_MAP = {
  BETA_SIGNUPS: 'beta-signups',
  BETA_ASSIGNED_CODES: 'beta-assigned-codes',
  BETA_FEEDBACK: 'beta-feedback',
  DEMO_SIGNUPS: 'demo-signups',
  DEMO_ASSIGNED_CODES: 'demo-assigned-codes',
  DEMO_SCHEDULED_JOBS: 'demo-scheduled-jobs',
  PORTAL_SESSIONS: 'portal-sessions',
  LYNK_SUBSCRIPTIONS: 'lynk-subscriptions',
  INVESTOR_SIGNUPS: 'investor-signups'
};

const BLOB_KEYS = new Set(Object.keys(KEY_MAP));
function isBlobKey(key) { return BLOB_KEYS.has(key); }

function resolveKey(key) {
  return KEY_MAP[key] || key;
}

function store() {
  // Prefer explicit credentials (always works); fall back to auto-config.
  if (process.env.NETLIFY_API_TOKEN && process.env.MY_SITE_ID) {
    return getStore({
      name: STORE_NAME,
      siteID: process.env.MY_SITE_ID,
      token: process.env.NETLIFY_API_TOKEN,
      consistency: 'strong'
    });
  }
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

async function getData(key) {
  try {
    const val = await store().get(resolveKey(key), { type: 'json' });
    return val == null ? null : val;
  } catch (e) {
    console.error('Blobs get failed for', key, e.message);
    return null;
  }
}

async function setData(key, value) {
  await store().setJSON(resolveKey(key), value);
}

module.exports = { getData, setData, isBlobKey };
