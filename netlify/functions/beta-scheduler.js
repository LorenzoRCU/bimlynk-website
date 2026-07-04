// Scheduled function — fires at 8:15 CEST on April 14, 2026 (6:15 UTC)
// and then every 5 minutes to:
//  1. Catch new signups for auto-send (processAllPending)
//  2. Send a pending scheduled version-update mail once it's due (processScheduledJob)

const { processAllPending } = require('./beta-send');
const { processScheduledJob } = require('./beta-update-notify');

exports.handler = async () => {
  const out = { processed: true };

  try {
    // Only auto-send after April 14, 2026 06:15 UTC (= 08:15 CEST)
    const launchTime = new Date('2026-04-14T06:15:00Z');
    if (Date.now() >= launchTime.getTime()) {
      out.signups = await processAllPending();
    } else {
      out.signups = { skipped: 'before launch time' };
    }
  } catch (err) {
    out.signupsError = err.message;
  }

  try {
    out.updateNotify = await processScheduledJob();
  } catch (err) {
    out.updateNotifyError = err.message;
  }

  return { statusCode: 200, body: JSON.stringify(out) };
};
