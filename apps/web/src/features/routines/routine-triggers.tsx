import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  enableEventRoutines,
  enableRoutineWebhooks,
} from '@core/constant/featureFlags';
import { Show, Suspense } from 'solid-js';
import { RoutineEventCondition } from './components/routine-event-condition';
import { RoutineGithubConnect } from './components/routine-github-connect';
import { RoutineGithubSettings } from './components/routine-github-settings';
import { RoutinePayloadTests } from './components/routine-payload-tests';
import { RoutineTriggers as TriggerList } from './components/routine-triggers';
import { RoutineWebhookUrl } from './components/routine-webhook-url';
import {
  type EventTriggerDraft,
  eventScopeKind,
  hasWebhookTrigger,
  type RoutineTriggerDraft,
  taskTriggerProperty,
  withPropertyValues,
} from './core/routine-triggers';
import { createGithubConnection } from './queries/github-link';
import { createGithubRepositoryOptions } from './queries/github-repositories';
import { createRoutineWebhook } from './queries/webhook';
import {
  RoutineEventPropertyValues,
  RoutineEventValueLabel,
} from './routine-event-property';
import {
  RoutineEventScope,
  RoutineEventScopeLabel,
} from './routine-event-scope';

/** The Macro entity kind a trigger narrows to; GitHub and webhooks have none. */
function entityKind(trigger: EventTriggerDraft) {
  const kind = eventScopeKind(trigger);
  return kind === 'GITHUB' || kind === 'WEBHOOK' ? undefined : kind;
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
  layout?: 'rows' | 'add' | 'inline';
  /** The saved routine's id; its webhook URL is made once a webhook trigger is saved. */
  routineId?: string;
}) {
  const eventRoutines = useFeatureFlag(enableEventRoutines);
  const webhooks = useFeatureFlag(enableRoutineWebhooks);
  const github = createGithubConnection();
  const repositories = createGithubRepositoryOptions(
    () =>
      github().linked === true &&
      props.triggers.some(
        (trigger) =>
          trigger.kind === 'event' && trigger.events.includes('github')
      )
  );
  const webhook = createRoutineWebhook(() => props.routineId);
  const connect = (message: string) => (
    <RoutineGithubConnect
      message={message}
      connecting={github().connecting}
      onConnect={() => github().connect()}
    />
  );
  // A GitHub trigger saved without a linked account never runs; say so
  // where the routine is reviewed, not only inside the trigger's panel.
  const needsGithub = () =>
    github().linked === false &&
    props.triggers.some(
      (trigger) => trigger.kind === 'event' && trigger.events.includes('github')
    );
  return (
    <>
      <Show when={needsGithub()}>
        {connect(
          'Connect your GitHub account so this routine can run on GitHub events.'
        )}
      </Show>
      <TriggerList
        triggers={props.triggers}
        onChange={props.onChange}
        layout={props.layout === 'add' ? 'add' : 'rows'}
        offerEvents={eventRoutines().enabled}
        offerWebhooks={webhooks().enabled}
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
        renderEventCondition={(trigger, onChange) => (
          <RoutineEventCondition trigger={trigger()} onChange={onChange} />
        )}
        renderEventSettings={(trigger, onChange) => (
          <>
            <Show when={taskTriggerProperty(trigger())}>
              {(property) => (
                <RoutineEventPropertyValues
                  property={property()}
                  values={trigger().property?.values ?? []}
                  onChange={(values) =>
                    onChange({
                      property: withPropertyValues(
                        trigger(),
                        property().definitionId,
                        values
                      ).property,
                    })
                  }
                />
              )}
            </Show>
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
            <Show when={eventScopeKind(trigger()) === 'WEBHOOK'}>
              <Show when={!webhooks().loading}>
                <RoutineWebhookUrl
                  off={!webhooks().enabled}
                  state={
                    webhooks().enabled &&
                    props.routineId &&
                    hasWebhookTrigger(props.triggers)
                      ? webhook()
                      : undefined
                  }
                />
              </Show>
              <RoutinePayloadTests
                subject="JSON body"
                pathPlaceholder="status"
                listExample="alerts.*.severity"
                tests={trigger().match ?? []}
                onChange={(match) => onChange({ match })}
              />
            </Show>
          </>
        )}
        renderEventLabel={(trigger) => (
          <Show
            when={entityKind(trigger())}
            fallback={<RepositoryScopeLabel trigger={trigger()} />}
          >
            {(kind) => (
              <Suspense fallback={<span>Selected items</span>}>
                <Show when={taskTriggerProperty(trigger())}>
                  {(property) => (
                    <RoutineEventValueLabel
                      property={property()}
                      values={trigger().property?.values ?? []}
                    />
                  )}
                </Show>
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
              <RoutineEventScope
                kind={kind()}
                ids={trigger().ids}
                onChange={onChange}
              />
            )}
          </Show>
        )}
      />
    </>
  );
}
