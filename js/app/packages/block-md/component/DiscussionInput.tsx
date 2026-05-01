import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { isMobile } from '@core/mobile/isMobile';
import { isIOS } from '@solid-primitives/platform';
import { createConfiguredDiscussionMarkdownEditor } from './configured-discussion-markdown-editor';
import { addMediaFromFile } from '@core/component/LexicalMarkdown/plugins/media';
import type {
  InputCallbacks,
  InputData,
  InputHandle,
  InputSnapshot,
} from '@channel/Input/types';
import {
  createSignal,
  type Accessor,
  type JSX,
  Show,
  Match,
  Switch,
} from 'solid-js';
import { Input } from '@channel/Input/Input';
import { FormatButtons } from '@channel/Input/FormatButtons';
import {
  applyInlineFormat,
  applyNodeFormat,
} from '@channel/Input/utils/formatting';
import { isReplyInput } from '@channel/Input/types';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import type { IUser } from '@core/user/types';
import { InputActionButton } from '@channel/Input/ActionButton';
import { useInputCommands } from '@channel/Input/context';
import PaperclipIcon from '@phosphor-icons/core/regular/paperclip.svg?component-solid';
import { Panel } from '@ui';

export type DiscussionInputProps = InputCallbacks & {
  input: InputData;
  markdownNamespace?: string;
  participants?: Accessor<IUser[]>;
  onReady?: (handle: InputHandle) => void;
  children?: JSX.Element;
  /** Whether to auto-focus the input on mount. Defaults to `!isMobile()`. */
  autofocus?: boolean;
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
        <PaperclipIcon class="size-5" />
      </InputActionButton>
    </>
  );
}

function DefaultActions(props: { input: InputData }) {
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
        <Input.SendAction />
      </Input.Actions.Right>
    </Input.Actions>
  );
}

export function DiscussionInput(props: DiscussionInputProps) {
  const [scrollContainer, setScrollContainer] = createSignal<HTMLElement>();
  const [value, setValue] = createSignal(props.input.value ?? '');
  const [mentions, setMentions] = createSignal<ItemMention[]>([]);
  const [showFormatRibbon, setShowFormatRibbon] = createSignal(false);

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
      const snapshot = createSnapshot();
      if (!snapshot.value.trim()) return false;
      await props.onSend?.(snapshot);
      return true;
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

  props.onReady?.({
    clear: () => {
      // On iOS, blur before clearing so dictation finalizes and discards its buffer
      if (isIOS) {
        markdownEditor.controls.blur();
        markdownEditor.controls.clear();
        requestAnimationFrame(() => markdownEditor.controls.focus());
      } else {
        markdownEditor.controls.clear();
      }
      setValue('');
      setMentions([]);
    },
    focus: () => markdownEditor.controls.focus(),
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
      markdownEditor.controls.focus();
    },
  });

  return (
    <Input.Root input={inputView()} commands={commands}>
      <Panel depth={2}>
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
                class="text-sm"
              />
            </Input.Editor>
          </Input.EditorShell>
          <Input.Footer>
            <Switch>
              <Match when={props.children}>{props.children}</Match>
              <Match when>
                <DefaultActions input={inputView()} />
              </Match>
            </Switch>
          </Input.Footer>
        </Input.Layout>
      </Panel>
    </Input.Root>
  );
}
