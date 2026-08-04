import { ComposeTaskTitleEditor } from '@block-md/component/ComposeTask';
import { InlinePropertyValue } from '@block-md/component/InlinePropertyValue';
import {
  createTaskComposerProperties,
  createTaskWithProperties,
  defaultTaskPropertyValues,
} from '@block-md/util/taskComposerProperties';
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
import { Scroll, SendButton } from '@ui';
import type { LexicalEditor } from 'lexical';
import {
  createEffect,
  createSignal,
  For,
  type JSX,
  on,
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
}) {
  const currentUserId = useUserId();
  const [title, setTitle] = createSignal('');
  const [content, setContent] = createSignal('');
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
  } = createTaskComposerProperties({ initialValues: defaultPropertyValues() });

  const upsertToHistoryMutation = useUpsertToHistoryMutation();

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
    const documentId = await createTaskWithProperties(
      taskTitle,
      taskContent,
      taskProperties,
      createDefinitions(),
      (params) => upsertToHistoryMutation.mutate(params)
    );
    setIsCreating(false);
    // createTaskWithProperties surfaces its own failure toast; keep the
    // draft so the user can retry.
    if (!documentId) return;
    resetComposer();
    props.onSend({ documentId, title: taskTitle, content: taskContent });
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

  // Imperative DOM focus: entering task mode focuses the title editor.
  createEffect(
    on(
      () => props.active,
      (active) => {
        if (!active) return;
        requestAnimationFrame(() => titleEditorRoot?.focus());
      }
    )
  );

  return (
    <div
      class="relative flex flex-col gap-4 p-4"
      tabIndex={-1}
      ref={setContainerRef}
      data-input-task-composer
    >
      <div class="shrink-0 flex gap-2 items-center px-2">
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

      <div class="overflow-y-auto scrollbar-hidden min-h-24 max-h-[calc(30*var(--dvh,1dvh))] px-2">
        <Scroll>
          <MarkdownShell
            config={editorConfig}
            placeholder="Add description..."
            class="text-sm"
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
          <div class="flex min-h-7 flex-row flex-wrap items-center gap-2 text-sm px-2">
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

      <div class="shrink-0 flex justify-between items-center gap-2">
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
