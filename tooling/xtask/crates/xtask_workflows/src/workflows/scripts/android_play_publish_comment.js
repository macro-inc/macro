// Android Play Publish's closing comment on the PR (actions/github-script).
// A failure names the step that failed and, when it is one that logs its
// output (steps::logged_run), quotes the end of that output.
const fs = require('fs');
const path = require('path');
const env = process.env;
const versionCode = env.VERSION_CODE || '?';
const releaseName = env.RELEASE_NAME || `version code ${versionCode}`;
const runUrl =
  `${context.serverUrl}/${context.repo.owner}/${context.repo.repo}` +
  `/actions/runs/${context.runId}`;
const runs = `[build](${env.BUILD_URL}), [publish](${runUrl})`;
let body;
if (env.JOB_STATUS === 'success') {
  body = [
    `🤖 Android ${releaseName} was uploaded to Google Play internal testing and submitted for a full production rollout (${runs}).`,
    '',
    'When Google approves it, the version goes live, the **Android Release Watch** workflow',
    'marks this PR `android-play/live` and re-runs the **Android Native Check** within half an hour',
    'of that, and the PR becomes mergeable. To merge it the moment that happens, click',
    '**Enable auto-merge** on this PR now (squash).',
    'After merge, the next prod deploy applies the Android native build floor committed in `min-native-build.json`.',
  ].join('\n');
} else {
  let failedStep = null;
  try {
    const { data } = await github.rest.actions.listJobsForWorkflowRunAttempt({
      owner: context.repo.owner,
      repo: context.repo.repo,
      run_id: context.runId,
      attempt_number: Number(env.GITHUB_RUN_ATTEMPT),
    });
    const job = data.jobs.find((j) => j.name === env.JOB_NAME);
    failedStep = job?.steps.find((s) => s.conclusion === 'failure')?.name ?? null;
  } catch (error) {
    core.warning(`Could not list this job's steps: ${error.message}`);
  }
  const read = (file) => {
    try {
      return fs.readFileSync(path.join(env.RUNNER_TEMP, file), 'utf8');
    } catch {
      return '';
    }
  };
  let tail = '';
  if (failedStep && read('last-step.name').trim() === failedStep) {
    const lines = read('last-step.log').replace(/\x1b\[[0-9;]*m/g, '').trimEnd().split('\n');
    tail = lines.slice(-30).join('\n').slice(-3000);
  }
  const retry =
    env.UPLOAD_OUTCOME === 'success'
      ? [
          `The bundle reached the internal track, so version code ${versionCode} is used up: bump`,
          '(`cd apps/web && just android-bump`), commit, and re-add the `android-update` label.',
          'If only the promotion failed and the native code is unchanged, you can instead promote',
          `version code ${versionCode} by hand with **Publish Android to Google Play** (\`operation=promote-production\`).`,
        ].join('\n')
      : 'Fix the problem, then remove and re-add the `android-update` label to retry.';
  body = [
    `🤖 Android Play release for ${releaseName} **failed**${failedStep ? ` at **${failedStep}**` : ''} (${runs}).`,
    ...(tail ? ['', '```text', tail, '```'] : []),
    '',
    retry,
  ].join('\n');
}
await github.rest.issues.createComment({
  owner: context.repo.owner,
  repo: context.repo.repo,
  issue_number: Number(env.PR_NUMBER),
  body,
});
