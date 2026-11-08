import { fireAndForget } from '@core/util/fireAndForget';
import {
  stopAskingOnRuntime,
  useRuntimeBypassOfferQuery,
} from '@queries/agent-session/runtime-bypass';
import { queryReadyGate } from '@queries/gate';
import type { PendingPermission } from '@service-agent-fold/generated/types';
import type { AgentChoiceChangeDto } from '@service-agent-harness/generated/schemas';
import { type Accessor, createSignal } from 'solid-js';
import { match } from 'ts-pattern';
import type {
  InteractionController,
  StopAskingAction,
} from '../context/interaction';

export type RuntimeBypassSource = {
  sessionId: Accessor<string | undefined>;
  /** A permission request is waiting and the viewer may answer it. */
  enabled: Accessor<boolean>;
  respond: InteractionController['respond'];
  /** The Settings confirmation for turning bypass on. */
  confirm: (options: { alsoSetsAgent: boolean }) => Promise<boolean>;
  onFailure: (message: string) => void;
};

export type RuntimeBypass = {
  /** Undefined where stopping would not stop the asking, or isn't the viewer's to do. */
  action: (request: PendingPermission) => StopAskingAction | undefined;
  /** Confirm, turn bypass on, then answer Allow once whatever the change did. */
  stopAsking: (request: PendingPermission) => Promise<void>;
};

/**
 * "Allow, and stop asking on this runtime" for a session's permission
 * requests. The server says whether it applies; the change goes first, then
 * Allow either way, because answering is what hands the live session its new
 * policy for the rest of the turn.
 */
export function createRuntimeBypass(
  source: RuntimeBypassSource
): RuntimeBypass {
  const offer = useRuntimeBypassOfferQuery(source.sessionId, source.enabled);
  const [running, setRunning] = createSignal(false);

  const changes = () => (queryReadyGate(offer) ? offer.data : undefined);

  // The same option Allow once answers; several are ambiguous.
  const allowOnce = (request: PendingPermission) => {
    const allows = request.options.filter(
      (option) => option.kind === 'allow_once'
    );
    return allows.length === 1 ? allows[0] : undefined;
  };

  const stopAsking = async (request: PendingPermission) => {
    const sessionId = source.sessionId();
    const offered = changes();
    const allow = allowOnce(request);
    if (!sessionId || !offered || !allow || running()) return;

    const confirmed = await source.confirm({
      alsoSetsAgent: offered.enablesAgentAutoAccept,
    });
    if (!confirmed) return;

    setRunning(true);
    try {
      const outcome: AgentChoiceChangeDto | 'runtimeUnchanged' =
        await stopAskingOnRuntime(sessionId).then(
          (result) =>
            result.isOk() ? result.value.agent : 'runtimeUnchanged',
          () => 'runtimeUnchanged'
        );
      await source.respond({
        kind: 'permission',
        requestId: request.requestId,
        turn: request.turn,
        answer: { kind: 'selected', optionId: allow.id },
      });
      const failure = match(outcome)
        .with('notNeeded', 'setToBypass', () => undefined)
        .with(
          'stillAsks',
          () =>
            "Allowed once. Bypass is on for this runtime, but the agent couldn't be set to bypass, so it will keep asking."
        )
        .with(
          'runtimeUnchanged',
          () =>
            "Allowed once. Bypass wasn't turned on, so the agent will keep asking."
        )
        .exhaustive();
      if (failure) source.onFailure(failure);
    } finally {
      setRunning(false);
    }
  };

  return {
    action: (request) => {
      if (!changes() || !allowOnce(request)) return undefined;
      return {
        running: running(),
        onSelect: () =>
          fireAndForget(stopAsking(request), 'agent-interactions'),
      };
    },
    stopAsking,
  };
}
