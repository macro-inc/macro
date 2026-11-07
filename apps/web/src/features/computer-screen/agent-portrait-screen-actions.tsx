import { t } from '@app/lib/i18n';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import DesktopIcon from '@icon/system/regular/desktop.svg';
import type { Harness } from '@service-storage/generated/schemas/harness';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { AgentComputerScreenEntry } from './agent-computer-screen-entry';
import { hasHarnessEditAccess } from './harness-access';

/** Shared by hover cards, right-click cards, and the phone card drawer. */
export function AgentPortraitScreenActions(props: {
  userId?: string;
  isDeleted?: boolean;
  onSelect?(): void;
}) {
  return (
    <AgentComputerScreenEntry {...props}>
      {(harness, open) => (
        <PortraitScreenActionButtons
          harness={harness()}
          mobile={isTouchDevice()}
          onOpen={open}
        />
      )}
    </AgentComputerScreenEntry>
  );
}

export function PortraitScreenActionButtons(props: {
  harness?: Harness;
  mobile: boolean;
  onOpen(control: boolean): void;
}) {
  const canWatch = () =>
    props.harness?.capabilities?.screen === true &&
    props.harness.access !== 'none';
  const canControl = () =>
    canWatch() && hasHarnessEditAccess(props.harness) && !props.mobile;
  return (
    <Show when={canWatch()}>
      <div class="flex flex-col gap-1 border-t border-edge p-2">
        <Button
          variant="ghost"
          size="sm"
          class="justify-start"
          onClick={() => canWatch() && props.onOpen(false)}
        >
          <DesktopIcon class="size-4" />
          {t('runtimeSharing.showScreen')}
        </Button>
        <Show when={canControl()}>
          <Button
            variant="ghost"
            size="sm"
            class="justify-start"
            onClick={() => canControl() && props.onOpen(true)}
          >
            <DesktopIcon class="size-4" />
            {t('runtimeSharing.screenTakeControl')}
          </Button>
        </Show>
      </div>
    </Show>
  );
}
