import { TextShimmer } from '@app/features/block-agent/ui';
import { useSessionActivity } from '@core/agent-session/session-activity';
import { openExternalUrl } from '@core/util/url';
import type { AgentSessionEntity } from '@entity';
import FilledSparkleIcon from '@icon/system/fill/sparkle-fill.svg?component-solid';
import RoutineIcon from '@icon/system/regular/clock-clockwise.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import { children, type JSX, Show } from 'solid-js';
import { AgentSessionCodeDetails } from '../components/AgentSessionCodeDetails';
import {
  AgentSessionRow,
  AgentSessionStatusIndicator,
} from '../components/AgentSessionRow';
import { kindForHarness, modeForKind, systemBotKind } from '../core/agent-kind';
import { conversationState } from '../core/conversation-state';
import { compactAge } from '../core/format-age';
import type { AgentsMode } from '../core/mode';
import { conversationTimestamp } from '../core/recent-conversations';
import { conversationCodeDetails } from '../queries/conversation-code-details';

type Props = {
  entity: AgentSessionEntity;
  surface: 'home' | 'agents';
  /** The row button's id, for a list that points at its focused row. */
  domId?: string;
  active?: boolean;
  focused?: boolean;
  unread?: boolean;
  mode?: AgentsMode;
  onOpen?: (event: MouseEvent) => void;
  /** Takes the unread dot's place on hover, as a notification's Mark done. */
  hoverAction?: JSX.Element;
};

/** Persisted list metadata stays fresh through the session update events. */
export function AgentSessionListItem(props: Props) {
  const mode = () =>
    props.entity.harness
      ? modeForKind(kindForHarness(props.entity.harness))
      : (props.mode ??
        modeForKind(systemBotKind(props.entity.botId) ?? 'agent'));
  const state = () =>
    conversationState(props.entity.status, props.entity.turnState);
  const failed = () => props.entity.turnState === 'failed';
  const hoverAction = children(() => props.hoverAction);
  const activity = useSessionActivity(() => props.entity.id);
  const summary = () => (state() === 'working' ? activity() : undefined);
  const details = () =>
    mode() === 'code' ? conversationCodeDetails(props.entity) : undefined;

  const hideLeading = () => props.surface === 'agents';
  const codeStatusIndicator = () =>
    props.surface === 'agents' && mode() === 'code' ? (
      <AgentSessionStatusIndicator
        state={state()}
        unread={props.unread}
        failed={failed()}
      />
    ) : undefined;
  const workStatusIndicator = () =>
    props.surface === 'agents' && (mode() !== 'code' || !details()) ? (
      <AgentSessionStatusIndicator
        state={state()}
        unread={props.unread}
        failed={failed()}
      />
    ) : undefined;

  return (
    <AgentSessionRow
      id={props.entity.id}
      domId={props.domId}
      title={props.entity.name || 'Untitled conversation'}
      kind={mode()}
      state={state()}
      failed={failed()}
      active={props.active}
      focused={props.focused}
      unread={props.unread}
      hideLeading={hideLeading()}
      onOpen={props.onOpen}
      hoverAction={hoverAction()}
      timestamp={compactAge(conversationTimestamp(props.entity))}
      leading={
        <Show
          when={props.surface === 'home'}
          fallback={
            <AgentSessionStatusIndicator
              state={state()}
              unread={props.unread}
              failed={failed()}
            />
          }
        >
          <Show when={mode() === 'code'} fallback={<SparkleIcon />}>
            <FilledSparkleIcon />
          </Show>
        </Show>
      }
      trailing={
        <>
          <Show when={props.entity.source === 'routine'}>
            <RoutineIcon
              aria-hidden={false}
              aria-label="Routine run"
              class="size-3.5 shrink-0 text-ink-extra-muted"
            />
          </Show>
          <Show when={props.surface === 'home' && (props.unread || failed())}>
            <span
              aria-label={props.unread ? 'Unread' : 'Last turn failed'}
              class="size-1.5 shrink-0 rounded-full"
              classList={{
                'bg-failure': failed(),
                'bg-accent': !failed(),
                'group-hover/agent-session:hidden': Boolean(hoverAction()),
              }}
            />
          </Show>
          {workStatusIndicator()}
        </>
      }
    >
      <Show when={summary()}>
        {(summary) => (
          <span class="block min-w-0 truncate text-xs text-ink-extra-muted">
            <TextShimmer text={summary()} active />
          </span>
        )}
      </Show>
      <Show when={details()}>
        {(details) => (
          <AgentSessionCodeDetails
            details={details()}
            statusIndicator={codeStatusIndicator()}
            onOpenPullRequest={() => {
              // PRs open on GitHub for now, not in the PR split.
              const url = details().pullRequest?.url;
              if (url) openExternalUrl(url);
            }}
          />
        )}
      </Show>
    </AgentSessionRow>
  );
}
