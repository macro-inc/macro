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
const unhydratedNotifications = ['DOCUMENT', 'PROJECT', 'CHAT'].map(
  (entityType, index) => ({
    ...notification(`00000000-0000-0000-0000-00000000002${index}`, 'UNSEEN'),
    entityType,
    entityId: '00000000-0000-0000-0000-000000000099',
  })
);
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
const snapshot = (
  identity = 'notification-projection-viewer',
  entityId = projectId
) => ({
  query: snapshotQuery,
  identity,
  data: {
    user: {
      id: identity,
      soup: {
        items: [
          {
            __typename: 'GraphqlSoupProject',
            id: entityId,
            cacheProjection: null,
            ownerId: 'macro|viewer@example.com',
            parentId: null,
            createdAt: '2025-01-01T00:00:00Z',
            updatedAt: '2025-01-02T00:00:00Z',
            notifications: [
              ...ids.map((id) => ({ ...notification(id, 'UNSEEN'), entityId })),
              ...unhydratedNotifications,
            ],
          },
        ],
      },
    },
  },
});
const seed = () => host.writeQuery(snapshot());
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
  await expectCount('Secondary edges preserve local filtering', 'UNSEEN', 1);
  for (const row of unhydratedNotifications) {
    await host.writeQuery({
      query: updateQuery,
      variables: variables(row.id, 'MARK_SEEN'),
      data: { updateNotifications: [{ ...row, state: 'SEEN' }] },
    });
    await expectCount(`Unhydrated ${row.entityType} inbox update`, 'UNSEEN', 1);
    const pending = await markDone(row.id);
    if (pending.initialClaim.kind !== 'claimed')
      throw new Error('unhydrated-parent mutation not claimed');
    await expectCount(`Unhydrated ${row.entityType} optimism`, 'UNSEEN', 1);
    await host.rollbackOptimisticWrite(
      pending.transactionId,
      {
        owner: 'notification-test',
        generation: pending.initialClaim.mutation.leaseGeneration,
      },
      'intentional unhydrated-parent rollback'
    );
    await host.deleteRecords([`GraphqlNotification:${row.id}`]);
    await expectCount(`Unhydrated ${row.entityType} deletion`, 'UNSEEN', 1);
  }
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
  // Reused notification IDs must not carry old-parent removals across viewers.
  // A complete snapshot establishes only the new viewer's parent projection.
  await host.writeQuery(
    snapshot('write-viewer', '00000000-0000-0000-0000-000000000002')
  );
  await expectCount(
    'Write identity switch discards old associations',
    'UNSEEN',
    1
  );
  await host.hydrateQuery(
    snapshot('hydrate-viewer', '00000000-0000-0000-0000-000000000003')
  );
  await expectCount(
    'Hydration identity switch discards old associations',
    'UNSEEN',
    1
  );
  await host.writeQuery({
    query: updateQuery,
    identity: 'id-only-viewer',
    variables: variables(ids[0], 'MARK_DONE'),
    data: {
      updateNotifications: [
        { __typename: 'GraphqlNotification', id: ids[0], state: 'DONE' },
      ],
    },
  });
  await expectCount(
    'Identity-only notification cannot inherit a parent',
    'UNSEEN',
    0
  );
  node.dataset.status = 'passed';
  node.textContent = report.join('\n');
} catch (error) {
  node.dataset.status = 'failed';
  node.textContent = `${report.join('\n')}\n${String(error)}`;
} finally {
  await host.clear();
  host.dispose();
}
