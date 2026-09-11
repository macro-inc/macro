import { InputActionButton } from '@channel/Input/ActionButton';
import { useInputCommands } from '@channel/Input/context';
import { createCollapsedInputState } from '@channel/Input/create-collapsed-input-state';
import { FormatButtons } from '@channel/Input/FormatButtons';
import { Input } from '@channel/Input/Input';
import type {
  InputCallbacks,
  InputData,
  InputHandle,
  InputSnapshot,
} from '@channel/Input/types';
import { isReplyInput } from '@channel/Input/types';
import {
  applyInlineFormat,
  applyNodeFormat,
} from '@channel/Input/utils/formatting';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import { addMediaFromFile } from '@core/component/LexicalMarkdown/plugins/media';
import { singleLineMarkdownTheme } from '@core/component/LexicalMarkdown/theme';
import { isMobile } from '@core/mobile/isMobile';
import type { IUser } from '@core/user/types';
import PaperclipIcon from '@phosphor-icons/core/regular/paperclip.svg?component-solid';
import { isIOS } from '@solid-primitives/platform';
import { CollapsedInput, ComposerSurface } from '@ui';
import {
  type Accessor,
  createSignal,
  type JSX,
  Match,
  Show,
  Switch,
} from 'solid-js';
import { createConfiguredDiscussionMarkdownEditor } from './configured-discussion-markdown-editor';

export type DiscussionInputProps = InputCallbacks & {
  input: InputData;
  markdownNamespace?: string;
  participants?: Accessor<IUser[]>;
  onReady?: (handle: InputHandle) => void;
  children?: JSX.Element;
  /** Whether to auto-focus the input on mount. Defaults to `!isMobile()`. */
  autofocus?: boolean;
  /** Use the channel-style compact mobile composer until tapped. */
  collapsible?: boolean;
};

function AttachImagesAction() {
  const commands = useInputCommands();
  let fileInputRef: HTMLInputElement | undefined;

  const onAttachImages: JSX.EventHandlerUnion<HTMLInputElement, Event> = (
    event
  ) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (files.length === 0) return;
    void commands.attachFiles(files);
  };

  return (
    <>
      <input
        ref={(element) => {
          fileInputRef = element;
        }}
        type="file"
        class="hidden"
        multiple
        accept="image/*"
        onChange={onAttachImages}
      />
      <InputActionButton
        label="Attach images"
        onClick={() => fileInputRef?.click()}
      >
        <PaperclipIcon />
      </InputActionButton>
    </>
  );
}

function DefaultActions(props: { input: InputData; isSending: boolean }) {
  return (
    <Input.Actions>
      <Input.Actions.Left>
        <AttachImagesAction />
        <Input.ToggleFormatAction />
        <Show when={isReplyInput(props.input)}>
          <Input.CloseReplyAction />
        </Show>
      </Input.Actions.Left>
      <Input.Actions.Right>
        <Input.SendAction tooltip="Send comment" disabled={props.isSending} />
      </Input.Actions.Right>
    </Input.Actions>
  );
}

export function DiscussionInput(props: DiscussionInputProps) {
  const [scrollContainer, setScrollContainer] = createSignal<HTMLElement>();
  const [value, setValue] = createSignal(props.input.value ?? '');
  const [mentions, setMentions] = createSignal<ItemMention[]>([]);
  const [showFormatRibbon, setShowFormatRibbon] = createSignal(false);
  const [isSending, setIsSending] = createSignal(false);
  let isInternalRefocus = false;
  let collapsedFilePicker: HTMLInputElement | undefined;

  const inputView = () => ({
    ...props.input,
    value: value(),
    isEmpty: !value().trim(),
    attachments: [],
    showFormatRibbon: showFormatRibbon(),
  });

  const createSnapshot = (): InputSnapshot => ({
    value: value(),
    attachments: [],
    mentions: mentions(),
  });

  const markdownEditor = createConfiguredDiscussionMarkdownEditor({
    type: 'markdown',
    namespace: props.markdownNamespace ?? 'discussion-input-markdown',
    enableMentions: true,
    users: props.participants,
    scrollContainer,
    onMentionCreate: (mention) => {
      setMentions((prev) => [...prev, mention]);
    },
    onMentionRemove: (mention) => {
      setMentions((prev) =>
        prev.filter(
          (m) =>
            !(m.itemId === mention.itemId && m.itemType === mention.itemType)
        )
      );
    },
    onChange: (markdown) => {
      setValue(markdown);
      props.onChange?.(createSnapshot());
    },
    onEnter: () => {
      if (isMobile()) return false;
      void commands.send();
      return true;
    },
  });

  // Build the editor handle immediately to ensure lexical is available for commands
  markdownEditor.buildHandle();

  const commands = {
    send: async () => {
      if (isSending()) return false;
      const snapshot = createSnapshot();
      if (!snapshot.value.trim()) return false;
      setIsSending(true);
      try {
        await props.onSend?.(snapshot);
        return true;
      } finally {
        setIsSending(false);
      }
    },
    close: () => {
      props.onClose?.(createSnapshot());
    },
    toggleFormatRibbon: () => {
      setShowFormatRibbon(!showFormatRibbon());
      props.onToggleFormatRibbon?.(!showFormatRibbon());
    },
    attachFiles: async (files: File[]) => {
      // Insert images into the editor
      for (const file of files) {
        await addMediaFromFile(markdownEditor.lexical, file, 'image');
      }
    },
    removeAttachment: () => {
      // No-op for discussion input - no attachments to remove
    },
  };

  const collapsedInput = createCollapsedInputState({
    inputId: () => props.input.id,
    attachFiles: commands.attachFiles,
  });
  const isCollapsed = () => !!props.collapsible && collapsedInput.isCollapsed();
  const focusEditor = () => {
    collapsedInput.expand();
    markdownEditor.controls.focus();
  };

  props.onReady?.({
    clear: () => {
      // On iOS, blur before clearing so dictation finalizes and discards its buffer
      const root = markdownEditor.lexical.getRootElement();
      if (isIOS && root?.contains(document.activeElement)) {
        isInternalRefocus = true;
        markdownEditor.controls.blur();
        markdownEditor.controls.clear();
        requestAnimationFrame(() => {
          markdownEditor.controls.focus();
          isInternalRefocus = false;
        });
      } else {
        markdownEditor.controls.clear();
      }
      setValue('');
      setMentions([]);
    },
    focus: focusEditor,
    send: () => commands.send(),
    attachFiles: async (files: File[]) => {
      // Insert images into the editor
      for (const file of files) {
        await addMediaFromFile(markdownEditor.lexical, file, 'image');
      }
    },
    restoreSnapshot: (snapshot) => {
      markdownEditor.controls.setMarkdown(snapshot.value);
      setMentions(snapshot.mentions);
      setValue(snapshot.value);
      focusEditor();
    },
  });

  return (
    <Input.Root input={inputView()} commands={commands}>
      <Show when={isCollapsed()}>
        <input
          ref={collapsedFilePicker}
          type="file"
          class="hidden"
          multiple
          accept="image/*"
          onChange={collapsedInput.onFilePickerChange}
        />
        <CollapsedInput
          class="touch:rounded-full touch:island"
          draft={value()}
          renderDraft={(draft) => (
            <StaticMarkdown
              markdown={draft()}
              theme={singleLineMarkdownTheme}
              singleLine
            />
          )}
          placeholder={props.input.placeholder}
          pending={isSending()}
          disabled={!value().trim()}
          getFocusTarget={() => {
            // Expand synchronously so iOS can focus within the tap gesture.
            collapsedInput.expand();
            return markdownEditor.lexical.getRootElement();
          }}
          onAttach={() => collapsedFilePicker?.click()}
          onOpen={collapsedInput.expand}
          onSend={() => void commands.send()}
        />
      </Show>
      <ComposerSurface
        class={isCollapsed() ? 'hidden' : 'h-auto'}
        onFocusOut={(event) => {
          const next = event.relatedTarget as Node | null;
          if (next && event.currentTarget.contains(next)) return;
          if (isInternalRefocus) return;
          collapsedInput.collapse();
        }}
      >
        <Input.Layout>
          <Input.FormatRibbon>
            <FormatButtons
              selectionState={() => markdownEditor.selection}
              onInlineFormat={(format) =>
                applyInlineFormat(markdownEditor.lexical, format)
              }
              onNodeFormat={(format) =>
                applyNodeFormat(markdownEditor.lexical, format)
              }
            />
          </Input.FormatRibbon>
          <Input.EditorShell
            ref={setScrollContainer}
            onClick={(event) => {
              if (!isMobile()) {
                event.stopPropagation();
                markdownEditor.controls.focus();
              }
            }}
          >
            <Input.Editor>
              <MarkdownShell
                config={markdownEditor}
                placeholder={inputView().placeholder}
                initialValue={inputView().value}
                autofocus={!isMobile() && (props.autofocus ?? true)}
                class="text-[15px] leading-5 touch:text-sm"
              />
            </Input.Editor>
          </Input.EditorShell>
          <Input.Footer>
            <Switch>
              <Match when={props.children}>{props.children}</Match>
              <Match when>
                <DefaultActions input={inputView()} isSending={isSending()} />
              </Match>
            </Switch>
          </Input.Footer>
        </Input.Layout>
      </ComposerSurface>
    </Input.Root>
  );
}
