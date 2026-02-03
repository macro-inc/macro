import type { PropertyApiValues } from '@core/component/Properties/types';
import {
  extractCheckboxesFromMarkdown,
  type PotentialTask,
} from '@core/util/taskExtraction';
import { debounce } from '@solid-primitives/scheduled';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  on,
} from 'solid-js';
import { createStore, reconcile } from 'solid-js/store';

const DEBOUNCE_MS = 300;

/** Extended task with property values in API format */
export type TaskWithProperties = PotentialTask & {
  propertyValues: Record<string, PropertyApiValues>;
};

type UseTaskModeReturn = {
  /** Whether task mode is currently enabled */
  taskModeEnabled: Accessor<boolean>;
  /** Toggle task mode on/off */
  toggleTaskMode: () => void;
  /** Set task mode enabled state directly */
  setTaskModeEnabled: (enabled: boolean) => void;
  /** Potential tasks detected in current content (debounced) */
  potentialTasks: Accessor<TaskWithProperties[]>;
  /** Update a property value on a specific task */
  updateTaskPropertyValue: (
    lineIndex: number,
    propertyDefinitionId: string,
    value: PropertyApiValues
  ) => void;
};

/**
 * Hook for managing task mode state in the channel message input.
 * When task mode is enabled, continuously parses checkboxes from the
 * markdown content (debounced) to preview what tasks will be created on send.
 *
 * @param markdownState - Accessor for the current markdown content
 * @returns Task mode state and controls
 */
export function useTaskMode(
  markdownState: Accessor<string>
): UseTaskModeReturn {
  const [taskModeEnabled, setTaskModeEnabled] = createSignal(false);
  const [debouncedMarkdown, setDebouncedMarkdown] = createSignal('');

  // Store property values per task (keyed by lineIndex, then propertyDefinitionId)
  const [taskPropertyValues, setTaskPropertyValues] = createStore<
    Record<number, Record<string, PropertyApiValues>>
  >({});

  const updateDebouncedMarkdown = debounce(
    (content: string) => setDebouncedMarkdown(content),
    DEBOUNCE_MS
  );

  createEffect(
    on(
      () => (taskModeEnabled() ? markdownState() : null),
      (markdown) => {
        if (markdown !== null) {
          updateDebouncedMarkdown(markdown);
        }
      },
      { defer: true }
    )
  );

  const potentialTasks = createMemo<TaskWithProperties[]>(() => {
    if (!taskModeEnabled()) return [];
    const markdown = debouncedMarkdown();
    if (!markdown) return [];

    const extracted = extractCheckboxesFromMarkdown(markdown);

    return extracted.map((task) => ({
      ...task,
      propertyValues: taskPropertyValues[task.lineIndex] ?? {},
    }));
  });

  const toggleTaskMode = () => {
    const newState = !taskModeEnabled();
    setTaskModeEnabled(newState);
    if (newState) {
      setDebouncedMarkdown(markdownState());
    } else {
      setTaskPropertyValues(reconcile({}));
    }
  };

  const updateTaskPropertyValue = (
    lineIndex: number,
    propertyDefinitionId: string,
    value: PropertyApiValues
  ) => {
    setTaskPropertyValues(lineIndex, (prev) => ({
      ...prev,
      [propertyDefinitionId]: value,
    }));
  };

  return {
    taskModeEnabled,
    toggleTaskMode,
    setTaskModeEnabled,
    potentialTasks,
    updateTaskPropertyValue,
  };
}
