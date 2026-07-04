// Scheduled function — fires every 5 minutes via netlify.toml.
// Picks up DEMO_SCHEDULED_JOBS that are due, executes them, and removes them.

const lib = require('./_demo_lib');

exports.handler = async () => {
  try {
    const jobs = await lib.getEnv('DEMO_SCHEDULED_JOBS') || [];
    if (jobs.length === 0) {
      return { statusCode: 200, body: 'no jobs' };
    }

    const now = Date.now();
    const due = jobs.filter(j => j.status === 'pending' && new Date(j.scheduledFor).getTime() <= now);
    if (due.length === 0) {
      return { statusCode: 200, body: `${jobs.length} pending, none due yet` };
    }

    const signups = await lib.getEnv('DEMO_SIGNUPS') || [];
    const remaining = [...jobs];
    const results = [];

    for (const job of due) {
      try {
        const signup = signups.find(s => s.id === job.signupId);
        if (!signup) {
          results.push({ id: job.id, error: 'signup not found' });
          // Remove orphaned job
          const idx = remaining.findIndex(j => j.id === job.id);
          if (idx >= 0) remaining.splice(idx, 1);
          continue;
        }

        const result = await lib.executeDemoSend({
          signup,
          demoVersionId: job.demoVersionId,
          recipientOverride: job.recipientOverride,
          message: job.message,
          subject: job.subject,
          codeOverride: job.codeOverride
        });

        // Update signup status (scheduler only handles real sends — test sends
        // would use isTestSend, but we still persist if it wasn't a test).
        if (!result.isTestSend) {
          signup.status = 'sent';
          signup.sentAt = new Date().toISOString();
          signup.assignedCode = result.code;
        }

        // Remove job from queue
        const idx = remaining.findIndex(j => j.id === job.id);
        if (idx >= 0) remaining.splice(idx, 1);

        results.push({ id: job.id, sent: true, code: result.code, recipient: result.recipient });
      } catch (e) {
        // Mark job as failed but keep it in the list so admin can investigate
        const j = remaining.find(j => j.id === job.id);
        if (j) {
          j.status = 'failed';
          j.error = e.message;
          j.failedAt = new Date().toISOString();
        }
        results.push({ id: job.id, error: e.message });
      }
    }

    await lib.setEnv('DEMO_SIGNUPS', signups);
    await lib.setEnv('DEMO_SCHEDULED_JOBS', remaining);

    return {
      statusCode: 200,
      body: JSON.stringify({ processed: due.length, results })
    };
  } catch (err) {
    return { statusCode: 500, body: 'scheduler error: ' + err.message };
  }
};
