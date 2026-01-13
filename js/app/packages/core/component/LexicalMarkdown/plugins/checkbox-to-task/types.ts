import type { ListItemNode } from '@lexical/list';
import type { RangeSelection } from 'lexical';
import type { Result } from 'neverthrow';

/**
 * Represents a parsed checkbox/todo item ready for task creation
 */
export type ParsedCheckbox = {
  /** The Lexical node key for this checkbox */
  nodeKey: string;
  /** The ListItemNode reference */
  node: ListItemNode;
  /** Extracted title (text content without mention XML) */
  title: string;
  /** Raw markdown text of the checkbox content */
  rawMarkdown: string;
  /** Extracted user IDs from @user mentions */
  assigneeUserIds: string[];
  /** Extracted due date ISO string from date mention (if present) */
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
  /** The selection to use (from popup's stored selection) */
  selection?: RangeSelection;
  /** Callback when all tasks are created */
  onComplete?: (results: TaskCreationResult[]) => void;
};
