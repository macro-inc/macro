import {
  splitChromeIsTinted,
  splitOwnsIdentity,
} from '@app/features/app-layout/split-chrome';
import { getViewPreset } from '@app/features/next-soup/sidebar/soup-filter-presets';
import { createSoupState } from '@app/features/next-soup/create-soup-state';
import { SoupContextProvider } from '@app/features/next-soup/soup-context';
import { useApplyPreset } from '@app/features/next-soup/soup-view/soup-view-tabs';
import {
  SoupViewContextProvider,
  useSoupView,
} from '@app/features/next-soup/soup-view/soup-view-context';
import {
  InboxCardLayout,
  toInboxCardDisplayItem,
} from '@app/features/next-soup/soup-view/views/inbox/inbox-card-layouts';
import { useGlobalBlockOrchestrator } from '@components/app/GlobalAppState';
import { PreviewPanel } from '@components/app/PreviewPanel';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import {
  MAX_MESSAGES_SIDEBAR_WIDTH,
  messagesSidebarWidth,
  MIN_MESSAGES_SIDEBAR_WIDTH,
  setMessagesSidebarWidth,
} from '@components/app/split-layout/messagesSidebarWidth';
import {
  Resize,
  ResizeZoneContext,
} from '@core/component/Resize/Resize';
import { StaticMarkdownContext } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import type { EntityData, WithNotification } from '@entity';
import { cn } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Show,
  useContext,
} from 'solid-js';

type InboxCategory = 'signal' | 'noise' | 'all';

const INBOX_CATEGORIES: readonly { id: InboxCategory; label: string }[] = [
  { id: 'signal', label: 'Signal' },
  { id: 'noise', label: 'Noise' },
  { id: 'all', label: 'All' },
];

const initialInboxPreset = getViewPreset('inbox', 'signal');
const INBOX_SIDEBAR_PANEL_ID = 'experimental-inbox-sidebar';
const INBOX_PREVIEW_PANEL_ID = 'experimental-inbox-preview';

function inboxEntityKey(entity: EntityData) {
  return `${entity.type}:${entity.id}`;
}

/** Inbox cards and an inline item preview, without a controller preview split. */
export function ExperimentalInboxWorkspace() {
  const soup = createSoupState();

  return (
    <SoupContextProvider soup={soup}>
      <SoupViewContextProvider
        soup={soup}
        initialEnabled
        initialQuery={initialInboxPreset?.filters}
        initialClientFilters={initialInboxPreset?.clientFilters}
        preferInitialFilters
      >
        <InboxWorkspaceContent />
      </SoupViewContextProvider>
    </SoupContextProvider>
  );
}

function SyncInboxSidebarWidth() {
  const resizeZone = useContext(ResizeZoneContext);
  if (!resizeZone) return null;
  const size = resizeZone.sizeOf(INBOX_SIDEBAR_PANEL_ID);
  createEffect(() => {
    const width = size();
    if (width > 0) setMessagesSidebarWidth(width);
  });
  return null;
}

function InboxWorkspaceContent() {
  const soupView = useSoupView();
  const orchestrator = useGlobalBlockOrchestrator();
  const splitPanelContext = useSplitPanelOrThrow();
  const { applyTabPreset } = useApplyPreset();
  const [category, setCategory] = createSignal<InboxCategory>('signal');
  const [selectedKey, setSelectedKey] = createSignal<string>();
  const entities = () => soupView.items();
  const selectedEntity = createMemo(() =>
    entities().find((entity) => inboxEntityKey(entity) === selectedKey())
  );
  createEffect(() => {
    const items = entities();
    if (items.some((entity) => inboxEntityKey(entity) === selectedKey())) return;
    setSelectedKey(items[0] ? inboxEntityKey(items[0]) : undefined);
  });

  const selectCategory = (next: InboxCategory) => {
    applyTabPreset('inbox', next);
    setCategory(next);
    setSelectedKey(undefined);
  };

  return (
    <StaticMarkdownContext>
      <Resize.Zone
        direction="horizontal"
        gutter={8}
        class="overflow-hidden"
      >
        <Resize.Panel
          id={INBOX_SIDEBAR_PANEL_ID}
          index={0}
          minSize={MIN_MESSAGES_SIDEBAR_WIDTH}
          maxSize={MAX_MESSAGES_SIDEBAR_WIDTH}
          redistributionPreferredSize={messagesSidebarWidth()}
          target={{ kind: 'px', px: messagesSidebarWidth() }}
        >
          <section
            class={cn(
              'flex size-full min-h-0 flex-col pb-5',
              splitChromeIsTinted() && 'bg-ink/2',
              // Clears the absolutely-positioned workspace header, which is
              // shorter once it drops its split controls.
              splitOwnsIdentity() ? 'pt-[5.75rem]' : 'pt-[3.75rem]'
            )}
          >
            <div
            class="mx-4 mt-3 grid h-9 shrink-0 grid-cols-3 gap-1 rounded-xl bg-ink/4 p-1"
            role="tablist"
            aria-label="Inbox views"
          >
            <For each={INBOX_CATEGORIES}>
              {(item) => (
                <button
                  type="button"
                  role="tab"
                  aria-selected={category() === item.id}
                  class={cn(
                    'flex min-w-0 items-center justify-center rounded-lg px-2 text-xs font-medium transition-colors',
                    category() === item.id
                      ? 'bg-surface text-ink shadow-sm'
                      : 'text-ink-muted hover:text-ink'
                  )}
                  aria-pressed={category() === item.id}
                  onClick={() => selectCategory(item.id)}
                >
                  {item.label}
                </button>
              )}
            </For>
          </div>
          <div class="scrollbar-hidden mt-3 min-h-0 flex-1 overflow-y-auto">
            <Show
              when={entities().length > 0}
              fallback={
                <p class="m-0 px-3 py-8 text-center text-sm text-ink-extra-muted">
                  {soupView.source.isLoading()
                    ? 'Loading inbox…'
                    : 'Nothing in this inbox.'}
                </p>
              }
            >
              <div class="flex flex-col divide-y divide-ink/[0.05]">
                <For each={entities()}>
                  {(entity) => {
                    const key = () => inboxEntityKey(entity);
                    return (
                      <InboxCardLayout
                        class={cn(
                          'rounded-none! px-4! py-3!',
                          selectedKey() === key() && 'bg-active!'
                        )}
                        item={toInboxCardDisplayItem(
                          entity as WithNotification<EntityData>
                        )}
                        selected={selectedKey() === key()}
                        onClick={() => setSelectedKey(key())}
                      />
                    );
                  }}
                </For>
              </div>
            </Show>
          </div>
          </section>
        </Resize.Panel>

        <Resize.Panel
          id={INBOX_PREVIEW_PANEL_ID}
          index={1}
          minSize={320}
        >
          <section class="size-full min-h-0 min-w-0">
          <Show
            when={selectedEntity()}
            fallback={
              <div class="flex size-full items-center justify-center text-center text-sm text-ink-extra-muted">
                Select an inbox item to preview it.
              </div>
            }
          >
            {(entity) => (
              <div class="size-full min-h-0 overflow-hidden">
                <PreviewPanel
                  selectedEntity={entity()}
                  orchestrator={orchestrator}
                  splitPanelContext={splitPanelContext}
                />
              </div>
            )}
          </Show>
          </section>
        </Resize.Panel>
        <SyncInboxSidebarWidth />
      </Resize.Zone>
    </StaticMarkdownContext>
  );
}
