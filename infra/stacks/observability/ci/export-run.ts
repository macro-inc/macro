import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

interface Run {
  id: number;
  run_attempt: number;
  name: string;
  event: string;
  head_branch: string | null;
  head_sha: string;
  status: string;
  conclusion: string | null;
  run_started_at: string;
  updated_at: string;
}
interface Job {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  started_at: string | null;
  completed_at: string | null;
}
const repository = 'macro-inc/macro';
const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken) throw new Error('GITHUB_TOKEN is required');
const headers = {
  Authorization: `Bearer ${githubToken}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};
async function github(path: string): Promise<unknown> {
  const response = await fetch(
    `https://api.github.com/repos/${repository}/actions/${path}`,
    {
      headers,
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    }
  );
  if (!response.ok)
    throw new Error(`GitHub metadata request failed: HTTP ${response.status}`);
  return response.json();
}
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
function isRun(value: unknown): value is Run {
  return (
    object(value) &&
    typeof value.id === 'number' &&
    typeof value.run_attempt === 'number' &&
    [
      'name',
      'event',
      'head_sha',
      'status',
      'run_started_at',
      'updated_at',
    ].every((key) => typeof value[key] === 'string') &&
    nullableString(value.head_branch) &&
    nullableString(value.conclusion)
  );
}
function isJob(value: unknown): value is Job {
  return (
    object(value) &&
    typeof value.id === 'number' &&
    Number.isSafeInteger(value.id) &&
    value.id > 0 &&
    typeof value.name === 'string' &&
    typeof value.status === 'string' &&
    nullableString(value.conclusion) &&
    nullableString(value.started_at) &&
    nullableString(value.completed_at)
  );
}
function positiveId(value: unknown): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0)
    throw new Error('Invalid run ID or attempt');
  return number;
}
function timestamp(value: string): number {
  const result = Date.parse(value);
  if (!Number.isFinite(result)) throw new Error('Invalid GitHub timestamp');
  return result;
}
function seconds(start: string, end: string): number {
  return Math.max(0, (timestamp(end) - timestamp(start)) / 1000);
}

// workflow_run payload is data only. No PR checkout, artifacts, shell interpolation,
// raw job logs, step commands, or repository-supplied URLs are used.
const event: unknown = JSON.parse(
  await readFile(process.env.GITHUB_EVENT_PATH ?? '', 'utf8')
);
if (
  !object(event) ||
  !object(event.repository) ||
  event.repository.full_name !== repository ||
  event.action !== 'completed' ||
  !object(event.workflow_run)
) {
  throw new Error('Expected a completed macro-inc/macro workflow_run event');
}
const runId = positiveId(event.workflow_run.id);
const attempt = positiveId(event.workflow_run.run_attempt);
const run = await github(`runs/${runId}/attempts/${attempt}`);
if (
  !isRun(run) ||
  run.id !== runId ||
  run.run_attempt !== attempt ||
  run.status !== 'completed'
) {
  throw new Error('Run identity, attempt, or completion mismatch');
}
const jobs: Job[] = [];
for (let page = 1; ; page++) {
  if (page > 100)
    throw new Error('Run exceeded 10,000 jobs; refusing partial export');
  const batch = await github(
    `runs/${runId}/attempts/${attempt}/jobs?per_page=100&page=${page}`
  );
  if (
    !object(batch) ||
    !Array.isArray(batch.jobs) ||
    !batch.jobs.every(isJob) ||
    typeof batch.total_count !== 'number' ||
    !Number.isSafeInteger(batch.total_count) ||
    batch.total_count < 0
  )
    throw new Error('Invalid GitHub jobs response');
  jobs.push(...batch.jobs);
  if (jobs.length >= batch.total_count) break;
  if (!batch.jobs.length)
    throw new Error('GitHub returned an incomplete jobs page');
}
if (jobs.some((job) => job.status !== 'completed')) {
  throw new Error(
    'Jobs are not finalized; rerun this exporter after GitHub settles'
  );
}
// Emit every job at run completion, so long-running workflows do not insert their
// earliest jobs behind Loki's out-of-order window. Actual job times stay in JSON.
const completedAt = run.updated_at;
const timeUnixNano = (BigInt(timestamp(completedAt)) * 1000000n).toString();
const url = `https://github.com/${repository}/actions/runs/${runId}/attempts/${attempt}`;
const common = {
  repository,
  workflow: run.name,
  run_id: String(runId),
  attempt,
  trigger: run.event,
  branch: run.head_branch,
  commit: run.head_sha,
};
const events = [
  {
    ...common,
    event_type: 'workflow',
    event_id: `${runId}:${attempt}`,
    conclusion: run.conclusion ?? 'unknown',
    started_at: run.run_started_at,
    completed_at: completedAt,
    duration_seconds: seconds(run.run_started_at, completedAt),
    url,
  },
  ...jobs.map((job) => ({
    ...common,
    event_type: 'job',
    event_id: `${runId}:${attempt}:${positiveId(job.id)}`,
    job: job.name,
    conclusion: job.conclusion ?? 'unknown',
    started_at: job.started_at,
    completed_at: job.completed_at,
    duration_seconds:
      job.started_at && job.completed_at
        ? seconds(job.started_at, job.completed_at)
        : null,
    url: `https://github.com/${repository}/actions/runs/${runId}/job/${job.id}`,
  })),
];
const token = execFileSync(
  'aws',
  [
    'secretsmanager',
    'get-secret-value',
    '--region',
    'us-east-1',
    '--secret-id',
    'observability/dev-ingest',
    '--query',
    'SecretString',
    '--output',
    'text',
  ],
  { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
).trim();
if (token.length < 32 || /\s/.test(token))
  throw new Error('Invalid ingestion credential');
for (let offset = 0; offset < events.length; offset += 100) {
  const response = await fetch('https://otlp.macro-internal.com/v1/logs', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
    body: JSON.stringify({
      resourceLogs: [
        {
          resource: {
            attributes: [
              { key: 'service.name', value: { stringValue: 'github-actions' } },
              { key: 'deployment.environment', value: { stringValue: 'ci' } },
            ],
          },
          scopeLogs: [
            {
              scope: { name: 'macro.ci' },
              logRecords: events.slice(offset, offset + 100).map((entry) => ({
                timeUnixNano,
                severityNumber: entry.conclusion === 'failure' ? 17 : 9,
                severityText: entry.conclusion === 'failure' ? 'ERROR' : 'INFO',
                body: { stringValue: JSON.stringify(entry) },
              })),
            },
          ],
        },
      ],
    }),
  });
  if (!response.ok)
    throw new Error(`Telemetry export failed: HTTP ${response.status}`);
  const result: unknown = await response.json();
  if (!object(result)) throw new Error('Invalid telemetry response');
  if (result.partialSuccess !== undefined) {
    if (!object(result.partialSuccess))
      throw new Error('Invalid telemetry response');
    const rejected = result.partialSuccess.rejectedLogRecords ?? 0;
    if (
      (typeof rejected !== 'string' && typeof rejected !== 'number') ||
      !Number.isSafeInteger(Number(rejected)) ||
      Number(rejected) !== 0
    ) {
      throw new Error(
        'Telemetry receiver rejected log records or returned an invalid count'
      );
    }
  }
}
console.log(`Exported run ${runId}, attempt ${attempt}, ${jobs.length} jobs`);
