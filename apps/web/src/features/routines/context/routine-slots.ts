import type { Accessor, Component } from 'solid-js';
import type { RoutineApp } from '../core/draft';
import type {
  AddedStep,
  CodeStepDraft,
  RoutineSoFar,
  StepKind,
} from '../core/routine-steps';
import type { RoutineTarget } from '../core/routine-target';
import type { RoutineTriggerDraft } from '../core/routine-triggers';
import type { HistoryMetadata } from './history';

export type RoutineEditorSlots = {
  PromptEditor: Component<{
    initialValue: string;
    disabled?: boolean;
    onChange(value: string): void;
  }>;
  ExecutionPicker: Component<{
    target: RoutineTarget;
    onChange(target: RoutineTarget): void;
  }>;
  Triggers: Component<{
    triggers: RoutineTriggerDraft[];
    onChange(triggers: RoutineTriggerDraft[]): void;
    /** `rows` for the routine page's When card; inline tokens otherwise. */
    layout?: 'rows' | 'add';
  }>;
  Apps: Component<{
    apps: RoutineApp[];
    onChange(apps: RoutineApp[]): void;
    /** A chip listing the apps (default), or an "Add connection" button. */
    variant?: 'chip' | 'button';
  }>;
  /** The viewer's connected app slugs; undefined until they load. */
  createConnectedApps(): Accessor<ReadonlySet<string> | undefined>;
  /** AI that adds and changes steps; without it, steps are added by hand. */
  createStepAuthor?(routine: Accessor<RoutineSoFar>): StepAuthor;
};

/** AI that writes one step at a time for a routine being edited. */
export type StepAuthor = {
  /** Draft a step to add at the end; `kind` overrides AI's choice. */
  add(description: string, kind?: StepKind): Promise<AddedStep | string>;
  /** Rewrite a code step as `instruction` says, checked like a save. */
  revise(
    step: CodeStepDraft,
    instruction: string
  ): Promise<CodeStepDraft | string>;
};
export type RoutineDetailSlots = RoutineEditorSlots & {
  createChatMetadata(id: string): Accessor<HistoryMetadata>;
  createAgentMetadata(id: string): Accessor<HistoryMetadata>;
};
