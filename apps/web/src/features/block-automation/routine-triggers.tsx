import { Suspense } from 'solid-js';
import { RoutineTriggers as TriggerList } from './components/routine-triggers';
import type {
  EventTriggerDraft,
  RoutineTriggerDraft,
} from './core/routine-triggers';
import {
  RoutineEventScope,
  RoutineEventScopeLabel,
} from './views/routine-event-scope';

function scopeKind(trigger: EventTriggerDraft) {
  return trigger.events.every((event) => event.startsWith('document.'))
    ? 'DOCUMENT'
    : 'CHANNEL';
}

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
            kind={scopeKind(trigger())}
            ids={trigger().ids}
          />
        </Suspense>
      )}
      renderEventScope={(trigger, onChange) => (
        <RoutineEventScope
          kind={scopeKind(trigger())}
          ids={trigger().ids}
          onChange={onChange}
        />
      )}
    />
  );
}
