import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableRoutineConditions } from '@core/constant/featureFlags';
import { Suspense } from 'solid-js';
import { RoutineEventCondition } from './components/routine-event-condition';
import { RoutineTriggers as TriggerList } from './components/routine-triggers';
import {
  eventScopeKind,
  type RoutineTriggerDraft,
} from './core/routine-triggers';
import {
  RoutineEventScope,
  RoutineEventScopeLabel,
} from './routine-event-scope';

export function RoutineTriggers(props: {
  triggers: RoutineTriggerDraft[];
  onChange: (triggers: RoutineTriggerDraft[]) => void;
  layout?: 'rows' | 'inline';
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
            events={trigger().events}
          />
        </Suspense>
      )}
      renderEventScope={(trigger, onChange) => (
        <RoutineEventScope
          kind={eventScopeKind(trigger())}
          ids={trigger().ids}
          onChange={onChange}
        />
      )}
    />
  );
}
