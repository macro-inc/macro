import type { RangeSelection } from 'lexical';
import type { Result } from 'neverthrow';

/**
 * Represents a parsed checkbox/todo item ready for task creation
 */
export type ParsedCheckbox = {
  nodeKey: string;
  title: string;
  rawMarkdown: string;
  assigneeUserIds: string[];
  dueDate: Date | null;
};

/** Successful task creation */
export type TaskCreationSuccess = {
  nodeKey: string;
  documentId: string;
  taskTitle: string;
};

/** Task creation error types */
export type TaskCreationError =
  | { tag: 'EmptyCheckbox'; nodeKey: string }
  | { tag: 'NoDocumentId'; nodeKey: string }
  | { tag: 'ApiError'; nodeKey: string; message: string };

/** Result of creating a task from a checkbox */
export type TaskCreationResult = Result<TaskCreationSuccess, TaskCreationError>;

export type ConvertCheckboxesPluginOptions = {
  /** Current user ID for auto-assignment */
  currentUserId?: string;
  /** Optionally pass a parent id to set the parent id property of the tasks **/
  parentTaskId?: string;
};

/**
 * Options for the checkbox-to-task conversion
 */
export type ConvertCheckboxesOptions = {
  /** The selection to use (from popup's stored selection) */
  selection?: RangeSelection;
  /** Callback when all tasks are created */
  onComplete?: (results: TaskCreationResult[]) => void;
};
