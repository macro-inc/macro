const marker = '<!-- ios-native-check-status -->';
const steps = JSON.parse(process.env.IOS_GATE_STEPS);
const { owner, repo } = context.repo;
const issue_number = context.issue.number;
const { data: pr } = await github.rest.pulls.get({ owner, repo, pull_number: issue_number });
// A rerun uses the original event. Never replace the current head's status
// with an older commit's result, or create comments after the PR has closed.
if (pr.state !== 'open' || pr.head.sha !== context.payload.pull_request.head.sha) return;

const comments = await github.paginate(github.rest.issues.listComments, {
  owner, repo, issue_number, per_page: 100,
});
const existing = comments.find((comment) =>
  comment.user?.login === 'github-actions[bot]' && comment.body?.startsWith(marker));
const native = steps['native-filter']?.outputs?.ios_native === 'true'
  || steps['cache-wasm']?.outputs?.bumped === 'true';
const detectionComplete = steps['native-filter']?.outcome === 'success'
  && steps['cache-wasm']?.outcome === 'success';
const failed = Object.entries(steps).filter(([, step]) => step.outcome === 'failure');
if (!native && failed.length === 0 && !existing) return;

const runUrl = `${context.serverUrl}/${owner}/${repo}/actions/runs/${context.runId}/attempts/${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`;
const guideUrl = `${context.serverUrl}/${owner}/${repo}/blob/${pr.head.sha}/apps/web/docs/ios-releases.md`;
const release = steps.live?.outputs?.gate_result
  ? JSON.parse(steps.live.outputs.gate_result) : null;
const labels = pr.labels.map((label) => label.name);
const lines = [marker];
if (failed.length && !release) {
  const names = {
    checkout: 'Checkout Repo',
    bun: 'Setup Bun',
    'native-filter': 'Detect native iOS changes',
    'cache-wasm': 'Detect a client cache wasm version bump',
    labels: "Read the PR's labels",
    bump: 'Verify iOS release numbers were bumped',
    credentials: 'Fetch App Store Connect credentials',
    live: 'Fetch the merge result and check App Store status',
  };
  lines.push('### iOS release check could not complete', '',
    `Failed step: **${failed.map(([id]) => names[id] ?? id).join(', ')}**.`, '',
    `See the [workflow logs](${runUrl}) for the error, fix it, then rerun the check.`,
    'This failure does not establish whether Apple approved the App Store release.');
} else if (!native && detectionComplete) {
  lines.push('### iOS release not required', '', 'This PR no longer changes native iOS code.');
} else if (steps.labels?.outputs?.skip === 'true') {
  lines.push('### iOS release gate bypassed', '',
    'The `skip-ios-update` label bypasses this check. App Store availability has not been verified.');
} else if (release) {
  const name = `iOS ${release.version} (build ${release.build})`;
  if (release.kind === 'approved') {
    lines.push(`### ${name} is approved and verified`, '',
      'Apple approved the App Store build, and it matches this PR’s current merge result. The iOS release requirement is satisfied; other checks and approvals still apply.');
    if (release.state) lines.push('', `App Store state: \`${release.state}\`.`);
  } else {
    lines.push(`### ${name} must be approved before this PR can merge`, '', release.reason);
    if (release.state) lines.push('', `App Store state: \`${release.state}\`.`);
    if (release.kind === 'waiting') {
      lines.push('', 'Wait for Apple to approve the release.');
    } else if (release.kind === 'mismatch') {
      lines.push('', 'Bump the release numbers, commit, push, then remove and re-add `ios-update` to release the current native code. Use `--no-min` for a release that does not need a higher native build floor.');
    } else {
      lines.push('', labels.includes('ios-update')
        ? 'The `ios-update` label is already present. Follow the **iOS App Store Release** run; if it failed, fix the reported problem, then remove and re-add the label to retry. Resolve any rejection or metadata issue in App Store Connect first.'
        : 'Once the other checks pass and the PR is ready, add **`ios-update`** to build, upload, and submit it for App Review.');
    }
    lines.push('', 'After approval, **iOS Release Watch** reruns this check within 30 minutes. You can also rerun it manually. Optionally enable **auto-merge** to merge once all requirements pass.');
  }
  lines.push('', `The next prod deploy releases ${name} on the App Store and makes the web bundle require iOS build **${release.floor}** or later, as committed in this PR.`,
    '', `[App Store Connect](${release.distributionUrl})`);
} else {
  // No structured result means verification never completed; never infer an
  // Apple state from an exit code or unstructured log text.
  lines.push('### iOS release status unavailable', '',
    `The check produced no App Store result. Inspect the [workflow logs](${runUrl}) and rerun it.`);
}
lines.push('', `[Workflow run](${runUrl}) · [Release guide](${guideUrl})`);
const body = lines.join('\n');
await core.summary.addRaw(body.replace(`${marker}\n`, '')).write();
if (existing) {
  if (existing.body !== body) {
    await github.rest.issues.updateComment({ owner, repo, comment_id: existing.id, body });
  }
} else {
  await github.rest.issues.createComment({ owner, repo, issue_number, body });
}
