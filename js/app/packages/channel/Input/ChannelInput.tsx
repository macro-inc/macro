import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { isMobile } from '@core/mobile/isMobile';
import type { IUser } from '@core/user/types';
import { isPlatform } from '@core/util/platform';
import {
  chatRuleset,
  handleFileFolderDrop,
  uploadFile,
} from '@core/util/upload';
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
import { createInputAttachmentTracker } from './attachment-tracker';
import { createConfiguredChannelMarkdownEditor } from './configured-markdown-editor';
import { createInputState } from './create-input-state';
import { createTypingTracker } from './create-typing-tracker';
import { FormatButtons } from './FormatButtons';
import { Input } from './Input';
import { createMentionsTracker } from './mentions-tracker';
import type {
  InputAttachmentTracker,
  InputCallbacks,
  InputData,
  InputHandle,
  InputPersistenceKey,
} from './types';
import { isReplyInput } from './types';
import { uploadInputAttachments } from './upload-attachments';
import { applyInlineFormat, applyNodeFormat } from './utils/formatting';

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

function WebDefaultActions(props: { input: InputData }) {
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

function IosDefaultActions(props: { input: InputData }) {
  return (
    <Input.Actions>
      <Input.Actions.Left>
        <Input.AttachNativeMediaAction />
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

function DefaultActions(props: { input: InputData }) {
  return (
    <Show
      when={isPlatform('ios')}
      fallback={<WebDefaultActions input={props.input} />}
    >
      <IosDefaultActions input={props.input} />
    </Show>
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

  const [isFocused, setIsFocused] = createSignal(false);

  return (
    <Input.Root input={inputState.view()} commands={inputState.commands}>
      <Surface
        onFocusOut={(e) => {
          const next = e.relatedTarget as Node | null;
          if (next && e.currentTarget.contains(next)) return;
          setIsFocused(false);
        }}
        onFocusIn={() => setIsFocused(true)}
        active={isFocused()}
        class="rounded-xl"
        depth={2}
        solid
      >
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
