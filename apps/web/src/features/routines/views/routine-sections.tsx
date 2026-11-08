import UserIcon from '@icon/system/regular/user.svg';
import { ToggleSwitch } from '@ui';
import { type Accessor, type JSX, Show } from 'solid-js';
import { ConnectionRows } from '../components/routine-connections';
import { RoutineSettingRow } from '../components/routine-editor';
import {
  RoutineSteps,
  RoutineStepsSummary,
} from '../components/routine-step-editor';
import type { RoutineEditorSlots } from '../context/routine-slots';
import { DEFAULT_RUN_VISIBILITY, type ScheduleDraft } from '../core/draft';
import { draftSteps } from '../core/routine-draft';
import { firstAgent, type StepDraft } from '../core/routine-steps';

/**
 * The sections a routine's page and a new routine's page share: its
 * triggers, steps, connections, and how its runs show. Each page supplies
 * its draft and how a change applies to it.
 */
export function routineSections(props: {
  /** Absent while a saved routine has no editable configuration. */
  draft: Accessor<ScheduleDraft | undefined>;
  onChange: (update: (draft: ScheduleDraft) => ScheduleDraft) => void;
  /** How edited steps go into the draft (a saved routine keeps its form). */
  withSteps: (draft: ScheduleDraft, steps: StepDraft[]) => ScheduleDraft;
  /** Bumped when the whole draft is replaced, so step editors remount. */
  version: Accessor<number>;
  slots: RoutineEditorSlots;
  defaultModel: string;
  decisionsEnabled: boolean;
  connected: Accessor<ReadonlySet<string> | undefined>;
  /** Who the routine runs as, and the line under it. */
  runsAs: Accessor<string>;
  runsAsDescription: string;
  /** Shown in the trigger card when there is no draft to edit. */
  unsupported?: JSX.Element;
}) {
  const triggers = () => props.draft()?.triggers ?? [];
  const hasCodeStep = () => {
    const draft = props.draft();
    return draft
      ? draftSteps(draft).some((step) => step.kind === 'code')
      : false;
  };
  const setTriggers = (next: ScheduleDraft['triggers']) =>
    props.onChange((current) => ({ ...current, triggers: next }));
  return {
    get hasTriggers() {
      return !props.draft() || triggers().length > 0;
    },
    triggerContent: (
      <Show when={props.draft()} fallback={props.unsupported}>
        <props.slots.Triggers
          layout="rows"
          triggers={triggers()}
          onChange={setTriggers}
        />
      </Show>
    ),
    triggerAdd: (
      <Show when={props.draft()}>
        <props.slots.Triggers
          layout="add"
          triggers={triggers()}
          onChange={setTriggers}
        />
      </Show>
    ),
    stepsAside: (
      <Show when={props.draft()}>
        {(draft) => (
          <RoutineStepsSummary
            steps={draftSteps(draft())}
            triggers={triggers()}
          />
        )}
      </Show>
    ),
    steps: (
      <Show when={props.draft()}>
        {(draft) => (
          <>
            {/* An API-written single agent keeps instructions ahead of the
                ones shown in its step; say so, so what runs is visible. */}
            <Show
              when={draft().steps === undefined && draft().basePrompt?.trim()}
            >
              {(base) => (
                <div class="mb-2 grid gap-1 rounded-xl border border-edge-muted px-4 py-3 text-sm">
                  <span class="text-xs font-medium text-ink-muted">
                    Saved instructions that run first
                  </span>
                  <p class="whitespace-pre-wrap text-ink-muted">{base()}</p>
                </div>
              )}
            </Show>
            <Show when={{ version: props.version() }} keyed>
              <RoutineSteps
                steps={draftSteps(draft())}
                onChange={(steps) =>
                  props.onChange((current) => props.withSteps(current, steps))
                }
                triggers={triggers()}
                defaultTarget={
                  firstAgent(draftSteps(draft()))?.target ?? {
                    kind: 'model',
                    model: props.defaultModel,
                  }
                }
                slots={props.slots}
              />
            </Show>
          </>
        )}
      </Show>
    ),
    // One instance for the page's life: edits elsewhere don't remount it, so
    // the app picker stays open across picks.
    connections: (
      <Show when={props.draft()}>
        {(draft) => (
          <ConnectionRows
            apps={draft().apps}
            agent={Boolean(firstAgent(draftSteps(draft())))}
            connected={props.connected}
            onChange={(apps) =>
              props.onChange((current) => ({ ...current, apps }))
            }
            Picker={props.slots.Apps}
          />
        )}
      </Show>
    ),
    settings: (
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
              (props.draft()?.runVisibility ?? DEFAULT_RUN_VISIBILITY) ===
              'listed'
            }
            disabled={!props.draft()}
            onChange={(listed) =>
              props.onChange((draft) => ({
                ...draft,
                runVisibility: listed ? 'listed' : 'unlisted',
              }))
            }
          />
        </RoutineSettingRow>
        <RoutineSettingRow
          label="Runs as"
          description={props.runsAsDescription}
        >
          <span class="inline-flex items-center gap-1.5 text-sm text-ink">
            <UserIcon class="size-4 text-ink-muted" />
            {props.runsAs()}
          </span>
        </RoutineSettingRow>
        {/* Only code steps change who writes; Ask AI steps stay the agent's. */}
        <Show when={hasCodeStep()}>
          <RoutineSettingRow
            label="Act as me"
            description="Posts, emails and comments from code steps will appear as written by you, with no Agent badge."
          >
            <ToggleSwitch
              size="md"
              label="Act as me"
              labelClass="sr-only"
              checked={props.draft()?.dangerouslyOperateAsUser ?? false}
              onChange={(dangerouslyOperateAsUser) =>
                props.onChange((draft) => ({
                  ...draft,
                  dangerouslyOperateAsUser,
                }))
              }
            />
          </RoutineSettingRow>
        </Show>
      </>
    ),
  };
}
