import { Surface } from '@ui';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { isMobile } from '@core/mobile/isMobile';
import { isIOS } from '@solid-primitives/platform';
import { Input } from './Input';
import { FormatButtons } from './FormatButtons';
import { createConfiguredChannelMarkdownEditor } from './configured-markdown-editor';
import { createInputAttachmentTracker } from './attachment-tracker';
import { createInputState } from './create-input-state';
import { createMentionsTracker } from './mentions-tracker';
import { createTypingTracker } from './create-typing-tracker';
import {
  chatRuleset,
  handleFileFolderDrop,
  uploadFile,
} from '@core/util/upload';
import { uploadInputAttachments } from './upload-attachments';
import type {
  InputAttachmentTracker,
  InputCallbacks,
  InputData,
  InputHandle,
  InputPersistenceKey,
} from './types';
import { applyInlineFormat, applyNodeFormat } from './utils/formatting';
import {
  Match,
  Show,
  Switch,
  createSignal,
  type Accessor,
  type JSX,
} from 'solid-js';
import { isReplyInput } from './types';
import type { IUser } from '@core/user/types';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';

export type ChannelInputProps = InputCallbacks & {
  input: InputData;
  markdownNamespace?: string;
  persistenceKey?: InputPersistenceKey;
  attachmentTracker?: InputAttachmentTracker;
  participants?: Accessor<IUser[]>;
  onReady?: (handle: InputHandle) => void;
  children?: JSX.Element;
  /** Whether to auto-focus the input on mount. Defaults to `!isMobile()`. */
  autofocus?: boolean;
};

function DefaultActions(props: { input: InputData }) {
  return (
    <Input.Actions>
      <Input.Actions.Left>
        <Input.AttachFilesAction />
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

export function ChannelInput(props: ChannelInputProps) {
  const [scrollContainer, setScrollContainer] = createSignal<HTMLElement>();
  const mentionsTracker = createMentionsTracker();
  const attachmentTracker =
    props.attachmentTracker ??
    createInputAttachmentTracker({
      initialAttachments: props.input.attachments,
    });
  let clearComposer = () => {};

  const typingTracker = createTypingTracker({
    onStartTyping: () => props.onStartTyping?.(),
    onStopTyping: () => props.onStopTyping?.(),
  });

  const inputState = createInputState({
    initialInput: props.input,
    mentions: mentionsTracker.mentions,
    attachmentTracker,
    clearComposer: () => clearComposer(),
    attachFiles: async (files) => {
      await uploadInputAttachments({
        files,
        tracker: attachmentTracker,
        uploadFile: async (file) => {
          return uploadFile(file, chatRuleset, {
            hideProgressIndicator: true,
          });
        },
      });
    },
    clearInput: () => markdownEditor.controls.clear(),
    callbacks: {
      onChange: props.onChange,
      onSend: (snapshot) => {
        typingTracker.stop();
        return props.onSend?.(snapshot);
      },
      onToggleFormatRibbon: props.onToggleFormatRibbon,
      onClose: (snapshot) => {
        typingTracker.stop();
        return props.onClose?.(snapshot);
      },
      onRemoveAttachment: props.onRemoveAttachment,
    },
    persistenceKey: props.persistenceKey,
  });

  const markdownEditor = createConfiguredChannelMarkdownEditor({
    namespace: props.markdownNamespace ?? 'channel-input-markdown',
    enableMentions: true,
    users: props.participants,
    scrollContainer,
    onMentionCreate: (mention) => {
      mentionsTracker.onMentionCreate(mention);
    },
    onMentionRemove: (mention) => {
      mentionsTracker.onMentionRemove(mention);
    },
    onChange: (markdown) => {
      inputState.setValue(markdown);
      typingTracker.keystroke();
    },
    onEnter: () => {
      if (isMobile()) return false;
      typingTracker.stop();
      inputState.commands.send();
      return true;
    },
    onPasteFilesAndDirs: (files, directories) => {
      void handleFileFolderDrop(files, directories, (entries) =>
        inputState.commands.attachFiles(entries.map((entry) => entry.file))
      );
    },
    onAttachFromDisk: (files) => inputState.commands.attachFiles(files),
  });
  // On iOS, blur before clearing so dictation finalizes and discards its buffer
  // (otherwise it re-injects the sent text into the cleared editor). Re-focus
  // via rAF so the keyboard stays up: rAF fires after Lexical's update commits,
  // avoiding a conflict where clear()'s $setSelection(null) undoes the focus.
  clearComposer = () => {
    if (isIOS) {
      markdownEditor.controls.blur();
      markdownEditor.controls.clear();
      requestAnimationFrame(() => markdownEditor.controls.focus());
    } else {
      markdownEditor.controls.clear();
    }
  };

  props.onReady?.({
    clear: () => markdownEditor.controls.clear(),
    focus: () => markdownEditor.controls.focus(),
    attachFiles: (files) => inputState.commands.attachFiles(files),
    restoreSnapshot: (snapshot) => {
      markdownEditor.controls.setMarkdown(snapshot.value);
      attachmentTracker.setAttachments(snapshot.attachments);
      mentionsTracker.setMentions(snapshot.mentions);
      markdownEditor.controls.focus();
    },
  });

  const [attach, scopeId] = useHotkeyDOMScope('channel-input-intercept');
  registerHotkey({
    scopeId,
    description: 'block escape from moving up scope',
    hotkey: ['escape'],
    runWithInputFocused: true,
    hide: true,
    keyDownHandler: () => {
      // Block upstream escape handlers when ESC should close inline menus.
      return markdownEditor.controls.isInlineMenuOpen();
    },
  });

  return (
    <Input.Root input={inputState.view()} commands={inputState.commands}>
      <Surface depth={2}>
        <Input.DropZone
          onDragStart={(valid) => inputState.setIsDraggedOver(valid)}
          onDragEnd={() => inputState.setIsDraggedOver(false)}
        >
          <Input.Layout>
            <Input.DropOverlay />
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
                  placeholder={inputState.view().placeholder}
                  initialValue={inputState.view().value}
                  autofocus={!isMobile() && (props.autofocus ?? true)}
                  class="text-sm"
                  refFn={attach}
                />
              </Input.Editor>
            </Input.EditorShell>
            <Input.Attachments kind="media" />
            <Input.Attachments kind="document" />
            <Input.Footer>
              <Switch>
                <Match when={props.children}>{props.children}</Match>
                <Match when>
                  <DefaultActions input={inputState.view()} />
                </Match>
              </Switch>
            </Input.Footer>
          </Input.Layout>
        </Input.DropZone>
      </Surface>
    </Input.Root>
  );
}
