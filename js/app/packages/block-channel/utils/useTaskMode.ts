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

/** Local property edits for a task */
type TaskPropertyEdits = {
  statusOptionId?: string | null;
  priorityOptionId?: string | null;
  dueDate?: string | null;
  assigneeUserIds?: string[];
};

type UseTaskModeReturn = {
  /** Whether task mode is currently enabled */
  taskModeEnabled: Accessor<boolean>;
  /** Toggle task mode on/off */
  toggleTaskMode: () => void;
  /** Set task mode enabled state directly */
  setTaskModeEnabled: (enabled: boolean) => void;
  /** Potential tasks detected in current content (debounced) */
  potentialTasks: Accessor<PotentialTask[]>;
  /** Whether there are tasks to create */
  hasTasksToCreate: Accessor<boolean>;
  /** Update a property on a specific task */
  updateTaskProperty: (
    lineIndex: number,
    property: 'statusOptionId' | 'priorityOptionId' | 'dueDate',
    value: string | null
  ) => void;
  /** Update assignees on a specific task */
  updateTaskAssignees: (lineIndex: number, assigneeUserIds: string[]) => void;
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

  // Store for local property edits (keyed by lineIndex)
  const [taskEdits, setTaskEdits] = createStore<
    Record<number, TaskPropertyEdits>
  >({});

  // Debounce the markdown state updates
  const updateDebouncedMarkdown = debounce(
    (content: string) => setDebouncedMarkdown(content),
    DEBOUNCE_MS
  );

  // Track markdown changes when task mode is enabled
  // Use createEffect with explicit dependency tracking to avoid interference with editor
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

  // Extract potential tasks from debounced markdown, merged with local edits
  const potentialTasks = createMemo<PotentialTask[]>(() => {
    if (!taskModeEnabled()) return [];
    const markdown = debouncedMarkdown();
    if (!markdown) return [];

    const extracted = extractCheckboxesFromMarkdown(markdown);

    // Merge extracted tasks with any local property edits
    return extracted.map((task) => ({
      ...task,
      ...taskEdits[task.lineIndex],
    }));
  });

  const hasTasksToCreate = createMemo(() => potentialTasks().length > 0);

  const toggleTaskMode = () => {
    const newState = !taskModeEnabled();
    setTaskModeEnabled(newState);
    // When enabling, immediately update with current content
    if (newState) {
      setDebouncedMarkdown(markdownState());
    } else {
      // Clear edits when disabling task mode
      setTaskEdits(reconcile({}));
    }
  };

  // Update a property on a specific task
  const updateTaskProperty = (
    lineIndex: number,
    property: 'statusOptionId' | 'priorityOptionId' | 'dueDate',
    value: string | null
  ) => {
    setTaskEdits(lineIndex, (prev) => ({
      ...prev,
      [property]: value,
    }));
  };

  // Update assignees on a specific task
  const updateTaskAssignees = (
    lineIndex: number,
    assigneeUserIds: string[]
  ) => {
    setTaskEdits(lineIndex, (prev) => ({
      ...prev,
      assigneeUserIds,
    }));
  };

  return {
    taskModeEnabled,
    toggleTaskMode,
    setTaskModeEnabled,
    potentialTasks,
    hasTasksToCreate,
    updateTaskProperty,
    updateTaskAssignees,
  };
}
