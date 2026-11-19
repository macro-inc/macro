import type {
  RoutineInput,
  RoutineSubRoutine,
  RoutineTask,
} from '@service-scheduled-action/generated/schemas';
import type { SubRoutineCopyDraft, SubRoutineDraft } from './draft';
import { type StepDraft, stepsFromWire, stepsToWire } from './routine-steps';

/** A stored sub-routine for the editor; undefined when it holds steps the editor can't show. */
export function subRoutineFromWire(
  definition: RoutineSubRoutine
): SubRoutineDraft | undefined {
  const steps = stepsFromWire(definition.steps);
  return (
    steps && {
      name: definition.name,
      title: definition.title,
      inputs: definition.inputs ?? [],
      steps,
      apps: definition.mcp_servers ?? [],
    }
  );
}

/**
 * A program's sub-routines for the editor: none for a task without them,
 * and undefined when one holds steps the editor can't show.
 */
export function subRoutinesFromWire(
  task: RoutineTask
): SubRoutineDraft[] | undefined {
  if (!('steps' in task)) return [];
  const drafts: SubRoutineDraft[] = [];
  for (const definition of task.sub_routines ?? []) {
    const draft = subRoutineFromWire(definition);
    if (!draft) return undefined;
    drafts.push(draft);
  }
  return drafts;
}

export function subRoutinesToWire(
  subRoutines: SubRoutineDraft[]
): RoutineSubRoutine[] {
  return subRoutines.map((definition) => ({
    name: definition.name,
    title: definition.title,
    ...(definition.inputs.length ? { inputs: definition.inputs } : {}),
    steps: stepsToWire(definition.steps),
    // Clearing a definition's apps is an explicit empty selection.
    mcp_servers: definition.apps,
  }));
}

/** A copy's definition and values; undefined for any other task. */
export function copyOf(task: RoutineTask): SubRoutineCopyDraft | undefined {
  return 'sub_routine' in task
    ? { subRoutine: task.sub_routine, inputs: task.inputs ?? {} }
    : undefined;
}

/** Resolve the copy's name without decoding the parent's other steps. */
export function wireDefinition(task: RoutineTask, name: string) {
  return 'steps' in task
    ? task.sub_routines?.find((definition) => definition.name === name)
    : undefined;
}

/** The program's own input values, as a kept copy holds them. */
export function programInputs(task: RoutineTask): RoutineInput[] {
  return 'steps' in task ? (task.inputs ?? []) : [];
}

/** One sub-routine's steps changed, the others as they were. */
export function withSubRoutineSteps(
  subRoutines: SubRoutineDraft[],
  name: string,
  steps: StepDraft[]
): SubRoutineDraft[] {
  return subRoutines.map((definition) =>
    definition.name === name ? { ...definition, steps } : definition
  );
}

/**
 * The definition a copy runs, from its parent's sub-routines once the
 * parent is loaded; otherwise why there is none: the parent defines none by
 * that name any more, or holds steps the editor can't show.
 */
export function copyDefinition(
  copy: SubRoutineCopyDraft,
  definitions: readonly SubRoutineDraft[] | undefined,
  parentLoaded: boolean
): { definition?: SubRoutineDraft; missing?: 'gone' | 'hidden' } {
  if (!parentLoaded) return {};
  if (!definitions) return { missing: 'hidden' };
  const definition = definitions.find((item) => item.name === copy.subRoutine);
  return definition ? { definition } : { missing: 'gone' };
}

/** How a value a copy was given reads on its page and its parent's. */
export function describeInputValue(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value) ?? '';
}

/**
 * A copy's values, labelled as its definition declares them, in the
 * definition's order; values it names no longer get their names.
 */
export function labelledInputs(
  copy: SubRoutineCopyDraft,
  definition: SubRoutineDraft | undefined
): { label: string; value: string }[] {
  const declared = definition?.inputs ?? [];
  const known = declared
    .filter((input) => input.name in copy.inputs)
    .map((input) => ({
      label: input.label,
      value: describeInputValue(copy.inputs[input.name]),
    }));
  const names = new Set(declared.map((input) => input.name));
  const unknown = Object.entries(copy.inputs)
    .filter(([name]) => !names.has(name))
    .map(([name, value]) => ({
      label: name,
      value: describeInputValue(value),
    }));
  return [...known, ...unknown];
}
