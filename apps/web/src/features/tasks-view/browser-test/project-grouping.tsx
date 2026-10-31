// Production grouping and headers over synthetic tasks; only HTTP is replaced.
import '@app/index.css';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { enableGraphqlSoup, enableProjects } from '@core/constant/featureFlags';
import { UserContextProvider } from '@core/context/user';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { authKeys } from '@queries/auth/keys';
import { queryClient } from '@queries/client';
import { localSoupGroupKeys } from '@queries/soup/graphql/grouped-local-projection';
import { groupedDocument } from '@queries/soup/graphql/grouped-test-fixtures';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { TaskGroupHeader } from '../components/task-list/TaskGroupHeader';

enableProjects.override = true;
enableGraphqlSoup.override = false;
const VIEWER_ID = 'macro|project-grouping@example.test';
const PROJECT_ONE = 'ad000000-0000-0000-0000-000000000001';
const PROJECT_TWO = 'ad000000-0000-0000-0000-000000000002';
const PROJECTS = new Map([
  [PROJECT_ONE, 'Project One'],
  [PROJECT_TWO, 'Project Two'],
]);
queryClient.setQueryData(authKeys.userInfo.queryKey, {
  id: VIEWER_ID,
  email: 'project-grouping@example.test',
  authenticated: true,
});
// The grouped page names Project Two; only Project One, still labeled by its
// key, resolves its name through an identity read.
window.fetch = async (_input, init) => {
  const body = JSON.parse(String(init?.body ?? '{}'));
  const id = body.variables?.initiativeId;
  if (id === PROJECT_ONE) {
    return Response.json({
      data: {
        user: {
          id: VIEWER_ID,
          initiative: {
            __typename: 'GraphqlSoupInitiative',
            id,
            displayName: PROJECTS.get(id),
            viewerPermission: {
              __typename: 'GraphqlAccessLevelPermission',
              accessLevel: 'OWNER',
            },
          },
        },
      },
    });
  }
  return Response.json({});
};

function Fixture() {
  const [cleared, setCleared] = createSignal(false);
  const [collapsed, setCollapsed] = createSignal(new Set<string>());
  const tasks = createMemo(() =>
    ['Task One', 'Task Two', 'Task Without Project'].map((name, index) => {
      const item = groupedDocument(name);
      const projectId = [...PROJECTS.keys()][index];
      item.properties =
        projectId && !(index === 0 && cleared())
          ? [
              {
                ...item.properties[0],
                propertyDefinitionId: SYSTEM_PROPERTY_IDS.PROJECT,
                value: {
                  __typename: 'GraphqlEntityReferencePropertyValue',
                  references: [
                    {
                      entityId: projectId,
                      entityType: 'INITIATIVE',
                      specificMessageId: null,
                    },
                  ],
                },
              },
            ]
          : [];
      return item;
    })
  );
  const groups = createMemo(() => {
    const bins = new Map<string, ReturnType<typeof tasks>>();
    for (const item of tasks()) {
      for (const key of localSoupGroupKeys(
        item,
        { groupBy: { field: 'PROJECT' } },
        new Date()
      ) ?? []) {
        bins.set(key, [...(bins.get(key) ?? []), item]);
      }
    }
    return [...bins].sort(([a], [b]) =>
      a ? (b ? a.localeCompare(b) : -1) : 1
    );
  });
  return (
    <main class="mx-auto max-w-5xl p-4 text-ink">
      <h1 class="mb-4 text-xl font-semibold">Tasks</h1>
      <div class="mb-4 flex items-center justify-between text-sm">
        <span>Group by Project</span>
        <button
          type="button"
          class="rounded border border-edge-muted px-3 py-2"
          onClick={() => setCleared((value) => !value)}
        >
          {cleared() ? 'Restore Project One' : 'Clear Task One project'}
        </button>
      </div>
      <div role="grid" aria-label="Tasks grouped by Project">
        <For each={groups()}>
          {([key, items]) => (
            <section aria-label={PROJECTS.get(key) ?? 'No Project'}>
              <TaskGroupHeader
                row={{
                  kind: 'group-header',
                  id: `group-${key}`,
                  groupId: key,
                  label:
                    key === PROJECT_TWO ? 'Project Two' : key || 'No Project',
                  count: items.length,
                }}
                groupBy="project"
                expanded={!collapsed().has(key)}
                focused={false}
                columnCount={2}
                onFocus={() => {}}
                onToggle={() =>
                  setCollapsed((previous) => {
                    const next = new Set(previous);
                    if (next.has(key)) next.delete(key);
                    else next.add(key);
                    return next;
                  })
                }
              />
              <Show when={!collapsed().has(key)}>
                <For each={items}>
                  {(item) => (
                    <div
                      role="row"
                      class="flex items-center justify-between gap-3 border-b border-edge-muted px-5 py-4 text-sm"
                    >
                      <span role="gridcell">{item.displayName}</span>
                      <span role="gridcell" class="truncate text-ink-muted">
                        {PROJECTS.get(
                          item.properties[0]?.value?.__typename ===
                            'GraphqlEntityReferencePropertyValue'
                            ? (item.properties[0].value.references[0]
                                ?.entityId ?? '')
                            : ''
                        ) ?? 'No Project'}
                      </span>
                    </div>
                  )}
                </For>
              </Show>
            </section>
          )}
        </For>
      </div>
    </main>
  );
}
render(
  () => (
    <QueryClientProvider client={queryClient}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <UserContextProvider>
            <Fixture />
          </UserContextProvider>
        </PosthogProvider>
      </AnalyticsContextProvider>
    </QueryClientProvider>
  ),
  document.getElementById('root')!
);
