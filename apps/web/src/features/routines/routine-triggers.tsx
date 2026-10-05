import { Show, Suspense } from 'solid-js';
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
  return (
    <TriggerList
      {...props}
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
