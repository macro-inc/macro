import { taskSourceComposerContext } from '@app/features/task-composer/source-context';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  type PersistentLocation,
  serializePersistentLocation,
} from '@core/component/LexicalMarkdown/plugins/location/locationPlugin';
import { toast } from '@core/component/Toast/Toast';
import { trackMention, untrackMention } from '@core/signal/mention';
import { fireAndForget } from '@core/util/fireAndForget';
import { buildMentionMarkdownString } from '@macro-inc/lexical-core';
import { Telemetry } from '@macro-inc/observability';
import type { ComposeTaskSuccess } from '../../task-composer/core/types';
import { URL_PARAMS } from '../constants';

/** The task mention an engine inserts at a saved point. */
export interface TaskMentionInsert {
  readonly documentId: string;
  readonly documentName: string;
  readonly mentionUuid: string | undefined;
}

/**
 * Source MarkdownPopup insertTaskMention around an engine's insertion: track
 * the backlink (best effort), insert, and untrack when the insert failed.
 * Resolves to the point after the inserted mention, or null.
 */
export async function insertTaskMention<Point>(
  blockId: string,
  point: Point,
  task: { documentId: string; title: string },
  insert: (
    point: Point,
    mention: TaskMentionInsert
  ) => Point | null | Promise<Point | null>
): Promise<Point | null> {
  // Tracking only records the backlink; the mention still links without it.
  let mentionUuid: string | undefined;
  try {
    mentionUuid = await trackMention(blockId, 'document', task.documentId);
  } catch (error) {
    Telemetry.error(error, { surface: 'markdown-create-task' });
  }
  const inserted = insert(point, {
    documentId: task.documentId,
    documentName: task.title,
    mentionUuid,
  });
  // Source inserts synchronously after tracking; only an async engine waits.
  const next = inserted instanceof Promise ? await inserted : inserted;
  if (next) return next;
  toast.failure('Could not link the task in this document');
  if (mentionUuid) {
    fireAndForget(
      untrackMention(blockId, mentionUuid, 'document'),
      'markdown-create-task'
    );
  }
  return null;
}

/**
 * Source MarkdownPopup handleCreateTask's snippet branch: open the task
 * composer on the highlighted snippet, as a channel message's "Create task"
 * does, and optionally link each created task after the snippet, in creation
 * order. False when there is no split manager to open it in.
 */
export function openSnippetTaskComposer<Point>(options: {
  blockId: string;
  documentName: string;
  snippet: { text: string; location: PersistentLocation; end: Point };
  canEdit: boolean;
  linkTask: (point: Point, task: ComposeTaskSuccess) => Promise<Point | null>;
}): boolean {
  const splitManager = globalSplitManager();
  if (!splitManager) return false;
  const { snippet } = options;
  const text = snippet.text.replace(/\s+/g, ' ').trim();
  // Create More links each task after the previous one, in creation order.
  let linking: Promise<Point> = Promise.resolve(snippet.end);
  const after = async (
    previous: Promise<Point>,
    task: ComposeTaskSuccess
  ): Promise<Point> => {
    const point = await previous;
    return (await options.linkTask(point, task)) ?? point;
  };
  const linkTask = (task: ComposeTaskSuccess) => {
    linking = after(linking, task);
    fireAndForget(linking, 'markdown-create-task');
  };
  splitManager.createPopoverSplit({
    content: {
      type: 'component',
      id: 'task-compose',
      params: {
        composerContext: taskSourceComposerContext({
          entity_type: 'DOCUMENT',
          entity_id: options.blockId,
        }),
        initialTitle: text.length > 70 ? `${text.slice(0, 70)}...` : text,
        initialContent: buildMentionMarkdownString({
          type: 'document',
          documentId: options.blockId,
          documentName: options.documentName,
          blockName: 'md',
          blockParams: {
            [URL_PARAMS.location]: serializePersistentLocation(
              snippet.location
            ),
          },
        }),
        linkInSource: options.canEdit
          ? {
              label: 'Link in document',
              insert: linkTask,
            }
          : undefined,
      },
    },
  });
  return true;
}
