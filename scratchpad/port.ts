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
    ' * owner it saw leave: after the grace, and after a refused release.\n */',
    ` * owner it saw leave: after the grace, and after a refused release.
 *
 * An enqueue claims the head for its runner inside the host. When its answer
 * is lost, the head stays leased to this page and nothing sends it, so a
 * refused claim also releases a lease this page took, has no enqueue on its
 * way for, and is not sending under.
 */`,
  ],
  [/\/\*\* Whether queue runners are alive, as far as this context can tell\. \*\/\nexport type LeaseOwnerLiveness = \{[\s\S]*?\n\}\n\nasync function boundedMutationLifecycle/, 'async function boundedMutationLifecycle'],
  [/  \/\*\*\n   \* Pending until this runner's claims can be told from a dead runner's;\n   \* undefined from then on, so a claim made later does not yield\.\n   \*\/\n  ownerRegistration: \(\) => Promise<void> \| undefined;\n/, ''],
  [
    '  // Lease owners whose page this runner is waiting to see go.\n',
    `  let drainDueAt = 0;
  // Every owner this page has claimed under.
  const ownOwners = new Set<string>();
  // Lease owners whose page this runner is waiting to see go.
`,
  ],
  ['      if (ownerRegistration) await ownerRegistration;\n', ''],
  ['        leaseOwner: owner.claimOwner(),\n      };', '        leaseOwner: claimOwner(),\n      };'],
  ['        if (await releaseAbandonedLease(epoch, now)) {', '        if (await releaseUnroutedLease(epoch)) {'],
  [
    '  /**\n   * A page that reloads or closes mid-attempt leaves its claim on the head\n',
    `  /** The owner for a claim made now, remembered as this page's. */
  function claimOwner(): string {
    const current = owner.claimOwner();
    ownOwners.add(current);
    return current;
  }

  /**
   * Releases the head's lease when this page took it and sends nothing under
   * it: an enqueue claimed the head and its answer was lost. The head is then
   * claimable now instead of when the lease lapses. It keeps its optimism and
   * is sent again; the server makes a repeated request safe.
   */
  async function releaseUnroutedLease(epoch: StorageEpoch): Promise<boolean> {
    if (!host.inspectMutations) return false;
    const head = await inspectHeadClaim();
    if (!head || !ownOwners.has(head.lease.owner)) return false;
    // An enqueue on its way may be the one that took this lease.
    if (enqueuesInFlight > 0) return false;
    if (
      activeAttempt?.transactionId === head.transactionId &&
      activeAttempt.leaseGeneration === head.lease.generation
    )
      return false;
    if (!isCurrent(epoch)) return false;
    // Fenced by the lease itself: a head claimed again meanwhile is kept.
    await host.deferOptimisticWrite(
      head.transactionId,
      { owner: head.lease.owner, generation: head.lease.generation },
      Date.now(),
      'Lease was never routed'
    );
    telemetry.skipped('lease-unrouted');
    return true;
  }

  /**
   * A page that reloads or closes mid-attempt leaves its claim on the head
`,
  ],
  ['    epoch: () => ({ storageGeneration, leaseOwner: owner.claimOwner() }),', '    epoch: () => ({ storageGeneration, leaseOwner: claimOwner() }),'],
  ['    ownerRegistration: () => ownerRegistration,\n', ''],
]);
edit(E + 'mutation-queue-telemetry.ts', [
  ["  /** The head was leased to a runner that is gone; its lease was released. */\n  | 'lease-owner-gone'\n", ''],
]);
edit(E + 'normalized-cache-exchange.ts', [
  ['  webLockLeaseOwnerLiveness,\n', ''],
  ['        leaseOwnerLiveness: webLockLeaseOwnerLiveness(),\n', ''],
  ['        const registration = mutationQueue.ownerRegistration();\n        if (registration) await registration;\n', ''],
]);
