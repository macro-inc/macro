import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableRoutineConditions } from '@core/constant/featureFlags';
import { Show, Suspense } from 'solid-js';
import { RoutineEventCondition } from './components/routine-event-condition';
import { RoutineTriggers as TriggerList } from './components/routine-triggers';
import {
  eventScopeKind,
  isGlobalEvent,
  type RoutineTriggerDraft,
} from './core/routine-triggers';
import {
  RoutineEventScope,
  RoutineEventScopeLabel,
} from './routine-event-scope';

export function RoutineTriggers(props: {
  triggers: RoutineTriggerDraft[];
  onChange: (triggers: RoutineTriggerDraft[]) => void;
}) {
  const conditions = useFeatureFlag(enableRoutineConditions);
  return (
    <TriggerList
      {...props}
      renderEventCondition={
        conditions().enabled
          ? (trigger, onChange) => (
              <RoutineEventCondition trigger={trigger()} onChange={onChange} />
            )
          : undefined
      }
      renderEventLabel={(trigger) => (
        <Suspense fallback={<span>Selected items</span>}>
          <RoutineEventScopeLabel
            kind={eventScopeKind(trigger())}
            ids={trigger().ids}
          />
        </Suspense>
      )}
      renderEventScope={(trigger, onChange) => (
        <Show
          when={!isGlobalEvent(trigger().events) || trigger().ids !== undefined}
        >
          <RoutineEventScope
            kind={eventScopeKind(trigger())}
            ids={trigger().ids}
            onChange={onChange}
          />
        </Show>
      )}
    />
  );
}
