import type { Accessor, Component } from 'solid-js';
import type { RoutineTarget } from '../core/routine-target';
import type { RoutineTriggerDraft } from '../core/routine-triggers';
import type { HistoryMetadata } from './history';

export type RoutineEditorSlots = {
  PromptEditor: Component<{
    initialValue: string;
    onChange(value: string): void;
  }>;
  ExecutionPicker: Component<{
    target: RoutineTarget;
    onChange(target: RoutineTarget): void;
  }>;
  Triggers: Component<{
    triggers: RoutineTriggerDraft[];
    onChange(triggers: RoutineTriggerDraft[]): void;
  }>;
};
export type RoutineDetailSlots = RoutineEditorSlots & {
  createChatMetadata(id: string): Accessor<HistoryMetadata>;
  createAgentMetadata(id: string): Accessor<HistoryMetadata>;
};
