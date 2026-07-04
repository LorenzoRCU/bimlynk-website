// Scheduled function — fires at 8:15 CEST on April 14, 2026 (6:15 UTC)
// and then every 5 minutes to catch new signups for auto-send.
// Processes all beta signups that haven't received their code yet.

const { processAllPending } = require('./beta-send');

exports.handler = async () => {
  try {
    // Only auto-send after April 14, 2026 06:15 UTC (= 08:15 CEST)
    const launchTime = new Date('2026-04-14T06:15:00Z');
    if (Date.now() < launchTime.getTime()) {
      return { statusCode: 200, body: 'Before launch time, skipping' };
    }

    const result = await processAllPending();
    return {
      statusCode: 200,
      body: JSON.stringify({ processed: true, ...result })
    };
  } catch (err) {
    return { statusCode: 500, body: 'beta-scheduler error: ' + err.message };
  }
};
