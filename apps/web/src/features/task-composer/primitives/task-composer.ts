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
  clearTaskSubmission,
  createTaskSubmissionList,
  submitTaskDraft,
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
import { buildSimpleEntityUrl } from '@core/util/url';
import ArrowSquareOutIcon from '@icon/system/regular/arrow-square-out.svg';
import SplitIcon from '@icon/system/regular/square-half.svg';
import { Telemetry } from '@macro-inc/observability';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import type { PropertyApiValues } from '@property/types';
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
import type { ComposeTaskProps, ComposeTaskSuccess } from '../core/types';

type ComposerTagLayoutMode = 'bottom' | 'title';

/** A task to open, with the snapshot that renders it before it syncs. */
type OpenableTask = { id: string; optimisticSnapshot?: Uint8Array };

/** App capabilities the composer uses; `compose-task.tsx` supplies them. */
export type TaskComposerHost = {
  userId: Accessor<string | undefined>;
  resolveAppLink: MentionLinkResolver | undefined;
  /** Whether the composer floats over the layout rather than filling a split. */
  isPopover: Accessor<boolean>;
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
      content: props.initialContent ?? '',
      editorState: undefined,
      propertyValues: withInitialProperties(getDefaultPropertyValues()),
      visiblePropertyIds: props.composerContext?.visiblePropertyIds,
      isDraftLoaded: false,
    };
  };

  const initialState = initializeFromDraft();
  const [title, setTitle] = createSignal(initialState.title);
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

  const {
    propertyValues,
    setPropertyValues,
    properties,
    visiblePropertyIds,
    setVisiblePropertyIds,
    availableProperties,
    addProperty,
    saveHandler,
    composerTags,
    clearComposerTags,
    createDefinitions,
  } = createTaskComposerProperties({
    initialValues: initialState.propertyValues,
    initialVisiblePropertyIds: initialState.visiblePropertyIds,
    allDefinitions: true,
  });
  let baselinePropertyValues = JSON.stringify(initialState.propertyValues);
  let baselineVisiblePropertyIds = JSON.stringify(visiblePropertyIds());
  const hasDraftChanges = () =>
    !!title() ||
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
    const currentTitle = title();
    const currentContent = content();
    // Deeply read propertyValues so this effect subscribes to any property
    // change (e.g. setting a due date). unwrap()'d access doesn't subscribe,
    // so without this the draft only saved when title/content changed.
    JSON.stringify(propertyValues);
    visiblePropertyIds();
    const currentProperties = structuredClone(unwrap(propertyValues));

    if (skipNextDraftSave) {
      skipNextDraftSave = false;
      return;
    }
    if (hasInitializedFromDraft) {
      hasInitializedFromDraft = false;
      return;
    }

    debouncedSave({
      title: currentTitle,
      content: currentContent,
      editorState: bodyEditor()?.getEditorState().toJSON(),
      propertyValues: currentProperties,
      visiblePropertyIds: [...visiblePropertyIds()],
    });
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

  const showTaskCreatedToast = async (
    documentId: string,
    optimisticSnapshot: Uint8Array | undefined
  ) => {
    // Auto-copy link to clipboard
    const url = buildSimpleEntityUrl({ type: 'task', id: documentId });
    let linkCopied = false;
    try {
      await navigator.clipboard.writeText(url);
      linkCopied = true;
    } catch {
      toast.failure('Failed to copy link to clipboard');
    }

    const task = { id: documentId, optimisticSnapshot };
    const openTask = (newSplit: boolean) => {
      if (toastId !== undefined) toast.dismiss(toastId);
      host.openTask(task, { newSplit, referredFrom: null });
    };
    const toastId = toast.success('Task created', {
      subtext: linkCopied ? 'Link copied' : undefined,
      actions: [
        {
          label: 'Open',
          icon: ArrowSquareOutIcon,
          onClick: () => openTask(false),
        },
        ...(!isTouchDevice()
          ? [
              {
                label: 'Open (New Split)',
                icon: SplitIcon,
                onClick: () => openTask(true),
              },
            ]
          : []),
      ],
    });
  };

  const recoverDraft = (id: string) => {
    if (currentUserId() !== draftOwner) return;
    host.openComposer({
      composerContext: props.composerContext,
      recoveredDraftId: id,
    });
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
    if (!inSplit && !taskTitle) {
      setErrorMessage('Please give this task a title');
      return;
    }
    const id = recovered?.id ?? crypto.randomUUID();
    if (
      queryClient.isMutating({ mutationKey: taskSubmissionKey(draftOwner, id) })
    )
      return;
    setErrorMessage('');
    setIsCreating(true);
    const keepOpen = createMore() && !inSplit && !recovered;
    submittedInput = true;
    const properties = structuredClone(Object.entries(unwrap(propertyValues)));
    const definitions = createDefinitions();
    const snapshot = draftSnapshot();
    const shareWithTeam = sharesWithTeam();
    let pendingSplit: ReturnType<typeof host.openPendingTask> | undefined;
    let started = false;
    let createdTask: Awaited<ReturnType<typeof createTaskWithProperties>> =
      null;
    try {
      createdTask = await submitTaskDraft(
        queryClient,
        {
          id,
          userId: draftOwner,
          contextKey: props.composerContext?.key,
          draft: snapshot,
          shareWithTeam,
        },
        (confirm) => {
          if (currentUserId() !== draftOwner) return Promise.resolve(null);
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
              shareWithTeam,
              showFailureToast: false,
              onCreated: confirm,
              onMutate: () => {
                discardSavedDraft();
                if (keepOpen) {
                  submittedInput = false;
                  skipNextDraftSave = true;
                  setTitle('');
                  setContent('');
                  setIsDraftLoaded(false);
                  const editor = bodyEditor();
                  if (editor) initializeEditorEmpty(editor);
                  requestAnimationFrame(() => titleEditorRoot?.focus());
                } else {
                  host.close();
                  props.onClose?.();
                  if (inSplit) {
                    pendingSplit = host.openPendingTask();
                  } else {
                    props.onCreateStart?.({
                      title: taskTitle,
                      content: taskContent,
                    });
                  }
                }
              },
            }
          );
        }
      );
    } catch (error) {
      Telemetry.error(error, { surface: 'compose-task' });
    } finally {
      setIsCreating(false);
    }

    if (currentUserId() !== draftOwner) return;
    if (!createdTask) {
      if (!started) {
        setErrorMessage(
          'Unable to save this draft on your device. Keep the composer open and try again.'
        );
        return;
      }
      if (!inSplit && !keepOpen) props.onCreateFailure?.();
      pendingSplit?.cancel();
      if (currentUserId() === draftOwner) {
        toast.failure('Task creation was not confirmed', {
          subtext:
            'Your draft is saved on this device. Check Tasks before retrying.',
          actions: [
            { label: 'Recover draft', onClick: () => recoverDraft(id) },
          ],
        });
      }
      return;
    }
    if (currentUserId() !== draftOwner) return;
    const { documentId, initialSnapshot } = createdTask;
    if (inSplit) {
      const task = { id: documentId, optimisticSnapshot: initialSnapshot };
      if (pendingSplit) {
        pendingSplit.show(task);
      } else {
        host.openTask(task, { newSplit: true, referredFrom: 'launcher' });
      }
    } else if (props.onSuccess) {
      props.onSuccess({ documentId, title: taskTitle, content: taskContent });
    } else {
      fireAndForget(
        showTaskCreatedToast(documentId, initialSnapshot),
        'compose-task'
      );
    }
    linkCreatedTask({ documentId, title: taskTitle, content: taskContent });
    props.onCreateTask?.(taskTitle, taskContent);
  };
  const createTask = () => submit(false);
  const continueInSplit = () => submit(true);

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
    // An empty title (e.g. a task started from an email) waits for the user.
    if (!title().trim()) {
      requestAnimationFrame(() => titleEditorRoot?.focus());
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
    editorConfig,
    portalScope,
    isPopover: host.isPopover,
    isCreating,
    errorMessage,
    setErrorMessage,
    hasDraftChanges,
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
    setPropertyValues,
    availableProperties,
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
