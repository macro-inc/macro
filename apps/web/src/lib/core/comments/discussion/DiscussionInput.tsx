import { InputActionButton } from '@channel/Input/ActionButton';
import { createInputAttachmentTracker } from '@channel/Input/attachment-tracker';
import { useInputCommands } from '@channel/Input/context';
import { createTypingTracker } from '@channel/Input/create-typing-tracker';
import { FormatButtons } from '@channel/Input/FormatButtons';
import { Input } from '@channel/Input/Input';
import type {
  InputCallbacks,
  InputData,
  InputHandle,
  InputSnapshot,
} from '@channel/Input/types';
import { isReplyInput } from '@channel/Input/types';
import { uploadInputAttachments } from '@channel/Input/upload-attachments';
import {
  applyInlineFormat,
  applyNodeFormat,
} from '@channel/Input/utils/formatting';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import type { ItemMention } from '@core/component/LexicalMarkdown/plugins';
import { addMediaFromFile } from '@core/component/LexicalMarkdown/plugins/media';
import { toast } from '@core/component/Toast/Toast';
import { isMobile } from '@core/mobile/isMobile';
import type { IUser } from '@core/user/types';
import { chatRuleset, uploadFile } from '@core/util/upload';
import PaperclipIcon from '@phosphor-icons/core/regular/paperclip.svg?component-solid';
import { isIOS } from '@solid-primitives/platform';
import { Surface } from '@ui';
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
  attachmentMode?: 'files' | 'inline-images';
  markdownNamespace?: string;
  participants?: Accessor<IUser[]>;
  onReady?: (handle: InputHandle) => void;
  children?: JSX.Element;
  /** Whether to auto-focus the input on mount. Defaults to `!isMobile()`. */
  autofocus?: boolean;
};

function AttachFilesAction(props: { inlineImages: boolean }) {
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
        accept={props.inlineImages ? 'image/*' : undefined}
        onChange={onAttachImages}
      />
      <InputActionButton
        label={props.inlineImages ? 'Attach images' : 'Attach files'}
        onClick={() => fileInputRef?.click()}
      >
        <PaperclipIcon class="size-5" />
      </InputActionButton>
    </>
  );
}

function DefaultActions(props: {
  input: InputData;
  isSending: boolean;
  inlineImages: boolean;
}) {
  return (
    <Input.Actions>
      <Input.Actions.Left>
        <AttachFilesAction inlineImages={props.inlineImages} />
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
  const [isFocused, setIsFocused] = createSignal(false);
  const attachments = createInputAttachmentTracker({
    initialAttachments: props.input.attachments,
  });
  const typing = createTypingTracker({
    onStartTyping: () => props.onStartTyping?.(),
    onStopTyping: () => props.onStopTyping?.(),
  });

  const inputView = () => ({
    ...props.input,
    value: value(),
    isEmpty: !value().trim() && !attachments.attachments().length,
    hasPendingAttachments: attachments.hasPending(),
    attachments: attachments.attachments(),
    showFormatRibbon: showFormatRibbon(),
  });

  const createSnapshot = (): InputSnapshot => ({
    value: value(),
    attachments: attachments.attachments(),
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
      typing.keystroke();
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
      if (
        attachments.hasPending() ||
        (!snapshot.value.trim() && !snapshot.attachments.length)
      )
        return false;
      typing.stop();
      setIsSending(true);
      try {
        await props.onSend?.(snapshot);
        return true;
      } catch {
        toast.failure('Could not send comment. Your draft is still here.');
        return false;
      } finally {
        setIsSending(false);
      }
    },
    close: () => {
      props.onClose?.(createSnapshot());
    },
    toggleFormatRibbon: () => {
      const show = !showFormatRibbon();
      setShowFormatRibbon(show);
      props.onToggleFormatRibbon?.(show);
    },
    attachFiles: async (files: File[]) => {
      if (props.attachmentMode === 'inline-images') {
        for (const file of files)
          await addMediaFromFile(markdownEditor.lexical, file, 'image');
        return;
      }
      await uploadInputAttachments({
        files,
        tracker: attachments,
        uploadFile: (file) =>
          uploadFile(file, chatRuleset, { hideProgressIndicator: true }),
      });
    },
    removeAttachment: (attachment: InputSnapshot['attachments'][number]) =>
      attachments.removeAttachment(attachment.id),
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
      attachments.clearAttachments();
    },
    focus: () => markdownEditor.controls.focus(),
    send: () => commands.send(),
    attachFiles: (files: File[]) => commands.attachFiles(files),
    restoreSnapshot: (snapshot) => {
      markdownEditor.controls.setMarkdown(snapshot.value);
      setMentions(snapshot.mentions);
      setValue(snapshot.value);
      attachments.setAttachments(snapshot.attachments);
      markdownEditor.controls.focus();
    },
  });

  return (
    <Input.Root input={inputView()} commands={commands}>
      <Surface
        onFocusOut={(event) => {
          const next = event.relatedTarget as Node | null;
          if (next && event.currentTarget.contains(next)) return;
          setIsFocused(false);
        }}
        onFocusIn={() => setIsFocused(true)}
        active={isFocused()}
        class="rounded-xl bg-surface"
        depth={2}
        solid
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
                class="text-sm"
              />
            </Input.Editor>
          </Input.EditorShell>
          <Input.Attachments />
          <Input.Footer>
            <Switch>
              <Match when={props.children}>{props.children}</Match>
              <Match when>
                <DefaultActions
                  input={inputView()}
                  isSending={isSending()}
                  inlineImages={props.attachmentMode === 'inline-images'}
                />
              </Match>
            </Switch>
          </Input.Footer>
        </Input.Layout>
      </Surface>
    </Input.Root>
  );
}
