import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableRoutineConditions } from '@core/constant/featureFlags';
import { Match, Show, Suspense, Switch } from 'solid-js';
import { RoutineEventCondition } from './components/routine-event-condition';
import { RoutineGithubSettings } from './components/routine-github-settings';
import { RoutinePayloadTests } from './components/routine-payload-tests';
import { RoutineTriggers as TriggerList } from './components/routine-triggers';
import {
  type EventTriggerDraft,
  eventScopeKind,
  isGlobalEvent,
  type RoutineTriggerDraft,
} from './core/routine-triggers';
import { createGithubRepositoryOptions } from './queries/github-repositories';
import {
  RoutineEventScope,
  RoutineEventScopeLabel,
} from './routine-event-scope';
import { RoutineWebhookUrlView } from './routine-webhook-url';

/** The Macro entity kind a trigger narrows to; external events have none. */
function entityKind(trigger: EventTriggerDraft) {
  const kind = eventScopeKind(trigger);
  return kind === 'GITHUB' || kind === 'WEBHOOK' ? undefined : kind;
}

function ExternalScopeLabel(props: { trigger: EventTriggerDraft }) {
  const label = () => {
    if (eventScopeKind(props.trigger) === 'WEBHOOK') return 'Your webhook URL';
    const repositories = props.trigger.github?.repositories ?? [];
    if (!repositories.length) return 'All repositories';
    if (repositories.length > 1) return `${repositories.length} repositories`;
    return repositories[0];
  };
  return <span title={label()}>{label()}</span>;
}

export function RoutineTriggers(props: {
  triggers: RoutineTriggerDraft[];
  onChange: (triggers: RoutineTriggerDraft[]) => void;
  /** Absent while the routine is being created. */
  routineId?: string;
}) {
  const conditions = useFeatureFlag(enableRoutineConditions);
  const repositories = createGithubRepositoryOptions(() =>
    props.triggers.some(
      (trigger) => trigger.kind === 'event' && trigger.events.includes('github')
    )
  );
  return (
    <TriggerList
      triggers={props.triggers}
      onChange={props.onChange}
      renderEventCondition={
        conditions().enabled
          ? (trigger, onChange) => (
              <RoutineEventCondition trigger={trigger()} onChange={onChange} />
            )
          : undefined
      }
      renderEventSettings={(trigger, onChange) => (
        <Show when={!entityKind(trigger())}>
          <Switch>
            <Match when={trigger().github}>
              {(selector) => (
                <RoutineGithubSettings
                  selector={selector()}
                  repositories={repositories()}
                  onChange={(github) => onChange({ github })}
                />
              )}
            </Match>
            <Match when={eventScopeKind(trigger()) === 'WEBHOOK'}>
              <RoutineWebhookUrlView routineId={props.routineId} />
            </Match>
          </Switch>
          <RoutinePayloadTests
            tests={trigger().match ?? []}
            onChange={(match) => onChange({ match })}
          />
        </Show>
      )}
      renderEventLabel={(trigger) => (
        <Show
          when={entityKind(trigger())}
          fallback={<ExternalScopeLabel trigger={trigger()} />}
        >
          {(kind) => (
            <Suspense fallback={<span>Selected items</span>}>
              <RoutineEventScopeLabel
                kind={kind()}
                ids={trigger().ids}
                events={trigger().events}
              />
            </Suspense>
          )}
        </Show>
      )}
      renderEventScope={(trigger, onChange) => (
        <Show when={entityKind(trigger())}>
          {(kind) => (
            <Show
              when={
                !isGlobalEvent(trigger().events) || trigger().ids !== undefined
              }
            >
              <RoutineEventScope
                kind={kind()}
                ids={trigger().ids}
                onChange={onChange}
              />
            </Show>
          )}
        </Show>
      )}
    />
  );
}
