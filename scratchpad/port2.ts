import { readFileSync, writeFileSync } from 'node:fs';
const E = 'apps/web/src/lib/graphql-cache/exchange/';
function edit(file: string, steps: [string | RegExp, string][]) {
  let t = readFileSync(file, 'utf8');
  for (const [from, to] of steps) {
    const before = t;
    t = t.replace(from, to);
    if (t === before) throw new Error(`no match in ${file}: ${String(from).slice(0, 60)}`);
  }
  writeFileSync(file, t);
}
edit(E + 'mutation-queue-runner.ts', [
  [
    ' * refused claim also releases a lease this page took, has no enqueue on its\n * way for, and is not sending under.\n',
    ' * claim refused after an enqueue lost its answer also releases a lease this\n * page took, has no enqueue on its way for, and is not sending under.\n',
  ],
  [
    '  // Every owner this page has claimed under.\n',
    '  // An enqueue lost its answer: it may have leased the head to this page.\n  let unroutedSuspected = false;\n  // Every owner this page has claimed under.\n',
  ],
  [
    '    if (!host.inspectMutations) return false;\n    const head = await inspectHeadClaim();\n    if (!head || !ownOwners.has(head.lease.owner)) return false;\n    // An enqueue on its way may be the one that took this lease.\n    if (enqueuesInFlight > 0) return false;\n',
    '    // Inspections read the whole queue: look only after a lost answer.\n    if (!unroutedSuspected || !host.inspectMutations) return false;\n    // An enqueue on its way may be the one that took the lease.\n    if (enqueuesInFlight > 0) return false;\n    unroutedSuspected = false;\n    const head = await inspectHeadClaim();\n    if (!head || !ownOwners.has(head.lease.owner)) return false;\n',
  ],
  [
    '    admit,\n    settle,\n',
    '    enqueueLost: () => {\n      unroutedSuspected = true;\n      wakeDrain();\n    },\n    admit,\n    settle,\n',
  ],
  [
    '  /** Schedules the first drain. */\n',
    '  /** An enqueue got no answer: it may have leased the head to this page. */\n  enqueueLost: () => void;\n  /** Schedules the first drain. */\n',
  ],
]);
edit(E + 'normalized-cache-exchange.ts', [
  ['            mutationQueue.wake();\n            return uncertainEnqueueResult(op, error);', '            mutationQueue.enqueueLost();\n            return uncertainEnqueueResult(op, error);'],
  ['              mutationQueue.wake();\n              return uncertainEnqueueResult(op, fallbackError);', '              mutationQueue.enqueueLost();\n              return uncertainEnqueueResult(op, fallbackError);'],
  ['        // The enqueue may claim the head for this runner.\n        const now = Date.now();', '        const now = Date.now();'],
]);
let t = readFileSync(E + 'mutation-queue-runner.test.ts', 'utf8');
t += `
it('releases a lease this page holds without sending under it', async () => {
  // An enqueue claimed the head for this page and its answer was lost.
  const { runner, host } = fixture();
  let leased = true;
  host.inspectMutations = async () => (leased ? [headLeasedBy('owner')] : []);
  const claims = vi.fn(async () => undefined);
  host.claimNextMutation = claims;
  vi.mocked(host.deferOptimisticWrite).mockImplementation(async () => {
    leased = false;
    return { kind: 'deferred' } as never;
  });
  runner.epoch();

  runner.enqueueLost();
  await vi.advanceTimersByTimeAsync(1);

  expect(host.deferOptimisticWrite).toHaveBeenCalledExactlyOnceWith(
    '1',
    { owner: 'owner', generation: '4' },
    expect.any(Number),
    'Lease was never routed'
  );
  // The pump asks again without waiting for its poll.
  expect(claims).toHaveBeenCalledTimes(2);
});

it('keeps its own lease while the enqueue that may have taken it is on its way', async () => {
  const { runner, host } = fixture();
  let leased = true;
  host.inspectMutations = async () => (leased ? [headLeasedBy('owner')] : []);
  vi.mocked(host.deferOptimisticWrite).mockImplementation(async () => {
    leased = false;
    return { kind: 'deferred' } as never;
  });
  const enqueueEnded = runner.enqueueStarted();

  runner.enqueueLost();
  await vi.advanceTimersByTimeAsync(1);
  expect(host.deferOptimisticWrite).not.toHaveBeenCalled();

  // That enqueue ends too: the next look at the head releases it.
  enqueueEnded();
  runner.wake();
  await vi.advanceTimersByTimeAsync(1);
  expect(host.deferOptimisticWrite).toHaveBeenCalledOnce();
});

it('keeps the lease it is sending under', async () => {
  const { runner, host, forwarded } = fixture();
  host.inspectMutations = async () => [headLeasedBy('owner', undefined, '3')];
  await runner.admit(operation(), enqueue(operation(), '3'), runner.epoch());
  expect(forwarded).toHaveLength(1);

  runner.enqueueLost();
  await vi.advanceTimersByTimeAsync(1);

  expect(host.deferOptimisticWrite).not.toHaveBeenCalled();
});

it('does not look at the queue for its own lease unless an enqueue lost its answer', async () => {
  const { runner, host } = fixture();
  const inspected = vi.fn(async () => [headLeasedBy('owner')]);
  host.inspectMutations = inspected;
  host.claimNextMutation = vi.fn(async () => undefined);

  runner.start();
  await vi.advanceTimersByTimeAsync(1);
  runner.wake();
  await vi.advanceTimersByTimeAsync(1);

  // Only the once-per-poll look for a departed owner.
  expect(inspected).toHaveBeenCalledOnce();
  expect(host.deferOptimisticWrite).not.toHaveBeenCalled();
});

it('claims again when a write settles while a claim is being answered', async () => {
  const { runner, host, forwarded } = fixture();
  let claimAnswered!: (claimed: undefined) => void;
  const claims = vi.fn(
    () =>
      new Promise<undefined>((resolve) => {
        claimAnswered = resolve;
      })
  );
  host.claimNextMutation = claims;

  runner.start();
  await vi.advanceTimersByTimeAsync(1);
  expect(claims).toHaveBeenCalledOnce();

  // The head this runner was sending settles, and asks for the next drain,
  // just before the first claim answers that nothing is claimable.
  await runner.admit(operation(), enqueue(operation(), '2'), runner.epoch());
  await runner.settle(
    { operation: forwarded[0], data: savedDraft, stale: false, hasNext: false },
    queueAttemptOf(forwarded[0])!
  );
  claimAnswered(undefined);
  await vi.advanceTimersByTimeAsync(1);
  expect(claims).toHaveBeenCalledTimes(2);
});
`;
writeFileSync(E + 'mutation-queue-runner.test.ts', t);
