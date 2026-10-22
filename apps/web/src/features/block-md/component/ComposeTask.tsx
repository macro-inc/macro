import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useMacroMentionLinkResolver } from '@components/app/split-layout/split-router/mention-links';
import { COMPOSER_STORAGE_CLEARED } from '@core/auth/clear-composer-storage';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { addMediaFromFile } from '@core/component/LexicalMarkdown/plugins/media';
import { initializeEditorEmpty } from '@core/component/LexicalMarkdown/utils';
import type { PortalScope } from '@core/component/ScopedPortal';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { fireAndForget } from '@core/util/fireAndForget';
import { buildSimpleEntityUrl } from '@core/util/url';
import { Telemetry } from '@macro-inc/observability';
import ArrowSquareOutIcon from '@phosphor/arrow-square-out.svg';
import ArrowsOutIcon from '@phosphor/arrows-out.svg';
import PaperclipIcon from '@phosphor/paperclip.svg';
import SplitIcon from '@phosphor/square-half.svg';
import XIcon from '@phosphor/x.svg';
import { Modals } from '@property/component/modal';
import { SYSTEM_PROPERTY_IDS } from '@property/constants';
import { PropertiesProvider } from '@property/context/PropertiesContext';
import { InlineTagsPill } from '@property/tags';
import type { PropertyApiValues } from '@property/types';
import { queryReadyGate } from '@queries/gate';
import { useUpsertToHistoryMutation } from '@queries/history/history';
import { useUserTeamsQuery } from '@queries/team/teams';
import { debounce } from '@solid-primitives/scheduled';
import { useQueryClient } from '@tanstack/solid-query';
import { Button, EntityComposer, Scroll, ToggleSwitch, Tooltip } from '@ui';
import type { LexicalEditor } from 'lexical';
import {
  createEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { reconcile, unwrap } from 'solid-js/store';
import { tabbable } from 'tabbable';
import type { TaskComposerContext } from '../../task-composer/core/context';
import {
  createTaskComposerProperties,
  createTaskWithProperties,
  DEFAULT_TASK_COMPOSER_PROPERTY_IDS,
  defaultTaskPropertyValues,
  taskComposerProjectValue,
} from '../util/taskComposerProperties';
import {
  clearTaskComposerDraft,
  createTaskComposerSharing,
  loadTaskComposerDraft,
  saveTaskComposerDraft,
  taskComposerContextStorage,
} from '../util/taskComposerStorage';
import {
  clearTaskSubmission,
  createTaskSubmissionList,
  submitTaskDraft,
  taskSubmissionDraftStorage,
  taskSubmissionKey,
} from '../util/taskComposerSubmissions';
import { ComposeTaskTitleEditor } from './ComposeTaskTitleEditor';

export { ComposeTaskTitleEditor } from './ComposeTaskTitleEditor';

import { EditorSystemMessage } from './EditorSystemMessage';
import { InlinePropertyValue } from './InlinePropertyValue';
import { RecoverTaskDrafts } from './RecoverTaskDrafts';
import { TaskComposerPropertyEditor } from './TaskComposerPropertyEditor';
import { SimilarTasksSection } from './TaskDuplicateList';

type ComposerTagLayoutMode = 'bottom' | 'title';

/**
 * Wrapper for controls that sit beside the composer title (the inline tags
 * pill) so they stay centered on the title's *first* line rather than drifting
 * to the middle of a title that wraps onto several lines. `h-7` matches the
 * `text-xl/7` line box of {@link ComposeTaskTitleEditor}; keep the two in sync.
 */
export const COMPOSER_TITLE_LINE_CLASS = 'flex h-7 shrink-0 items-center';

/**
 * Toast preview component for successful task creation.
 * @param props
 * @returns
 */

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
}

export function ComposeTask(props: ComposeTaskProps) {
  const splitPanel = useSplitPanelOrThrow();
  const { popoverSplit, openWithSplit } = useSplitLayout();
  const currentUserId = useUserId();
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
  let attachInputRef: HTMLInputElement | undefined;

  const handleAttachFiles = async (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    input.value = '';
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
  const clearDraft = () => {
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

    const snapshotParams = optimisticSnapshot
      ? { params: { optimisticSnapshot }, preserveParams: true as const }
      : {};

    toast.success('Task created', {
      subtext: linkCopied ? 'Link copied' : undefined,
      actions: [
        {
          label: 'Open',
          icon: ArrowSquareOutIcon,
          onClick: () => {
            openWithSplit(
              { type: 'task', id: documentId, ...snapshotParams },
              { referredFrom: null }
            );
          },
        },
        {
          label: 'Open (New Split)',
          icon: SplitIcon,
          onClick: () => {
            openWithSplit(
              { type: 'task', id: documentId, ...snapshotParams },
              { referredFrom: null, preferNewSplit: true }
            );
          },
        },
      ],
    });
  };

  const recoverDraft = (id: string) => {
    if (currentUserId() !== draftOwner) return;
    popoverSplit({
      type: 'component',
      id: 'task-compose',
      params: {
        composerContext: props.composerContext,
        recoveredDraftId: id,
      },
    });
  };

  const createTask = async (inSplit: boolean) => {
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
    let split: ReturnType<typeof openWithSplit>['split'];
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
                clearDraft();
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
                  splitPanel.handle.close();
                  props.onClose?.();
                  if (inSplit) {
                    split = openWithSplit(
                      { type: 'component', id: 'loading' },
                      { referredFrom: 'launcher', preferNewSplit: true }
                    ).split;
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
      split?.goBack();
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
      const snapshotParams = initialSnapshot
        ? {
            params: { optimisticSnapshot: initialSnapshot },
            preserveParams: true as const,
          }
        : {};
      if (split) {
        split.replace({
          next: { type: 'task', id: documentId, ...snapshotParams },
          mergeHistory: true,
          referredFrom: 'launcher',
        });
      } else {
        openWithSplit(
          { type: 'task', id: documentId, ...snapshotParams },
          { referredFrom: 'launcher', preferNewSplit: true }
        );
      }
    } else if (props.onSuccess) {
      props.onSuccess({ documentId, title: taskTitle, content: taskContent });
    } else {
      fireAndForget(
        showTaskCreatedToast(documentId, initialSnapshot),
        'compose-task'
      );
    }
    props.onCreateTask?.(taskTitle, taskContent);
  };
  const handleCreateTask = () => createTask(false);
  const handleContinueInSplit = () => createTask(true);

  const handleClose = () => {
    splitPanel.handle.close();
    props.onClose?.();
  };

  const handleOpenSimilarTask = (taskId: string) => {
    // Closing snapshots the draft (incl. these results); open the existing task
    // in a new split so the composer's work isn't lost.
    splitPanel.handle.close();
    props.onClose?.();
    openWithSplit(
      { type: 'task', id: taskId },
      { referredFrom: null, preferNewSplit: true }
    );
  };

  const handleClearDraft = () => {
    if (recovered) clearTaskSubmission(draftOwner, recovered.id);
    clearDraft();
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
    splitPanel.handle.setDisplayName('New task');
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
      handleCreateTask().catch((error) =>
        Telemetry.error(error, { surface: 'compose-task' })
      );
      return true;
    },
    runWithInputFocused: true,
  });

  const editorConfig = buildConfig('markdown')
    .withAppLinkResolver(useMacroMentionLinkResolver())
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

  const editor = editorConfig.buildHandle().lexical;
  setBodyEditor(editor);
  const portalScope = (): PortalScope =>
    splitPanel.handle.isPopover() ? 'local' : 'block';

  return (
    <EntityComposer.Root tabIndex={-1} ref={setContainerRef}>
      <EntityComposer.Header>
        <div class="flex-1 flex items-center">
          <Show when={splitPanel?.handle.isPopover()}>
            <Button
              onMouseDown={handleContinueInSplit}
              disabled={isCreating()}
              tabIndex={-1}
              tooltip="Continue editing in split"
              size="icon-composer"
            >
              <ArrowsOutIcon />
            </Button>
          </Show>
        </div>
        <Show when={hasDraftChanges()}>
          <Button
            onMouseDown={handleClearDraft}
            disabled={isCreating()}
            tabIndex={-1}
            tooltip="Clear Draft"
            size="sm"
            variant="outline"
            depth={3}
            class="bg-surface px-3"
          >
            Clear Draft
          </Button>
        </Show>
        <Show when={splitPanel?.handle.isPopover()}>
          <Button
            onMouseDown={handleClose}
            tabIndex={-1}
            tooltip="Close"
            size="icon-composer"
          >
            <XIcon />
          </Button>
        </Show>
      </EntityComposer.Header>
      <RecoverTaskDrafts
        userId={draftOwner}
        drafts={submissions().filter((draft) => draft.id !== recovered?.id)}
        onOpen={recoverDraft}
      />
      <Show when={recovered}>
        <div class="border-b border-edge-muted p-3 text-sm">
          Recovered on this device. Task creation requires a connection. Check
          Tasks before retrying to avoid creating a duplicate.
        </div>
      </Show>
      <EntityComposer.Main>
        <EntityComposer.Title>
          <Show when={tagLayoutMode() === 'title'}>
            <div class={COMPOSER_TITLE_LINE_CLASS}>
              <InlineTagsPill
                docTags={composerTags}
                showPlaceholder
                class="shrink-0"
                onActiveChange={handleTitleTagPickerActive}
              />
            </div>
          </Show>
          <ComposeTaskTitleEditor
            value={title}
            onChange={setTitle}
            disabled={isCreating}
            bodyEditor={bodyEditor}
            containerRef={containerRef}
            onUserInput={() => {
              if (errorMessage()) {
                setErrorMessage('');
              }
            }}
            onTagSelected={(tag) => {
              setTagLayoutMode('title');
              fireAndForget(
                composerTags.applyTag(tag.scope, tag.optionId),
                'compose-task'
              );
            }}
            onDeleteTagsAtStart={deleteTitleTagsAtStart}
            portalScope={portalScope()}
            ref={(el) => {
              titleEditorRoot = el;
            }}
          />
        </EntityComposer.Title>

        <EntityComposer.Body class="mb-0">
          <Scroll>
            <MarkdownShell
              config={editorConfig}
              initialState={initialState.editorState}
              initialValue={
                initialState.editorState
                  ? undefined
                  : initialState.content || undefined
              }
              placeholder={props.placeholder ?? 'Add description...'}
              portalScope={portalScope()}
            />
          </Scroll>
        </EntityComposer.Body>

        <div class="shrink-0 flex items-center py-2 -ml-1 touch:-ml-[3px]">
          <input
            ref={(el) => {
              attachInputRef = el;
            }}
            type="file"
            class="hidden"
            multiple
            accept="image/*,video/*"
            onChange={handleAttachFiles}
          />
          <Button
            onMouseDown={() => attachInputRef?.click()}
            tabIndex={-1}
            tooltip="Attach image or video"
            size="icon-composer"
          >
            <PaperclipIcon />
          </Button>
        </div>

        <Suspense fallback={<div class="h-7" />}>
          <PropertiesProvider
            entityType="TASK"
            canEdit={true}
            properties={properties}
            onRefresh={() => {}}
            onPropertyAdded={() => {}}
            onPropertyDeleted={() => {}}
            saveHandler={saveHandler}
          >
            <EntityComposer.Properties
              on:keydown={(e) => {
                const target = e.target as HTMLElement;
                const container = e.currentTarget;
                const tabbables = tabbable(container);
                const isFirst = tabbables.indexOf(target) === 0;
                const isLast =
                  tabbables.indexOf(target) === tabbables.length - 1;

                // Shift+Tab or ArrowUp on first property -> focus editor
                if (
                  isFirst &&
                  ((e.key === 'Tab' && e.shiftKey) || e.key === 'ArrowUp')
                ) {
                  const editor = bodyEditor();
                  if (editor) {
                    e.preventDefault();
                    e.stopPropagation();
                    editor.focus(undefined, { defaultSelection: 'rootEnd' });
                  }
                }

                // Tab or ArrowDown on last property -> let tabbable handle or wrap
                if (
                  isLast &&
                  ((e.key === 'Tab' && !e.shiftKey) || e.key === 'ArrowDown')
                ) {
                  // Allow default Tab behavior to continue to next focusable
                  // element outside this container
                }
              }}
            >
              <For each={properties()}>
                {(property) => (
                  <InlinePropertyValue
                    property={property}
                    emptyLabel={property.displayName}
                  />
                )}
              </For>
              <Show when={tagLayoutMode() === 'bottom'}>
                <InlineTagsPill docTags={composerTags} showPlaceholder />
              </Show>
              <TaskComposerPropertyEditor
                name={title()}
                definitions={availableProperties()}
                properties={properties()}
                onAdd={addProperty}
                onSave={(id, value) => setPropertyValues(id, value)}
              />
            </EntityComposer.Properties>
            <Modals />
          </PropertiesProvider>
        </Suspense>
      </EntityComposer.Main>

      <Show when={errorMessage()}>
        <div class="w-full border-b border-edge-muted" />
        <div class="p-2">
          <EditorSystemMessage variant="error">
            {errorMessage()}
          </EditorSystemMessage>
        </div>
      </Show>

      <EntityComposer.Footer class="items-center">
        <Show when={team()}>
          {(team) => (
            <Tooltip label={sharingHint()} tabIndex={0}>
              <ToggleSwitch
                class="shrink-0 ml-0.5"
                checked={shareWithTeam()}
                onChange={setShareWithTeam}
                disabled={isCreating()}
                label={`Share with ${team().name}`}
                labelClass="text-xs text-ink-muted font-normal whitespace-nowrap"
              />
            </Tooltip>
          )}
        </Show>
        <div class="ml-auto flex items-center gap-3">
          <ToggleSwitch
            labelClass="text-xs text-ink-muted font-normal whitespace-nowrap"
            onChange={setCreateMore}
            disabled={!!recovered || isCreating()}
            checked={createMore()}
            label="Create More"
          />
          <EntityComposer.Submit
            variant="strong"
            onClick={handleCreateTask}
            disabled={title().trim().length === 0 || isCreating()}
            hasContent={title().trim().length > 0}
          >
            Create Task
          </EntityComposer.Submit>
        </div>
      </EntityComposer.Footer>

      <SimilarTasksSection
        title={title}
        content={content}
        onOpenTask={handleOpenSimilarTask}
      />
    </EntityComposer.Root>
  );
}
