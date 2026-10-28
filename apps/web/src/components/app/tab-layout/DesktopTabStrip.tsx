import { t } from '@app/lib/i18n';
import { globalTabManager } from '@app/signal/tabLayout';
import { TOKENS } from '@core/hotkey/tokens';
import PlusIcon from '@icon/system/regular/plus.svg';
import SquareSplitIcon from '@icon/system/regular/square-split-horizontal.svg';
import XIcon from '@icon/system/regular/x.svg';
import { Button, cn, Tooltip } from '@ui';
import { For, Show } from 'solid-js';
import type { DesktopTab, TabManager } from './tab-manager';

function TabItem(props: { tabManager: TabManager; tab: DesktopTab }) {
  const title = () => props.tabManager.tabTitle(props.tab) ?? t('tabs.newTab');
  const active = () => props.tabManager.activeTabId() === props.tab.id;
  const paneCount = () => props.tabManager.tabPaneCount(props.tab);
  const closable = () => props.tabManager.tabs().length > 1;

  return (
    <div
      role="tab"
      aria-selected={active()}
      class={cn(
        'group flex h-7 min-w-9 max-w-44 flex-initial basis-40 items-center gap-1 rounded-md pl-2 pr-1 text-xs select-none',
        active()
          ? 'bg-active text-ink'
          : 'text-ink-muted not-touch:hover:bg-hover not-touch:hover:text-ink'
      )}
      onClick={() => props.tabManager.activateTab(props.tab.id)}
      onAuxClick={(event) => {
        if (event.button === 1 && closable()) {
          props.tabManager.closeTab(props.tab.id);
        }
      }}
    >
      <Show when={paneCount() > 1}>
        <Tooltip label={t('tabs.splitCount', { count: paneCount() })} as="span">
          <span class="flex shrink-0 items-center gap-0.5 text-2xs text-ink-extra-muted">
            <SquareSplitIcon class="size-3.5" />
            {paneCount()}
          </span>
        </Tooltip>
      </Show>
      <Tooltip label={title()} as="span" class="min-w-0 flex-1">
        <span class="block truncate">{title()}</span>
      </Tooltip>
      <Show when={closable()}>
        <Button
          variant="ghost"
          size="icon-xs"
          label={t('tabs.closeTab')}
          noTouchResize
          class={cn(
            'shrink-0',
            !active() && 'invisible not-touch:group-hover:visible'
          )}
          onClick={(event) => {
            event.stopPropagation();
            props.tabManager.closeTab(props.tab.id);
          }}
        >
          <XIcon />
        </Button>
      </Show>
    </div>
  );
}

/**
 * The browser-style tab strip in the title bar's center slot. Renders nothing
 * until the tab manager exists (desktop tabs enabled and a user signed in).
 */
export function DesktopTabStrip() {
  return (
    <Show when={globalTabManager()}>
      {(tabManager) => (
        <div
          data-desktop-tab-strip
          class="flex h-full min-w-0 flex-1 items-center gap-1 px-2"
        >
          <div
            role="tablist"
            aria-label={t('tabs.tablist')}
            class="flex min-w-0 items-center gap-1 overflow-hidden"
          >
            <For each={tabManager().tabs()}>
              {(tab) => <TabItem tabManager={tabManager()} tab={tab} />}
            </For>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            label={t('tabs.newTab')}
            hotkey={TOKENS.tabs.new}
            onClick={() => tabManager().newTab()}
          >
            <PlusIcon class="size-4" />
          </Button>
          <div data-tauri-drag-region class="h-full min-w-4 flex-1" />
        </div>
      )}
    </Show>
  );
}
