import { fireAndForget } from '@core/util/fireAndForget';
import { type JSX, onMount } from 'solid-js';
import { InsightsPanel } from '../components/insights-panel';
import type { SchedulingSource } from '../context/scheduling-context';
import type { EventType, SchedulingMember } from '../core/types';
import { createInsightsState } from '../primitives/insights-state';
import { InsightsHostAvatar } from './insights-host-avatar';

export function InsightsView(props: {
  source: SchedulingSource;
  events: EventType[];
  members: SchedulingMember[];
  timeZone: string;
  scopeSelector?: JSX.Element;
  headerTitle?: JSX.Element;
}) {
  const state = createInsightsState(props.source, props.timeZone);
  onMount(() => fireAndForget(state.load(), 'scheduling'));
  return (
    <InsightsPanel
      headerTitle={props.headerTitle}
      scopeSelector={props.scopeSelector}
      bookings={state.bookings()}
      events={props.events}
      members={props.members}
      renderHostAvatar={(host) => <InsightsHostAvatar host={host} />}
      timeZone={props.timeZone}
      loading={state.loading()}
      error={state.error()}
      from={state.range().from}
      to={state.range().to}
      onRangeChange={(from, to) =>
        fireAndForget(state.load(from, to), 'scheduling')
      }
      onRetry={() => fireAndForget(state.load(), 'scheduling')}
    />
  );
}
