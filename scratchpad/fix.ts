import { readFileSync, writeFileSync } from 'node:fs';
const E = 'apps/web/src/lib/graphql-cache/exchange/';
function edit(file: string, steps: [string, string][]) {
  let t = readFileSync(file, 'utf8');
  for (const [from, to] of steps) {
    if (!t.includes(from)) throw new Error('no match: ' + from.slice(0, 50));
    t = t.replace(from, to);
  }
  writeFileSync(file, t);
}
edit(E + 'mutation-queue-runner.ts', [
  [
    '    if (enqueuesInFlight > 0) return false;\n    unroutedSuspected = false;\n    const head = await inspectHeadClaim();\n',
    '    if (enqueuesInFlight > 0) return false;\n    // A look that fails keeps the suspicion for the next drain.\n    const head = await inspectHeadClaim();\n    unroutedSuspected = false;\n',
  ],
]);
edit(E + 'mutation-queue-runner.test.ts', [
  ["it('keeps the lease it is sending under', async () => {", "it('leaves its lease alone while it is sending the head', async () => {"],
]);
let t = readFileSync(E + 'mutation-queue-runner.test.ts', 'utf8');
t += `
it('looks for its own lease again when the first look failed', async () => {
  const { runner, host } = fixture();
  let fail = true;
  host.inspectMutations = async () => {
    if (fail) throw new Error('engine restarting');
    return [headLeasedBy('owner')];
  };
  host.claimNextMutation = vi.fn(async () => undefined);
  runner.epoch();

  runner.enqueueLost();
  await vi.advanceTimersByTimeAsync(1);
  expect(host.deferOptimisticWrite).not.toHaveBeenCalled();

  fail = false;
  runner.wake();
  await vi.advanceTimersByTimeAsync(1);
  expect(host.deferOptimisticWrite).toHaveBeenCalledOnce();
});
`;
writeFileSync(E + 'mutation-queue-runner.test.ts', t);
