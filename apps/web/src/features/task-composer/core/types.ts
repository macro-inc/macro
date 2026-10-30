import type { createTaskWithProperties } from '@block-md/util/taskComposerProperties';
import type { TaskComposerContext } from './context';

export type ComposeTaskSuccess = {
  documentId: string;
  title: string;
  content: string;
};

export interface ComposeTaskProps {
  /** Replaces how the task is created, e.g. to also add it to a project. */
  createTask?: typeof createTaskWithProperties;
  onCreateTask?: (title: string, content: string) => void;
  onClose?: () => void;
  /** Identity of a locally retained, unconfirmed submission. */
  recoveredDraftId?: string;
  initialTitle?: string;
  initialContent?: string;
  placeholder?: string;
  initialAssigneeIds?: string[];
  /** Start in this project, e.g. when composing from the project's page. */
  initialProjectId?: string;
  composerContext?: TaskComposerContext;
  /** Prefill the visible Due Date control when creating from a timeline. */
  initialDueDate?: Date;
  /**
   * When provided, replaces the default success behavior (auto-copy link +
   * toast) so the caller can handle the created task however it needs.
   */
  onSuccess?: (result: ComposeTaskSuccess) => void;
  /**
   * Fires when the user submits and the dialog closes but the create-task
   * network call is still in flight. The originating editor can use this to
   * drop in an await placeholder which onSuccess later replaces.
   */
  onCreateStart?: (init: { title: string; content: string }) => void;
  /**
   * Fires if the create-task API call fails after the dialog has been closed.
   * Pairs with onCreateStart for placeholder cleanup.
   */
  onCreateFailure?: () => void;
  /**
   * Offers a toggle that links the created task back where it was composed
   * from; `insert` runs after creation while the toggle is on.
   */
  linkInSource?: {
    label: string;
    insert: (result: ComposeTaskSuccess) => void;
  };
}
