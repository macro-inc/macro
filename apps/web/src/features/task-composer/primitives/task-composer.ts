import {
  captureTaskTemplate,
  type TaskTemplateContents,
} from '@app/features/task-templates/core/template';
import {
  createTaskComposerProperties,
  createTaskWithProperties,
  DEFAULT_TASK_COMPOSER_PROPERTY_IDS,
  defaultTaskPropertyValues,
  taskComposerProjectValue,
} from '@block-md/util/taskComposerProperties';
import {
  clearTaskComposerDraft,
  createTaskComposerLinkInSource,
  createTaskComposerSharing,
  loadTaskComposerDraft,
  saveTaskComposerDraft,
  taskComposerContextStorage,
} from '@block-md/util/taskComposerStorage';
import {
  checkpointTaskTemplate,
  clearTaskSubmission,
  createTaskSubmissionList,
  submitTaskDraft,
  TemplateCreationConflict,
  taskSubmissionDraftStorage,
  taskSubmissionKey,
} from '@block-md/util/taskComposerSubmissions';
import { COMPOSER_STORAGE_CLEARED } from '@core/auth/clear-composer-storage';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { addMediaFromFile } from '@core/component/LexicalMarkdown/plugins/media';
import type { MentionLinkResolver } from '@core/component/LexicalMarkdown/plugins/text-paste/textPastePlugin';
import { initializeEditorEmpty } from '@core/component/LexicalMarkdown/utils';
import type { PortalScope } from '@core/component/ScopedPortal';
import { toast } from '@core/component/Toast/Toast';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import {
  getDefaultPinnedProperties,
  SYSTEM_PROPERTY_IDS,
} from '@property/constants';
import type {
  PropertyApiValues,
  PropertyDefinitionDomain,
} from '@property/types';
import { queryReadyGate } from '@queries/gate';
import { useUpsertToHistoryMutation } from '@queries/history/history';
import { useUserTeamsQuery } from '@queries/team/teams';
import { debounce } from '@solid-primitives/scheduled';
import { useQueryClient } from '@tanstack/solid-query';
import type { LexicalEditor } from 'lexical';
import {
  type Accessor,
  createEffect,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { reconcile, unwrap } from 'solid-js/store';
import { tabbable } from 'tabbable';
import { initialTaskPinDefinitionIds } from '../core/initial-pins';
import {
  freshTaskFromTemplate,
  type SavedTaskTemplate,
  type TaskTemplateSelection,
  type TemplateCreationRequest,
  templateSubmitKind,
} from '../core/template-selection';
import {
  isTemplateStateDirty,
  templateContextualIds,
} from '../core/template-state';
import type { ComposeTaskProps, ComposeTaskSuccess } from '../core/types';
import {
  CUSTOMER_CONTACT_PROPERTY_IDS,
  customerContactEnabled,
} from '../customer-contact';
import { showTaskCreatedToast } from './taskCreatedToast';
import { applyTemplateToEditor } from './template-editor';

type ComposerTagLayoutMode = 'bottom' | 'title';

/** A task to open, with the snapshot that renders it before it syncs. */
type OpenableTask = { id: string; optimisticSnapshot?: Uint8Array };

/** App capabilities the composer uses; `compose-task.tsx` supplies them. */
export type TaskComposerHost = {
  userId: Accessor<string | undefined>;
  resolveAppLink: MentionLinkResolver | undefined;
  createTemplate(
    viewerId: string,
    selection: Extract<TaskTemplateSelection, { kind: 'new' }>,
    contents: TaskTemplateContents,
    definitions: readonly PropertyDefinitionDomain[]
  ): Promise<SavedTaskTemplate>;
  updateTemplate(
    viewerId: string,
    selection: Extract<TaskTemplateSelection, { kind: 'editing' }>,
    contents: TaskTemplateContents,
    definitions: readonly PropertyDefinitionDomain[]
  ): Promise<SavedTaskTemplate>;
  /** Whether the composer floats over the layout rather than filling a split. */
  isPopover: Accessor<boolean>;
  /**
   * Opens the touch sheet at a fixed height for as long as the calling owner
   * lives, so the composer's body can fill it.
   */
  fillSheet(): void;
  setDisplayName(name: string): void;
  close(): void;
  /** Opens another composer on a recovered submission. */
  openComposer(
    params: Pick<ComposeTaskProps, 'composerContext' | 'recoveredDraftId'>
  ): void;
  openTask(
    task: OpenableTask,
    options: { newSplit: boolean; referredFrom: 'launcher' | null }
  ): void;
  /** Holds a new split for a task that is still being created. */
  openPendingTask(): { show(task: OpenableTask): void; cancel(): void };
};

/**
 * Draft, property, and submission state for one task composer, shared by the
 * desktop and mobile views through the `TaskComposer` parts.
 */
export function createTaskComposer(
  props: ComposeTaskProps,
  host: TaskComposerHost
) {
  const currentUserId = host.userId;
  const queryClient = useQueryClient();
  const draftOwner = currentUserId() ?? '';
  const submissions = createTaskSubmissionList(
    queryClient,
    draftOwner,
    props.composerContext?.key
  );
  const recovered = submissions().find(
    (draft) => draft.id === props.recoveredDraftId
  );
  const draftStorage = recovered
    ? taskSubmissionDraftStorage(draftOwner, recovered.id)
    : props.composerContext
      ? taskComposerContextStorage(props.composerContext.key)
      : undefined;

  const getDefaultPropertyValues = (): Record<string, PropertyApiValues> => {
    const ids = (() => {
      if (props.initialAssigneeIds && props.initialAssigneeIds.length > 0) {
        return props.initialAssigneeIds;
      }
      const id = currentUserId();
      return id ? [id] : [];
    })();
    return {
      ...defaultTaskPropertyValues(ids),
      ...props.composerContext?.initialPropertyValues,
    };
  };

  // Contextual project and date values apply without discarding a restored draft.
  const withInitialProperties = (
    values: Record<string, PropertyApiValues>
  ): Record<string, PropertyApiValues> => {
    const next = { ...values };
    if (props.initialProjectId) {
      next[SYSTEM_PROPERTY_IDS.PROJECT] = taskComposerProjectValue(
        props.initialProjectId
      );
    }
    if (props.initialDueDate) {
      next[SYSTEM_PROPERTY_IDS.DUE_DATE] = {
        valueType: 'DATE',
        value: props.initialDueDate,
      };
    }
    return next;
  };

  // draft init logic
  const initializeFromDraft = () => {
    if (recovered) {
      const draft = loadTaskComposerDraft(draftStorage) ?? recovered.draft;
      return { ...draft, isDraftLoaded: true };
    }
    if (
      !props.initialTitle &&
      !props.initialContent &&
      !props.initialAssigneeIds?.length
    ) {
      const draft = loadTaskComposerDraft(draftStorage);
      if (draft) {
        return {
          title: draft.title,
          templateSelection: draft.templateSelection,
          templateRequest: draft.templateRequest,
          templateBaseline: draft.templateBaseline,
          content: draft.content,
          editorState: draft.editorState,
          propertyValues: withInitialProperties(draft.propertyValues),
          visiblePropertyIds:
            draft.visiblePropertyIds ??
            props.composerContext?.visiblePropertyIds,
          isDraftLoaded: true,
        };
      }
    }
    return {
      title: props.initialTitle ?? '',
      templateSelection: undefined,
      templateRequest: undefined,
      templateBaseline: undefined,
      content: props.initialContent ?? '',
      editorState: undefined,
      propertyValues: withInitialProperties(getDefaultPropertyValues()),
      visiblePropertyIds: props.composerContext?.visiblePropertyIds,
      isDraftLoaded: false,
    };
  };

  const initialState = initializeFromDraft();
  const [title, setTitle] = createSignal(initialState.title);
  // The durable checkpoint takes precedence over an older editing draft.
  const [templateSelection, setTemplateSelection] =
    createSignal<TaskTemplateSelection>(
      recovered?.draft.templateSelection?.kind === 'saved'
        ? recovered.draft.templateSelection
        : (initialState.templateSelection ?? { kind: 'none' })
    );
  let templateRequest: TemplateCreationRequest | undefined =
    recovered?.draft.templateRequest ?? initialState.templateRequest;
  const [isSavingTemplate, setIsSavingTemplate] = createSignal(false);
  const submitKind = () => templateSubmitKind(templateSelection(), title());
  const canSubmit = () => {
    const selection = templateSelection();
    return (
      !isCreating() &&
      ((selection.kind !== 'new' && selection.kind !== 'editing') ||
        (definitionsReady() &&
          Boolean(selection.name.trim()) &&
          (selection.kind !== 'new' ||
            !selection.teamId ||
            selection.teamId === team()?.id))) &&
      (submitKind() === 'template' || Boolean(title().trim()))
    );
  };
  const [content, setContent] = createSignal(initialState.content);
  const [bodyEditor, setBodyEditor] = createSignal<LexicalEditor>();
  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();
  const [attachHotkeys, composeHotkeyScope] = useHotkeyDOMScope(
    'compose-task',
    true
  );
  const [isDraftLoaded, setIsDraftLoaded] = createSignal(
    initialState.isDraftLoaded
  );
  const [createMore, setCreateMore] = createSignal(false);
  const [shareWithTeam, setShareWithTeam] = createTaskComposerSharing(
    recovered?.shareWithTeam
  );
  const [linkInSourceEnabled, setLinkInSourceEnabled] =
    createTaskComposerLinkInSource();
  const linkCreatedTask = (result: ComposeTaskSuccess) => {
    if (linkInSourceEnabled()) props.linkInSource?.insert(result);
  };
  const [errorMessage, setErrorMessage] = createSignal<string>('');
  const userTeams = useUserTeamsQuery();
  const team = () =>
    queryReadyGate(userTeams) ? userTeams.data.at(0) : undefined;
  // Without a team there is nobody to share with, whatever was last toggled.
  const sharesWithTeam = () => (team() ? shareWithTeam() : false);
  const sharingHint = () =>
    shareWithTeam()
      ? 'Visible to your whole team'
      : 'Only you and people you share with';
  const [isCreating, setIsCreating] = createSignal(false);
  const [tagLayoutMode, setTagLayoutMode] =
    createSignal<ComposerTagLayoutMode>('bottom');
  let titleEditorRoot: HTMLDivElement | undefined;

  const attachFiles = async (files: File[]) => {
    const editor = bodyEditor();
    if (!editor || files.length === 0) return;
    for (const file of files) {
      const mediaType = file.type.startsWith('video/') ? 'video' : 'image';
      await addMediaFromFile(editor, file, mediaType);
    }
  };

  // Read once per opening, so a flag change leaves an open draft's row alone.
  const showCustomerContact = customerContactEnabled();

  const {
    propertyValues,
    setPropertyValues,
    properties,
    selectedPropertyIds: visiblePropertyIds,
    setVisiblePropertyIds,
    availableProperties,
    writableProperties: templateProperties,
    definitionsReady,
    addProperty,
    saveHandler,
    composerTags,
    clearComposerTags,
    createDefinitions,
  } = createTaskComposerProperties({
    initialValues: initialState.propertyValues,
    initialVisiblePropertyIds: initialState.visiblePropertyIds,
    hiddenPropertyIds: showCustomerContact
      ? CUSTOMER_CONTACT_PROPERTY_IDS
      : undefined,
    allDefinitions: true,
  });
  const originalTemplateContents: TaskTemplateContents = {
    propertyIds:
      props.composerContext?.visiblePropertyIds ??
      DEFAULT_TASK_COMPOSER_PROPERTY_IDS,
    propertyDefaults: withInitialProperties(getDefaultPropertyValues()),
    descriptionMarkdown: props.initialContent ?? '',
  };
  const contextualPropertyIds = templateContextualIds(props);
  const currentTemplateState = (): TaskTemplateContents => ({
    propertyIds: [...visiblePropertyIds()],
    propertyDefaults: structuredClone(unwrap(propertyValues)),
    descriptionMarkdown: content(),
  });
  const [templateBaseline, setTemplateBaseline] = createSignal<
    TaskTemplateContents | undefined
  >(
    initialState.isDraftLoaded
      ? initialState.templateBaseline
      : currentTemplateState()
  );
  const isTemplateDirty = () =>
    isTemplateStateDirty(
      currentTemplateState(),
      templateBaseline(),
      templateSelection()
    );
  let baselinePropertyValues = JSON.stringify(initialState.propertyValues);
  let baselineVisiblePropertyIds = JSON.stringify(visiblePropertyIds());
  const hasDraftChanges = () =>
    !!title() ||
    templateSelection().kind !== 'none' ||
    !!content() ||
    isDraftLoaded() ||
    JSON.stringify(propertyValues) !== baselinePropertyValues ||
    JSON.stringify(visiblePropertyIds()) !== baselineVisiblePropertyIds;

  // History upsert mutation
  const upsertToHistoryMutation = useUpsertToHistoryMutation();

  // draft saving logic
  let hasInitializedFromDraft = isDraftLoaded();
  let skipNextDraftSave = false;
  let submittedInput = false;
  let draftSessionActive = true;
  const debouncedSave = debounce(
    (draft: Parameters<typeof saveTaskComposerDraft>[0]) => {
      if (draftSessionActive && currentUserId() === draftOwner)
        saveTaskComposerDraft(draft, draftStorage);
    },
    300
  );
  const retireDraftSession = () => {
    draftSessionActive = false;
    debouncedSave.clear();
  };
  window.addEventListener(COMPOSER_STORAGE_CLEARED, retireDraftSession);
  onCleanup(() =>
    window.removeEventListener(COMPOSER_STORAGE_CLEARED, retireDraftSession)
  );
  const draftSnapshot = () => ({
    title: title(),
    templateSelection: structuredClone(templateSelection()),
    templateRequest: templateRequest && structuredClone(templateRequest),
    templateBaseline: templateBaseline() && structuredClone(templateBaseline()),
    content: content(),
    editorState: bodyEditor()?.getEditorState().toJSON(),
    propertyValues: structuredClone(unwrap(propertyValues)),
    visiblePropertyIds: [...visiblePropertyIds()],
  });
  onCleanup(() => {
    debouncedSave.clear();
    // Escape and backdrop dismissal bypass the close button. Flush before disposal.
    if (
      draftSessionActive &&
      currentUserId() === draftOwner &&
      (!isCreating() || !submittedInput) &&
      hasDraftChanges()
    ) {
      saveTaskComposerDraft(draftSnapshot(), draftStorage);
    }
  });
  const discardSavedDraft = () => {
    debouncedSave.clear();
    clearTaskComposerDraft(draftStorage);
  };

  createEffect(() => {
    // Deeply read propertyValues so this effect subscribes to any property
    // change (e.g. setting a due date). unwrap()'d access doesn't subscribe,
    // so without this the draft only saved when title/content changed.
    JSON.stringify(propertyValues);
    const snapshot = draftSnapshot();

    if (skipNextDraftSave) {
      skipNextDraftSave = false;
      return;
    }
    if (hasInitializedFromDraft) {
      hasInitializedFromDraft = false;
      return;
    }

    debouncedSave(snapshot);
  });

  // A title-mode pill that ends a picker session with no tags left has nothing
  // to show, so drop it back to the property row instead of leaving an empty
  // "Tags" chip beside the title. Collapsing on the session end rather than on
  // the tag removal itself keeps the open picker from unmounting under the user.
  const handleTitleTagPickerActive = (active: boolean) => {
    if (active) return;
    if (composerTags.appliedTags().length > 0) return;
    setTagLayoutMode('bottom');
  };

  const deleteTitleTagsAtStart = () => {
    if (tagLayoutMode() !== 'title') return false;
    clearComposerTags();
    setTagLayoutMode('bottom');
    return true;
  };

  const recoverDraft = (id: string) => {
    if (currentUserId() !== draftOwner) return;
    host.openComposer({
      composerContext: props.composerContext,
      recoveredDraftId: id,
    });
  };

  const resetForMore = (available: readonly PropertyDefinitionDomain[]) => {
    submittedInput = false;
    skipNextDraftSave = true;
    setTitle('');
    const selected = templateSelection();
    if (selected.kind === 'saved') {
      const fresh = freshTaskFromTemplate(
        { ...originalTemplateContents, descriptionMarkdown: '' },
        selected.template.contents,
        new Set(available.map((definition) => definition.id)),
        contextualPropertyIds
      );
      replaceTemplateState(fresh);
    } else {
      setContent('');
      const editor = bodyEditor();
      if (editor) initializeEditorEmpty(editor);
      setTemplateBaseline(currentTemplateState());
    }
    setIsDraftLoaded(false);
    requestAnimationFrame(() => titleEditorRoot?.focus());
  };

  const submit = async (inSplit: boolean) => {
    if (
      !draftSessionActive ||
      isCreating() ||
      currentUserId() !== draftOwner ||
      !draftOwner
    )
      return;
    const taskTitle = title().trim();
    const taskContent = content().trim();
    const selection = structuredClone(templateSelection());
    const kind = templateSubmitKind(selection, taskTitle);
    if (
      (selection.kind === 'new' || selection.kind === 'editing') &&
      !definitionsReady()
    )
      return;
    if (
      selection.kind === 'new' &&
      selection.teamId &&
      selection.teamId !== team()?.id
    ) {
      setErrorMessage('Select your current team or a personal template');
      return;
    }
    if (
      (selection.kind === 'new' || selection.kind === 'editing') &&
      !selection.name.trim()
    ) {
      setErrorMessage('Please give this template a name');
      return;
    }
    if (
      !taskTitle &&
      ((!inSplit && kind !== 'template') ||
        (inSplit && selection.kind === 'new'))
    ) {
      setErrorMessage('Please give this task a title');
      return;
    }
    if (selection.kind === 'editing' && inSplit) return;
    const id = recovered?.id ?? crypto.randomUUID();
    if (
      queryClient.isMutating({ mutationKey: taskSubmissionKey(draftOwner, id) })
    )
      return;
    setErrorMessage('');
    setIsCreating(true);
    const keepOpen = createMore() && !inSplit && !recovered;
    submittedInput = true;
    const available = templateProperties();
    if (selection.kind === 'new') {
      const contents = captureTaskTemplate(
        {
          propertyIds: [...visiblePropertyIds()],
          propertyDefaults: structuredClone(unwrap(propertyValues)),
          descriptionMarkdown: content(),
        },
        new Set(available.map((definition) => definition.id)),
        new Set([SYSTEM_PROPERTY_IDS.SOURCE])
      );
      const request = {
        creationId: selection.creationId,
        name: selection.name.trim(),
        teamId: selection.teamId,
        contents,
      };
      if (
        templateRequest?.creationId === request.creationId &&
        JSON.stringify(request) !== JSON.stringify(templateRequest)
      ) {
        setErrorMessage(new TemplateCreationConflict().message);
        setIsCreating(false);
        return;
      }
      templateRequest = request;
    }
    const snapshot = draftSnapshot();
    const properties = structuredClone(Object.entries(snapshot.propertyValues));
    const definitions = createDefinitions();
    const pinnedPropertyDefinitionIds = initialTaskPinDefinitionIds(
      snapshot.visiblePropertyIds ?? visiblePropertyIds(),
      new Set(definitions.keys()),
      getDefaultPinnedProperties('task')
    );
    const sharing = sharesWithTeam();
    const submission = {
      id,
      userId: draftOwner,
      contextKey: props.composerContext?.key,
      draft: snapshot,
      shareWithTeam: sharing,
    };
    let pendingSplit: ReturnType<typeof host.openPendingTask> | undefined;
    let started = false;
    let templateFailed = false;
    let createdTask: Awaited<ReturnType<typeof createTaskWithProperties>> =
      null;
    try {
      createdTask = await submitTaskDraft(
        queryClient,
        submission,
        async (confirm) => {
          if (!draftSessionActive || currentUserId() !== draftOwner)
            return null;
          if (selection.kind === 'new' || selection.kind === 'editing') {
            setIsSavingTemplate(true);
            try {
              const contents =
                selection.kind === 'new' && templateRequest
                  ? templateRequest.contents
                  : captureTaskTemplate(
                      {
                        propertyIds: [...(snapshot.visiblePropertyIds ?? [])],
                        propertyDefaults: snapshot.propertyValues,
                        descriptionMarkdown: snapshot.content,
                      },
                      new Set(available.map((definition) => definition.id)),
                      new Set([SYSTEM_PROPERTY_IDS.SOURCE])
                    );
              const saved =
                selection.kind === 'new'
                  ? await host.createTemplate(
                      draftOwner,
                      { ...selection, name: selection.name.trim() },
                      contents,
                      available
                    )
                  : await host.updateTemplate(
                      draftOwner,
                      { ...selection, name: selection.name.trim() },
                      contents,
                      available
                    );
              // Logout clears storage; a late response must not restore it.
              if (!draftSessionActive || currentUserId() !== draftOwner)
                return null;
              checkpointTaskTemplate(submission, saved);
              templateRequest = undefined;
              setTemplateSelection({ kind: 'saved', template: saved });
              if (kind === 'template') {
                clearTaskSubmission(draftOwner, id);
                if (keepOpen && selection.kind === 'new') {
                  discardSavedDraft();
                  resetForMore(available);
                  saveTaskComposerDraft(draftSnapshot(), draftStorage);
                } else {
                  discardSavedDraft();
                  host.close();
                  props.onClose?.();
                }
                return null;
              }
            } catch (error) {
              templateFailed = true;
              if (error instanceof TemplateCreationConflict)
                setErrorMessage(error.message);
              throw error;
            } finally {
              setIsSavingTemplate(false);
            }
          }
          if (kind === 'template') return null;
          if (!draftSessionActive || currentUserId() !== draftOwner)
            return null;
          started = true;
          return (props.createTask ?? createTaskWithProperties)(
            taskTitle,
            taskContent,
            properties,
            definitions,
            (params) => {
              if (currentUserId() === draftOwner)
                upsertToHistoryMutation.mutate(params);
            },
            {
              shareWithTeam: sharing,
              pinnedPropertyDefinitionIds,
              showFailureToast: false,
              onCreated: confirm,
              onMutate: () => {
                discardSavedDraft();
                if (keepOpen) {
                  resetForMore(available);
                } else {
                  host.close();
                  props.onClose?.();
                  if (inSplit) pendingSplit = host.openPendingTask();
                  else
                    props.onCreateStart?.({
                      title: taskTitle,
                      content: taskContent,
                    });
                }
              },
            }
          );
        },
        { templateOnly: kind === 'template' }
      );
    } catch (error) {
      if (error instanceof TemplateCreationConflict) {
        templateFailed = true;
        setErrorMessage(error.message);
      }
      Telemetry.error(error, { surface: 'compose-task' });
    } finally {
      setIsSavingTemplate(false);
      setIsCreating(false);
    }

    if (!draftSessionActive || currentUserId() !== draftOwner) return;
    if (
      kind === 'template' &&
      !templateFailed &&
      templateSelection().kind === 'saved'
    )
      return;
    if (templateFailed) {
      if (!errorMessage())
        setErrorMessage(
          'Unable to save the template. Keep the composer open and try again.'
        );
      return;
    }
    if (!createdTask) {
      if (!started) {
        setErrorMessage(
          'Unable to save this draft on your device. Keep the composer open and try again.'
        );
        return;
      }
      if (!inSplit && !keepOpen) props.onCreateFailure?.();
      pendingSplit?.cancel();
      toast.failure('Task creation was not confirmed', {
        subtext:
          'Your draft is saved on this device. Check Tasks before retrying.',
        actions: [{ label: 'Recover draft', onClick: () => recoverDraft(id) }],
      });
      return;
    }
    const { documentId, initialSnapshot } = createdTask;
    if (inSplit) {
      const task = { id: documentId, optimisticSnapshot: initialSnapshot };
      if (pendingSplit) pendingSplit.show(task);
      else host.openTask(task, { newSplit: true, referredFrom: 'launcher' });
    } else if (props.onSuccess) {
      props.onSuccess({ documentId, title: taskTitle, content: taskContent });
    } else {
      showTaskCreatedToast(documentId, initialSnapshot, host.openTask);
    }
    linkCreatedTask({ documentId, title: taskTitle, content: taskContent });
    props.onCreateTask?.(taskTitle, taskContent);
  };
  const createTask = () => submit(false);
  const continueInSplit = () =>
    templateSelection().kind === 'editing' ? Promise.resolve() : submit(true);

  const close = () => {
    host.close();
    props.onClose?.();
  };

  const openSimilarTask = (taskId: string) => {
    // Closing snapshots the draft (incl. these results); open the existing task
    // in a new split so the composer's work isn't lost.
    host.close();
    props.onClose?.();
    host.openTask({ id: taskId }, { newSplit: true, referredFrom: null });
  };

  const clearDraft = () => {
    if (recovered) clearTaskSubmission(draftOwner, recovered.id);
    discardSavedDraft();
    skipNextDraftSave = true;
    setTitle('');
    setContent('');
    setTemplateSelection({ kind: 'none' });
    templateRequest = undefined;
    setPropertyValues(
      reconcile(withInitialProperties(getDefaultPropertyValues()))
    );
    setVisiblePropertyIds(
      props.composerContext?.visiblePropertyIds ??
        DEFAULT_TASK_COMPOSER_PROPERTY_IDS
    );
    setTagLayoutMode('bottom');
    setIsDraftLoaded(false);
    baselinePropertyValues = JSON.stringify(unwrap(propertyValues));
    baselineVisiblePropertyIds = JSON.stringify(visiblePropertyIds());
    setTemplateBaseline(currentTemplateState());
    const ed = bodyEditor();
    ed && initializeEditorEmpty(ed);
  };

  const editorFocusChange = (e: KeyboardEvent, dir: 1 | -1) => {
    const root = bodyEditor()?.getRootElement();
    const container = containerRef();
    if (!(root && container)) return;
    const tabbables = tabbable(container);
    const ndx = tabbables.indexOf(root);

    let elem: Element | undefined;
    if (ndx >= 0) {
      // Editor is in tabbable list, navigate relative to it
      const next = (ndx + dir + tabbables.length) % tabbables.length;
      elem = tabbables.at(next);
    } else {
      // Editor not in tabbable list (contenteditable edge case)
      // Go to first element when moving forward, last when moving backward
      elem = dir === 1 ? tabbables.at(0) : tabbables.at(-1);
    }

    if (elem) {
      (elem as HTMLElement).focus();
      e.preventDefault();
      e.stopPropagation();
    }
  };

  onMount(() => {
    host.setDisplayName('New task');
    const container = containerRef();
    if (container) {
      attachHotkeys(container);
    }
  });

  registerHotkey({
    hotkey: 'cmd+enter',
    scopeId: composeHotkeyScope,
    description: 'Create task',
    keyDownHandler: () => {
      fireAndForget(createTask(), 'compose-task');
      return true;
    },
    runWithInputFocused: true,
  });

  const replaceTemplateState = (template: TaskTemplateContents) => {
    const next = applyTemplateToEditor(template, bodyEditor());
    setVisiblePropertyIds([...next.propertyIds]);
    setPropertyValues(reconcile(structuredClone(next.propertyDefaults)));
    setContent(next.descriptionMarkdown);
    setTemplateBaseline(currentTemplateState());
  };
  const canChangeTemplate = () =>
    draftSessionActive && currentUserId() === draftOwner && !isCreating();
  const detachTemplate = () => {
    if (canChangeTemplate()) setTemplateSelection({ kind: 'none' });
  };
  const selectNoTemplate = () => {
    if (!canChangeTemplate()) return;
    replaceTemplateState(
      freshTaskFromTemplate(
        originalTemplateContents,
        { propertyIds: [], propertyDefaults: {}, descriptionMarkdown: '' },
        new Set(templateProperties().map((definition) => definition.id)),
        contextualPropertyIds,
        unwrap(propertyValues)
      )
    );
    detachTemplate();
  };
  const startNewTemplate = () => {
    if (canChangeTemplate())
      setTemplateSelection({
        kind: 'new',
        name: '',
        teamId: null,
        creationId: crypto.randomUUID(),
      });
  };
  const setTemplateName = (name: string) => {
    if (
      canChangeTemplate() &&
      ['new', 'editing'].includes(templateSelection().kind)
    )
      setTemplateSelection((selection) =>
        selection.kind === 'new' || selection.kind === 'editing'
          ? { ...selection, name }
          : selection
      );
  };
  const setTemplateTeamId = (teamId: string | null) => {
    if (
      canChangeTemplate() &&
      templateSelection().kind === 'new' &&
      (!teamId || teamId === team()?.id)
    )
      setTemplateSelection((selection) =>
        selection.kind === 'new' ? { ...selection, teamId } : selection
      );
  };
  const selectTemplate = (template: SavedTaskTemplate) => {
    if (!canChangeTemplate() || !definitionsReady()) return;
    const next = freshTaskFromTemplate(
      { ...originalTemplateContents, descriptionMarkdown: '' },
      template.contents,
      new Set(templateProperties().map((definition) => definition.id)),
      contextualPropertyIds,
      unwrap(propertyValues)
    );
    replaceTemplateState(next);
    setTemplateSelection({
      kind: 'saved',
      template: structuredClone(template),
    });
  };

  const editTemplate = (template: SavedTaskTemplate) => {
    if (!canChangeTemplate() || !definitionsReady()) return;
    const next = structuredClone(template.contents);
    setTitle('');
    replaceTemplateState(next);
    setTemplateSelection({
      kind: 'editing',
      template: structuredClone(template),
      name: template.name,
    });
  };

  const editorConfig = buildConfig('markdown')
    .withAppLinkResolver(host.resolveAppLink)
    .withMentions()
    .withTags({
      applyTargetLabel: 'Task',
      isApplied: (tag) => composerTags.isApplied(tag.optionId),
      onCreate: (tag) => {
        fireAndForget(
          composerTags.applyTag(tag.scope, tag.optionId),
          'compose-task'
        );
      },
    })
    .withEmojis()
    .withActions()
    .withCode()
    .withMedia({ fileDrop: true })
    .withSelectionData()
    .withFloatingFormatMenu()
    .withHistory()
    .onChange(setContent)
    .onFocusLeave({
      onStart: (e) => editorFocusChange(e, -1),
      onEnd: (e) => editorFocusChange(e, +1),
    })
    .onEscape(() => {
      containerRef()?.focus();
      return true;
    });

  setBodyEditor(editorConfig.buildHandle().lexical);
  const portalScope = (): PortalScope => (host.isPopover() ? 'local' : 'block');

  return {
    props,
    draftOwner,
    submissions,
    recovered,
    initialState,
    title,
    setTitle,
    content,
    bodyEditor,
    containerRef,
    setContainerRef,
    setTitleEditorRoot: (el: HTMLDivElement) => {
      titleEditorRoot = el;
    },
    /**
     * Whether the title takes focus as the composer opens. Always on touch,
     * where the opening tap raised the keyboard for it
     * (`raiseKeyboardForNewTaskTitle`); elsewhere a title that already has
     * text (a task started from an email) waits for the user.
     */
    autofocusTitle: isTouchDevice() || !title().trim(),
    editorConfig,
    portalScope,
    isPopover: host.isPopover,
    fillSheet: host.fillSheet,
    isCreating,
    errorMessage,
    setErrorMessage,
    hasDraftChanges,
    isTemplateDirty,
    createMore,
    setCreateMore,
    team,
    shareWithTeam,
    setShareWithTeam,
    sharingHint,
    linkInSourceEnabled,
    setLinkInSourceEnabled,
    tagLayoutMode,
    setTagLayoutMode,
    handleTitleTagPickerActive,
    deleteTitleTagsAtStart,
    properties,
    showCustomerContact,
    propertyValues,
    setPropertyValues,
    templateSelection,
    selectNoTemplate,
    detachTemplate,
    startNewTemplate,
    setTemplateName,
    setTemplateTeamId,
    editTemplate,
    selectTemplate,
    submitKind,
    canSubmit,
    isSavingTemplate,
    availableProperties,
    templateProperties,
    definitionsReady,
    addProperty,
    saveHandler,
    composerTags,
    attachFiles,
    recoverDraft,
    createTask,
    continueInSplit,
    close,
    openSimilarTask,
    clearDraft,
  };
}

export type TaskComposerController = ReturnType<typeof createTaskComposer>;
