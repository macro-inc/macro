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
  const listing = { limit, remaining, reserve, calls: 0, trace: false, jobs: null };
  writeFileSync(listingFile, JSON.stringify(listing));
  core.notice(`GitHub API budget is low (${remaining} of ${limit} left); skipping this export`);
  core.setOutput('export', false);
  return;
}
const run = context.payload.workflow_run;
const { data } = await github.rest.actions.listJobsForWorkflowRunAttempt({
  ...context.repo, run_id: run.id, attempt_number: run.run_attempt, per_page: 100,
});
// The event collector reads this listing instead of fetching it again, also when
// the checks below refuse the trace.
const listing = {
  limit,
  remaining: remaining - 1,
  reserve,
  calls: 1,
  trace: false,
  jobs: data.jobs,
};
writeFileSync(listingFile, JSON.stringify(listing));
if (data.total_count > 100 || data.jobs.length !== data.total_count) {
  throw new Error('Grafana exporter supports at most 100 jobs; refusing a partial trace');
}
// The pinned exporter retries a failed assertion up to 240 times, two calls each, so
// check everything it asserts before it starts.
if (!run.conclusion) throw new Error('Run conclusion is unavailable; retry after GitHub sets it');
// Check the pinned exporter's name-based IDs and timestamp requirements.
const { createHash } = require('node:crypto');
const prefix = `${context.repo.owner}/${context.repo.repo}${run.id}${run.run_attempt}`;
const ids = new Set();
function span(suffix) {
  const id = createHash('sha256').update(prefix + suffix).digest('hex').slice(16, 32);
  if (ids.has(id)) throw new Error('Duplicate exporter span ID; job/step names must be distinct');
  ids.add(id);
}
function timed(entry) {
  const start = Date.parse(entry.started_at);
  const end = Date.parse(entry.completed_at);
  return entry.conclusion && Number.isFinite(start) && Number.isFinite(end) && end >= start;
}
span('s');
for (const job of data.jobs) {
  if (job.status !== 'completed' || !timed(job) || !job.workflow_name) {
    throw new Error('Job timing is incomplete; retry after GitHub finalizes this attempt');
  }
  span(job.name);
  for (const step of job.steps ?? []) {
    if (!timed(step)) throw new Error('Step timing is unavailable; this exporter cannot represent it');
    span(job.name + step.name);
  }
}
// At 512 spans upstream starts an asynchronous batch whose failure can be swallowed.
if (ids.size >= 512) throw new Error('Grafana exporter cannot reliably report delivery failures for 512+ spans');
// A trace of skipped jobs shows nothing and costs the exporter two calls.
const ran = data.jobs.some((job) => job.conclusion !== 'skipped');
writeFileSync(listingFile, JSON.stringify({ ...listing, trace: ran }));
core.setOutput('export', ran);
if (!ran) core.notice('No job ran in this attempt; no execution trace to export');
