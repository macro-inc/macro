import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

test('server-confirmed invitations survive missing cache metadata and confirmed archives still leave Inbox', async ({
  page,
}) => {
  const scope = `mail-membership-${crypto.randomUUID()}`;
  await page.goto(`/mail-projection.html?scope=${scope}`);
  await expect(page.locator('#result')).toHaveAttribute(
    'data-status',
    'ready',
    { timeout: 60_000 }
  );
  const result = await page.evaluate(
    async ({ scope, modulePath }) => {
      const { createWorkerCacheHost } = (await import(
        modulePath
      )) as typeof import('../../host/worker-host');
      const host = createWorkerCacheHost({ scope });
      const id = (n: number) =>
        `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`;
      const key = (n: number) => `GraphqlSoupEmailThread:${id(n)}`;
      const query = `query MailUpdate { user { id soup(input:{initial:{limit:100,emailView:INBOX}}) { items { __typename id ... on GraphqlSoupEmailThread { inboxVisible isRead } } } } }`;
      const write = (n: number, inboxVisible: boolean) =>
        host.writeQuery({
          query,
          identity: 'offline-mail-viewer',
          data: {
            user: {
              id: 'offline-mail-viewer',
              soup: {
                items: [
                  {
                    __typename: 'GraphqlSoupEmailThread',
                    id: id(n),
                    inboxVisible,
                    isRead: false,
                  },
                ],
              },
            },
          },
        });
      const filters = Object.fromEntries(
        [
          ['documentFilter', 'id'],
          ['projectFilter', 'projectIdSelf'],
          ['chatFilter', 'chatId'],
          ['calendarEventFilter', 'id'],
          ['channelFilter', 'channelId'],
          ['channelThreadFilter', 'threadId'],
          ['callFilter', 'callId'],
          ['crmCompanyFilter', 'id'],
          ['foreignEntityFilter', 'id'],
        ].map(([field, literal]) => [field, { literal: { [literal]: id(0) } }])
      );
      try {
        await write(76, true);
        const baseline = [76, 60].map((n) => ({
          key: key(n),
          sortTimestamp: '2026-01-01T00:00:00Z',
        }));
        const read = () =>
          host.entityFilter({
            filters,
            sortMethod: 'UPDATED_AT',
            sortDirection: 'DESC',
            limit: 10,
            baseline,
            mail: { view: 'INBOX' },
          });
        const before = await read();
        // Unrelated cache revisions used to replace the server list with a partial local page.
        await write(50, true);
        const refreshed = await read();
        await write(60, false);
        const archived = await read();
        if (
          before.kind !== 'mail-page' ||
          refreshed.kind !== 'mail-page' ||
          archived.kind !== 'mail-page'
        )
          throw new Error('expected cached Mail pages');
        return {
          retained: before.retainedKeys,
          visibleBefore: before.keys.includes(key(76)),
          visibleAfterRefresh: refreshed.keys.includes(key(76)),
          visibleAfterArchive: archived.keys.includes(key(76)),
          archivedRemoved: !archived.keys.includes(key(60)),
          inviteKey: key(76),
        };
      } finally {
        host.dispose();
      }
    },
    {
      scope,
      modulePath: `/@fs${fileURLToPath(new URL('../../host/worker-host.ts', import.meta.url))}`,
    }
  );
  expect(result).toEqual({
    retained: [result.inviteKey],
    visibleBefore: true,
    visibleAfterRefresh: true,
    visibleAfterArchive: true,
    archivedRemoved: true,
    inviteKey: result.inviteKey,
  });
});

test('delivered reminders immediately lead cached Signal, including sent-only threads', async ({
  page,
}) => {
  await page.goto('/mail-projection.html');
  await expect(page.locator('#result')).toHaveAttribute(
    'data-status',
    'ready',
    {
      timeout: 60_000,
    }
  );
  await page
    .getByRole('combobox', { name: 'View', exact: true })
    .selectOption('INBOX');
  await page
    .getByRole('combobox', { name: 'Signal', exact: true })
    .selectOption('true');
  await expect(page.locator('#rows li').first()).not.toHaveText(
    'Email 4 — Not Done'
  );
  await page.getByRole('button', { name: 'Deliver reminders' }).click();
  await expect(page.locator('#rows li').nth(0)).toHaveText(
    'Email 4 — Not Done'
  );
  await expect(page.locator('#rows li').nth(1)).toHaveText(
    'Email 2 — Not Done'
  );
});

test('invalid identity binding preserves the server response and completes the mutation', async ({
  page,
}) => {
  await page.goto('/mail-projection.html');
  await expect(page.locator('#result')).toHaveAttribute(
    'data-status',
    'ready',
    {
      timeout: 60_000,
    }
  );
  const result = await page.evaluate(
    async (modulePath) => {
      const { createWorkerCacheHost } = (await import(
        modulePath
      )) as typeof import('../../host/worker-host');
      const host = createWorkerCacheHost({
        scope: `invalid-identity-${crypto.randomUUID()}`,
      });
      const settlements: unknown[] = [];
      host.onMutationSettled((settlement) => settlements.push(settlement));
      try {
        const query =
          'mutation Save { saved: setEntityProperty { __typename id displayName } }';
        const nowMs = Date.now();
        const enqueued = await host.enqueueOptimisticMutation(
          {
            uuid: crypto.randomUUID(),
            query,
            data: {
              saved: {
                __typename: 'GraphqlProperty',
                id: 'local',
                displayName: 'pending',
              },
            },
            identityBindings: [
              {
                localKey: 'GraphqlProperty:local',
                responsePath: ['setEntityProperty'],
              },
            ],
          },
          { owner: 'identity-test', nowMs, leaseExpiresAtMs: nowMs + 1000 }
        );
        if (enqueued.initialClaim.kind !== 'claimed')
          throw new Error('expected claim');
        const outcome = await host.commitOptimisticWrite(
          enqueued.transactionId,
          {
            owner: 'identity-test',
            generation: enqueued.initialClaim.mutation.leaseGeneration,
          },
          {
            query,
            data: {
              saved: {
                __typename: 'GraphqlProperty',
                id: 'server',
                displayName: 'confirmed',
              },
            },
          }
        );
        const next = await host.claimNextMutation(
          'after-lease',
          nowMs + 2000,
          nowMs + 3000
        );
        const records = await host.readRecordsByKeys({
          document: 'fragment Property on GraphqlProperty { id displayName }',
          fragmentName: 'Property',
          keys: ['GraphqlProperty:server', 'GraphqlProperty:local'],
        });
        return { outcome, next, settlements, records };
      } finally {
        host.dispose();
      }
    },
    `/@fs${fileURLToPath(new URL('../../host/worker-host.ts', import.meta.url))}`
  );
  expect(result.outcome).toMatchObject({
    kind: 'committed',
    identityErrors: ['missing identity response object'],
  });
  expect(result.next).toBeNull();
  expect(result.settlements).toEqual([
    expect.objectContaining({
      status: 'committed',
    }),
  ]);
  expect(result.records.records).toEqual([
    expect.objectContaining({
      recordKey: 'GraphqlProperty:server',
      record: { id: 'server', displayName: 'confirmed' },
    }),
  ]);
});

test('a superseded offline create recovers its server identity after reload and unblocks the newer save', async ({
  page,
  context,
}) => {
  await page.goto(`/mail-projection.html?scope=draft-recovery-${Date.now()}`);
  await expect(page.locator('#result')).toHaveAttribute(
    'data-status',
    'ready',
    { timeout: 60_000 }
  );
  await context.setOffline(true);
  for (let i = 0; i < 2; i++) {
    await page.locator('#draft-status').evaluate((element) => {
      element.textContent = '';
    });
    await page.getByRole('button', { name: 'Create offline draft' }).click();
    await expect(page.locator('#draft-status')).toHaveText('Draft queued');
  }
  await context.setOffline(false);
  await page.reload();
  await expect(page.locator('#result')).toHaveAttribute(
    'data-status',
    'ready',
    { timeout: 60_000 }
  );
  await page.getByRole('button', { name: 'Resume draft sync' }).click();
  await expect(page.locator('#draft-status')).toHaveText(
    'Draft synced after reload; latest edit and server identity confirmed',
    { timeout: 20_000 }
  );
});

test('server-null threads and committed draft deletes leave records and Mail views', async ({
  page,
}) => {
  await page.goto('/mail-projection.html');
  await expect(page.locator('#result')).toHaveAttribute(
    'data-status',
    'ready',
    { timeout: 60_000 }
  );
  await page
    .getByRole('button', { name: 'Check deleted thread cleanup' })
    .click();
  await expect(page.locator('#draft-status')).toHaveText(
    'Deleted threads absent from records and Mail views'
  );
});

test('a new offline draft reaches Drafts and reopens through another cache client', async ({
  page,
  context,
}) => {
  await page.goto('/mail-projection.html');
  await expect(page.locator('#result')).toHaveAttribute(
    'data-status',
    'ready',
    { timeout: 60_000 }
  );
  await context.setOffline(true);
  try {
    await page
      .getByRole('combobox', { name: 'View', exact: true })
      .selectOption('DRAFTS');
    await page.getByRole('button', { name: 'Create offline draft' }).click();
    await expect(page.locator('#draft-status')).toHaveText('Draft queued');
    await expect(page.locator('#rows li').first()).toHaveText(
      'Offline standalone — Not Done'
    );
    await page.getByRole('button', { name: 'Reopen cached draft' }).click();
    await expect(page.locator('#draft-status')).toContainText(
      'Saved on this device'
    );
    await expect(page.locator('#draft-status')).toContainText(
      'recipient@example.com'
    );
    await expect(page.locator('#draft-status')).toContainText('"pending":true');
    await expect(page.locator('#rows li').first()).toHaveText(
      'Offline standalone — Not Done'
    );
  } finally {
    await context.setOffline(false);
  }
});

test('new Mail filter combinations and pagination work offline without bodies or server baselines', async ({
  page,
  context,
}) => {
  await page.goto('/mail-projection.html');
  await expect(page.locator('#result')).toHaveAttribute(
    'data-status',
    'ready',
    { timeout: 60_000 }
  );
  await expect(page.locator('#rows li')).toHaveCount(10);
  await context.setOffline(true);
  try {
    for (const count of [20, 30, 40, 50, 60, 69]) {
      await page.getByRole('button', { name: 'Load more cached mail' }).click();
      await expect(page.locator('#rows li')).toHaveCount(count);
    }
    await expect(
      page.getByRole('button', { name: 'Load more cached mail' })
    ).toBeDisabled();
    await page
      .getByRole('combobox', { name: 'View', exact: true })
      .selectOption('INBOX');
    await page
      .getByRole('combobox', { name: 'Signal', exact: true })
      .selectOption('true');
    await page
      .getByRole('combobox', { name: 'Account', exact: true })
      .selectOption('1001');
    await expect(page.locator('#rows li')).toHaveCount(3);
    await page
      .getByRole('combobox', { name: 'Status', exact: true })
      .selectOption('false');
    await expect(page.locator('#rows li')).toHaveCount(0);
    await page
      .getByRole('combobox', { name: 'View', exact: true })
      .selectOption('ALL');
    await expect(page.locator('#rows li')).toHaveCount(4);
    await expect(page.locator('#rows li')).toHaveText([
      / — Done$/,
      / — Done$/,
      / — Done$/,
      / — Done$/,
    ]);
    await page
      .getByRole('combobox', { name: 'Read', exact: true })
      .selectOption('true');
    await expect(page.locator('#rows li')).toHaveCount(0);
    await page
      .getByRole('combobox', { name: 'Read', exact: true })
      .selectOption('false');
    await expect(page.locator('#rows li')).toHaveCount(4);
  } finally {
    await context.setOffline(false);
  }
});

test('retained mail applies optimistic flags, rollback and committed actions without hydration', async ({
  page,
}) => {
  const scope = `retained-actions-${crypto.randomUUID()}`;
  await page.goto(`/mail-projection.html?scope=${scope}`);
  await expect(page.locator('#result')).toHaveAttribute(
    'data-status',
    'ready',
    { timeout: 60_000 }
  );
  const result = await page.evaluate(
    async ({ scope, hostPath, readerPath, selectionPath, documentsPath }) => {
      const { createWorkerCacheHost } = (await import(
        hostPath
      )) as typeof import('../../host/worker-host');
      const { readSoupPage } = (await import(
        readerPath
      )) as typeof import('../../../queries/soup/graphql/read-soup-page');
      const { selectRecords } = (await import(
        selectionPath
      )) as typeof import('../../exchange/record-selection');
      const { MailItemFieldsFragmentDoc } = (await import(
        documentsPath
      )) as typeof import('../../../service-clients/service-storage/graphql/generated/graphql');
      const host = createWorkerCacheHost({ scope });
      const id = '00000000-0000-0000-0000-000000000076';
      const key = `GraphqlSoupEmailThread:${id}`;
      const snapshot: Extract<
        import('../../../service-clients/service-storage/graphql-soup').GraphqlSoupItem,
        { __typename: 'GraphqlSoupEmailThread' }
      > = {
        __typename: 'GraphqlSoupEmailThread',
        id,
        entityType: 'EMAIL_THREAD',
        displayName: 'Invitation',
        emailName: 'Invitation',
        providerId: null,
        ownerId: 'offline-mail-viewer',
        linkId: '00000000-0000-0000-0000-000000001000',
        inboxVisible: true,
        isRead: false,
        isSignal: false,
        isImportant: false,
        isDraft: false,
        isFavorited: false,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
        viewedAt: null,
        latestInboundMessageTs: '2026-01-01T00:00:00Z',
        latestOutboundMessageTs: null,
        latestNonSpamMessageTs: null,
        reminderReturnedAt: null,
        projectId: null,
        cacheProjection: null,
        frecencyScore: null,
        snippet: 'Fetched preview',
        senderEmail: null,
        senderName: null,
        senderPhotoUrl: null,
        notifications: [],
        participants: [],
        attachments: [],
        labels: [],
        properties: [],
        mailDraftState: null,
        mailAllPreview: null,
        mailDraftPreview: null,
        mailSentPreview: null,
      };
      const filters = Object.fromEntries(
        [
          ['documentFilter', 'id'],
          ['projectFilter', 'projectIdSelf'],
          ['chatFilter', 'chatId'],
          ['calendarEventFilter', 'id'],
          ['channelFilter', 'channelId'],
          ['channelThreadFilter', 'threadId'],
          ['callFilter', 'callId'],
          ['crmCompanyFilter', 'id'],
          ['foreignEntityFilter', 'id'],
        ].map(([field, literal]) => [
          field,
          { literal: { [literal]: '00000000-0000-0000-0000-000000000000' } },
        ])
      );
      const read = async (unread = false) => {
        const page = await host.entityFilter({
          filters: {
            ...filters,
            ...(unread
              ? { emailFilter: { tree: { literal: { read: false } } } }
              : {}),
          },
          sortMethod: 'UPDATED_AT',
          sortDirection: 'DESC',
          limit: 10,
          mail: { view: 'INBOX' },
          baseline: [{ key, sortTimestamp: snapshot.createdAt }],
        });
        if (page.kind !== 'mail-page') throw new Error('expected Mail page');
        const selected = await readSoupPage(host, {
          page,
          select: selectRecords(MailItemFieldsFragmentDoc),
          baseline: [snapshot],
          mailView: 'INBOX',
        });
        if (selected.kind !== 'ready')
          throw new Error('expected coherent row selection');
        const row = selected.records.find((row) => row.id === id);
        return {
          present: page.keys.includes(key),
          isRead:
            row?.__typename === 'GraphqlSoupEmailThread' ? row.isRead : null,
          preview:
            row?.__typename === 'GraphqlSoupEmailThread' ? row.emailName : null,
        };
      };
      const update = async (
        field: 'inboxVisible' | 'isRead',
        value: boolean,
        rollback = false
      ) => {
        const mutation =
          field === 'inboxVisible'
            ? 'setEmailThreadArchived'
            : 'markEmailThreadSeen';
        const query = `mutation Change { ${mutation} { __typename id ${field} } }`;
        const data = {
          [mutation]: {
            __typename: 'GraphqlSoupEmailThread',
            id,
            [field]: value,
          },
        };
        const nowMs = Date.now();
        const queued = await host.enqueueOptimisticMutation(
          { uuid: crypto.randomUUID(), query, data },
          { owner: 'test', nowMs, leaseExpiresAtMs: nowMs + 60_000 }
        );
        if (queued.initialClaim.kind !== 'claimed')
          throw new Error('expected mutation claim');
        const optimistic = await read();
        const token = {
          owner: 'test',
          generation: queued.initialClaim.mutation.leaseGeneration,
        };
        if (rollback)
          await host.rollbackOptimisticWrite(
            queued.transactionId,
            token,
            'rejected'
          );
        else
          await host.commitOptimisticWrite(queued.transactionId, token, {
            query,
            data,
          });
        return { optimistic, settled: await read() };
      };
      try {
        await host.writeQuery({
          query:
            'query Partial { user { id soup(input:{initial:{limit:1,emailView:INBOX}}) { items { __typename id ... on GraphqlSoupEmailThread { inboxVisible isRead } } } } }',
          identity: 'offline-mail-viewer',
          data: {
            user: {
              id: 'offline-mail-viewer',
              soup: {
                items: [
                  {
                    __typename: 'GraphqlSoupEmailThread',
                    id,
                    inboxVisible: true,
                    isRead: false,
                  },
                ],
              },
            },
          },
        });
        return {
          initial: await read(),
          read: await update('isRead', true),
          unread: await read(true),
          rollback: await update('inboxVisible', false, true),
          archive: await update('inboxVisible', false),
          undo: await update('inboxVisible', true),
        };
      } finally {
        host.dispose();
      }
    },
    {
      scope,
      hostPath: `/@fs${fileURLToPath(new URL('../../host/worker-host.ts', import.meta.url))}`,
      readerPath: `/@fs${fileURLToPath(new URL('../../../queries/soup/graphql/read-soup-page.ts', import.meta.url))}`,
      selectionPath: `/@fs${fileURLToPath(new URL('../../exchange/record-selection.ts', import.meta.url))}`,
      documentsPath: `/@fs${fileURLToPath(new URL('../../../service-clients/service-storage/graphql/generated/graphql.ts', import.meta.url))}`,
    }
  );
  expect(result.initial).toEqual({
    present: true,
    isRead: false,
    preview: 'Invitation',
  });
  expect(result.read.optimistic).toEqual({
    present: true,
    isRead: true,
    preview: 'Invitation',
  });
  expect(result.read.settled).toEqual(result.read.optimistic);
  expect(result.unread.present).toBe(false);
  expect(result.rollback.optimistic.present).toBe(false);
  expect(result.rollback.settled).toEqual(result.read.settled);
  expect(result.archive.optimistic.present).toBe(false);
  expect(result.archive.settled.present).toBe(false);
  expect(result.undo.optimistic).toEqual(result.read.settled);
  expect(result.undo.settled).toEqual(result.read.settled);
});
