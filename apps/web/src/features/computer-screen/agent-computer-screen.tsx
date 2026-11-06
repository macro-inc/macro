import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableMacroComputers } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useAgentsQuery } from '@queries/agents/agents';
import { useHarnessesQuery } from '@queries/harnesses/harnesses';
import type { Harness } from '@service-storage/generated/schemas/harness';
import { createMemo, type ParentProps } from 'solid-js';
import { type ScreenHost, ScreenProvider } from './context/screen-context';
import { createScreenPaneState } from './pane-state';
import { connectScreen } from './queries/novnc';
import { resolveScreenUrl } from './queries/screen-url';
import { ScreenSplit } from './views/screen-split';

export function AgentComputerScreen(
  props: ParentProps<{
    sessionId: string | undefined;
    botId: string | undefined;
    canEdit: boolean;
  }>
) {
  const rollout = useFeatureFlag(enableMacroComputers);
  const agents = useAgentsQuery(() => !!props.botId);
  const harnesses = useHarnessesQuery();
  const harness = createMemo(() => {
    if (!agents.isSuccess || !harnesses.isSuccess) return undefined;
    const id = agents.data.find(
      (agent) => agent.bot.id === props.botId
    )?.harness_id;
    const registered: readonly Harness[] = harnesses.data;
    return registered.find(
      (item) => item.id === id && item.capabilities?.screen === true
    );
  });
  const { open, setOpen } = createScreenPaneState();
  const host: ScreenHost = {
    sessionId: () => props.sessionId,
    harnessId: () => harness()?.id,
    canEdit: () => props.canEdit,
    touch: isTouchDevice,
    resolveUrl: resolveScreenUrl,
  };
  return (
    <ScreenProvider
      value={{
        host,
        available: () => rollout().enabled && !!harness(),
        open,
        setOpen,
      }}
    >
      <ScreenSplit connect={connectScreen}>{props.children}</ScreenSplit>
    </ScreenProvider>
  );
}
