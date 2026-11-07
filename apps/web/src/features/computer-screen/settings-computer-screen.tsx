import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { resolveScreenUrl } from '@app/lib/service-clients/service-agent-harness/screen-url';
import {
  beginInteraction,
  TraceFlow,
  usePending,
} from '@app/observability/flow';
import { toast } from '@core/component/Toast/Toast';
import { enableMacroComputers } from '@core/constant/featureFlags';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import type { Span } from '@macro-inc/observability';
import { useHarnessDirectoryQuery } from '@queries/harnesses/harnesses';
import { useTeamAgentComputerMutation } from '@queries/team-agents';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  type ParentProps,
  Show,
  Suspense,
} from 'solid-js';
import { RuntimeAccessAction } from '../runtime-sharing/components/RuntimeAccessAction';
import { ScreenToolbar } from './components/screen-toolbar';
import { type ScreenHost, ScreenProvider } from './context/screen-context';
import { SettingsComputerScreenContext } from './context/settings-screen-context';
import { useOptionalSettingsScreenNavigation } from './context/settings-screen-navigation';
import { hasHarnessEditAccess } from './harness-access';
import { connectScreen } from './queries/novnc';
import { ScreenPane } from './views/screen-pane';
import { ScreenSplit } from './views/screen-split';

/** Settings reuses the screen pane as its main content at every width. */
export function SettingsComputerScreen(props: ParentProps) {
  const flag = useFeatureFlag(enableMacroComputers);
  const enabled = () => !flag().loading && flag().enabled;
  return (
    <Show when={enabled()} fallback={props.children}>
      <Suspense
        fallback={
          <p role="status">{t('runtimeSharing.loadingComputerAccess')}</p>
        }
      >
        <ConnectedSettingsComputerScreen>
          {props.children}
        </ConnectedSettingsComputerScreen>
      </Suspense>
    </Show>
  );
}

function ConnectedSettingsComputerScreen(props: ParentProps) {
  const directory = useHarnessDirectoryQuery();
  const discovery = useTeamAgentComputerMutation();
  const navigation = useOptionalSettingsScreenNavigation();
  const [flowVersion, setFlowVersion] = createSignal(0);
  const [harnessId, setHarnessId] = createSignal<string>();
  const [agentComputer, setAgentComputer] = createSignal(false);
  const [open, setOpen] = createSignal(false);
  const [startControlling, setStartControlling] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let request = 0;
  let operationSpan: Span | undefined;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
    request++;
  });
  const directoryReady = () =>
    !directory.isPending && directory.data !== undefined;
  const harness = createMemo(() =>
    directoryReady()
      ? directory.data?.find((item) => item.id === harnessId())
      : undefined
  );

  const canView = () => {
    const access = harness()?.access;
    return (
      access === 'read' ||
      access === 'resident' ||
      access === 'user' ||
      access === 'owner'
    );
  };
  const host: ScreenHost = {
    sessionId: () => undefined,
    harnessId,
    title: () => harness()?.name,
    startControlling,
    canEdit: () => hasHarnessEditAccess(harness()),
    touch: isTouchDevice,
    resolveUrl: (id, control) =>
      operationSpan
        ? operationSpan.run(() => resolveScreenUrl(id, control))
        : resolveScreenUrl(id, control),
  };
  const openHarness = (id: string, control = false) => {
    if (disposed) return;
    const interaction = beginInteraction('computer.screen.open', {
      attributes: { 'harness.id': id },
    });
    operationSpan = interaction.span;
    request++;
    setFlowVersion(request);
    try {
      setLoading(false);
      setError(undefined);
      setAgentComputer(false);
      setStartControlling(control);
      setHarnessId(id);
      setOpen(true);
      fireAndForget(directory.refetch(), 'computer-screen.access.refresh');
    } finally {
      interaction.end();
    }
  };
  createEffect(() => {
    const id = navigation?.requestedHarness();
    if (!id) return;
    openHarness(id, navigation?.requestedControl?.() ?? false);
    navigation?.consume(id);
  });
  const openAgentComputer = (userId: string) => {
    if (disposed) return;
    const interaction = beginInteraction('computer.screen.open');
    operationSpan = interaction.span;
    const current = ++request;
    setFlowVersion(current);
    setAgentComputer(true);
    setStartControlling(false);
    setHarnessId(undefined);
    setError(undefined);
    setLoading(true);
    setOpen(true);
    const resolve = async () => {
      try {
        const computer = await discovery.mutateAsync({
          userId,
          parentSpan: interaction.span,
        });
        if (current !== request) return;
        setAgentComputer(computer.isAgentComputer);
        if (!computer.harnessId) setError('starting');
        else setHarnessId(computer.harnessId);
      } catch {
        if (current === request) {
          setError('lookup');
          toast.failure(t('runtimeSharing.computerLoadFailed'));
        }
      } finally {
        if (current === request) setLoading(false);
      }
    };
    try {
      fireAndForget(directory.refetch(), 'computer-screen.access.refresh');
      fireAndForget(resolve(), 'computer-screen.agent.open');
    } finally {
      interaction.end();
    }
  };
  const close = () => {
    request++;
    setOpen(false);
  };
  return (
    <SettingsComputerScreenContext.Provider
      value={{ openHarness, openAgentComputer }}
    >
      <ScreenProvider
        value={{
          host,
          available: () => true,
          open,
          setOpen: (value) => (value ? setOpen(true) : close()),
        }}
      >
        <ScreenSplit
          takeover
          connect={connectScreen}
          pane={
            <TraceFlow name="computer.screen.settings" key={flowVersion}>
              <ScreenLoadingPhases
                discovery={loading}
                access={() => directory.isPending}
              >
                <Show
                  when={
                    !loading() && !error() && !directory.isPending && canView()
                  }
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
                        onClose={close}
                      />
                      <div class="flex flex-col gap-3 p-4 text-sm">
                        <Show when={loading() || directory.isPending}>
                          <p role="status">
                            {t('runtimeSharing.loadingComputerAccess')}
                          </p>
                        </Show>
                        <Show when={error() || directory.isError}>
                          <p role="alert">
                            {error() === 'starting'
                              ? t('runtimeSharing.computerStarting')
                              : t('runtimeSharing.computerAccessFailed')}
                          </p>
                        </Show>
                        <Show
                          when={
                            !loading() &&
                            !error() &&
                            directoryReady() &&
                            harnessId()
                          }
                        >
                          {(id) => (
                            <>
                              <p class="text-ink-muted">
                                {t('runtimeSharing.requestComputerView')}
                              </p>
                              <RuntimeAccessAction harnessId={id()} />
                            </>
                          )}
                        </Show>
                      </div>
                    </section>
                  }
                >
                  <div class="flex size-full min-h-0 flex-col">
                    <Show when={directory.isError}>
                      <p
                        role="alert"
                        class="shrink-0 p-2 text-xs text-ink-muted"
                      >
                        {t('runtimeSharing.computerAccessRefreshFailed')}
                      </p>
                    </Show>
                    <div class="min-h-0 flex-1">
                      <ScreenPane
                        connect={connectScreen}
                        requestControl={
                          <Show
                            when={
                              !agentComputer() &&
                              harness()?.access === 'read' &&
                              !harness()?.is_agent_computer
                            }
                          >
                            <RuntimeAccessAction
                              harnessId={harnessId() ?? ''}
                              controlOnly
                            />
                          </Show>
                        }
                      />
                    </div>
                  </div>
                </Show>
              </ScreenLoadingPhases>
            </TraceFlow>
          }
        >
          {props.children}
        </ScreenSplit>
      </ScreenProvider>
    </SettingsComputerScreenContext.Provider>
  );
}

function ScreenLoadingPhases(
  props: ParentProps<{
    discovery: Accessor<boolean>;
    access: Accessor<boolean>;
  }>
) {
  usePending('computer.screen.discovery', props.discovery);
  usePending('computer.screen.access', props.access);
  return props.children;
}
