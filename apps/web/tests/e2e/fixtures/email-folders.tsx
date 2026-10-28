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
import type { EmailEntity } from '../../../src/features/entity/types/entity';
import { TagSetsProvider } from '../../../src/features/property/tags/tag-sets-context';
import { AnalyticsContextProvider } from '../../../src/lib/analytics/analytics-context';
import { PosthogProvider } from '../../../src/lib/analytics/posthog';
import { EmailLinksContextProvider } from '../../../src/lib/core/context/emailLinks';
import { UserContextProvider } from '../../../src/lib/core/context/user';
import { queryClient } from '../../../src/lib/queries/client';
import '../../../src/index.css';

// Production navigation primitives and row controls, with a deterministic source.
// Provider queries and semantic restore writes have separate integration coverage.
function Fixture() {
  const [container, setContainer] = createSignal<HTMLElement>();
  const [tab, setTab] = createSignal<EmailTab>('spam');
  const [restored, setRestored] = createSignal<string[]>([]);
  const [pending, setPending] = createSignal(false);
  const [error, setError] = createSignal('');
  const touch = navigator.maxTouchPoints > 0;
  document.documentElement.dataset.touchDevice = String(touch);
  const label = () => (tab() === 'spam' ? 'Not spam' : 'Restore');
  const rows = () =>
    ['Gmail', 'Outlook'].filter(
      (provider) => !restored().includes(`${tab()}:${provider}`)
    );
  async function restore(provider: string) {
    setPending(true);
    setError('');
    await new Promise((resolve) => setTimeout(resolve, 150));
    setPending(false);
    if (location.search.includes('fail')) {
      setError('Could not restore email. Try again.');
      return;
    }
    setRestored((old) => [...old, `${tab()}:${provider}`]);
  }
  return (
    <QueryClientProvider client={queryClient}>
      <UserContextProvider>
        <EmailLinksContextProvider>
          <AnalyticsContextProvider>
            <PosthogProvider>
              <TagSetsProvider tagSets={() => []}>
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
                          {(provider) => {
                            const entity: EmailEntity = {
                              type: 'email',
                              id: provider,
                              name: `${provider} folder message`,
                              ownerId: '',
                              linkId: 'fixture',
                              isRead: true,
                              isDraft: false,
                              isImportant: false,
                              done: false,
                              updatedAt: new Date('2026-10-01T12:00:00Z'),
                              properties: [],
                              senderName: provider,
                              senderEmail: 'sender@example.com',
                            };
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
                                  run: () => restore(provider),
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
              </TagSetsProvider>
            </PosthogProvider>
          </AnalyticsContextProvider>
        </EmailLinksContextProvider>
      </UserContextProvider>
    </QueryClientProvider>
  );
}

render(Fixture, document.getElementById('root')!);
