import {
  captureTaskTemplate,
  type TaskTemplateContents,
} from '@app/features/task-templates/core/template';
import { t } from '@app/lib/i18n';
import type { TaskComposerDraft } from '@block-md/util/taskComposerStorage';
import { thrownResultErrorHasCode } from '@core/util/result';
import type { PropertyDefinitionDomain } from '@property/types';
import { type Accessor, batch, onCleanup } from 'solid-js';
import { createStore, unwrap } from 'solid-js/store';
import type {
  SavedTaskTemplate,
  TaskTemplateEditorDraft,
  TaskTemplateSelection,
} from '../core/template-selection';
import type { TaskComposerHost } from './task-composer';

type TaskDraft = Omit<TaskComposerDraft, 'timestamp'>;
type EditorSelection = TaskTemplateEditorDraft['selection'];

type TemplateWorkflowOptions = {
  enabled: Accessor<boolean>;
  initialEditor?: TaskTemplateEditorDraft;
  userId: Accessor<string | undefined>;
  draftOwner: string;
  canChange(): boolean;
  sessionActive(): boolean;
  teamId(): string | undefined;
  definitions(): readonly PropertyDefinitionDomain[];
  contextualPropertyIds: ReadonlySet<string>;
  definitionsReady(): boolean;
  baseline: Accessor<TaskTemplateContents | undefined>;
  setBaseline(contents: TaskTemplateContents): void;
  selection: Accessor<TaskTemplateSelection>;
  setSelection(selection: TaskTemplateSelection): void;
  captureTask(): TaskDraft;
  restoreTask(draft: TaskDraft): void;
  contents(): TaskTemplateContents;
  replaceContents(contents: TaskTemplateContents): void;
  stripAttachments(): void;
  applyTemplate(template: SavedTaskTemplate, preserveTaskText?: boolean): void;
  persist(): boolean;
  setError(message: string): void;
  createTemplate: TaskComposerHost['createTemplate'];
  updateTemplate: TaskComposerHost['updateTemplate'];
};

type TemplateWorkflowState = {
  taskDraft: TaskDraft | undefined;
  suspendedEditor: TaskTemplateEditorDraft | undefined;
  pending: boolean;
};
/** A separate editing session with an immutable task snapshot beneath it. */
export function createTemplateWorkflow(options: TemplateWorkflowOptions) {
  const [state, setState] = createStore<TemplateWorkflowState>({
    taskDraft: undefined,
    suspendedEditor:
      options.initialEditor && structuredClone(options.initialEditor),
    pending: false,
  });
  // Root patches replace captured snapshots; raw reads keep them cloneable for persistence.
  const taskDraft = () => state.taskDraft && unwrap(state.taskDraft);
  const suspendedEditor = () =>
    state.suspendedEditor && unwrap(state.suspendedEditor);
  const pending = () => state.pending;
  const setTaskDraft = (draft: TaskDraft | undefined) =>
    setState({ taskDraft: draft });
  const setSuspendedEditor = (editor: TaskTemplateEditorDraft | undefined) =>
    setState({ suspendedEditor: editor });
  const setPending = (value: boolean) => setState('pending', value);
  let request: TaskTemplateEditorDraft['request'];
  let requestVersion = 0;
  let alive = true;
  onCleanup(() => {
    alive = false;
  });
  const isCurrent = () =>
    alive &&
    options.enabled() &&
    options.sessionActive() &&
    options.userId() === options.draftOwner;
  const isTemplateMode = () => Boolean(taskDraft());
  const editingSelection = (): EditorSelection | undefined => {
    const selection = options.selection();
    return selection.kind === 'new' || selection.kind === 'editing'
      ? selection
      : undefined;
  };
  const editorDraft = (): TaskTemplateEditorDraft | undefined => {
    const selection = editingSelection();
    if (!isTemplateMode() || !selection) return undefined;
    return {
      selection: structuredClone(selection),
      contents: options.contents(),
      request: request && structuredClone(request),
    };
  };
  const snapshot = (): TaskDraft => {
    const underlying = taskDraft();
    if (!underlying)
      return { ...options.captureTask(), templateEditor: suspendedEditor() };
    return { ...structuredClone(underlying), templateEditor: editorDraft() };
  };
  const open = (selection: EditorSelection, contents: TaskTemplateContents) => {
    if (
      !options.enabled() ||
      !options.canChange() ||
      !options.definitionsReady() ||
      isTemplateMode()
    )
      return;
    batch(() => {
      setTaskDraft(structuredClone(options.captureTask()));
      request = undefined;
      options.setSelection(structuredClone(selection));
      options.replaceContents(structuredClone(contents));
      options.stripAttachments();
      options.setError('');
    });
  };
  const suspend = () => {
    // Invalidate saves before restoring the task when template access disappears.
    requestVersion += 1;
    const underlying = taskDraft();
    if (!underlying) return;
    const editor = editorDraft();
    batch(() => {
      if (editor) setSuspendedEditor(editor);
      options.restoreTask(structuredClone(underlying));
      setTaskDraft(undefined);
      options.setError('');
    });
  };
  const resume = (draft?: TaskTemplateEditorDraft) => {
    const editor = draft ?? suspendedEditor();
    if (!editor) return;
    if (!options.enabled()) {
      setSuspendedEditor(structuredClone(editor));
      return;
    }
    open(editor.selection, editor.contents);
    if (isTemplateMode()) {
      request = editor.request && structuredClone(editor.request);
      setSuspendedEditor(undefined);
    }
  };
  const discardSuspendedEditor = () => {
    setSuspendedEditor(undefined);
  };
  const cancelTemplateEdit = () => {
    const underlying = taskDraft();
    if (!underlying || pending() || !options.canChange()) return;
    batch(() => {
      options.restoreTask(structuredClone(underlying));
      setTaskDraft(undefined);
      request = undefined;
      options.setError('');
    });
  };
  const saveTemplate = async () => {
    const selection = editingSelection();
    if (
      !selection ||
      !options.enabled() ||
      !isTemplateMode() ||
      pending() ||
      !options.canChange() ||
      !options.definitionsReady()
    )
      return;
    if (!selection.name.trim()) return;
    if (
      selection.kind === 'new' &&
      selection.teamId &&
      selection.teamId !== options.teamId()
    )
      return;
    const definitions = options.definitions();
    options.stripAttachments();
    const contents = captureTaskTemplate(
      options.contents(),
      new Set(definitions.map((definition) => definition.id)),
      options.contextualPropertyIds
    );
    if (selection.kind === 'new') {
      const next = {
        creationId: selection.creationId,
        name: selection.name.trim(),
        teamId: selection.teamId,
        contents,
      };
      if (request && JSON.stringify(request) !== JSON.stringify(next)) {
        options.setError(t('create.taskTemplateCreationConflict'));
        return;
      }
      request = next;
    }
    // Persist both the untouched task and the admitted creation identity before I/O.
    if (!options.persist()) {
      options.setError(t('create.taskTemplateSaveError'));
      return;
    }
    const teamId = options.teamId();
    const version = requestVersion;
    const currentRequest = () =>
      isCurrent() &&
      requestVersion === version &&
      options.teamId() === teamId &&
      options.selection() === selection;
    setPending(true);
    options.setError('');
    try {
      const saved =
        selection.kind === 'new'
          ? await options.createTemplate(
              options.draftOwner,
              { ...selection, name: selection.name.trim() },
              contents,
              definitions
            )
          : await options.updateTemplate(
              options.draftOwner,
              { ...selection, name: selection.name.trim() },
              contents,
              definitions
            );
      if (!currentRequest()) return;
      const underlying = taskDraft();
      if (!underlying) return;
      batch(() => {
        options.restoreTask(structuredClone(underlying));
        setTaskDraft(undefined);
        request = undefined;
        setPending(false);
        // Saving defaults must not discard task-specific text or attachments.
        options.applyTemplate(saved, true);
      });
      options.persist();
    } catch (error) {
      if (currentRequest())
        options.setError(
          thrownResultErrorHasCode(error, 'CONFLICT') ||
            (error instanceof Error &&
              error.message === 'Task template update conflict')
            ? t('create.taskTemplateConflict')
            : t('create.taskTemplateSaveError')
        );
    } finally {
      setPending(false);
    }
  };
  const updateTemplateFields = async () => {
    const selection = options.selection();
    if (
      selection.kind !== 'saved' ||
      !options.enabled() ||
      pending() ||
      !options.canChange() ||
      !options.definitionsReady()
    )
      return;
    const current = options.contents();
    const baseline = options.baseline();
    const definitions = options.definitions();
    const contents = captureTaskTemplate(
      {
        ...current,
        title: selection.template.contents.title,
        descriptionMarkdown: selection.template.contents.descriptionMarkdown,
      },
      new Set(definitions.map((definition) => definition.id)),
      options.contextualPropertyIds
    );
    const teamId = options.teamId();
    const version = requestVersion;
    const currentRequest = () =>
      isCurrent() &&
      requestVersion === version &&
      options.teamId() === teamId &&
      options.selection() === selection;
    setPending(true);
    options.setError('');
    try {
      const saved = await options.updateTemplate(
        options.draftOwner,
        {
          kind: 'editing',
          template: selection.template,
          name: selection.template.name,
        },
        contents,
        definitions
      );
      if (!currentRequest()) return;
      batch(() => {
        options.setSelection({ kind: 'saved', template: saved });
        options.setBaseline({
          ...current,
          title: baseline?.title ?? selection.template.contents.title,
          descriptionMarkdown:
            baseline?.descriptionMarkdown ??
            selection.template.contents.descriptionMarkdown,
        });
      });
    } catch (error) {
      if (currentRequest())
        options.setError(
          thrownResultErrorHasCode(error, 'CONFLICT') ||
            (error instanceof Error &&
              error.message === 'Task template update conflict')
            ? t('create.taskTemplateConflict')
            : t('create.taskTemplateSaveError')
        );
    } finally {
      setPending(false);
    }
  };
  return {
    isTemplateMode,
    pending,
    snapshot,
    open,
    resume,
    suspend,
    hasSuspendedEditor: () => Boolean(suspendedEditor()),
    discardSuspendedEditor,
    cancelTemplateEdit,
    saveTemplate,
    updateTemplateFields,
  };
}
