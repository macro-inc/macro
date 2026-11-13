import { RoutineListRow } from '@app/features/routines/components/routine-row';
import type { TriggerKind } from '@app/features/routines/core/routine-triggers';
import type { RoutineRow } from '@app/features/routines/core/types';
import { routineContent } from '@app/features/routines/routine-navigation';
import { formatLocale, t } from '@app/lib/i18n';
import { usePending } from '@app/observability/flow';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { thrownResultErrorHasCode } from '@core/util/result';
import { formatRelativeDate } from '@core/util/time';
import { useQuery } from '@tanstack/solid-query';
import { For, Match, Show, Switch } from 'solid-js';
import {
  type AgentRoutineSummary,
  agentRoutinesQueryOptions,
} from '../../queries/agent-panes';
import type { WidgetOf } from '../../view';
import { AgentPane, PaneScroll } from '../panes/agent-pane';
import {
  NO_ACCESS_CODES,
  NoAccess,
  PaneLoading,
  PaneMessage,
  usePaneDense,
} from '../panes/pane';

export type RoutinesProps = Omit<WidgetOf<'routines'>, 'type'>;

const TRIGGER_KINDS: readonly TriggerKind[] = [
  'schedule',
  'email',
  'task',
  'document',
  'channel',
  'call',
  'github',
];

/**
 * The routines an agent owns, in the Routines list's rows: when each runs
 * next and how its last run went. Read-only here: the switch stays off-limits
 * and each row opens its routine, where its owner can change it.
 */
export function Routines(props: RoutinesProps) {
  const dense = usePaneDense(() => props.dense);
  return (
    <AgentPane
      type="routines"
      agentId={props.agentId}
      title={props.title ?? t('dynamicUi.routines')}
      dense={dense()}
    >
      {(agentId) => <RoutineRows agentId={agentId} dense={dense()} />}
    </AgentPane>
  );
}

function RoutineRows(props: { agentId: string; dense: boolean }) {
  const { openWithSplit } = useSplitLayout();
  const query = useQuery(() => agentRoutinesQueryOptions(props.agentId));
  usePending('dynamic_ui.pane.load', () => query.isPending);
  const noAccess = () =>
    query.isError &&
    NO_ACCESS_CODES.some((code) => thrownResultErrorHasCode(query.error, code));
  const routines = () => (query.isSuccess ? query.data.routines : []);
  return (
    <Switch
      fallback={
        // The rows' own layout narrows with this container, as on a phone.
        <PaneScroll>
          <div role="table" class="@container/routines -mx-1">
            <For each={routines()}>
              {(routine) => (
                <RoutineListRow
                  row={routineRow(routine)}
                  pending={false}
                  onOpen={(id) =>
                    openWithSplit(routineContent(id), { activate: true })
                  }
                  onToggle={() => {}}
                />
              )}
            </For>
          </div>
          <Show when={query.isSuccess && query.data.truncated}>
            <p class="px-1 pt-1 text-xs text-ink-extra-muted">
              {t('dynamicUi.moreRoutines')}
            </p>
          </Show>
        </PaneScroll>
      }
    >
      <Match when={query.isPending}>
        <PaneLoading dense={props.dense} />
      </Match>
      <Match when={noAccess()}>
        <NoAccess dense={props.dense} />
      </Match>
      <Match when={query.isError}>
        <PaneMessage dense={props.dense}>{t('dynamicUi.failed')}</PaneMessage>
      </Match>
      <Match when={routines().length === 0}>
        <PaneMessage dense={props.dense}>
          {t('dynamicUi.noRoutines')}
        </PaneMessage>
      </Match>
    </Switch>
  );
}

/** The Routines list's row for a summary: no steps, never editable here. */
function routineRow(routine: AgentRoutineSummary): RoutineRow {
  const whenKind = TRIGGER_KINDS.find((kind) => kind === routine.triggerKind);
  const next = routine.nextRunAt ? nextRunLabel(routine.nextRunAt) : undefined;
  return {
    id: routine.id,
    name: routine.name,
    description: next,
    createdAt: '',
    when: next ?? '',
    whenKind,
    does: '',
    group: whenKind === 'schedule' ? 'schedule' : 'activity',
    lastRun: routine.lastRun
      ? {
          at: formatRelativeDate(routine.lastRun.startedAt),
          outcome: routine.lastRun.succeeded ? 'succeeded' : 'failed',
          summary: routine.lastRun.succeeded
            ? t('dynamicUi.runSucceeded')
            : t('dynamicUi.runFailed'),
        }
      : undefined,
    status: routine.running ? 'Running' : routine.enabled ? 'Active' : 'Paused',
    editable: false,
    enabled: routine.enabled,
    children: [],
    pausedByParent: false,
  };
}

function nextRunLabel(at: string): string | undefined {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return undefined;
  const time = new Intl.DateTimeFormat(formatLocale(), {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  return t('dynamicUi.nextRun', { time });
}
