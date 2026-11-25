import { t } from '@app/lib/i18n';
import { fireAndForget } from '@core/util/fireAndForget';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import FolderIcon from '@icon/system/regular/tag.svg';
import UsersIcon from '@icon/system/regular/users.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, cn, Dialog, Surface } from '@ui';
import { createEffect, createMemo, createSignal, For, Show } from 'solid-js';
import { useSidebarWorkspace } from '../context/sidebar-workspace-context';
import {
  buildQuickSwitchResults,
  type QuickSwitchItem,
} from '../core/quick-switch';
import type { SidebarChannel } from '../core/sidebar-model';

export type QuickSwitchModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Jump into a browse section when a section hit is activated. */
  onJumpToSection?: (sectionId: string) => void;
};

type GroupedResults = {
  key: 'unread' | 'joined' | 'sections' | 'discover';
  label: string;
  items: { item: QuickSwitchItem; flatIndex: number }[];
};

export function QuickSwitchModal(props: QuickSwitchModalProps) {
  const ws = useSidebarWorkspace();
  const [query, setQuery] = createSignal('');
  const [activeIndex, setActiveIndex] = createSignal(0);
  const [joiningId, setJoiningId] = createSignal<string>();
  let inputRef: HTMLInputElement | undefined;

  createEffect(() => {
    ws.setQuickSwitchState?.(props.open, query());
  });

  const combinedChannels = createMemo<readonly SidebarChannel[]>(() => {
    const base = ws.channels();
    const extra = ws.discoverableChannels?.() ?? [];
    if (extra.length === 0) return base;
    const seen = new Set(base.map((ch) => ch.id));
    const merged = [...base];
    for (const ch of extra) {
      if (!seen.has(ch.id)) {
        seen.add(ch.id);
        merged.push(ch);
      }
    }
    return merged;
  });

  const results = createMemo(() =>
    buildQuickSwitchResults({
      query: query(),
      channels: combinedChannels(),
      sections: ws.sections(),
      unreadIds: ws.unreadIds(),
      unreadOrMentionedIds: ws.unreadOrMentionedIds(),
      mentionCounts: ws.mentionCounts(),
      limit: 50,
    })
  );

  const groups = createMemo<GroupedResults[]>(() => {
    const all = results();
    const buckets: Record<GroupedResults['key'], GroupedResults> = {
      unread: {
        key: 'unread',
        label: t('channelSidebar.quickSwitchGroupUnread'),
        items: [],
      },
      joined: {
        key: 'joined',
        label: t('channelSidebar.quickSwitchGroupJoined'),
        items: [],
      },
      sections: {
        key: 'sections',
        label: t('channelSidebar.quickSwitchGroupSections'),
        items: [],
      },
      discover: {
        key: 'discover',
        label: t('channelSidebar.quickSwitchGroupDiscover'),
        items: [],
      },
    };

    all.forEach((item, flatIndex) => {
      buckets[item.group].items.push({ item, flatIndex });
    });

    return (
      [
        buckets.unread,
        buckets.joined,
        buckets.sections,
        buckets.discover,
      ] as GroupedResults[]
    ).filter((group) => group.items.length > 0);
  });

  createEffect(() => {
    if (props.open) {
      setQuery('');
      setActiveIndex(0);
      queueMicrotask(() => inputRef?.focus());
    }
  });

  createEffect(() => {
    const len = results().length;
    if (activeIndex() >= len) {
      setActiveIndex(Math.max(0, len - 1));
    }
  });

  const activateResult = (
    item: QuickSwitchItem,
    options?: { newSplit?: boolean }
  ) => {
    if (item.kind === 'section') {
      if (ws.activeTab() === 'threads') {
        ws.exitThreads();
      }
      ws.prefs.setActiveLens('browse');
      if (ws.prefs.prefs.hiddenTeamSectionIds.includes(item.section.id)) {
        ws.prefs.showTeamSection(item.section.id);
      }
      ws.setSectionOpen(item.section.id, true);
      props.onJumpToSection?.(item.section.id);
      props.onOpenChange(false);
      return;
    }

    if (!options?.newSplit && ws.activeTab() === 'threads') {
      ws.exitThreads();
    }
    ws.openChannel(item.channel.id, {
      newSplit: options?.newSplit,
      focusComposer: true,
    });
    props.onOpenChange(false);
  };

  const handleJoin = (channel: SidebarChannel, event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
    if (joiningId()) return;
    setJoiningId(channel.id);
    fireAndForget(
      ws.joinChannel(channel.id).finally(() => setJoiningId(undefined)),
      'channels-view'
    );
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const all = results();
    if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')) {
      event.preventDefault();
      if (all.length > 0) setActiveIndex((idx) => (idx + 1) % all.length);
      return;
    }
    if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')) {
      event.preventDefault();
      if (all.length > 0)
        setActiveIndex((idx) => (idx - 1 + all.length) % all.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const target = all[activeIndex()];
      if (target) activateResult(target, { newSplit: event.shiftKey });
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      props.onOpenChange(false);
    }
  };

  return (
    <Dialog
      open={props.open}
      onOpenChange={props.onOpenChange}
      class="w-[min(34rem,92vw)]"
      visibleScrim
    >
      <Surface
        depth={2}
        class="flex max-h-[min(32rem,75dvh)] flex-col overflow-hidden rounded-xl border border-edge text-ink shadow-xl"
        data-quick-switch-dialog=""
      >
        <Dialog.Title class="sr-only">
          {t('channelSidebar.quickSwitchTitle')}
        </Dialog.Title>
        <Dialog.Description class="sr-only">
          {t('channelSidebar.quickSwitchPlaceholder')}
        </Dialog.Description>

        {/* Search input header */}
        <div class="flex h-11 shrink-0 items-center gap-2 border-b border-edge-muted px-3">
          <SearchIcon class="size-4 shrink-0 text-ink-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query()}
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setActiveIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={t('channelSidebar.quickSwitchPlaceholder')}
            aria-label={t('channelSidebar.quickSwitchPlaceholder')}
            class="h-full min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-extra-muted focus:outline-none"
          />
          <Show when={query().length > 0}>
            <button
              type="button"
              aria-label="Clear search"
              class="flex size-5 items-center justify-center rounded text-ink-extra-muted hover:bg-hover hover:text-ink"
              onClick={() => {
                setQuery('');
                inputRef?.focus();
              }}
            >
              <XIcon class="size-3.5" />
            </button>
          </Show>
        </div>

        {/* Grouped results */}
        <div
          class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-2"
          role="listbox"
          aria-label={t('channelSidebar.quickSwitchTitle')}
        >
          <Show
            when={groups().length > 0}
            fallback={
              <div class="px-4 py-8 text-center text-sm text-ink-muted">
                {t('channelSidebar.quickSwitchNoMatches', { query: query() })}
              </div>
            }
          >
            <For each={groups()}>
              {(group) => (
                <div class="flex flex-col gap-0.5" data-qs-group={group.key}>
                  <div class="px-2 pt-1 pb-0.5 text-[11px] font-semibold tracking-wide text-ink-extra-muted uppercase">
                    {group.label}
                  </div>
                  <For each={group.items}>
                    {({ item, flatIndex }) => {
                      const isActive = () => activeIndex() === flatIndex;
                      return (
                        <div
                          role="option"
                          aria-selected={isActive()}
                          data-qs-item=""
                          data-qs-group-item={group.key}
                          class={cn(
                            'flex h-9 items-center gap-2 rounded-lg px-2 text-sm transition-colors',
                            isActive()
                              ? 'bg-active text-ink'
                              : 'text-ink-muted hover:bg-hover hover:text-ink'
                          )}
                          onMouseEnter={() => setActiveIndex(flatIndex)}
                          onClick={(event) =>
                            activateResult(item, { newSplit: event.shiftKey })
                          }
                        >
                          <Show
                            when={item.kind === 'channel' ? item : undefined}
                            fallback={
                              item.kind === 'section' ? (
                                <>
                                  <span class="flex size-5 shrink-0 items-center justify-center text-ink-muted">
                                    {item.section.scope === 'team' ? (
                                      <UsersIcon class="size-3.5" />
                                    ) : (
                                      <FolderIcon class="size-3.5" />
                                    )}
                                  </span>
                                  <span class="min-w-0 flex-1 truncate font-medium text-ink">
                                    {item.section.name}
                                  </span>
                                  <span class="text-xs text-ink-extra-muted">
                                    {item.section.scope === 'team'
                                      ? t('channelSidebar.teamZoneFallback')
                                      : t('channelSidebar.personalZone')}
                                  </span>
                                </>
                              ) : null
                            }
                          >
                            {(hit) => {
                              const ch = () => hit().channel;
                              const isUnread = () =>
                                ws.unreadIds().has(ch().id);
                              const mentions = () =>
                                ws.mentionCounts().get(ch().id) ?? 0;
                              return (
                                <>
                                  <span class="flex size-5 shrink-0 items-center justify-center">
                                    {ws.renderChannelIcon(ch(), 'sm')}
                                  </span>
                                  <span
                                    class={cn(
                                      'min-w-0 flex-1 truncate',
                                      isUnread() || mentions() > 0
                                        ? 'font-semibold text-ink'
                                        : 'text-ink'
                                    )}
                                  >
                                    {ch().name}
                                  </span>
                                  <Show when={mentions() > 0}>
                                    <span class="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[11px] font-semibold tabular-nums text-accent-contrast">
                                      {mentions()}
                                    </span>
                                  </Show>
                                  <Show when={mentions() === 0 && isUnread()}>
                                    <span class="size-2 shrink-0 rounded-full bg-accent" />
                                  </Show>
                                  <Show when={!ch().isParticipant}>
                                    <Button
                                      type="button"
                                      variant="secondary"
                                      size="xs"
                                      disabled={joiningId() === ch().id}
                                      onClick={(event) =>
                                        handleJoin(ch(), event)
                                      }
                                    >
                                      {t('channelSections.join')}
                                    </Button>
                                  </Show>
                                </>
                              );
                            }}
                          </Show>
                        </div>
                      );
                    }}
                  </For>
                </div>
              )}
            </For>
          </Show>
        </div>

        {/* Footer keyboard hints */}
        <div class="flex shrink-0 items-center justify-between border-t border-edge-muted px-3 py-1.5 text-[11px] text-ink-extra-muted">
          <span>{t('channelSidebar.quickSwitchHint')}</span>
          <span class="tabular-nums">{results().length}</span>
        </div>
      </Surface>
    </Dialog>
  );
}
