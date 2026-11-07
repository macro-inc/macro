import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { beginInteraction } from '@app/observability/flow';
import { enableMacroComputers } from '@core/constant/featureFlags';
import { isBotPrincipalId } from '@core/constant/macroAgent';
import { useSettingsState } from '@core/constant/SettingsState';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isAgentAccount, tryMacroId } from '@core/user';
import { useAgentsQuery } from '@queries/agents/agents';
import { queryReadyGate } from '@queries/gate';
import { useHarnessDirectoryQuery } from '@queries/harnesses/harnesses';
import { useTeamAgentComputerQuery } from '@queries/team-agents';
import type { Harness } from '@service-storage/generated/schemas/harness';
import {
  type Accessor,
  createMemo,
  type JSX,
  onCleanup,
  Show,
  Suspense,
} from 'solid-js';
import { useSettingsComputerScreen } from './context/settings-screen-context';
import { useOptionalSettingsScreenNavigation } from './context/settings-screen-navigation';
import { hasHarnessEditAccess } from './harness-access';

/** Shared discovery and navigation for agent screen entry points. */
type AgentScreenEntryProps = {
  userId?: string;
  isDeleted?: boolean;
  onSelect?(): void;
  children(
    harness: Accessor<Harness | undefined>,
    open: (control: boolean) => void
  ): JSX.Element;
};

export function AgentComputerScreenEntry(props: AgentScreenEntryProps) {
  const flag = useFeatureFlag(enableMacroComputers);
  return (
    <Show
      when={
        !flag().loading && flag().enabled && props.userId && !props.isDeleted
      }
    >
      <Suspense>
        <ConnectedAgentScreenEntry {...props} />
      </Suspense>
    </Show>
  );
}

function ConnectedAgentScreenEntry(props: AgentScreenEntryProps) {
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  const flag = useFeatureFlag(enableMacroComputers);
  const isAgent = () => isAgentAccount(tryMacroId(props.userId ?? ''));
  const isBot = () => isBotPrincipalId(props.userId);
  const computer = useTeamAgentComputerQuery(() => props.userId, isAgent);
  const bots = useAgentsQuery(isBot);
  const directory = useHarnessDirectoryQuery(() => isAgent() || isBot());
  const screen = useSettingsComputerScreen();
  const navigation = useOptionalSettingsScreenNavigation();
  const settings = useSettingsState();
  const resolveHarness = () => {
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
  };
  const harness = createMemo(resolveHarness);
  const open = (control: boolean) => {
    if (
      disposed ||
      flag().loading ||
      !flag().enabled ||
      !props.userId ||
      props.isDeleted
    )
      return;
    const runtime = resolveHarness();
    if (
      !runtime?.capabilities?.screen ||
      runtime.access === 'none' ||
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
  return props.children(harness, open);
}
