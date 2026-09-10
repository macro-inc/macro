import { createWorkerCacheHost } from '../../host/worker-host';

const node = document.querySelector<HTMLElement>('#result');
if (!node) throw new Error('missing result node');
const host = createWorkerCacheHost({
  scope: `notification-projection-${crypto.randomUUID()}`,
  requestTimeoutMs: 30_000,
});
const projectId = '00000000-0000-0000-0000-000000000001';
const ids = [
  '00000000-0000-0000-0000-000000000011',
  '00000000-0000-0000-0000-000000000012',
];
const nil = '00000000-0000-0000-0000-000000000000';
const snapshotQuery = `query Snapshot {
  user { id soup(input: { initial: { limit: 20 } }) { items {
    __typename id cacheProjection
    notifications { id entityId entityType state }
    ... on GraphqlSoupProject { ownerId parentId createdAt updatedAt }
  } } }
}`;
const updateQuery = `mutation Update($input: UpdateNotificationsInput!) {
  updateNotifications(input: $input) { id entityId entityType state }
}`;
const notification = (id: string, state: string) => ({
  __typename: 'GraphqlNotification',
  id,
  entityId: projectId,
  entityType: 'PROJECT',
  state,
});
const filters = (state: string) => ({
  calendarEventFilter: { literal: { id: nil } },
  documentFilter: { literal: { id: nil } },
  projectFilter: { literal: { notificationState: state } },
  chatFilter: { literal: { chatId: nil } },
  emailFilter: { tree: { literal: { threadId: nil } } },
  channelFilter: { literal: { channelId: nil } },
  channelThreadFilter: { literal: { threadId: nil } },
  callFilter: { literal: { callId: nil } },
  crmCompanyFilter: { literal: { id: nil } },
  foreignEntityFilter: { literal: { id: nil } },
});
const report: string[] = [];
async function expectCount(label: string, state: string, expected: number) {
  const result = await host.entityFilter({
    filters: filters(state),
    sortMethod: 'UPDATED_AT',
    sortDirection: 'DESC',
    limit: 20,
  });
  if (result.kind !== 'complete' || result.keys.length !== expected) {
    throw new Error(`${label}: ${JSON.stringify(result)}`);
  }
  report.push(`${label}: ${expected}`);
  if (node) node.textContent = report.join('\n');
}
const variables = (id: string, operation: string) => ({
  input: { notificationIds: [id], operation },
});
const authority = (id: string, state: string) =>
  host.writeQuery({
    query: updateQuery,
    variables: variables(id, 'MARK_DONE'),
    data: { updateNotifications: [notification(id, state)] },
  });
const seed = () =>
  host.writeQuery({
    query: snapshotQuery,
    identity: 'notification-projection-viewer',
    data: {
      user: {
        id: 'notification-projection-viewer',
        soup: {
          items: [
            {
              __typename: 'GraphqlSoupProject',
              id: projectId,
              cacheProjection: null,
              ownerId: 'macro|viewer@example.com',
              parentId: null,
              createdAt: '2025-01-01T00:00:00Z',
              updatedAt: '2025-01-02T00:00:00Z',
              notifications: ids.map((id) => notification(id, 'UNSEEN')),
            },
          ],
        },
      },
    },
  });
const markDone = (id: string) =>
  host.enqueueOptimisticMutation(
    {
      query: updateQuery,
      variables: variables(id, 'MARK_DONE'),
      uuid: crypto.randomUUID(),
      data: {
        updateNotifications: [
          { __typename: 'GraphqlNotification', id, state: 'DONE' },
        ],
      },
    },
    {
      owner: 'notification-test',
      nowMs: Date.now(),
      leaseExpiresAtMs: Date.now() + 60_000,
    }
  );

try {
  await seed();
  await expectCount('Initial unseen project', 'UNSEEN', 1);
  const first = await markDone(ids[0]);
  if (first.initialClaim.kind !== 'claimed')
    throw new Error('first mutation not claimed');
  await expectCount('One of two notifications done', 'UNSEEN', 1);
  const second = await markDone(ids[1]);
  await expectCount('Both notifications optimistically done', 'UNSEEN', 0);
  await seed();
  await expectCount('Refetch preserves both pending edits', 'UNSEEN', 0);
  await host.rollbackOptimisticWrite(
    first.transactionId,
    {
      owner: 'notification-test',
      generation: first.initialClaim.mutation.leaseGeneration,
    },
    'intentional test rollback'
  );
  await expectCount('Rollback restores only first notification', 'UNSEEN', 1);
  const claim = await host.claimNextMutation(
    'notification-test',
    Date.now(),
    Date.now() + 60_000
  );
  if (!claim) throw new Error('second mutation not claimable');
  await host.commitOptimisticWrite(
    second.transactionId,
    {
      owner: 'notification-test',
      generation: claim.leaseGeneration,
    },
    {
      query: updateQuery,
      variables: variables(ids[1], 'MARK_DONE'),
      data: { updateNotifications: [notification(ids[1], 'DONE')] },
    }
  );
  await authority(ids[0], 'SEEN');
  await expectCount(
    'Authoritative seen removes unseen membership',
    'UNSEEN',
    0
  );
  await expectCount('Authoritative seen adds seen membership', 'SEEN', 1);
  await authority(ids[0], 'DONE');
  await expectCount('Done removes last seen contribution', 'SEEN', 0);
  await authority(ids[1], 'SEEN');
  await expectCount('Reopen inserts an active contribution', 'SEEN', 1);
  await host.deleteRecords([`GraphqlNotification:${ids[1]}`]);
  await expectCount('Deletion removes active contribution', 'SEEN', 0);
  const done = await host.entityFilter({
    filters: filters('DONE'),
    sortMethod: 'UPDATED_AT',
    sortDirection: 'DESC',
    limit: 20,
  });
  if (done.kind !== 'unsupported') throw new Error('DONE must fall back');
  report.push('DONE: network-only');
  node.dataset.status = 'passed';
  node.textContent = report.join('\n');
} catch (error) {
  node.dataset.status = 'failed';
  node.textContent = `${report.join('\n')}\n${String(error)}`;
} finally {
  await host.clear();
  host.dispose();
}
