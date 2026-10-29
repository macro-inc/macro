import '@fontsource-variable/inter';
import { QueryClientProvider } from '@tanstack/solid-query';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { PillTabs } from '../../../src/components/app/mobile/PillTabs';
import { ViewSidebar } from '../../../src/components/view-shell/ViewSidebar';
import { EmailRowActions } from '../../../src/features/email-view/components/EmailRowActions';
import {
  EMAIL_TABS,
  type EmailTab,
} from '../../../src/features/email-view/constants';
import {
  ListEntity,
  ListLayoutProvider,
} from '../../../src/features/entity/composed/ListEntity';
import { isEmailEntity } from '../../../src/features/entity/types/entity';
import { TagSetsProvider } from '../../../src/features/property/tags/tag-sets-context';
import { AnalyticsContextProvider } from '../../../src/lib/analytics/analytics-context';
import { PosthogProvider } from '../../../src/lib/analytics/posthog';
import { EmailLinksContextProvider } from '../../../src/lib/core/context/emailLinks';
import { UserContextProvider } from '../../../src/lib/core/context/user';
import { queryClient } from '../../../src/lib/queries/client';
import '../../../src/index.css';

// Production REST folder query, semantic restore mutation, invalidation, and row
// controls. Playwright supplies deterministic provider responses at HTTP boundaries.
function FolderQueryFixture() {
  const [container, setContainer] = createSignal<HTMLElement>();
  const [tab, setTab] = createSignal<EmailTab>('spam');
  const mutation = useRestoreEmailFolderMutation();
  const pending = () => mutation.isPending;
  const [error, setError] = createSignal('');
  const touch = navigator.maxTouchPoints > 0;
  document.documentElement.dataset.touchDevice = String(touch);
  const label = () => (tab() === 'spam' ? 'Not spam' : 'Restore');
  const query = useSoupAstItemsQuery(
    () =>
      buildEmailQuery({
        tab: tab(),
        inboxIds: undefined,
        facets: {},
        facetContext: { tagPropertyDefinitionByOptionId: new Map() },
      }),
    () => ({
      keepPreviousData: false,
      meta: { normalize: false, insertFilter: () => false },
    })
  );
  const rows = () => query.data?.entities.filter(isEmailEntity) ?? [];
  async function restore(threadId: string) {
    const folder = tab();
    if (folder !== 'spam' && folder !== 'trash') return;
    setError('');
    const result = await mutation.mutateAsync({
      folder,
      threadIds: [threadId],
    });
    if (result.failedIds.length)
      setError('Could not restore email. Try again.');
  }
  return (
    <div class="flex h-screen bg-page text-ink">
      <Show when={!touch}>
        <div class="w-60 border-r border-edge p-3">
          <ViewSidebar.Root aria-label="Email navigation">
            <h1 class="p-2 text-sm font-medium">Email</h1>
            <ViewSidebar.Nav aria-label="Email tabs">
              <For each={EMAIL_TABS}>
                {(item) => (
                  <ViewSidebar.Item
                    active={tab() === item.id}
                    onClick={() => setTab(item.id)}
                  >
                    {item.label}
                  </ViewSidebar.Item>
                )}
              </For>
            </ViewSidebar.Nav>
          </ViewSidebar.Root>
        </div>
      </Show>
      <main class="min-w-0 flex-1 p-4">
        <Show when={touch}>
          <PillTabs
            scrollable
            items={EMAIL_TABS.map((item) => ({
              value: item.id,
              label: item.label,
            }))}
            value={tab()}
            onChange={setTab}
          />
        </Show>
        <h2 class="my-5 text-sm font-medium">
          {EMAIL_TABS.find((item) => item.id === tab())?.label}
        </h2>
        <Show when={error()}>
          <p role="alert">{error()}</p>
        </Show>
        <ul ref={setContainer} aria-label="Folder emails">
          <ListLayoutProvider ref={container} narrowLayout="inbox">
            <For each={rows()}>
              {(entity) => {
                const controls = () => (
                  <EmailRowActions
                    archived
                    canArchive={false}
                    pending={pending()}
                    onArchive={() => {}}
                    onFocus={() => {}}
                    onCommands={() => {}}
                    restore={{
                      label: label(),
                      run: () => restore(entity.id),
                    }}
                  />
                );
                return (
                  <li>
                    <ListEntity
                      entity={entity}
                      hideCheckbox
                      deferInteractions
                      actions={controls()}
                      touchActions={controls()}
                    />
                  </li>
                );
              }}
            </For>
          </ListLayoutProvider>
        </ul>
      </main>
    </div>
  );
}

function Fixture() {
  return (
    <QueryClientProvider client={queryClient}>
      <UserContextProvider>
        <EmailLinksContextProvider>
          <AnalyticsContextProvider>
            <PosthogProvider>
              <TagSetsProvider tagSets={() => []}>
                <FolderQueryFixture />
              </TagSetsProvider>
            </PosthogProvider>
          </AnalyticsContextProvider>
        </EmailLinksContextProvider>
      </UserContextProvider>
    </QueryClientProvider>
  );
}

// Initialize row components before app query adapters, matching app bootstrap
// order and avoiding the existing barrel-import cycles in the Vite fixture.
const { buildEmailQuery } = await import(
  '../../../src/features/email-view/queries/email-query'
);
const { useSoupAstItemsQuery } = await import(
  '../../../src/lib/queries/soup/items'
);
const { useRestoreEmailFolderMutation } = await import(
  '../../../src/lib/queries/email/folders'
);
render(Fixture, document.getElementById('root')!);
