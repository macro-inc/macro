import { runCreateAction } from '@app/features/command/Launcher';
import { globalSplitManager } from '@app/signal/splitLayout';
import { CALENDAR_BLOCK_ID } from '@block-calendar/types';
import { ENABLE_CHAT_V3_AGENTS } from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { TOKENS } from '@core/hotkey/tokens';
import CalendarPlusIcon from '@phosphor/calendar-plus.svg';
import GearIcon from '@phosphor/gear.svg';
import SparkleIcon from '@phosphor/sparkle.svg';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { MoreAppsPopover } from './more-apps-popover';
import { useNavItemGates } from './use-nav-item-gates';

/**
 * The bottom button row: new AI chat, calendar in a new split, the More Apps
 * grid, and settings.
 */
export const FooterActions = (props: {
  onMenuOpenChange?: (open: boolean) => void;
}) => {
  const { openSettings } = useSettingsState();
  const gates = useNavItemGates();

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

  return (
    <div class="flex shrink-0 items-center justify-around w-full">
      <Button
        size="icon-md"
        class="border-edge bg-ink/3 text-ink/70"
        label="New AI chat"
        hotkey={TOKENS.create.chat}
        variant="outline"
        onClick={() =>
          // The two creatables both bind `a` and are mutually exclusive on the
          // agents flag, so pick the one that is actually registered.
          runCreateAction(ENABLE_CHAT_V3_AGENTS() ? 'agent' : 'chat')
        }
      >
        <SparkleIcon />
      </Button>

      <Show when={gates().showCalendar}>
        <Button
          size="icon-md"
          class="border-edge bg-ink/3 text-ink/70"
          label="Open calendar in a new split"
          disabled={!canOpenNewSplit()}
          onClick={openCalendarInNewSplit}
        >
          <CalendarPlusIcon />
        </Button>
      </Show>

      <MoreAppsPopover onOpenChange={props.onMenuOpenChange} />

      <Button
        size="icon-md"
        class="border-edge bg-ink/3 text-ink/70"
        label="Settings"
        hotkey={TOKENS.global.toggleSettings}
        onClick={() => openSettings('Account')}
      >
        <GearIcon />
      </Button>
    </div>
  );
};
