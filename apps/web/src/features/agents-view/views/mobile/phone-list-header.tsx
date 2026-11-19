import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { MobileHeader } from '@components/app/mobile-header/mobile-header';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import ArchiveIcon from '@icon/system/regular/archive.svg';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import RoutineIcon from '@icon/system/regular/clock-clockwise.svg';
import SearchIcon from '@icon/system/regular/magnifying-glass.svg';
import AgentIcon from '@icon/system/regular/sparkle.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button } from '@ui';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import type { ConversationFiltersProps } from '../../components/conversation-filters/conversation-filters';
import type { AgentsPage } from '../../core/pages';
import { ConversationFiltersDrawer } from './filters/filters';

export function PhoneListHeader(
  props: ConversationFiltersProps & {
    archived: boolean;
    search: string;
    onSearchChange: (value: string) => void;
    onBack: () => void;
    onOpenPage: (page: AgentsPage) => void;
    archivedCount?: number;
  }
) {
  const panel = useSplitPanelOrThrow();
  const [searchOpen, setSearchOpen] = createSignal(false);
  const [menuOpen, setMenuOpen] = createSignal(false);
  createEffect(() => {
    if (props.archived) return;
    const open = () => setMenuOpen(true);
    panel.setTitleFileMenuTrigger(() => open);
    onCleanup(() => panel.setTitleFileMenuTrigger(undefined));
  });
  let input: HTMLInputElement | undefined;
  const closeSearch = () => {
    setSearchOpen(false);
    props.onSearchChange('');
  };
  return (
    <MobileHeader
      trailing={
        <>
          <Show when={!searchOpen()}>
            <MobileHeader.Island class="size-10 justify-center !px-0">
              <Button
                variant="ghost"
                size="icon-md"
                aria-label={t('agentWork.searchConversations')}
                onClick={() => {
                  setSearchOpen(true);
                  queueMicrotask(() => input?.focus());
                }}
              >
                <SearchIcon class="size-5" />
              </Button>
            </MobileHeader.Island>
            <Show when={!props.archived}>
              <ConversationFiltersDrawer
                filters={props.filters}
                onFilterChange={props.onFilterChange}
                onClearFilters={props.onClearFilters}
                showUnlistedRuns={props.showUnlistedRuns}
                onShowUnlistedRunsChange={props.onShowUnlistedRunsChange}
              />
            </Show>
          </Show>
          <Show when={searchOpen()}>
            <MobileHeader.Island class="size-10 justify-center !px-0">
              <Button
                variant="ghost"
                size="icon-md"
                aria-label={t('agentControls.back')}
                onClick={closeSearch}
              >
                <CloseIcon class="size-5" />
              </Button>
            </MobileHeader.Island>
          </Show>
        </>
      }
    >
      <Show
        when={searchOpen()}
        fallback={
          props.archived ? (
            <>
              <MobileHeader.Back onBack={props.onBack} />
              <MobileHeader.Island>
                <span class="text-sm font-semibold">
                  {t('viewMenus.archived')}
                </span>
              </MobileHeader.Island>
            </>
          ) : (
            <MobileDrawer
              side="bottom"
              open={menuOpen()}
              onOpenChange={setMenuOpen}
            >
              <MobileHeader.Title label={t('agentWork.agents')} />
              <MobileDrawer.Portal>
                <MobileDrawer.Overlay />
                <MobileDrawer.Content aria-label={t('agentWork.agentTools')}>
                  <MobileDrawer.Handle />
                  <MobileDrawer.ScrollBody>
                    <MobileDrawer.Item
                      onClick={() => {
                        setMenuOpen(false);
                        props.onOpenPage('new');
                      }}
                    >
                      <ChatIcon class="size-[18px]" />
                      {t('agentWork.conversations')}
                      <CheckIcon class="ml-auto size-4 text-accent" />
                    </MobileDrawer.Item>
                    <MobileDrawer.Item
                      onClick={() => {
                        setMenuOpen(false);
                        props.onOpenPage('agents');
                      }}
                    >
                      <AgentIcon class="size-[18px]" />
                      {t('agentWork.agents')}
                    </MobileDrawer.Item>
                    <MobileDrawer.Item
                      onClick={() => {
                        setMenuOpen(false);
                        props.onOpenPage('routines');
                      }}
                    >
                      <RoutineIcon class="size-[18px]" />
                      {t('agentWork.routines')}
                    </MobileDrawer.Item>
                    <MobileDrawer.Item
                      onClick={() => {
                        setMenuOpen(false);
                        props.onOpenPage('archived');
                      }}
                    >
                      <ArchiveIcon class="size-[18px]" />
                      {t('viewMenus.archived')}
                      <Show when={props.archivedCount !== undefined}>
                        <span class="ml-auto text-ink-extra-muted/70">
                          {props.archivedCount}
                        </span>
                      </Show>
                    </MobileDrawer.Item>
                  </MobileDrawer.ScrollBody>
                </MobileDrawer.Content>
              </MobileDrawer.Portal>
            </MobileDrawer>
          )
        }
      >
        <MobileHeader.Island class="min-w-0 flex-1">
          <SearchIcon class="size-4 shrink-0 text-ink-muted" />
          <input
            ref={input}
            aria-label={
              props.archived
                ? t('agentWork.searchArchived')
                : t('agentWork.searchConversations')
            }
            class="min-w-0 flex-1 bg-transparent outline-none"
            value={props.search}
            onInput={(event) => props.onSearchChange(event.currentTarget.value)}
          />
          <Show when={props.search}>
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label={t('viewMenus.clearFilters')}
              onClick={() => props.onSearchChange('')}
            >
              <CloseIcon class="size-4" />
            </Button>
          </Show>
        </MobileHeader.Island>
      </Show>
    </MobileHeader>
  );
}
