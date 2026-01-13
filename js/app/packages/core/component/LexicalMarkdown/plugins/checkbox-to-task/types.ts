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
  dueDate: string | null;
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

/**
 * Options for the checkbox-to-task conversion
 */
export type ConvertCheckboxesOptions = {
  /** Current user ID for auto-assignment */
  currentUserId: string;
  /** The selection to use (from popup's stored selection) */
  selection?: RangeSelection;
  /** Callback when all tasks are created */
  onComplete?: (results: TaskCreationResult[]) => void;
};
