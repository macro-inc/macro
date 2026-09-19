import {
  COMPOSER_TITLE_LINE_CLASS,
  ComposeTaskTitleEditor,
} from '@block-md/component/ComposeTask';
import { InlinePropertyValue } from '@block-md/component/InlinePropertyValue';
import {
  createTaskComposerProperties,
  createTaskWithProperties,
  defaultTaskPropertyValues,
} from '@block-md/util/taskComposerProperties';
import {
  loadTaskComposerDraft,
  saveTaskComposerDraft,
  type TaskComposerDraft,
  type TaskComposerDraftStorage,
} from '@block-md/util/taskComposerStorage';
import { buildConfig } from '@core/component/LexicalMarkdown/builder/MarkdownConfigBuilder';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { addMediaFromFile } from '@core/component/LexicalMarkdown/plugins/media';
import { initializeEditorEmpty } from '@core/component/LexicalMarkdown/utils';
import { useUserId } from '@core/context/user';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import PaperclipIcon from '@phosphor-icons/core/regular/paperclip.svg?component-solid';
import { Modals } from '@property/component/modal';
import { PropertiesProvider } from '@property/context/PropertiesContext';
import { InlineTagsPill } from '@property/tags';
import { useUpsertToHistoryMutation } from '@queries/history/history';
import { debounce } from '@solid-primitives/scheduled';
import { Scroll, SendButton } from '@ui';
import type { LexicalEditor } from 'lexical';
import {
  createEffect,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { reconcile, unwrap } from 'solid-js/store';
import { InputActionButton } from './ActionButton';

export type TaskComposerSendPayload = {
  documentId: string;
  title: string;
  content: string;
};

/**
 * The channel input's task face: a slimmed-down task compose dialog
 * (title, description, property pills) that swaps in for the message
 * editor when the input is toggled into task mode. Sending creates the
 * task and hands it to the host, which posts it into the channel.
 */
export function TaskComposer(props: {
  /** Whether the composer is the visible face of the input. */
  active: boolean;
  /** Fires after the task is created; the host posts it to the channel. */
  onSend: (task: TaskComposerSendPayload) => void;
  /** The message/task mode switch, rendered in the composer footer. */
  modeSwitch?: JSX.Element;
  /**
   * Whether to focus the title editor when the composer mounts already
   * active (e.g. a restored task-mode draft). Later activations always
   * focus. Defaults to `true`.
   */
  autofocus?: boolean;
  /**
   * localStorage key to persist the draft under, scoped by the host (e.g.
   * per channel). Without it the draft only lives as long as the composer.
   */
  draftPersistenceKey?: string;
}) {
  const currentUserId = useUserId();

  // Per-host drafts follow the message input's persistence semantics (kept
  // until sent) rather than the compose dialog's short expiry window.
  const draftStorage: TaskComposerDraftStorage | undefined =
    props.draftPersistenceKey
      ? { storageKey: props.draftPersistenceKey, expiryMs: null }
      : undefined;
  const restoredDraft = draftStorage
    ? loadTaskComposerDraft(draftStorage)
    : null;

  const [title, setTitle] = createSignal(restoredDraft?.title ?? '');
  const [content, setContent] = createSignal(restoredDraft?.content ?? '');
  const [bodyEditor, setBodyEditor] = createSignal<LexicalEditor>();
  const [containerRef, setContainerRef] = createSignal<HTMLDivElement>();
  const [isCreating, setIsCreating] = createSignal(false);
  const [tagLayoutMode, setTagLayoutMode] = createSignal<'bottom' | 'title'>(
    'bottom'
  );
  let titleEditorRoot: HTMLDivElement | undefined;
  let attachInputRef: HTMLInputElement | undefined;

  const defaultPropertyValues = () => {
    const id = currentUserId();
    return defaultTaskPropertyValues(id ? [id] : []);
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
    initialValues: restoredDraft?.propertyValues ?? defaultPropertyValues(),
  });

  const upsertToHistoryMutation = useUpsertToHistoryMutation();

  if (draftStorage) {
    const snapshotDraft = (): Omit<TaskComposerDraft, 'timestamp'> => ({
      title: title(),
      content: content(),
      editorState: bodyEditor()?.getEditorState().toJSON(),
      propertyValues: structuredClone(unwrap(propertyValues)),
    });

    // Mirrors the compose dialog's draft autosave: skip the first run (it
    // would just rewrite what was restored), subscribe deeply to property
    // edits, and debounce the localStorage writes.
    let hasInitializedFromDraft = restoredDraft !== null;
    const debouncedSave = debounce(
      (draft: Omit<TaskComposerDraft, 'timestamp'>) =>
        saveTaskComposerDraft(draft, draftStorage),
      300
    );
    createEffect(() => {
      title();
      content();
      JSON.stringify(propertyValues);
      if (hasInitializedFromDraft) {
        hasInitializedFromDraft = false;
        return;
      }
      debouncedSave(snapshotDraft());
    });
    onCleanup(() => {
      // Flush the latest state so navigating away never drops keystrokes
      // that were still inside the debounce window.
      debouncedSave.clear();
      saveTaskComposerDraft(snapshotDraft(), draftStorage);
    });
  }

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

  const canSend = () => title().trim().length > 0 && !isCreating();

  const resetComposer = () => {
    setTitle('');
    setContent('');
    setTagLayoutMode('bottom');
    setPropertyValues(reconcile(defaultPropertyValues()));
    const editor = bodyEditor();
    editor && initializeEditorEmpty(editor);
  };

  const handleSend = async () => {
    if (!canSend()) return;
    const taskTitle = title().trim();
    const taskContent = content().trim();
    setIsCreating(true);
    const taskProperties = structuredClone(
      Object.entries(unwrap(propertyValues))
    );
    const createdTask = await createTaskWithProperties(
      taskTitle,
      taskContent,
      taskProperties,
      createDefinitions(),
      (params) => upsertToHistoryMutation.mutate(params)
    );
    setIsCreating(false);
    // createTaskWithProperties surfaces its own failure toast; keep the
    // draft so the user can retry.
    if (!createdTask) return;
    resetComposer();
    props.onSend({
      documentId: createdTask.documentId,
      title: taskTitle,
      content: taskContent,
    });
  };

  const [attachHotkeys, composerHotkeyScope] = useHotkeyDOMScope(
    'channel-input-task-composer',
    true
  );
  onMount(() => {
    const container = containerRef();
    if (container) attachHotkeys(container);
  });

  registerHotkey({
    hotkey: 'cmd+enter',
    scopeId: composerHotkeyScope,
    description: 'Create task and send',
    keyDownHandler: () => {
      void handleSend();
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
    .onEscape(() => {
      containerRef()?.focus();
      return true;
    });

  const editor = editorConfig.buildHandle().lexical;
  setBodyEditor(editor);

  // Imperative DOM focus: entering task mode focuses the title editor. The
  // first activation is the mount itself — a restored task-mode draft — and
  // only focuses when the host's autofocus allows it.
  let isFirstActivation = true;
  createEffect(
    on(
      () => props.active,
      (active) => {
        if (!active) return;
        const shouldFocus = isFirstActivation
          ? (props.autofocus ?? true)
          : true;
        isFirstActivation = false;
        if (!shouldFocus) return;
        requestAnimationFrame(() => titleEditorRoot?.focus());
      }
    )
  );

  return (
    // Compact edges matching the message face (content at px-3/pt-2), with
    // roomier gap-4 spacing between title, description, and property pills.
    // The property pills and footer share the footer's 8px inset so the pills,
    // the action buttons, and the composer's edges are evenly spaced.
    <div
      class="relative flex flex-col"
      tabIndex={-1}
      ref={setContainerRef}
      data-input-task-composer
    >
      <div class="flex flex-col gap-4 px-3 pt-2">
        <div class="shrink-0 flex gap-2 items-start">
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
            onUserInput={() => {}}
            onTagSelected={(tag) => {
              setTagLayoutMode('title');
              void composerTags.applyTag(tag.scope, tag.optionId);
            }}
            onDeleteTagsAtStart={deleteTitleTagsAtStart}
            ref={(el) => {
              titleEditorRoot = el;
            }}
          />
        </div>

        <div class="overflow-y-auto scrollbar-hidden min-h-24 max-h-[calc(30*var(--dvh,1dvh))]">
          <Scroll>
            <MarkdownShell
              config={editorConfig}
              initialState={restoredDraft?.editorState}
              initialValue={
                restoredDraft?.editorState
                  ? undefined
                  : restoredDraft?.content || undefined
              }
              placeholder="Add description, type @ to insert or / for commands"
              class="text-sm"
            />
          </Scroll>
        </div>
      </div>

      {/* Property pills line up with the footer's action row (px-2) rather
          than the text above it, so the leading pill is flush with the attach
          button, and pt-4 keeps the gap-4 rhythm of the content above. */}
      <div class="px-2 pt-4">
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
            <div class="flex min-h-7 flex-row flex-wrap items-center gap-2 text-sm">
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

      {/* A plain p-2 box (no fixed height, no extra bottom margin) puts an
          even 8px between the action row and the composer's bottom-left edges
          and the property pills above it. */}
      <div class="shrink-0 flex w-full flex-row justify-between items-center p-2 space-x-2">
        <div class="flex items-center gap-2">
          <input
            ref={(el) => {
              attachInputRef = el;
            }}
            type="file"
            class="hidden"
            multiple
            accept="image/*,video/*"
            onChange={handleAttachFiles}
            data-input-task-attach-picker
          />
          <InputActionButton
            label="Attach image or video"
            onClick={() => attachInputRef?.click()}
          >
            <PaperclipIcon />
          </InputActionButton>
          {props.modeSwitch}
        </div>
        <SendButton
          tooltip="Create task and send"
          shortcut="cmd+enter"
          aria-label="Create task and send"
          data-input-action="send-task"
          pending={isCreating()}
          disabled={!canSend()}
          onPointerDown={(event) => {
            event.preventDefault();
            void handleSend();
          }}
        />
      </div>
    </div>
  );
}
