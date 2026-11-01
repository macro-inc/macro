import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableRoutineConditions } from '@core/constant/featureFlags';
import { Show, Suspense } from 'solid-js';
import { RoutineEventCondition } from './components/routine-event-condition';
import { RoutineGithubConnect } from './components/routine-github-connect';
import { RoutineGithubSettings } from './components/routine-github-settings';
import { RoutinePayloadTests } from './components/routine-payload-tests';
import { RoutineTriggers as TriggerList } from './components/routine-triggers';
import {
  type EventTriggerDraft,
  eventScopeKind,
  isGlobalEvent,
  type RoutineTriggerDraft,
} from './core/routine-triggers';
import { createGithubConnection } from './queries/github-link';
import { createGithubRepositoryOptions } from './queries/github-repositories';
import {
  RoutineEventScope,
  RoutineEventScopeLabel,
} from './routine-event-scope';

/** The Macro entity kind a trigger narrows to; GitHub has none. */
function entityKind(trigger: EventTriggerDraft) {
  const kind = eventScopeKind(trigger);
  return kind === 'GITHUB' ? undefined : kind;
}

function RepositoryScopeLabel(props: { trigger: EventTriggerDraft }) {
  const label = () => {
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
}) {
  const conditions = useFeatureFlag(enableRoutineConditions);
  const github = createGithubConnection();
  const repositories = createGithubRepositoryOptions(
    () =>
      github().linked === true &&
      props.triggers.some(
        (trigger) =>
          trigger.kind === 'event' && trigger.events.includes('github')
      )
  );
  const connect = (message: string) => (
    <RoutineGithubConnect
      message={message}
      connecting={github().connecting}
      onConnect={() => github().connect()}
    />
  );
  return (
    <TriggerList
      triggers={props.triggers}
      onChange={props.onChange}
      renderEventGroup={(group, options) => (
        <Show
          when={group !== 'GitHub' || github().linked !== false}
          fallback={connect(
            'Connect your GitHub account to run this routine on GitHub events.'
          )}
        >
          {options()}
        </Show>
      )}
      renderEventCondition={
        conditions().enabled
          ? (trigger, onChange) => (
              <RoutineEventCondition trigger={trigger()} onChange={onChange} />
            )
          : undefined
      }
      renderEventSettings={(trigger, onChange) => (
        <Show when={trigger().github}>
          {(selector) => (
            <Show
              when={github().linked !== false}
              fallback={connect(
                'GitHub isn’t connected, so this trigger can’t run. Connect it to turn the routine on.'
              )}
            >
              <RoutineGithubSettings
                selector={selector()}
                repositories={repositories()}
                onChange={(github) => onChange({ github })}
              />
              <RoutinePayloadTests
                tests={trigger().match ?? []}
                onChange={(match) => onChange({ match })}
              />
            </Show>
          )}
        </Show>
      )}
      renderEventLabel={(trigger) => (
        <Show
          when={entityKind(trigger())}
          fallback={<RepositoryScopeLabel trigger={trigger()} />}
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
