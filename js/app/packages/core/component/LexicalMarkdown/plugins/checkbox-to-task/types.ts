import type { ListItemNode } from '@lexical/list';
import type { RangeSelection } from 'lexical';

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

/**
 * Result of creating a task from a checkbox
 */
export type TaskCreationResult = {
  success: boolean;
  nodeKey: string;
  documentId?: string;
  taskTitle?: string;
  error?: string;
};

/**
 * Options for the checkbox-to-task conversion
 */
export type ConvertCheckboxesOptions = {
  /** The selection to use (from popup's stored selection) */
  selection?: RangeSelection;
  /** Callback when all tasks are created */
  onComplete?: (results: TaskCreationResult[]) => void;
  /** Callback for progress updates */
  onProgress?: (current: number, total: number) => void;
};
