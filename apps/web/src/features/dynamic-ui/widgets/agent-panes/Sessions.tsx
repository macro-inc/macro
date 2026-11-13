import { conversationState } from '@app/features/agents-view/core/conversation-state';
import { AgentSessionListItem } from '@app/features/agents-view/views/AgentSessionListItem';
import type { AgentSessionEntity } from '@app/features/entity/types/entity';
import { t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { agentSessionQueryOptions } from '@queries/agent-session/session';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { useQueries } from '@tanstack/solid-query';
import { createMemo, For, type JSX, Show } from 'solid-js';
import {
  buildSessionTree,
  parentSessionOf,
  type SessionNode,
} from '../../core/session-tree';
import { agentSessionsQuery } from '../../queries/agent-panes';
import type { WidgetOf } from '../../view';
import { AgentPane, PaneScroll } from '../panes/agent-pane';
import { PaneLoading, PaneMessage, usePaneDense } from '../panes/pane';

export type SessionsProps = Omit<WidgetOf<'sessions'>, 'type'>;

const DEFAULT_LIMIT = 10;
/** Sub-agents are found from their origin; only this many are looked up. */
const MAX_LINEAGE_LOOKUPS = 25;

/**
 * An agent's sessions and the sub-agents they started, as the Agents list
 * draws them: live status, the waiting dot, the activity line. Reads the
 * sessions the viewer can see; each row opens its session.
 */
export function Sessions(props: SessionsProps) {
  const dense = usePaneDense(() => props.dense);
  return (
    <AgentPane
      type="sessions"
      agentId={props.agentId}
      title={props.title ?? t('dynamicUi.sessions')}
      dense={dense()}
    >
      {(agentId) => (
        <SessionTree
          agentId={agentId}
          limit={props.limit ?? DEFAULT_LIMIT}
          dense={dense()}
        />
      )}
    </AgentPane>
  );
}

function SessionTree(props: {
  agentId: string;
  limit: number;
  dense: boolean;
}) {
  const { openWithSplit } = useSplitLayout();
  const query = useSoupAstItemsQuery(
    () => agentSessionsQuery(props.agentId),
    () => ({ keepPreviousData: true })
  );
  usePending('dynamic_ui.pane.load', () => query.isPending);
  const sessions = createMemo(() =>
    // A pending read would suspend the whole view.
    (query.isPending ? [] : (query.data?.entities ?? [])).filter(
      (entity): entity is AgentSessionEntity => entity.type === 'agent_session'
    )
  );
  // Only sessions another agent started can sit under a parent.
  const dispatched = () =>
    sessions()
      .filter((session) => session.source === 'agent')
      .slice(0, MAX_LINEAGE_LOOKUPS);
  const details = useQueries(() => ({
    queries: dispatched().map((session) =>
      agentSessionQueryOptions(session.id)
    ),
  }));
  const parents = createMemo(() => {
    const byId = new Map<string, string>();
    for (const detail of details) {
      if (!detail.isSuccess) continue;
      const parent = parentSessionOf(detail.data.origin);
      if (parent) byId.set(detail.data.id, parent);
    }
    return byId;
  });
  const tree = createMemo(() =>
    buildSessionTree(sessions(), (s) => parents().get(s.id), props.limit)
  );
  const waiting = () =>
    sessions().filter(
      (s) => conversationState(s.status, s.turnState) === 'waiting'
    ).length;
  const open = (id: string, event: MouseEvent) =>
    openWithSplit(
      { type: 'agent', id },
      {
        activate: true,
        preferNewSplit: openInNewSplitForMention(event.shiftKey, true),
      }
    );

  return (
    <Show
      when={!query.isPending}
      fallback={<PaneLoading dense={props.dense} />}
    >
      <Show
        when={tree().length > 0}
        fallback={
          <PaneMessage dense={props.dense}>
            {query.error ? t('dynamicUi.failed') : t('dynamicUi.noSessions')}
          </PaneMessage>
        }
      >
        <Show when={waiting() > 0}>
          <p
            role="status"
            class="flex flex-none items-center gap-1.5 px-1 pb-1 text-xs text-ink-muted"
          >
            <span class="size-1.5 rounded-full bg-warning" />
            {t('dynamicUi.waitingSessions', { count: waiting() })}
          </p>
        </Show>
        <PaneScroll>
          <ul class="flex flex-col" aria-label={t('dynamicUi.sessions')}>
            <For each={tree()}>
              {(node) => <SessionBranch node={node} onOpen={open} />}
            </For>
          </ul>
        </PaneScroll>
      </Show>
    </Show>
  );
}

function SessionBranch(props: {
  node: SessionNode<AgentSessionEntity>;
  onOpen: (id: string, event: MouseEvent) => void;
}): JSX.Element {
  return (
    <li class="min-w-0">
      <AgentSessionListItem
        entity={props.node.session}
        surface="agents"
        onOpen={(event) => props.onOpen(props.node.session.id, event)}
      />
      <Show when={props.node.children.length > 0}>
        <ul
          class="ml-3 flex flex-col border-l border-edge-muted pl-2"
          aria-label={t('dynamicUi.subAgents')}
        >
          <For each={props.node.children}>
            {(child) => <SessionBranch node={child} onOpen={props.onOpen} />}
          </For>
        </ul>
      </Show>
    </li>
  );
}
