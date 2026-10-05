import { badgeTriggerClasses } from '@ui';
import {
  type Accessor,
  ErrorBoundary,
  type JSX,
  Show,
  Suspense,
} from 'solid-js';
import {
  MACRO_PERSONA_ID,
  type RosterAgent,
} from '../../agents-view/core/roster';
import { AgentPicker } from '../../agents-view/views/AgentPicker';
import type { RoutineTarget } from '../core/routine-target';

export type RoutineExecutionPickerProps = {
  target: RoutineTarget;
  onChange: (target: RoutineTarget) => void;
};

type ModelCatalog = {
  models: Accessor<readonly { id: string }[]>;
  message: Accessor<string>;
};

type Props = RoutineExecutionPickerProps & {
  roster: RosterAgent[];
  rosterLoading: boolean;
  rosterError: boolean;
  availabilityLoading: boolean;
  createModels: (agent: Accessor<RosterAgent | undefined>) => ModelCatalog;
  onConnect: (agent: RosterAgent) => void;
  onCreate: () => void;
};

function savedSelection(target: RoutineTarget): string {
  if (target.kind === 'model') return `Model: ${target.model}`;
  const label = `Agent: ${target.agentId}`;
  return target.modelOverride ? `${label} · ${target.modelOverride}` : label;
}

/** Keep query suspension and discovery failures local to the selector, not the editor. */
export function RoutineExecutionPickerBoundary(props: {
  target: RoutineTarget;
  children: JSX.Element;
}): JSX.Element {
  return (
    <ErrorBoundary
      fallback={(_, reset) => (
        <div role="status" class="text-xs text-ink-muted">
          {savedSelection(props.target)}. Could not load model and agent
          choices. Your selection is unchanged.
          <button type="button" class="ml-2 underline" onClick={reset}>
            Retry choices
          </button>
        </div>
      )}
    >
      <Suspense
        fallback={
          <div role="status" class="text-xs text-ink-muted">
            {savedSelection(props.target)}. Loading model and agent choices…
          </div>
        }
      >
        {props.children}
      </Suspense>
    </ErrorBoundary>
  );
}

export function RoutineExecutionPickerView(props: Props): JSX.Element {
  const selected = (): RosterAgent | undefined => {
    const target = props.target;
    if (target.kind === 'model') {
      return props.roster.find((agent) => agent.id === MACRO_PERSONA_ID);
    }
    return props.roster.find((agent) => agent.botId === target.agentId);
  };
  const model = (): string | undefined => {
    const target = props.target;
    return target.kind === 'model' ? target.model : target.modelOverride;
  };
  const catalog = props.createModels(selected);
  const warning = (): string | undefined => {
    if (props.rosterError) {
      return 'Could not load agents. Your saved selection is unchanged.';
    }
    if (props.rosterLoading)
      return 'Loading agents. Your selection is unchanged.';
    if (!selected())
      return 'Warning: the saved selection is missing or no longer accessible.';
    if (props.availabilityLoading) return 'Checking runtime availability…';
    if (selected()?.unavailableReason)
      return `Warning: ${selected()?.unavailableReason}.`;
    const id = model();
    if (!id) return;
    const models = catalog.models();
    if (models.some((option) => option.id === id)) return;
    if (models.length === 0)
      return `Cannot verify model "${id}". ${catalog.message()}`;
    return `Warning: model "${id}" is not available from this runtime. Your selection is unchanged.`;
  };

  function select(agent: RosterAgent, override?: string): void {
    if (agent.id === MACRO_PERSONA_ID) {
      if (override) props.onChange({ kind: 'model', model: override });
      return;
    }
    if (!agent.botId) return;
    // A direct agent choice uses its configured default, never the old override.
    props.onChange({
      kind: 'agent',
      agentId: agent.botId,
      ...(override ? { modelOverride: override } : {}),
    });
  }

  return (
    <div
      role="group"
      aria-label="Routine model or agent"
      class="min-w-0 max-w-full"
    >
      <AgentPicker
        triggerClass={badgeTriggerClasses({
          variant: 'outline',
          size: 'sm',
          class: 'max-w-full text-ink-muted',
        })}
        agents={props.roster}
        selected={selected()}
        modelOverride={model()}
        loading={props.rosterLoading}
        onSelect={select}
        onConnect={props.onConnect}
        onCreate={props.onCreate}
      />
      <Show when={!selected()}>
        <p class="break-words text-xs text-ink-muted">
          {savedSelection(props.target)}
        </p>
      </Show>
      <Show when={warning()}>
        {(message) => (
          <p role="status" class="text-xs text-ink-muted">
            {message()}
          </p>
        )}
      </Show>
    </div>
  );
}
