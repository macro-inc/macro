import { fireAndForget } from '@core/util/fireAndForget';
import UserIcon from '@icon/system/regular/user.svg';
import { Button, ToggleSwitch } from '@ui';
import { createSignal, Show } from 'solid-js';
import { ConnectionRows } from '../components/routine-connections';
import { RoutineEditor, RoutineSettingRow } from '../components/routine-editor';
import {
  RoutineSteps,
  RoutineStepsSummary,
} from '../components/routine-step-editor';
import type { RoutineEditorSlots } from '../context/routine-slots';
import type {
  RoutineCreatorSource,
  RoutineDraftStorage,
} from '../context/routine-sources';
import { DEFAULT_RUN_VISIBILITY } from '../core/draft';
import { draftSteps, withNewDraftSteps } from '../core/routine-draft';
import { firstAgent } from '../core/routine-steps';
import { createRoutineComposer } from '../primitives/routine-composer';

/**
 * A routine before it exists: its page, laid out like a saved routine's, that
 * is written only when Create routine succeeds. It starts from the draft New
 * routine left behind (a description, a template, or nothing).
 */
export function RoutineNewView(props: {
  source: RoutineCreatorSource;
  storage: RoutineDraftStorage;
  slots: RoutineEditorSlots;
  defaultModel: string;
  /** Decisions are answered by the classifier behind trigger conditions. */
  decisionsEnabled: boolean;
  onCreated(id: string): void;
  onCancel(): void;
}) {
  const connected = props.slots.createConnectedApps();
  const {
    draft,
    change,
    version,
    attempted,
    formError,
    submitError,
    create,
    discard,
  } = createRoutineComposer(
    props.source,
    props.storage,
    props.defaultModel,
    props.onCreated,
    connected
  );
  const [showRun, setShowRun] = createSignal(false);
  const pending = () => props.source.pending();
  const cancel = () => {
    discard();
    props.onCancel();
  };
  return (
    <RoutineEditor
      creating
      draft={draft()}
      onChange={change}
      disabled={pending()}
      tab="settings"
      onTab={() => {}}
      onBack={cancel}
      meta={
        <ToggleSwitch
          class="flex-row-reverse"
          label="Enabled"
          labelClass="text-sm font-medium text-ink"
          checked={draft().enabled ?? true}
          disabled={pending()}
          onChange={(enabled) => change((current) => ({ ...current, enabled }))}
        />
      }
      hasTriggers={(draft().triggers ?? []).length > 0}
      triggerContent={
        <props.slots.Triggers
          layout="rows"
          triggers={draft().triggers ?? []}
          onChange={(triggers) =>
            change((current) => ({ ...current, triggers }))
          }
        />
      }
      triggerAdd={
        <props.slots.Triggers
          layout="add"
          triggers={draft().triggers ?? []}
          onChange={(triggers) =>
            change((current) => ({ ...current, triggers }))
          }
        />
      }
      stepsAside={
        <RoutineStepsSummary
          steps={draftSteps(draft())}
          triggers={draft().triggers ?? []}
          showRun={showRun()}
          onShowRun={setShowRun}
        />
      }
      steps={
        <Show when={{ version: version() }} keyed>
          <RoutineSteps
            steps={draftSteps(draft())}
            onChange={(steps) =>
              change((current) => withNewDraftSteps(current, steps))
            }
            triggers={draft().triggers ?? []}
            defaultTarget={
              firstAgent(draftSteps(draft()))?.target ?? {
                kind: 'model',
                model: props.defaultModel,
              }
            }
            decisionsEnabled={props.decisionsEnabled}
            slots={props.slots}
            // The Steps heading carries the summary; there is no last run yet.
            showRun={false}
          />
        </Show>
      }
      connections={
        <ConnectionRows
          apps={draft().apps}
          agent={Boolean(firstAgent(draftSteps(draft())))}
          connected={connected}
          onChange={(apps) => change((current) => ({ ...current, apps }))}
          Picker={props.slots.Apps}
        />
      }
      settings={
        <>
          <RoutineSettingRow
            label="Show runs in Home and Agents"
            description="Runs stay in this routine’s history unless shown."
          >
            <ToggleSwitch
              size="md"
              label="Show runs in Home and Agents"
              labelClass="sr-only"
              checked={
                (draft().runVisibility ?? DEFAULT_RUN_VISIBILITY) === 'listed'
              }
              disabled={pending()}
              onChange={(listed) =>
                change((current) => ({
                  ...current,
                  runVisibility: listed ? 'listed' : 'unlisted',
                }))
              }
            />
          </RoutineSettingRow>
          <RoutineSettingRow
            label="Runs as"
            description="Steps and AI act with your access."
          >
            <span class="inline-flex items-center gap-1.5 text-sm text-ink">
              <UserIcon class="size-4 text-ink-muted" />
              You
            </span>
          </RoutineSettingRow>
        </>
      }
      feedback={
        <>
          <Show when={attempted() && formError()}>
            {(message) => (
              <p role="alert" class="text-sm text-failure">
                {message()}
              </p>
            )}
          </Show>
          <Show when={submitError()}>
            {(message) => (
              <p role="alert" class="text-sm text-failure">
                {message()}
              </p>
            )}
          </Show>
        </>
      }
      footer={
        <>
          <Button variant="ghost" disabled={pending()} onClick={cancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={pending()}
            onClick={() => fireAndForget(create(), 'routines')}
          >
            {pending() ? 'Creating…' : 'Create routine'}
          </Button>
        </>
      }
    />
  );
}
