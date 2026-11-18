import { ListEntity } from '@app/features/entity/composed/ListEntity';
import { ListEntityNoopMetadataProvider } from '@app/features/entity/composed/list-entity/list-entity-metadata-provider';
import type { EntityData } from '@app/features/entity/types/entity';
import { macroDarkTheme } from '@app/features/theme/themes/macro-dark';
import { macroLightTheme } from '@app/features/theme/themes/macro-light';
import { AnalyticsContextProvider } from '@app/lib/analytics/analytics-context';
import { PosthogProvider } from '@app/lib/analytics/posthog';
import { EmailLinksContextProvider } from '@core/context/emailLinks';
import { UserContextProvider } from '@core/context/user';
import { hasLoginCookie } from '@core/util/cookies';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { Button } from '@ui/components/Button';
import { createSignal, For, onCleanup } from 'solid-js';
import { createStore, produce, reconcile } from 'solid-js/store';
import { render } from 'solid-js/web';
import '../../../index.css';

if (hasLoginCookie())
  throw new Error('Use a fresh browser context for the static entity fixture.');

const params = new URLSearchParams(location.search);
const count = Number(params.get('count') ?? 1000);
const theme =
  params.get('theme') === 'light' ? macroLightTheme : macroDarkTheme;
for (const [token, value] of Object.entries(theme.colorTokens)) {
  document.documentElement.style.setProperty(`--color-${token}`, value);
}
document.documentElement.dataset.themeLight = String(theme.mode === 'light');
document.documentElement.dataset.touchDevice = 'false';
const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const fixtures: EntityData[] = Array.from({ length: count }, (_, index) => {
  const base = {
    id: `fixture-row-${index}`,
    name: `Example item ${index}`,
    ownerId: '',
    updatedAt: '2025-01-15T12:00:00Z',
  };
  if (index % 2 === 0) return { ...base, type: 'document', fileType: 'pdf' };
  return {
    ...base,
    type: 'foreign',
    foreignSource: 'github_pull_request',
    foreignId: `fixture-pr-${index}`,
    storedForId: '',
    storedForAuthEntity: 'team',
    metadata: {
      number: index,
      name: base.name,
      owner: 'example',
      repo: 'fixture',
      // Empty links leave linked-session lookup disabled in this static collection.
      url: '',
      status: 'open',
      additions: 24,
      deletions: 8,
      comments: [],
      checks: [],
      labels: [
        { name: 'Performance' },
        { name: 'Needs review' },
        { name: 'Frontend' },
      ],
    },
  };
});

// The benchmark changes data/selection through the same store semantics as a
// live collection. The regular stress fixture keeps its plain static rows.
const benchmark = params.has('benchmark');
const [models, setModels] = createStore(fixtures);
const [mounted, setMounted] = createSignal(!benchmark);
const [selected, setSelected] = createSignal(false);
const rows = () => (mounted() ? (benchmark ? models : fixtures) : []);
let mounts = 0;
let disposals = 0;
let update = 0;
const api = {
  stats: () => ({
    mounts,
    disposals,
    selected: selected(),
    checked: document.querySelectorAll('[role="checkbox"][aria-checked="true"]')
      .length,
    firstName: models[0]?.name,
    rows: document.querySelectorAll('[data-entity]').length,
  }),
  mount: () => setMounted(true),
  clear() {
    setMounted(false);
    setSelected(false);
  },
  select: () => setSelected((value) => !value),
  rename() {
    update++;
    setModels(
      produce((rows) => {
        for (let index = 0; index < rows.length; index++)
          rows[index].name = `Example item ${index} update ${update}`;
      })
    );
  },
  replace() {
    update++;
    setModels(
      reconcile(
        fixtures.map((entity, index) => ({
          ...entity,
          name: `Example item ${index} update ${update}`,
        })),
        { key: 'id', merge: true }
      )
    );
  },
};
declare global {
  interface Window {
    entityRowBenchmark: typeof api;
  }
}

render(
  () => (
    <QueryClientProvider client={client}>
      <AnalyticsContextProvider>
        <PosthogProvider>
          <UserContextProvider>
            <EmailLinksContextProvider>
              <ListEntityNoopMetadataProvider>
                <main
                  data-list
                  class="h-screen overflow-y-auto bg-page p-4 text-ink"
                >
                  <h1 class="mb-4 text-lg">Static entity collection</h1>
                  <For each={rows()}>
                    {(entity) => {
                      mounts++;
                      onCleanup(() => disposals++);
                      return (
                        <ListEntity
                          entity={entity}
                          deferInteractions
                          hideCheckbox={
                            !benchmark || params.has('hideCheckbox')
                          }
                          checked={selected()}
                          actions={
                            <Button size="sm" variant="ghost">
                              Open
                            </Button>
                          }
                        />
                      );
                    }}
                  </For>
                </main>
              </ListEntityNoopMetadataProvider>
            </EmailLinksContextProvider>
          </UserContextProvider>
        </PosthogProvider>
      </AnalyticsContextProvider>
    </QueryClientProvider>
  ),
  document.getElementById('root')!
);

window.entityRowBenchmark = api;
