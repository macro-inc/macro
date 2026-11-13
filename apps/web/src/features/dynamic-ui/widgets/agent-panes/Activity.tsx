import { useActivityContext } from '@app/features/activity/context/activity-context';
import { collapseRuns } from '@app/features/activity/core/collapse-runs';
import { openEntityInSplit } from '@app/features/activity/open-entity-in-split';
import { createMyActivityQuery } from '@app/features/activity/queries/feed-query';
import { ActivityTimelineRow } from '@app/features/activity/views/activity-timeline-row';
import { createPanelState } from '@app/features/agent-session-activity/primitives/create-panel-state';
import { createAgentActivitySource } from '@app/features/agent-session-activity/queries/create-agent-activity-source';
import { AgentActivityItemRow } from '@app/features/agent-session-activity/views/agent-activity-section';
import { t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useUserId } from '@core/context/user';
import { ThrownResultError } from '@core/util/result';
import { agentSessionQueryOptions } from '@queries/agent-session/session';
import { useQuery } from '@tanstack/solid-query';
import { Button } from '@ui';
import { createMemo, For, Match, Show, Switch } from 'solid-js';
import type { WidgetOf } from '../../view';
import { AgentPane, PaneScroll } from '../panes/agent-pane';
import {
  NO_ACCESS_CODES,
  NoAccess,
  PaneLoading,
  PaneMessage,
  usePaneDense,
} from '../panes/pane';

export type ActivityProps = Omit<WidgetOf<'activity'>, 'type'>;

const DEFAULT_LIMIT = 20;

/**
 * What an agent did, newest first, as the Activity feed draws it: its
 * activity on items shared with the viewer (all of it, for the agent
 * itself), or what one of its sessions did, as the session's activity panel
 * draws it. Rows open their items; a session's pane opens the session.
 */
export function Activity(props: ActivityProps) {
  const dense = usePaneDense(() => props.dense);
  const { openWithSplit } = useSplitLayout();
  const limit = () => props.limit ?? DEFAULT_LIMIT;
  return (
    <AgentPane
      type="activity"
      agentId={props.agentId}
      title={props.title ?? t('dynamicUi.activity')}
      dense={dense()}
      attributes={
        props.sessionId
          ? {
              'activity.source': 'session',
              'agent.session.id': props.sessionId,
            }
          : { 'activity.source': 'actor' }
      }
      trailing={
        <Show when={props.sessionId}>
          {(sessionId) => (
            <Button
              variant="ghost"
              size="xs"
              onClick={() =>
                openWithSplit(
                  { type: 'agent', id: sessionId() },
                  { activate: true }
                )
              }
            >
              {t('dynamicUi.openSession')}
            </Button>
          )}
        </Show>
      }
    >
      {(agentId) => (
        <Show
          when={props.sessionId}
          fallback={
            <ActorActivity agentId={agentId} limit={limit()} dense={dense()} />
          }
        >
          {(sessionId) => (
            <SessionActivity
              sessionId={sessionId()}
              limit={limit()}
              dense={dense()}
            />
          )}
        </Show>
      )}
    </AgentPane>
  );
}

/**
 * The agent's own feed when the viewer is the agent; otherwise the team feed
 * narrowed to the agent, which holds only items shared with the viewer.
 */
function ActorActivity(props: {
  agentId: string;
  limit: number;
  dense: boolean;
}) {
  const context = useActivityContext();
  const viewer = useUserId();
  const own = () => viewer() === props.agentId;
  const query = createMyActivityQuery(context, {
    scope: own() ? 'mine' : 'team',
    enabled: () => true,
    actorId: () => (own() ? undefined : props.agentId),
  });
  usePending('dynamic_ui.pane.load', () => query.isPending);
  const entries = createMemo(() =>
    collapseRuns(
      (query.isPending ? [] : (query.data ?? [])).filter((event) =>
        context.entityTypeShown(event.entityType)
      )
    ).slice(0, props.limit)
  );
  return (
    <Switch
      fallback={
        <PaneScroll>
          <For each={entries()}>
            {(entry) => (
              <ActivityTimelineRow entry={entry} onOpen={openEntityInSplit} />
            )}
          </For>
        </PaneScroll>
      }
    >
      <Match when={query.isPending}>
        <PaneLoading dense={props.dense} />
      </Match>
      <Match when={query.isError && entries().length === 0}>
        <PaneMessage dense={props.dense}>{t('dynamicUi.failed')}</PaneMessage>
      </Match>
      <Match when={entries().length === 0}>
        <PaneMessage dense={props.dense}>
          {t('dynamicUi.noActivity')}
        </PaneMessage>
      </Match>
    </Switch>
  );
}

/** One session's activity, after checking the viewer can open the session. */
function SessionActivity(props: {
  sessionId: string;
  limit: number;
  dense: boolean;
}) {
  const session = useQuery(() => ({
    ...agentSessionQueryOptions(props.sessionId),
    retry: false,
  }));
  usePending('dynamic_ui.pane.load', () => session.isPending);
  const noAccess = () =>
    session.isError &&
    session.error instanceof ThrownResultError &&
    session.error.errors.some((error) => NO_ACCESS_CODES.includes(error.code));
  return (
    <Switch>
      <Match when={session.isPending}>
        <PaneLoading dense={props.dense} />
      </Match>
      <Match when={noAccess()}>
        <NoAccess dense={props.dense} />
      </Match>
      <Match when={session.isError}>
        <PaneMessage dense={props.dense}>{t('dynamicUi.failed')}</PaneMessage>
      </Match>
      <Match when={session.isSuccess}>
        <SessionRows
          sessionId={props.sessionId}
          limit={props.limit}
          dense={props.dense}
        />
      </Match>
    </Switch>
  );
}

function SessionRows(props: {
  sessionId: string;
  limit: number;
  dense: boolean;
}) {
  const context = useActivityContext();
  const source = createAgentActivitySource(() => props.sessionId);
  const state = createPanelState(source);
  usePending('dynamic_ui.pane.load', source.isPending);
  const items = () => state.items().slice(0, props.limit);
  return (
    <Switch
      fallback={
        <PaneScroll>
          <For each={items()}>
            {(item) => (
              <AgentActivityItemRow
                item={item}
                now={Date.now()}
                entityDisplay={context.entityDisplay}
                open={state.openKey() === item.key}
                unseen={false}
                onSeen={() => {}}
                onToggle={() =>
                  state.setOpenKey(
                    state.openKey() === item.key ? undefined : item.key
                  )
                }
                ref={() => {}}
              />
            )}
          </For>
        </PaneScroll>
      }
    >
      <Match when={source.isPending()}>
        <PaneLoading dense={props.dense} />
      </Match>
      <Match when={items().length === 0}>
        <PaneMessage dense={props.dense}>
          {t('dynamicUi.noActivity')}
        </PaneMessage>
      </Match>
    </Switch>
  );
}
