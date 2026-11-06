import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { enableTeamAgents } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { useAgentsQuery } from '@queries/agents/agents';
import {
  useHarnessDirectoryQuery,
  useHarnessesQuery,
} from '@queries/harnesses/harnesses';
import type { Harness } from '@service-storage/generated/schemas/harness';
import { createMemo, type ParentProps, Show, Suspense } from 'solid-js';
import { RuntimeAccessAction } from '../runtime-sharing/components/RuntimeAccessAction';
import { ScreenToolbar } from './components/screen-toolbar';
import { type ScreenHost, ScreenProvider } from './context/screen-context';
import { createScreenPaneState } from './pane-state';
import { connectScreen } from './queries/novnc';
import { resolveScreenUrl } from './queries/screen-url';
import { ScreenPane } from './views/screen-pane';
import { ScreenSplit } from './views/screen-split';

export function AgentComputerScreen(
  props: ParentProps<{
    sessionId: string | undefined;
    botId: string | undefined;
    canEdit: boolean;
  }>
) {
  return (
    <Suspense fallback={props.children}>
      <ConnectedAgentComputerScreen {...props} />
    </Suspense>
  );
}

function ConnectedAgentComputerScreen(
  props: ParentProps<{
    sessionId: string | undefined;
    botId: string | undefined;
    canEdit: boolean;
  }>
) {
  const flag = useFeatureFlag(enableTeamAgents);
  const sharingEnabled = () => !flag().loading && flag().enabled;
  const agents = useAgentsQuery(() => !!props.botId);
  const harnesses = useHarnessesQuery();
  const directory = useHarnessDirectoryQuery(sharingEnabled);
  const registered = (): readonly Harness[] => {
    if (flag().loading) return [];
    if (flag().enabled)
      return directory.isPending ? [] : (directory.data ?? []);
    return harnesses.isPending ? [] : (harnesses.data ?? []);
  };
  const harness = createMemo(() => {
    if (agents.isPending) return undefined;
    const id = agents.data?.find(
      (agent) => agent.bot.id === props.botId
    )?.harness_id;
    return registered().find(
      (item) => item.id === id && item.capabilities?.screen === true
    );
  });
  const canControl = () => {
    if (flag().loading) return false;
    if (!flag().enabled) return props.canEdit;
    return harness()?.access === 'user' || harness()?.access === 'owner';
  };
  const canView = () => {
    if (!sharingEnabled()) return !flag().loading;
    const access = harness()?.access;
    return (
      access === 'read' ||
      access === 'resident' ||
      access === 'user' ||
      access === 'owner'
    );
  };
  const { open, setOpen } = createScreenPaneState();
  const host: ScreenHost = {
    sessionId: () => props.sessionId,
    harnessId: () => harness()?.id,
    title: () => harness()?.name,
    canEdit: canControl,
    mobile: isTouchDevice,
    resolveUrl: resolveScreenUrl,
  };
  return (
    <ScreenProvider
      value={{ host, available: () => !!harness(), open, setOpen }}
    >
      <ScreenSplit
        connect={connectScreen}
        pane={
          <Show
            when={canView()}
            fallback={
              <section
                aria-label={t('runtimeSharing.computerScreen')}
                class="flex size-full min-h-0 flex-col bg-panel text-ink"
              >
                <ScreenToolbar
                  title={harness()?.name}
                  showStatus={false}
                  canControl={false}
                  controlling={false}
                  onToggleControl={() => {}}
                  onClose={() => setOpen(false)}
                />
                <div class="flex flex-col gap-3 p-4 text-sm">
                  <p class="text-ink-muted">
                    {t('runtimeSharing.requestComputerView')}
                  </p>
                  <Show when={harness()}>
                    {(runtime) => (
                      <RuntimeAccessAction harnessId={runtime().id} />
                    )}
                  </Show>
                </div>
              </section>
            }
          >
            <ScreenPane
              connect={connectScreen}
              requestControl={
                <Show
                  when={
                    sharingEnabled() &&
                    harness()?.access === 'read' &&
                    !harness()?.is_agent_computer
                  }
                >
                  <RuntimeAccessAction
                    harnessId={harness()?.id ?? ''}
                    controlOnly
                  />
                </Show>
              }
            />
          </Show>
        }
      >
        {props.children}
      </ScreenSplit>
    </ScreenProvider>
  );
}
