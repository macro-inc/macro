import {
  extractCheckboxesFromMarkdown,
  type PotentialTask,
} from '@core/util/taskExtraction';
import { debounce } from '@solid-primitives/scheduled';
import { type Accessor, createMemo, createSignal } from 'solid-js';

const DEBOUNCE_MS = 300;

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

  // Debounce the markdown state updates
  const updateDebouncedMarkdown = debounce(
    (content: string) => setDebouncedMarkdown(content),
    DEBOUNCE_MS
  );

  // Track markdown changes when task mode is enabled
  createMemo(() => {
    if (taskModeEnabled()) {
      updateDebouncedMarkdown(markdownState());
    }
  });

  // Extract potential tasks from debounced markdown
  const potentialTasks = createMemo<PotentialTask[]>(() => {
    if (!taskModeEnabled()) return [];
    const markdown = debouncedMarkdown();
    if (!markdown) return [];
    return extractCheckboxesFromMarkdown(markdown);
  });

  const hasTasksToCreate = createMemo(() => potentialTasks().length > 0);

  const toggleTaskMode = () => {
    const newState = !taskModeEnabled();
    setTaskModeEnabled(newState);
    // When enabling, immediately update with current content
    if (newState) {
      setDebouncedMarkdown(markdownState());
    }
  };

  return {
    taskModeEnabled,
    toggleTaskMode,
    setTaskModeEnabled,
    potentialTasks,
    hasTasksToCreate,
  };
}
