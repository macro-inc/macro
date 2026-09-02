import { runCreateAction } from '@app/features/command/Launcher';
import { globalSplitManager } from '@app/signal/splitLayout';
import { CALENDAR_BLOCK_ID } from '@block-calendar/types';
import { SidebarSettingsWidget } from '@components/app/app-sidebar/sidebar';
import { ENABLE_CHAT_V3_AGENTS } from '@core/constant/featureFlags';
import {
  type SettingsTab,
  useSettingsState,
} from '@core/constant/SettingsState';
import { useSettingsTabAvailable } from '@core/constant/settingsTabsConfig';
import { TOKENS } from '@core/hotkey/tokens';
import CalendarPlusIcon from '@phosphor/calendar-plus.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import { Button, cn } from '@ui';
import { Show } from 'solid-js';
import { MoreAppsPopover } from './more-apps-popover';
import { useNavItemGates } from './use-nav-item-gates';

/**
 * The bottom actions: new AI chat, calendar in a new split, and the More Apps
 * grid — a row in the wide sidebar, stacked in the narrow rail — with the
 * account card below a divider. Settings is reached from that card's menu
 * rather than its own button.
 */
export const FooterActions = (props: {
  onMenuOpenChange?: (open: boolean) => void;
  /** The narrow rail stacks these; the wide sidebar lays them out in a row. */
  orientation?: 'row' | 'column';
}) => {
  const { openSettings, selectTab, settingsOpen } = useSettingsState();
  const isTabAvailable = useSettingsTabAvailable();
  const gates = useNavItemGates();

  // Same handling as `AppSidebar`: retarget the panel when it is already open
  // rather than reopening it, and ignore tabs this account cannot reach.
  const openSettingsTab = (tab: SettingsTab) => {
    if (!isTabAvailable(tab)) return;
    if (settingsOpen()) {
      selectTab(tab);
      return;
    }
    openSettings(tab);
  };

  const canOpenNewSplit = () => globalSplitManager()?.canAppendSplit() ?? true;

  const openCalendarInNewSplit = () => {
    const manager = globalSplitManager();
    if (!manager?.canAppendSplit()) return;
    manager.createNewSplit({
      content: { type: 'calendar', id: CALENDAR_BLOCK_ID },
      activate: true,
      allowDuplicate: false,
      referredFrom: 'sidebar',
    });
  };

  const isColumn = () => props.orientation === 'column';

  return (
    <div class="flex w-full shrink-0 flex-col gap-2">
      <div
        class={cn(
          'flex w-full items-center',
          isColumn() ? 'flex-col gap-1' : 'justify-around'
        )}
      >
        <Button
          size="icon-md"
          variant="ghost"
          class="text-ink-subtle hover:text-ink rounded-xl"
          label="New AI chat in a new split"
          hotkey={TOKENS.create.chatNewSplit}
          onClick={() =>
            // The two creatables both bind `a` and are mutually exclusive on the
            // agents flag, so pick the one that is actually registered.
            // `shouldInsert` is what `createBlock` turns into `preferNewSplit`.
            runCreateAction(ENABLE_CHAT_V3_AGENTS() ? 'agent' : 'chat', {
              shouldInsert: true,
              source: 'sidebar',
            })
          }
        >
          <SparkleIcon />
        </Button>

        <Show when={gates().showCalendar}>
          <Button
            size="icon-md"
            variant="ghost"
            class="text-ink-subtle hover:text-ink rounded-xl"
            label="Open calendar in a new split"
            disabled={!canOpenNewSplit()}
            onClick={openCalendarInNewSplit}
          >
            <CalendarPlusIcon />
          </Button>
        </Show>

        <MoreAppsPopover onOpenChange={props.onMenuOpenChange} />
      </div>

      {/* Inset within the sidebar's `px-3` rather than breaking out of it, so
          the rule stops short of the edges. `my-2` sits on top of the wrapper's
          `gap-2`, giving it 16px of clearance above and below. */}
      <div class="my-2 h-px shrink-0 self-stretch bg-edge-muted" />

      {/*
        The account card from the old sidebar, reused whole. Its trigger already
        collapses to the bare avatar under that sidebar's slim contract, so the
        group is scoped to this wrapper — setting `data-slim` on the rail root
        would expose every descendant to those selectors.
      */}
      <div
        class={cn(
          'group/sidebar flex w-full',
          isColumn() ? 'justify-center' : 'justify-start'
        )}
        data-slim={isColumn() ? 'true' : undefined}
      >
        <SidebarSettingsWidget
          compact={isColumn()}
          isSlim={isColumn}
          onSelect={openSettingsTab}
          onMenuOpenChange={props.onMenuOpenChange}
        />
      </div>
    </div>
  );
};
