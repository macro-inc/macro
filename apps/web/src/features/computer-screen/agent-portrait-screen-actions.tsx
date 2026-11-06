import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { beginInteraction } from '@app/observability/flow';
import { enableMacroComputers } from '@core/constant/featureFlags';
import { isBotPrincipalId } from '@core/constant/macroAgent';
import { useSettingsState } from '@core/constant/SettingsState';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isAgentAccount, tryMacroId } from '@core/user';
import DesktopIcon from '@icon/system/regular/desktop.svg';
import { useAgentsQuery } from '@queries/agents/agents';
import { queryReadyGate } from '@queries/gate';
import { useHarnessDirectoryQuery } from '@queries/harnesses/harnesses';
import { useTeamAgentComputerQuery } from '@queries/team-agents';
import type { Harness } from '@service-storage/generated/schemas/harness';
import { Button } from '@ui';
import { createMemo, Show, Suspense } from 'solid-js';
import { useSettingsComputerScreen } from './context/settings-screen-context';
import { useOptionalSettingsScreenNavigation } from './context/settings-screen-navigation';
import { hasHarnessEditAccess } from './harness-access';

/** Shared by hover cards, right-click cards, and the phone card drawer. */
export function AgentPortraitScreenActions(props: {
  userId?: string;
  isDeleted?: boolean;
  onSelect?(): void;
}) {
  const flag = useFeatureFlag(enableMacroComputers);
  return (
    <Show
      when={
        !flag().loading && flag().enabled && props.userId && !props.isDeleted
      }
    >
      <Suspense>
        <ConnectedPortraitScreenActions {...props} />
      </Suspense>
    </Show>
  );
}

function ConnectedPortraitScreenActions(props: {
  userId?: string;
  onSelect?(): void;
}) {
  const isAgent = () => isAgentAccount(tryMacroId(props.userId ?? ''));
  const isBot = () => isBotPrincipalId(props.userId);
  const computer = useTeamAgentComputerQuery(() => props.userId, isAgent);
  const bots = useAgentsQuery(isBot);
  const directory = useHarnessDirectoryQuery(() => isAgent() || isBot());
  const screen = useSettingsComputerScreen();
  const navigation = useOptionalSettingsScreenNavigation();
  const settings = useSettingsState();
  const harness = createMemo(() => {
    if (!queryReadyGate(directory)) return;
    let id: string | undefined | null;
    if (isAgent() && queryReadyGate(computer)) id = computer.data.harnessId;
    else if (isBot() && queryReadyGate(bots)) {
      id = bots.data.find(
        (item) => `bot|${item.bot.id}` === props.userId
      )?.harness_id;
    }
    return directory.data.find(
      (item) => item.id === id && item.capabilities?.screen === true
    );
  });
  const open = (control: boolean) => {
    const runtime = harness();
    if (
      !runtime?.capabilities?.screen ||
      (control && (!hasHarnessEditAccess(runtime) || isTouchDevice()))
    )
      return;
    const interaction = beginInteraction('computer.screen.open', {
      attributes: { 'harness.id': runtime.id },
    });
    try {
      if (screen) screen.openHarness(runtime.id, control);
      else if (navigation) {
        navigation.request(runtime.id, control);
        settings.openSettings('Harness');
      } else return;
      props.onSelect?.();
    } finally {
      interaction.end();
    }
  };
  return (
    <PortraitScreenActionButtons
      harness={harness()}
      mobile={isTouchDevice()}
      onOpen={open}
    />
  );
}

export function PortraitScreenActionButtons(props: {
  harness?: Harness;
  mobile: boolean;
  onOpen(control: boolean): void;
}) {
  const canWatch = () => props.harness?.capabilities?.screen === true;
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
