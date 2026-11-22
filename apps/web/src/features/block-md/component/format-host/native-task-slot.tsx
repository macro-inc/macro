import { convertNativeCheckboxesToTasks } from '@core/component/LexicalMarkdown/plugins/checkbox-to-task/native';
import {
  dispatchApplicationCommandSettledIfSessionEdit,
  queryApplication,
} from '@core/component/LexicalMarkdown/plugins/group-b/command';
import { toast } from '@core/component/Toast/Toast';
import LoadingIcon from '@icon/system/bold/spinner-gap-bold.svg?component-solid';
import CheckSquareIcon from '@icon/system/regular/check-square.svg?component-solid';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { Toolbar } from '@ui';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  insertTaskMention,
  openSnippetTaskComposer,
  type TaskMentionInsert,
} from '../../util/snippet-task-composer';
import { type BodyPopupSlot, buttonSlot } from './body-popup-slots';
import {
  type NativeSelectionSnippet,
  readNativeSelectionSnippet,
} from './native-snippet';

type NativePoint = NativeSelectionSnippet['end'];

function isPoint(value: unknown): value is NativePoint {
  return (
    typeof value === 'object' &&
    value !== null &&
    'key' in value &&
    typeof value.key === 'number' &&
    'offset' in value &&
    typeof value.offset === 'number' &&
    'type' in value &&
    (value.type === 'text' || value.type === 'element')
  );
}

/**
 * Source `$insertAtSavedPoint` of a space and the task mention, as one native
 * write at the generation the snippet was read in. Resolves to the point after
 * the mention, or null when the point is gone or the write was not admitted.
 */
async function insertNativeTaskMention(
  view: EditorView,
  generation: number,
  point: NativePoint,
  mention: TaskMentionInsert
): Promise<NativePoint | null> {
  if (!view.isMounted || view.mirror.keyGeneration !== generation) return null;
  let next: NativePoint | null = null;
  const release = view.onPluginEvent(
    'group-b.task-mention-inserted',
    (payload) => {
      if (isPoint(payload)) next = payload;
    }
  );
  try {
    const settled = await dispatchApplicationCommandSettledIfSessionEdit(
      view,
      'group-b.insert-task-mention-at-point',
      () => ({
        point,
        documentId: mention.documentId,
        documentName: mention.documentName,
        ...(mention.mentionUuid === undefined
          ? {}
          : { mentionUuid: mention.mentionUuid }),
      }),
      // A resync while queued cancels the write instead of failing it.
      {
        admit: () => view.isMounted && view.mirror.keyGeneration === generation,
      }
    );
    if (settled.status === 'error') throw settled.error;
    return settled.status === 'success' && settled.handled ? next : null;
  } finally {
    release();
  }
}

/**
 * Source MarkdownPopup's Task action over the native model: "N tasks" makes
 * one task per selected checklist item; otherwise "Task" opens the task
 * composer on the snippet and can link each created task after it.
 */
export function createNativeTaskSlot(options: {
  /** The mounted native view, if any. */
  view: Accessor<EditorView | undefined>;
  canEdit: Accessor<boolean>;
  currentUserId: Accessor<string | undefined>;
  parentTaskId?: string;
  /** The document the snippet comes from (Source blockId). */
  documentId: Accessor<string>;
  /** Source persistedName() ?? fallbackName() ?? ''. */
  documentName: Accessor<string>;
  /** The published selection, re-read on every selection change. */
  selection: Accessor<unknown>;
  /** The published selection's text (Source selection()?.text). */
  selectionText: Accessor<string>;
}): BodyPopupSlot {
  const [isConverting, setIsConverting] = createSignal(false);
  // Source selectedCheckboxCount: selected items with a title.
  const selectedCheckboxCount = createMemo(() => {
    options.selection();
    const view = options.view();
    if (!view?.isMounted) return 0;
    const count = queryApplication(view, 'group-b.selected-checkbox-count', {});
    return typeof count === 'number' ? count : 0;
  });
  // Source shouldShowCreateTaskButton.
  const shouldShowCreateTaskButton = () =>
    Boolean(options.currentUserId() && options.selectionText());
  // Source convertsCheckboxes: a selection spanning several checklist items.
  const convertsCheckboxes = () =>
    options.canEdit() && selectedCheckboxCount() > 1;
  const createTaskLabel = () => {
    if (isConverting()) return 'Converting...';
    return convertsCheckboxes() ? `${selectedCheckboxCount()} tasks` : 'Task';
  };
  // Source handleConvertToTasks.
  const convert = (hide: () => void) => {
    const view = options.view();
    if (!view) return;
    setIsConverting(true);
    let completed = false;
    const started = convertNativeCheckboxesToTasks(
      view,
      {
        currentUserId: options.currentUserId(),
        parentTaskId: options.parentTaskId,
      },
      (results) => {
        completed = true;
        setIsConverting(false);
        const created = results.filter((result) => result.isOk()).length;
        if (created > 0) {
          toast.success(`Created ${created} task${created > 1 ? 's' : ''}`);
        }
        if (
          results.some(
            (result) => result.isErr() && result.error.tag !== 'EmptyCheckbox'
          )
        ) {
          toast.failure('Some checklist items could not become tasks');
        }
        hide();
      }
    );
    // Without a range selection nothing converts and no completion follows.
    if (!started && !completed) setIsConverting(false);
  };
  // Source handleCreateTask.
  const handleCreateTask = (hide: () => void) => {
    if (convertsCheckboxes()) {
      convert(hide);
      return;
    }
    const view = options.view();
    const generation = view?.mirror.keyGeneration;
    if (!view || generation === null || generation === undefined) return;
    const snippet = readNativeSelectionSnippet(view);
    if (!snippet) return;
    const blockId = options.documentId();
    const opened = openSnippetTaskComposer<NativePoint>({
      blockId,
      documentName: options.documentName(),
      snippet,
      canEdit: options.canEdit(),
      linkTask: (point, task) =>
        insertTaskMention(blockId, point, task, (at, mention) =>
          insertNativeTaskMention(view, generation, at, mention)
        ),
    });
    if (opened) hide();
  };
  return buttonSlot({
    id: 'task',
    available: shouldShowCreateTaskButton,
    button: (control) => (
      <Toolbar.Button
        size="sm"
        tooltip={
          convertsCheckboxes()
            ? 'Create a task for each checklist item'
            : 'Create task from snippet'
        }
        onClick={() => handleCreateTask(control.close)}
        disabled={isConverting()}
      >
        <Dynamic
          component={isConverting() ? LoadingIcon : CheckSquareIcon}
          class="size-4"
        />
        {createTaskLabel()}
      </Toolbar.Button>
    ),
    select: handleCreateTask,
    touchLabel: createTaskLabel,
    converting: isConverting,
  });
}
