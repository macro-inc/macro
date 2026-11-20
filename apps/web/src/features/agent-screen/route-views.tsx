import { t } from '@app/lib/i18n';
import { useRouteParams } from '@app/lib/split-router';
import { agentScreenRoute } from '@app/routes/routes';
import { useSplitDisplayName } from '@components/app/split-layout/layoutUtils';
import { withAuth } from '@components/app/split-layout/split-router/app-route-shell';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { getDisplayName, tryMacroId } from '@core/user';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  useComputersQuery,
  useSetComputerPowerMutation,
} from '@queries/computers/computers';
import { useHarnessesQuery } from '@queries/harnesses/harnesses';
import { createSignal, Show } from 'solid-js';
import { match } from 'ts-pattern';
import {
  type ScreenCapabilities,
  ScreenCapabilitiesProvider,
  useScreenCapabilities,
} from './context/screen-context';
import { createScreenInput } from './primitives/screen-input';
import { createScreenSession } from './primitives/screen-session';
import { requestScreenTicket } from './queries/screen-tickets';
import { VNC_TRANSPORT } from './transports/vnc';
import { AgentScreen } from './views/agent-screen';
import { MobileAgentScreen } from './views/mobile/agent-screen';
import type { AgentScreenModel } from './views/shared/agent-screen-model';

const PRODUCTION_CAPABILITIES: ScreenCapabilities = {
  requestTicket: requestScreenTicket,
  transport: (kind) =>
    match(kind)
      .with('vnc', () => VNC_TRANSPORT)
      .exhaustive(),
};

function AgentScreenModelProvider(props: { harnessId: string }) {
  const capabilities = useScreenCapabilities();
  const currentUserId = useUserId();
  const harnesses = useHarnessesQuery();
  const computers = useComputersQuery(() => true);
  const setPower = useSetComputerPowerMutation();

  // Guarded reads: an unguarded `data` suspends the whole screen.
  const harness = () =>
    harnesses.isSuccess
      ? harnesses.data.find((each) => each.id === props.harnessId)
      : undefined;
  const computer = () =>
    computers.isSuccess
      ? computers.data.find((each) => each.harnessId === props.harnessId)
      : undefined;

  // Driving needs Manage. A computer belongs to its team, and the harness
  // list reports Manage as `owner` access for the team's owner and its admins
  // alike (crates/harnesses `ensure_may_manage`).
  const canDrive = () => harness()?.access === 'owner';
  // Until the list has loaded, nobody is known to manage: don't connect yet.
  const accessKnown = () => !harnesses.isPending;
  const agentName = () => {
    const agentUserId = harness()?.team_agent_user_id;
    return (
      (agentUserId ? getDisplayName(tryMacroId(agentUserId)) : '') ||
      harness()?.name ||
      ''
    );
  };
  useSplitDisplayName(agentName);

  const session = createScreenSession({
    harnessId: props.harnessId,
    canDrive,
    accessKnown,
    currentUserId,
    transport: () => 'vnc',
    capabilities,
  });

  const [containerSize, setContainerSize] = createSignal({
    width: 0,
    height: 0,
  });
  const input = createScreenInput({
    frame: () => session.store.frame,
    container: () => containerSize(),
    rotation: () => 0,
    sendsInput: session.drivingMe,
    send: (event) => session.sendInput(event),
    onHandBackHold: () => session.handBack(null),
  });

  const turnOn = async () => {
    const target = computer();
    if (!target) return;
    await setPower.mutateAsync({ computerId: target.id, on: true });
    session.retry();
  };

  const model: AgentScreenModel = {
    harnessId: props.harnessId,
    agentName,
    canDrive,
    session,
    input,
    setContainerSize,
    driverName: () => {
      const driver = session.store.server?.driver;
      if (!driver) return undefined;
      return (
        getDisplayName(tryMacroId(driver.userId)) ||
        driver.name ||
        t('agentScreen.someoneElse')
      );
    },
    turnOn: () =>
      canDrive() && computer()
        ? () => fireAndForget(turnOn(), 'agent-screen.turn-on')
        : undefined,
  };

  return (
    <Show when={isTouchDevice()} fallback={<AgentScreen model={model} />}>
      <MobileAgentScreen model={model} />
    </Show>
  );
}

/**
 * The screen viewer for one agent computer. The route renders it from the
 * URL; split content (`agentScreenContent`) renders it from the component
 * registry with the same harness id.
 */
export const AgentScreenView = withAuth((props: { harnessId: string }) => (
  <ScreenCapabilitiesProvider value={PRODUCTION_CAPABILITIES}>
    <Show when={props.harnessId} keyed>
      {(harnessId) => <AgentScreenModelProvider harnessId={harnessId} />}
    </Show>
  </ScreenCapabilitiesProvider>
));

export function AgentScreenRouteView() {
  const params = useRouteParams(agentScreenRoute);
  return <AgentScreenView harnessId={params.harnessId ?? ''} />;
}
