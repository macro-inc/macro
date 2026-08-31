import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { EmojiMenu } from '@core/component/LexicalMarkdown/component/menu/EmojiMenu';
import { TagsMenu } from '@core/component/LexicalMarkdown/component/menu/TagsMenu';
import { createLexicalWrapper } from '@core/component/LexicalMarkdown/context/LexicalWrapperContext';
import {
  autoRegister,
  emojisPlugin,
  singleLinePlugin,
  tagsPlugin,
} from '@core/component/LexicalMarkdown/plugins';
import { addMediaFromFile } from '@core/component/LexicalMarkdown/plugins/media';
import type { TagMentionLifecycle } from '@core/component/LexicalMarkdown/plugins/tags';
import { createMenuOperations } from '@core/component/LexicalMarkdown/shared/inlineMenu';
import {
  $getCaretRect,
  forceSetTextContent,
  initializeEditorEmpty,
  isRectFlushWith,
  trimWhitespace,
} from '@core/component/LexicalMarkdown/utils';
import type { PortalScope } from '@core/component/ScopedPortal';
import { toast } from '@core/component/Toast/Toast';
import { useUserId } from '@core/context/user';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { buildSimpleEntityUrl } from '@core/util/url';
import { mergeRegister } from '@lexical/utils';
import ArrowSquareOutIcon from '@phosphor/arrow-square-out.svg';
import ArrowsOutIcon from '@phosphor/arrows-out.svg';
import PaperclipIcon from '@phosphor/paperclip.svg';
import SplitIcon from '@phosphor/square-half.svg';
import XIcon from '@phosphor/x.svg';
import { Modals } from '@property/component/modal';
import { PropertiesProvider } from '@property/context/PropertiesContext';
import { InlineTagsPill } from '@property/tags';
import type { PropertyApiValues } from '@property/types';
import { useUpsertToHistoryMutation } from '@queries/history/history';
import { onElementConnect } from '@solid-primitives/lifecycle';
import { debounce } from '@solid-primitives/scheduled';
import { Button, Hotkey, Scroll, ToggleSwitch } from '@ui';
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_NORMAL,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_RIGHT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  type LexicalEditor,
} from 'lexical';
import {
  type Accessor,
  createEffect,
  createSignal,
  For,
  on,
  onCleanup,
  onMount,
  Show,
  Suspense,
  untrack,
} from 'solid-js';
import { reconcile, unwrap } from 'solid-js/store';
import { tabbable } from 'tabbable';
import {
  createTaskComposerProperties,
  createTaskWithProperties,
  defaultTaskPropertyValues,
} from '../util/taskComposerProperties';
import {
  clearTaskComposerDraft,
  loadTaskComposerDraft,
  saveTaskComposerDraft,
  updateDraftTimestamp,
} from '../util/taskComposerStorage';
import { InlinePropertyValue } from './InlinePropertyValue';
import { SimilarTasksSection } from './TaskDuplicateList';

type ComposerTagLayoutMode = 'bottom' | 'title';

function composerTitleNavigationPlugin(
  bodyEditor: Accessor<LexicalEditor | undefined>,
  ignoreNavigation: Accessor<boolean>
) {
  const focusBodyStart = (event: KeyboardEvent | null) => {
    if (ignoreNavigation()) return true;
    const editor = bodyEditor();
    if (!editor) return false;
    event?.preventDefault();
    event?.stopPropagation();
    editor.update(() => {
      const firstChild = $getRoot().getFirstChild();
      firstChild?.selectStart();
    });
    editor.focus();
    return true;
  };

  return (titleEditor: LexicalEditor) =>
    mergeRegister(
      titleEditor.registerCommand(
        KEY_ENTER_COMMAND,
        (event) => focusBodyStart(event),
        COMMAND_PRIORITY_NORMAL
      ),
      titleEditor.registerCommand(
        KEY_ARROW_DOWN_COMMAND,
        (event) => {
          if (ignoreNavigation()) return true;
          const rect = titleEditor.getRootElement()?.getBoundingClientRect();
          if (!rect) return false;
          const caret = $getCaretRect() ?? rect;
          if (!isRectFlushWith(caret, rect, 'bottom', 5)) return false;
          return focusBodyStart(event);
        },
        COMMAND_PRIORITY_NORMAL
      ),
      titleEditor.registerCommand(
        KEY_ARROW_RIGHT_COMMAND,
        (event) => {
          if (ignoreNavigation()) return true;
          const selection = $getSelection();
          if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
            return false;
          }
          const anchorNode = selection.anchor.getNode();
          const len = anchorNode.getTextContent().length;
          if (selection.anchor.offset !== len) return false;
          if (anchorNode.getParent()?.getLastChild() !== anchorNode) {
            return false;
          }
          return focusBodyStart(event);
        },
        COMMAND_PRIORITY_NORMAL
      )
    );
}

function isTitleSelectionAtStart() {
  const selection = $getSelection();
  if (
    !$isRangeSelection(selection) ||
    !selection.isCollapsed() ||
    selection.anchor.offset !== 0
  ) {
    return false;
  }

  const root = $getRoot();
  let topLevel = selection.anchor.getNode();
  while (topLevel.getParent() !== root) {
    const parent = topLevel.getParent();
    if (!parent) return false;
    topLevel = parent;
  }

  let previous = topLevel.getPreviousSibling();
  while (previous) {
    if (previous.getTextContent().length > 0) return false;
    previous = previous.getPreviousSibling();
  }

  return true;
}

export function ComposeTaskTitleEditor(props: {
  value: Accessor<string>;
  onChange: (value: string) => void;
  disabled: Accessor<boolean>;
  bodyEditor: Accessor<LexicalEditor | undefined>;
  containerRef: Accessor<HTMLDivElement | undefined>;
  onUserInput: () => void;
  onTagSelected: (tag: TagMentionLifecycle) => void;
  onDeleteTagsAtStart: () => boolean;
  portalScope?: PortalScope;
  ref?: (el: HTMLDivElement) => void;
}) {
  const [state, setState] = createSignal(props.value());
  const [showPlaceholder, setShowPlaceholder] = createSignal(
    props.value().trim() === ''
  );
  const [rootConnected, setRootConnected] = createSignal(false);

  const { editor, plugins, cleanup } = createLexicalWrapper({
    namespace: 'task-composer-title',
    type: 'title',
    isInteractable: () => !props.disabled(),
  });

  const emojiMenuOperations = createMenuOperations();
  const tagMenuOperations = createMenuOperations();
  const inlineMenuOpen = () =>
    emojiMenuOperations.isOpen() || tagMenuOperations.isOpen();

  initializeEditorEmpty(editor);
  forceSetTextContent(editor, props.value());

  plugins
    .plainText()
    .history(400)
    .use(singleLinePlugin())
    .use(emojisPlugin({ menu: emojiMenuOperations }))
    .use(
      tagsPlugin({
        menu: tagMenuOperations,
        insertTags: false,
        onCreateTag: props.onTagSelected,
      })
    )
    .use(composerTitleNavigationPlugin(props.bodyEditor, inlineMenuOpen))
    .state<string>(setState, 'plain');

  plugins.onUpdate(({ editorState }) => {
    if (!editorState) return;
    setShowPlaceholder(
      editorState.read(() => $getRoot().getTextContent().trim() === '')
    );
  });

  createEffect(() => {
    editor.setEditable(!props.disabled());
  });

  createEffect(
    on(
      state,
      (next) => {
        if (next === props.value()) return;
        props.onUserInput();
        props.onChange(next);
      },
      { defer: true }
    )
  );

  createEffect(() => {
    const next = props.value();
    if (!untrack(rootConnected)) return;
    if (next === untrack(state)) return;
    forceSetTextContent(editor, next);
  });

  autoRegister(
    mergeRegister(
      editor.registerCommand(
        KEY_BACKSPACE_COMMAND,
        (event) => {
          if (!isTitleSelectionAtStart()) return false;
          if (!props.onDeleteTagsAtStart()) return false;
          event?.preventDefault();
          event?.stopPropagation();
          return true;
        },
        COMMAND_PRIORITY_NORMAL
      ),
      editor.registerCommand(
        KEY_ESCAPE_COMMAND,
        (event) => {
          props.containerRef()?.focus();
          event?.preventDefault();
          event?.stopPropagation();
          return true;
        },
        COMMAND_PRIORITY_NORMAL
      )
    )
  );

  const onConnect = (el: HTMLDivElement) => {
    editor.setRootElement(el);
    setRootConnected(true);
    onCleanup(() => {
      trimWhitespace(editor, { trailing: true });
      cleanup();
    });
  };

  return (
    <div class="relative w-full">
      <div
        contentEditable={!props.disabled()}
        class="ph-no-capture w-full text-xl font-medium outline-none whitespace-pre-wrap wrap-break-word"
        ref={(el) => {
          props.ref?.(el);
          onElementConnect(el, () => onConnect(el));
        }}
      />
      <EmojiMenu
        editor={editor}
        menu={emojiMenuOperations}
        useBlockBoundary={true}
        portalScope={props.portalScope}
      />
      <TagsMenu
        editor={editor}
        menu={tagMenuOperations}
        useBlockBoundary={true}
        portalScope={props.portalScope}
      />
      <Show when={showPlaceholder()}>
        <div class="pointer-events-none absolute top-1.5 text-xl font-medium text-ink-placeholder">
          New task
        </div>
      </Show>
    </div>
  );
}

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
  onCreateTask?: (title: string, content: string) => void;
  onClose?: () => void;
  initialTitle?: string;
  initialContent?: string;
  placeholder?: string;
  initialAssigneeIds?: string[];
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

  const getDefaultPropertyValues = (): Record<string, PropertyApiValues> => {
    const ids = (() => {
      if (props.initialAssigneeIds && props.initialAssigneeIds.length > 0) {
        return props.initialAssigneeIds;
      }
      const id = currentUserId();
      return id ? [id] : [];
    })();
    return defaultTaskPropertyValues(ids);
  };

  // draft init logic
  const initializeFromDraft = () => {
    if (
      !props.initialTitle &&
      !props.initialContent &&
      !props.initialAssigneeIds?.length
    ) {
      const draft = loadTaskComposerDraft();
      if (draft) {
        return {
          title: draft.title,
          content: draft.content,
          editorState: draft.editorState,
          propertyValues: draft.propertyValues,
          isDraftLoaded: true,
        };
      }
    }
    return {
      title: props.initialTitle ?? '',
      content: props.initialContent ?? '',
      editorState: undefined,
      propertyValues: getDefaultPropertyValues(),
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
  const [errorMessage, setErrorMessage] = createSignal<string>('');
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
    saveHandler,
    composerTags,
    clearComposerTags,
    createDefinitions,
  } = createTaskComposerProperties({
    initialValues: initialState.propertyValues,
  });

  // History upsert mutation
  const upsertToHistoryMutation = useUpsertToHistoryMutation();

  // draft saving logic
  let hasInitializedFromDraft = isDraftLoaded();
  const debouncedSave = debounce(saveTaskComposerDraft, 300);

  createEffect(() => {
    const currentTitle = title();
    const currentContent = content();
    // Deeply read propertyValues so this effect subscribes to any property
    // change (e.g. setting a due date). unwrap()'d access doesn't subscribe,
    // so without this the draft only saved when title/content changed.
    JSON.stringify(propertyValues);
    const currentProperties = structuredClone(unwrap(propertyValues));

    if (hasInitializedFromDraft) {
      hasInitializedFromDraft = false;
      return;
    }

    debouncedSave({
      title: currentTitle,
      content: currentContent,
      editorState: bodyEditor()?.getEditorState().toJSON(),
      propertyValues: currentProperties,
    });
  });

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

  const handleCreateTask = async () => {
    if (isCreating()) return;

    const taskTitle = title().trim();
    const taskContent = content().trim();

    if (!taskTitle) {
      setErrorMessage('Please give this task a title');
      return;
    }
    setErrorMessage('');

    setIsCreating(true);

    const properties = structuredClone(Object.entries(unwrap(propertyValues)));
    const resetTitleAndBody = () => {
      clearTaskComposerDraft();
      setTitle('');
      setContent('');
      setIsDraftLoaded(false);
      const ed = bodyEditor();
      ed && initializeEditorEmpty(ed);
      requestAnimationFrame(() => titleEditorRoot?.focus());
    };

    if (!createMore()) {
      // Snapshot the draft locally, then clear localStorage so a new dialog
      // opened while this creation is in flight starts blank.
      const draftSnapshot = {
        title: taskTitle,
        content: taskContent,
        propertyValues: structuredClone(unwrap(propertyValues)),
      };
      clearTaskComposerDraft();
      // Close the dialog immediately
      splitPanel.handle.close();
      props.onClose?.();
      console.log(
        '[ComposeTask] dispatching onCreateStart, hasHandler=',
        Boolean(props.onCreateStart)
      );
      props.onCreateStart?.({ title: taskTitle, content: taskContent });

      const createdTask = await createTaskWithProperties(
        taskTitle,
        taskContent,
        properties,
        createDefinitions(),
        (params) => upsertToHistoryMutation.mutate(params)
      );

      setIsCreating(false);

      if (!createdTask) {
        props.onCreateFailure?.();
        // Restore the draft and re-open so the user can retry
        saveTaskComposerDraft(draftSnapshot);
        popoverSplit({ type: 'component', id: 'task-compose' });
        return;
      }

      const { documentId, initialSnapshot } = createdTask;
      if (props.onSuccess) {
        props.onSuccess({ documentId, title: taskTitle, content: taskContent });
      } else {
        showTaskCreatedToast(documentId, initialSnapshot);
      }
      props.onCreateTask?.(taskTitle, taskContent);
      return;
    }

    resetTitleAndBody();
    setIsCreating(false);

    const createdTask = await createTaskWithProperties(
      taskTitle,
      taskContent,
      properties,
      createDefinitions(),
      (params) => upsertToHistoryMutation.mutate(params)
    );

    if (!createdTask) {
      return;
    }

    // Success: clear draft and notify
    clearTaskComposerDraft();
    const { documentId, initialSnapshot } = createdTask;
    if (props.onSuccess) {
      props.onSuccess({ documentId, title: taskTitle, content: taskContent });
    } else {
      showTaskCreatedToast(documentId, initialSnapshot);
    }
    props.onCreateTask?.(taskTitle, taskContent);
  };

  const handleContinueInSplit = async () => {
    if (isCreating()) return;

    const taskTitle = title().trim();
    const taskContent = content().trim();

    setErrorMessage('');
    setIsCreating(true);

    const properties = structuredClone(Object.entries(unwrap(propertyValues)));
    const draftSnapshot = {
      title: taskTitle,
      content: taskContent,
      propertyValues: structuredClone(unwrap(propertyValues)),
    };
    clearTaskComposerDraft();

    splitPanel.handle.close();
    props.onClose?.();

    const split = openWithSplit(
      { type: 'component', id: 'loading' },
      { referredFrom: 'launcher', preferNewSplit: true }
    );

    const createdTask = await createTaskWithProperties(
      taskTitle,
      taskContent,
      properties,
      createDefinitions(),
      (params) => upsertToHistoryMutation.mutate(params)
    );

    setIsCreating(false);

    if (!createdTask) {
      split?.goBack();
      saveTaskComposerDraft(draftSnapshot);
      popoverSplit({ type: 'component', id: 'task-compose' });
      return;
    }

    const { documentId, initialSnapshot } = createdTask;
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

    props.onCreateTask?.(taskTitle, taskContent);
  };

  const handleClose = () => {
    const currentTitle = title();
    const currentContent = content();

    if (currentTitle || currentContent) {
      updateDraftTimestamp();
    }
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
    clearTaskComposerDraft();
    setTitle('');
    setContent('');
    setPropertyValues(reconcile(getDefaultPropertyValues()));
    setTagLayoutMode('bottom');
    setIsDraftLoaded(false);
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
      handleCreateTask();
      return true;
    },
    runWithInputFocused: true,
  });

  const editorConfig = buildConfig('markdown')
    .withMentions()
    .withTags({
      applyTargetLabel: 'Task',
      isApplied: (tag) => composerTags.isApplied(tag.optionId),
      onCreate: (tag) => {
        void composerTags.applyTag(tag.scope, tag.optionId);
      },
    })
    .withEmojis()
    .withActions()
    .withCode()
    .withMedia({ fileDrop: true })
    .withSelectionData()
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
    <div
      class="portal-scope flex flex-col relative h-full max-h-full min-h-0 p-4 gap-4"
      tabIndex={-1}
      ref={setContainerRef}
    >
      <div class="flex items-center gap-1">
        <div class="flex-1 flex items-center">
          <Show when={splitPanel?.handle.isPopover()}>
            <Button
              onMouseDown={handleContinueInSplit}
              disabled={isCreating()}
              tabIndex={-1}
              tooltip="Continue editing in split"
              size="icon-sm"
            >
              <ArrowsOutIcon />
            </Button>
          </Show>
        </div>
        <Show when={content().trim() || title()}>
          <Button
            onMouseDown={handleClearDraft}
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
            size="icon-sm"
          >
            <XIcon />
          </Button>
        </Show>
      </div>
      <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div class="shrink-0 flex gap-2 items-center px-2 mb-4">
          <Show when={tagLayoutMode() === 'title'}>
            <InlineTagsPill
              docTags={composerTags}
              showPlaceholder
              class="shrink-0"
            />
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
              void composerTags.applyTag(tag.scope, tag.optionId);
            }}
            onDeleteTagsAtStart={deleteTitleTagsAtStart}
            portalScope={portalScope()}
            ref={(el) => {
              titleEditorRoot = el;
            }}
          />
        </div>

        <div class="overflow-auto scrollbar-hidden mb-6 min-h-24 grow px-2">
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
            <div
              class="flex min-h-7 flex-row flex-wrap items-center gap-2 text-sm m-px"
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
            </div>
            <Modals />
          </PropertiesProvider>
        </Suspense>
      </div>

      <Show when={errorMessage()}>
        <div class="w-full border-b border-edge-muted" />
        <div class="p-2">
          <div class="text-sm text-failure-ink px-3 py-2">{errorMessage()}</div>
        </div>
      </Show>

      <div class="shrink-0 flex justify-between items-end gap-2">
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
          size="icon-sm"
        >
          <PaperclipIcon />
        </Button>
        <div class="flex items-center gap-3">
          <ToggleSwitch
            labelClass="text-xs text-ink-muted font-normal whitespace-nowrap"
            onChange={setCreateMore}
            checked={createMore()}
            label="Create More"
          />
          <Button
            onClick={handleCreateTask}
            disabled={title().trim().length === 0 || isCreating()}
            variant={title().trim().length === 0 ? 'ghost' : 'accent'}
            depth={3}
            class="gap-3 rounded-lg border-0"
          >
            Create Task
            <Hotkey shortcut="cmd+enter" theme="current" />
          </Button>
        </div>
      </div>

      <SimilarTasksSection
        title={title}
        content={content}
        onOpenTask={handleOpenSimilarTask}
      />
    </div>
  );
}
