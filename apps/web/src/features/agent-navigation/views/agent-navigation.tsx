/**
 * Applies an agent's `macro.ui.open` in this tab: the `ui_command` frame the
 * harness sends to the person who prompted it. Owned once by the app shell.
 */

import { analytics } from '@app/lib/analytics/analytics';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import {
  type SplitLocation,
  type SplitRouter,
  useOptionalSplitRouter,
} from '@app/lib/split-router';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  agentNavigationRunsHere,
  startUiClientId,
  uiClientId,
} from '@core/agent-session/ui-client';
import { toast } from '@core/component/Toast/Toast';
import { enableAgentNavigation } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { fireAndForget } from '@core/util/fireAndForget';
import ArrowCounterClockwise from '@icon/system/regular/arrow-counter-clockwise.svg?component-solid';
import ArrowSquareOut from '@icon/system/regular/arrow-square-out.svg?component-solid';
import { type Span, Telemetry } from '@macro-inc/observability';
import {
  createConnectionWebsocketEffect,
  type FromWebsocketMessage,
  parseWebsocketPayload,
} from '@service-connection/websocket';
import { createEffect, on, type ParentProps } from 'solid-js';
import {
  type AgentArrivals,
  AgentArrivalsProvider,
  createAgentArrivals,
} from '../context/agent-arrivals';
import {
  decideUiCommand,
  UI_COMMAND_MESSAGE,
  type UiCommandFrame,
} from '../core/ui-command';
import { type ApplyOutcome, applyOpen } from '../primitives/apply-ui-command';

/** Undo stays on offer a little longer than an ordinary notice. */
const UNDO_TOAST_MS = 8_000;

/**
 * Undo, traced with its outcome. A leave guard can keep the pane (unsaved
 * edits); Undo then stays on offer.
 */
async function undoOpen(
  frame: UiCommandFrame,
  route: string,
  outcome: Extract<ApplyOutcome, { kind: 'opened' }>
) {
  const span = Telemetry.span('ui.command.undo');
  span.setAttr('ui.command.id', frame.commandId);
  span.setAttr('ui.route', route);
  try {
    const undone = await outcome.undo();
    span.setAttr('outcome', undone ? 'undone' : 'kept');
    analytics.track('agent_ui_command_undone', {
      route,
      outcome: undone ? 'undone' : 'kept',
    });
    if (!undone) offerUndo(frame, route, outcome);
  } finally {
    span.end();
  }
}

function offerUndo(
  frame: UiCommandFrame,
  route: string,
  outcome: Extract<ApplyOutcome, { kind: 'opened' }>
) {
  const toastId = toast.success(
    t('agentNavigation.opened', { agent: frame.agentName }),
    {
      stack: true,
      duration: UNDO_TOAST_MS,
      dismissStyle: 'icon',
      actionLayout: 'inline',
      actions: [
        {
          label: t('agentNavigation.undo'),
          icon: ArrowCounterClockwise,
          onClick: () => {
            if (toastId !== undefined) toast.dismiss(toastId);
            fireAndForget(undoOpen(frame, route, outcome), 'agent-navigation');
          },
        },
      ],
    }
  );
}

/** No room for another pane: the person decides whether to make room. */
function offerOpen(
  router: SplitRouter,
  frame: UiCommandFrame,
  location: SplitLocation
) {
  const toastId = toast.success(
    t('agentNavigation.noRoom', { agent: frame.agentName }),
    {
      stack: true,
      subtext: t('agentNavigation.noRoomDescription'),
      duration: UNDO_TOAST_MS,
      dismissStyle: 'icon',
      actions: [
        {
          label: t('agentNavigation.open'),
          icon: ArrowSquareOut,
          trailingIcon: true,
          onClick: () => {
            if (toastId !== undefined) toast.dismiss(toastId);
            fireAndForget(
              router.open({ location }, { newPane: true }),
              'agent-navigation'
            );
          },
        },
      ],
    }
  );
}

/** The span the harness started, carried in the gateway envelope. */
function applySpan(message: FromWebsocketMessage): Span {
  const traceparent = message.trace?.traceparent;
  if (!traceparent) return Telemetry.span('ui.command.apply');

  return Telemetry.remoteContext(traceparent).run(() =>
    Telemetry.span('ui.command.apply')
  );
}

async function apply(
  span: Span,
  router: SplitRouter,
  arrivals: AgentArrivals,
  userId: string,
  payload: unknown
) {
  const validate = span.span('ui.command.validate');
  const decision = decideUiCommand(
    router.routes,
    { userId, clientId: uiClientId() },
    payload
  );
  validate.setAttr('ui.command.decision', decision.kind);
  validate.end();
  if (decision.kind === 'ignore') {
    span.setAttr('outcome', 'ignored');
    return;
  }

  // Not for this tab to open, whatever the server allowed. Nothing shows:
  // the agent already links what it couldn't open.
  if (decision.kind === 'refuse') {
    span.setAttr('outcome', 'declined.not_allowed_route');
    analytics.track('agent_ui_command', {
      kind: 'open',
      outcome: 'not_allowed_route',
    });
    return;
  }

  const { frame, location, route } = decision;
  span.setAttr('ui.command.id', frame.commandId);
  span.setAttr('ui.command.kind', frame.kind);
  span.setAttr('ui.route', route);
  span.setAttr('agent_session.id', frame.sessionId);

  const opening = span.span('ui.command.open');
  const outcome = await opening.run(() =>
    applyOpen(
      {
        router,
        manager: globalSplitManager(),
        arrivals,
        stacked: isNativeMobilePlatform(),
      },
      frame,
      location
    )
  );
  opening.end();

  if (outcome.kind === 'opened') {
    await span.span('ui.command.route_arrival', () => router.settled());
  }

  span.setAttr('outcome', outcome.kind);
  analytics.track('agent_ui_command', {
    kind: 'open',
    outcome: outcome.kind,
    route,
  });

  if (outcome.kind === 'opened') offerUndo(frame, route, outcome);
  if (outcome.kind === 'no_room') offerOpen(router, frame, location);
}

/**
 * Applies `ui_command` frames meant for this tab, and holds read markers in
 * the panes an agent opened until the person touches them.
 */
export function AgentNavigationProvider(props: ParentProps) {
  // Takes this tab's id as the app starts, or once the page stops reading as
  // touch-first (device emulation turned off); never on mobile.
  createEffect(on(agentNavigationRunsHere, startUiClientId));
  const arrivals = createAgentArrivals();
  const router = useOptionalSplitRouter();
  const userId = useUserId();
  const navigation = useFeatureFlag(enableAgentNavigation);

  createConnectionWebsocketEffect((message) => {
    if (message.type !== UI_COMMAND_MESSAGE) return;
    if (!navigation().enabled) return;
    if (!agentNavigationRunsHere()) return;

    const user = userId();
    if (!router || !user) return;

    const payload = parseWebsocketPayload<unknown>(message.type, message.data);
    const span = applySpan(message);
    fireAndForget(
      (async () => {
        try {
          await apply(span, router, arrivals, user, payload);
        } catch (error) {
          span.error(String(error));
          throw error;
        } finally {
          span.end();
        }
      })(),
      'agent-navigation'
    );
  });

  return (
    <AgentArrivalsProvider arrivals={arrivals}>
      {props.children}
    </AgentArrivalsProvider>
  );
}
