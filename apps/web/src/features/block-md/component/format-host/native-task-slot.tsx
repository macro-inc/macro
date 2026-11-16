import { convertNativeCheckboxesToTasks } from '@core/component/LexicalMarkdown/plugins/checkbox-to-task/native';
import { queryApplication } from '@core/component/LexicalMarkdown/plugins/group-b/command';
import { toast } from '@core/component/Toast/Toast';
import LoadingIcon from '@icon/system/bold/spinner-gap-bold.svg?component-solid';
import CheckSquareIcon from '@icon/system/regular/check-square.svg?component-solid';
import type { EditorView } from '@macro-inc/lexical-wasm-view';
import { Toolbar } from '@ui';
import { type Accessor, createMemo, createSignal } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { type BodyPopupSlot, buttonSlot } from './body-popup-slots';

/**
 * Source MarkdownPopup's Task action over the native model, for a selection
 * spanning several checklist items: "N tasks" makes one task per item.
 */
export function createNativeTaskSlot(options: {
  /** The mounted native view, if any. */
  view: Accessor<EditorView | undefined>;
  canEdit: Accessor<boolean>;
  currentUserId: Accessor<string | undefined>;
  parentTaskId?: string;
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
  // Source handleCreateTask; its snippet-composer branch is not native yet.
  const handleCreateTask = (hide: () => void) => {
    if (convertsCheckboxes()) convert(hide);
  };
  return buttonSlot({
    id: 'task',
    available: () => shouldShowCreateTaskButton() && convertsCheckboxes(),
    button: (control) => (
      <Toolbar.Button
        size="sm"
        tooltip="Create a task for each checklist item"
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
