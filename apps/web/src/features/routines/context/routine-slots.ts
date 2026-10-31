import type { Accessor, Component } from 'solid-js';
import type { RoutineToolSlots } from '../components/routine-tool-step';
import type { RoutineApp } from '../core/draft';
import type { RoutineTarget } from '../core/routine-target';
import type { RoutineTriggerDraft } from '../core/routine-triggers';
import type { HistoryMetadata } from './history';

export type RoutineEditorSlots = RoutineToolSlots & {
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
};
export type RoutineDetailSlots = RoutineEditorSlots & {
  createChatMetadata(id: string): Accessor<HistoryMetadata>;
  createAgentMetadata(id: string): Accessor<HistoryMetadata>;
};
