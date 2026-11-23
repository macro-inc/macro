// Every workflow's GITHUB_TOKEN shares one hourly API budget, and PR CI can't start
// without its own calls. Below this share of it the exporter makes no more calls.
// Reading the budget is free: GitHub doesn't count `GET /rate_limit`.
const RESERVE_FRACTION = 0.4;
const { writeFileSync } = require('node:fs');
const listingFile = process.env.CI_TELEMETRY_JOBS;
const { data: limits } = await github.rest.rateLimit.get();
const { limit, remaining } = limits.resources.core;
const reserve = Math.ceil(limit * RESERVE_FRACTION);
if (remaining < reserve) {
  const listing = { limit, remaining, reserve, calls: 0, trace: false, untraced: null, jobs: null };
  writeFileSync(listingFile, JSON.stringify(listing));
  core.notice(`GitHub API budget is low (${remaining} of ${limit} left); skipping this export`);
  core.setOutput('export', false);
  return;
}
const run = context.payload.workflow_run;
const { data } = await github.rest.actions.listJobsForWorkflowRunAttempt({
  ...context.repo, run_id: run.id, attempt_number: run.run_attempt, per_page: 100,
});
// The event collector reads this listing instead of fetching it again. It is
// written before the checks below so that the job events survive a failing check.
const listing = {
  limit,
  remaining: remaining - 1,
  reserve,
  calls: 1,
  trace: false,
  untraced: null,
  jobs: data.jobs,
};
writeFileSync(listingFile, JSON.stringify(listing));
const { createHash } = require('node:crypto');

function timed(entry) {
  const start = Date.parse(entry.started_at);
  const end = Date.parse(entry.completed_at);
  return entry.conclusion && Number.isFinite(start) && Number.isFinite(end) && end >= start;
}

// Why the pinned trace exporter can't represent this attempt, or null when it can.
// It retries a failed assertion up to 240 times at two calls a try, and sends a job
// that ends before it starts as a broken span, so it runs only on what it can trace.
// None of these is an exporter failure: the job events are still exported.
function untraced() {
  if (data.total_count > 100 || data.jobs.length !== data.total_count) return 'over_100_jobs';
  if (!run.conclusion) return 'no_conclusion';
  if (data.jobs.every((job) => job.conclusion === 'skipped')) return 'no_job_ran';
  // Its span IDs hash the names, so equal job or step names would collide.
  const prefix = `${context.repo.owner}/${context.repo.repo}${run.id}${run.run_attempt}`;
  const ids = new Set();
  function distinct(suffix) {
    const id = createHash('sha256').update(prefix + suffix).digest('hex').slice(16, 32);
    if (ids.has(id)) return false;
    ids.add(id);
    return true;
  }
  distinct('s');
  for (const job of data.jobs) {
    const finished = job.status === 'completed' && job.conclusion && job.workflow_name;
    if (!finished) return 'job_unfinished';
    // GitHub dates a job that never ran (skipped, or cancelled before it started)
    // as completed before it started, usually by a second.
    if (!timed(job)) return 'job_never_ran';
    if (!distinct(job.name)) return 'duplicate_name';
    for (const step of job.steps ?? []) {
      if (!timed(step)) return 'step_timing';
      if (!distinct(job.name + step.name)) return 'duplicate_name';
    }
  }
  // At 512 spans upstream starts an asynchronous batch whose failure can be swallowed.
  if (ids.size >= 512) return 'over_511_spans';
  return null;
}

const reason = untraced();
listing.trace = !reason;
listing.untraced = reason;
writeFileSync(listingFile, JSON.stringify(listing));
core.setOutput('export', !reason);
if (reason) core.info(`No execution trace for this attempt (${reason}); job events still export`);
