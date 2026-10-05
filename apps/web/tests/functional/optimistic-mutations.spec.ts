import { readFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { buildSchema, graphql } from 'graphql';
import type {
  RenameEntitiesMutationVariables,
  SoupInput,
  UpdateEntityPropertyOptionsMutationVariables,
} from '../../src/lib/service-clients/service-storage/graphql/generated/graphql';
import {
  ASSIGNMENT_ID,
  BLUE_TAG,
  DOCS_TAG,
  DOCUMENT_ID,
  OTHER_DOCUMENT_ID,
  soupDocument,
  tagAssignment,
} from './optimistic-mutations/data';
import type {} from './optimistic-mutations/fixture';

const schema = buildSchema(
  readFileSync(
    new URL('../../../../static_assets/schema.graphql', import.meta.url),
    'utf8'
  )
);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

type Outcome =
  | 'commit'
  | 'reject'
  | 'disconnect'
  | { canonical: string[]; assignmentId?: string };
type CacheMode = 'cached' | 'disabled' | 'retired';

/** Real GraphQL documents and schema; only server state and response timing are controlled. */
async function mount(page: Page, mode: CacheMode, initial?: string[]) {
  const origin = test.info().project.use.baseURL;
  let properties = initial ? [tagAssignment(initial)] : [];
  let name = 'Task under test';
  const mutations: Array<{
    reply: (outcome: Outcome) => void;
  }> = [];
  const delayedQueries: Array<() => void> = [];
  const reads: string[] = [];
  let delayNextQuery = false;
  const unexpected: string[] = [];
  page.on('pageerror', (error) => unexpected.push(error.message));
  await page.routeWebSocket('**', (socket) => socket.close());
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      await route.abort();
      return;
    }
    if (
      /^\/(auth|cognition|contacts|dss|email|notification|connection-gateway)\//.test(
        url.pathname
      )
    ) {
      await route.fulfill({ json: {} });
      return;
    }
    // Serve Vite assets through the runner as well. Host interface changes
    // must not abort Chromium module loads before the test starts.
    await route.fulfill({ response: await route.fetch() });
  });
  await page.route('**/dss/items/soup/graphql', async (route) => {
    const request = route.request().postDataJSON() as {
      query: string;
      operationName: string;
      variables: Record<string, unknown>;
    };
    if (!request.query.includes('mutation ')) reads.push(request.operationName);
    let outcome: Outcome = 'commit';
    if (
      ['UpdateEntityPropertyOptions', 'RenameEntities'].includes(
        request.operationName
      )
    ) {
      const response = deferred<Outcome>();
      mutations.push({ reply: response.resolve });
      outcome = await response.promise;
      if (outcome === 'disconnect') {
        await route.abort('connectionreset');
        return;
      }
      if (outcome === 'reject') {
        await route.fulfill({
          json: {
            errors: [
              { message: 'Edit forbidden', extensions: { code: 'FORBIDDEN' } },
            ],
          },
        });
        return;
      }
    }
    const snapshot = structuredClone(properties);
    const items = [
      { ...soupDocument(DOCUMENT_ID, snapshot), name, displayName: name },
      soupDocument(OTHER_DOCUMENT_ID, []),
    ];
    const rootValue = {
      user: {
        id: 'functional-viewer',
        emailLinks: [],
        soup: ({ input }: { input: SoupInput }) => ({
          items: items.filter(
            ({ id }) =>
              !input.initial?.filters?.documentFilter?.literal?.id ||
              input.initial.filters.documentFilter.literal.id === id
          ),
          nextCursor: null,
        }),
        groupSoup: {
          bins: [
            { key: '', totalCount: items.length, items, nextCursor: null },
          ],
        },
      },
      updateEntityPropertyOptions: ({
        input,
      }: UpdateEntityPropertyOptionsMutationVariables) => {
        const ids = new Set(
          properties[0]?.value?.__typename ===
            'GraphqlSelectOptionPropertyValue'
            ? properties[0].value.optionIds
            : []
        );
        for (const change of input.properties) {
          for (const id of change.addOptionIds) ids.add(String(id));
          for (const id of change.removeOptionIds) ids.delete(String(id));
        }
        properties = [
          {
            ...tagAssignment(
              typeof outcome === 'object' ? outcome.canonical : [...ids]
            ),
            id:
              (typeof outcome === 'object'
                ? outcome.assignmentId
                : undefined) ??
              properties[0]?.id ??
              ASSIGNMENT_ID,
          },
        ];
        return properties;
      },
      renameEntities: ({ inputs }: RenameEntitiesMutationVariables) => {
        const input = Array.isArray(inputs) ? inputs[0] : inputs;
        name = input.displayName;
        return {
          results: [
            {
              __typename: 'GraphqlMutationSuccess',
              effects: [
                {
                  __typename: 'SoupUpdated',
                  item: {
                    ...soupDocument(DOCUMENT_ID, properties),
                    name,
                    displayName: name,
                  },
                },
              ],
            },
          ],
        };
      },
    };
    const result = await graphql({
      schema,
      source: request.query,
      rootValue,
      variableValues: request.variables,
      operationName: request.operationName,
    });
    if (result.errors)
      unexpected.push(...result.errors.map(({ message }) => message));
    if (delayNextQuery && request.operationName === 'EntityProperties') {
      delayNextQuery = false;
      const gate = deferred<void>();
      delayedQueries.push(() => gate.resolve());
      await gate.promise;
    }
    await route.fulfill({ json: result });
  });
  await page.goto(
    `/tests/functional/optimistic-mutations/index.html?cache=${mode}`
  );
  await expect(page.getByTestId('ready')).toHaveText('ready');
  expect(unexpected).toEqual([]);
  expect(await page.evaluate(() => window.optimisticMutations.hasCache())).toBe(
    mode !== 'disabled'
  );
  if (mode === 'retired') {
    await page.evaluate(() => window.optimisticMutations.retireCache());
    expect(
      await page.evaluate(() => window.optimisticMutations.hasCache())
    ).toBe(false);
  }
  return {
    mutations,
    reads,
    unexpected,
    delayRead: () => {
      delayNextQuery = true;
    },
    delayedQueries,
    persisted: () => properties,
  };
}

for (const outcome of ['commit', 'reject'] as const) {
  test(`a local rename resolver changes only the subscribed field and ${outcome}s correctly`, async ({
    page,
  }) => {
    const server = await mount(page, 'cached', [DOCS_TAG]);
    await expect(page.getByTestId('name')).toHaveText('Task under test');
    const before = await page.evaluate(() => window.optimisticMutations.read());
    await page
      .getByRole('button', { name: 'Rename task', exact: true })
      .click();
    await expect(page.getByTestId('name')).toHaveText('Renamed task');
    await expectTags(page, ['docs']);
    await expect.poll(() => server.mutations.length).toBe(1);
    expect(
      await page.evaluate(
        () => window.optimisticMutations.read().unrelatedReads
      )
    ).toBe(before.unrelatedReads);
    server.mutations[0].reply(outcome);
    await expectSettled(
      page,
      outcome === 'commit' ? 1 : 0,
      outcome === 'reject' ? 1 : 0
    );
    await expect(page.getByTestId('name')).toHaveText(
      outcome === 'commit' ? 'Renamed task' : 'Task under test'
    );
    await expectTags(page, ['docs']);
    expect(
      await page.evaluate(
        () => window.optimisticMutations.read().unrelatedReads
      )
    ).toBe(before.unrelatedReads);
    expect(server.unexpected).toEqual([]);
  });
}

async function expectTags(page: Page, tags: string[]) {
  const text = [...tags].sort().join(',');
  await expect(page.getByTestId('detail')).toHaveText(text);
  await expect(page.getByTestId('list')).toHaveText(text);
  await expect(page.getByTestId('grouped')).toHaveText(text);
  if (await page.getByTestId('mirror').count())
    await expect(page.getByTestId('mirror')).toHaveText(text);
}

async function expectSettled(page: Page, completed: number, failures = 0) {
  await expect
    .poll(() => page.evaluate(() => window.optimisticMutations.read()))
    .toMatchObject({
      pending: false,
      overlay: false,
      completed,
      failures,
    });
}

async function expectNoDisappearance(page: Page, tag: string) {
  const trace = await page.evaluate(() => window.optimisticMutations.trace());
  for (const view of ['detail', 'list', 'grouped'] as const) {
    const start = trace.findIndex((value) => value[view].includes(tag));
    expect(start).toBeGreaterThanOrEqual(0);
    expect(
      trace.slice(start).every((value) => value[view].includes(tag)),
      `${view}: ${JSON.stringify(trace)}`
    ).toBe(true);
  }
}

for (const mode of ['cached', 'disabled', 'retired'] as const) {
  test.describe(mode, () => {
    test('a first tag is immediate in every subscriber and remains after success', async ({
      page,
    }) => {
      const server = await mount(page, mode);
      await expectTags(page, []);
      await page.getByRole('button', { name: 'Add docs', exact: true }).click();
      await expectTags(page, ['docs']);
      await expect.poll(() => server.mutations.length).toBe(1);
      expect(
        await page.evaluate(() => window.optimisticMutations.read())
      ).toMatchObject({ pending: true, overlay: true });
      if (mode === 'cached') {
        await expect
          .poll(() =>
            page.evaluate(() => window.optimisticMutations.read().raw)
          )
          .toEqual([DOCS_TAG]);
      }
      server.mutations[0].reply('commit');
      await expectSettled(page, 1);
      await expectTags(page, ['docs']);
      expect(
        await page.evaluate(() => window.optimisticMutations.read().assignments)
      ).toEqual([ASSIGNMENT_ID]);
      await expectNoDisappearance(page, 'docs');
      expect(server.unexpected).toEqual([]);
    });

    test('removing and re-adding a saved tag preserves assignment identity', async ({
      page,
    }) => {
      const server = await mount(page, mode, [DOCS_TAG]);
      await expectTags(page, ['docs']);
      await page
        .getByRole('button', { name: 'Remove docs', exact: true })
        .click();
      await expectTags(page, []);
      await expect.poll(() => server.mutations.length).toBe(1);
      server.mutations[0].reply('commit');
      await expectSettled(page, 1);
      await expectTags(page, []);
      await page.evaluate(() => window.optimisticMutations.clearTrace());
      await page.getByRole('button', { name: 'Add docs', exact: true }).click();
      await expectTags(page, ['docs']);
      await expect.poll(() => server.mutations.length).toBe(2);
      server.mutations[1].reply('commit');
      await expectSettled(page, 2);
      await expectTags(page, ['docs']);
      expect(
        await page.evaluate(() => window.optimisticMutations.read().assignments)
      ).toEqual([ASSIGNMENT_ID]);
      await expectNoDisappearance(page, 'docs');
      expect(server.unexpected).toEqual([]);
    });

    test('a rejected edit rolls every subscriber back to the previous saved selection', async ({
      page,
    }) => {
      const server = await mount(page, mode, [DOCS_TAG]);
      await page.getByRole('button', { name: 'Add blue', exact: true }).click();
      await expectTags(page, ['docs', 'blue']);
      await expect.poll(() => server.mutations.length).toBe(1);
      server.mutations[0].reply('reject');
      await expectSettled(page, 0, 1);
      await expectTags(page, ['docs']);
      expect(server.persisted()).toEqual([tagAssignment([DOCS_TAG])]);
      expect(server.unexpected).toEqual([]);
    });

    test('a recreated assignment replaces the cached relation when its save commits', async ({
      page,
    }) => {
      const server = await mount(page, mode, []);
      if (mode === 'cached')
        await page.evaluate(() =>
          window.optimisticMutations.delayCacheReads(250)
        );
      const recreatedId = '00000000-0000-4000-8000-000000000007';
      const readsBefore = [...server.reads];
      await page.getByRole('button', { name: 'Add docs', exact: true }).click();
      await expectTags(page, ['docs']);
      await expect.poll(() => server.mutations.length).toBe(1);
      server.mutations[0].reply({
        canonical: [DOCS_TAG],
        assignmentId: recreatedId,
      });
      await expectSettled(page, 1);
      await expectTags(page, ['docs']);
      expect(
        await page.evaluate(() => window.optimisticMutations.read().assignments)
      ).toEqual([recreatedId]);
      await expectNoDisappearance(page, 'docs');
      if (mode === 'cached') expect(server.reads).toEqual(readsBefore);
      expect(server.unexpected).toEqual([]);
    });

    test('the server can reconcile an optimistic selection to a different canonical value', async ({
      page,
    }) => {
      const server = await mount(page, mode);
      await page.getByRole('button', { name: 'Add docs', exact: true }).click();
      await expectTags(page, ['docs']);
      await expect.poll(() => server.mutations.length).toBe(1);
      server.mutations[0].reply({ canonical: [DOCS_TAG, BLUE_TAG] });
      await expectSettled(page, 1);
      await expectTags(page, ['docs', 'blue']);
      await expectNoDisappearance(page, 'docs');
      expect(server.unexpected).toEqual([]);
    });

    test('an older save cannot erase a newer pending edit', async ({
      page,
    }) => {
      const server = await mount(page, mode);
      await page.getByRole('button', { name: 'Add docs', exact: true }).click();
      await expectTags(page, ['docs']);
      await expect.poll(() => server.mutations.length).toBe(1);
      await page.getByRole('button', { name: 'Add blue', exact: true }).click();
      await expectTags(page, ['docs', 'blue']);
      expect(server.mutations).toHaveLength(1);
      server.mutations[0].reply('commit');
      await expect.poll(() => server.mutations.length).toBe(2);
      await expectTags(page, ['docs', 'blue']);
      server.mutations[1].reply('commit');
      await expectSettled(page, 2);
      await expectTags(page, ['docs', 'blue']);
      await expectNoDisappearance(page, 'blue');
      expect(server.unexpected).toEqual([]);
    });

    test('a subscriber can unmount during a save and remount with its committed value', async ({
      page,
    }) => {
      const server = await mount(page, mode);
      await page.getByRole('button', { name: 'Add docs', exact: true }).click();
      await expectTags(page, ['docs']);
      await page.getByRole('button', { name: 'Toggle subscriber' }).click();
      await expect(page.getByTestId('mirror')).toHaveCount(0);
      await expect.poll(() => server.mutations.length).toBe(1);
      server.mutations[0].reply('commit');
      await expectSettled(page, 1);
      await page.getByRole('button', { name: 'Toggle subscriber' }).click();
      await expect(page.getByTestId('mirror')).toHaveText('docs');
      await expectTags(page, ['docs']);
      expect(server.unexpected).toEqual([]);
    });
  });
}

for (const firstAssignment of [false, true]) {
  for (const stage of ['enqueue', 'commit'] as const) {
    test(`an incomplete property relation at ${stage} recovers before caller optimism clears (first=${firstAssignment})`, async ({
      page,
    }) => {
      const server = await mount(
        page,
        'cached',
        firstAssignment ? undefined : []
      );
      await page.evaluate(() =>
        window.optimisticMutations.delayCacheReads(250)
      );
      const readsBefore = server.reads.length;
      if (stage === 'enqueue')
        await page.evaluate(() =>
          window.optimisticMutations.addIncompletePropertyLink()
        );
      await page.getByRole('button', { name: 'Add docs', exact: true }).click();
      await expectTags(page, ['docs']);
      await expect.poll(() => server.mutations.length).toBe(1);
      if (stage === 'commit')
        await page.evaluate(() =>
          window.optimisticMutations.addIncompletePropertyLink()
        );
      server.mutations[0].reply({
        canonical: [DOCS_TAG],
        assignmentId: '00000000-0000-4000-8000-000000000007',
      });
      await expectSettled(page, 1);
      await expectTags(page, ['docs']);
      await expectNoDisappearance(page, 'docs');
      // Incomplete mounted queries may also refetch while the targeted repair
      // restores the parent; healthy commits above require no extra reads.
      expect(server.reads.slice(readsBefore)).toContain('EntityProperties');
      expect(server.unexpected).toEqual([]);
    });
  }
}

test('an offline queued mutation stays visible after the caller settles and commits on retry', async ({
  page,
}) => {
  const server = await mount(page, 'cached');
  await page.getByRole('button', { name: 'Add docs', exact: true }).click();
  await expectTags(page, ['docs']);
  await expect.poll(() => server.mutations.length).toBe(1);
  server.mutations[0].reply('disconnect');
  await expectSettled(page, 1);
  await expectTags(page, ['docs']);
  await expect.poll(() => server.mutations.length).toBe(2);
  server.mutations[1].reply('commit');
  await expect
    .poll(() =>
      page.evaluate(() => window.optimisticMutations.read().assignments)
    )
    .toEqual([ASSIGNMENT_ID]);
  await expectTags(page, ['docs']);
  await expectNoDisappearance(page, 'docs');
  expect(server.unexpected).toEqual([]);
});

for (const mode of ['cached', 'disabled'] as const) {
  test(`${mode}: a read started before the save cannot undo its committed selection`, async ({
    page,
  }) => {
    const server = await mount(page, mode, []);
    server.delayRead();
    await page.evaluate(() => {
      void window.optimisticMutations.refetch();
    });
    await expect.poll(() => server.delayedQueries.length).toBe(1);
    await page.getByRole('button', { name: 'Add docs', exact: true }).click();
    await expectTags(page, ['docs']);
    await expect.poll(() => server.mutations.length).toBe(1);
    server.mutations[0].reply('commit');
    await expectSettled(page, 1);
    server.delayedQueries[0]();
    await page.evaluate(() => window.optimisticMutations.waitForRead());
    await expect
      .poll(() => page.evaluate(() => window.optimisticMutations.read().raw))
      .toEqual([DOCS_TAG]);
    await expectTags(page, ['docs']);
    await expectNoDisappearance(page, 'docs');
    expect(server.unexpected).toEqual([]);
  });
}
