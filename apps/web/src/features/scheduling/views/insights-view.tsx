import { type JSX, onMount } from 'solid-js';
import { InsightsPanel } from '../components/insights-panel';
import type { SchedulingSource } from '../context/scheduling-context';
import type { EventType, SchedulingMember } from '../core/types';
import { createInsightsState } from '../primitives/insights-state';

export function InsightsView(props: {
  source: SchedulingSource;
  events: EventType[];
  members: SchedulingMember[];
  timeZone: string;
  scopeSelector?: JSX.Element;
}) {
  const state = createInsightsState(props.source, props.timeZone);
  onMount(() => void state.load());
  return (
    <InsightsPanel
      scopeSelector={props.scopeSelector}
      bookings={state.bookings()}
      events={props.events}
      members={props.members}
      timeZone={props.timeZone}
      loading={state.loading()}
      error={state.error()}
      from={state.range().from}
      to={state.range().to}
      onRangeChange={(from, to) => void state.load(from, to)}
      onRetry={() => void state.load()}
    />
  );
}
