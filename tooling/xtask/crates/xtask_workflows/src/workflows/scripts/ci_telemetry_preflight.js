const run = context.payload.workflow_run;
const { data } = await github.rest.actions.listJobsForWorkflowRunAttempt({
  ...context.repo, run_id: run.id, attempt_number: run.run_attempt, per_page: 100,
});
if (data.total_count > 100 || data.jobs.length !== data.total_count) {
  throw new Error('Grafana exporter supports at most 100 jobs; refusing a partial trace');
}
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
  if (job.status !== 'completed' || !timed(job)) {
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
core.setOutput('export', data.jobs.length > 0);
if (!data.jobs.length) core.notice('No jobs in this attempt; no execution trace to export');
