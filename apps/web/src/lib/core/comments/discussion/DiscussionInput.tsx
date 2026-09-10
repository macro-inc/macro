import { InputActionButton } from '@channel/Input/ActionButton';
import { useInputCommands } from '@channel/Input/context';
import { FormatButtons } from '@channel/Input/FormatButtons';
import { Input } from '@channel/Input/Input';
import type {
  InputCallbacks,
  InputData,
  InputHandle,
} from '@channel/Input/types';
import { isReplyInput } from '@channel/Input/types';
import {
  applyInlineFormat,
  applyNodeFormat,
} from '@channel/Input/utils/formatting';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { addMediaFromFile } from '@core/component/LexicalMarkdown/plugins/media';
import { toast } from '@core/component/Toast/Toast';
import { createConfiguredMessageEditor } from '@core/messages/configured-message-editor';
import { createMessageComposer } from '@core/messages/create-message-composer';
import { isMobile } from '@core/mobile/isMobile';
import type { IUser } from '@core/user/types';
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
  const [isFocused, setIsFocused] = createSignal(false);
  const { inputState, mentionsTracker, onChange } = createMessageComposer({
    input: props.input,
    callbacks: props,
    clearEditor: () => clearEditor(),
    onSendError: () =>
      toast.failure('Could not send comment. Your draft is still here.'),
    attachFiles: async (files) => {
      for (const file of files)
        await addMediaFromFile(markdownEditor.lexical, file, 'image');
    },
  });
  const inputView = inputState.view;
  const commands = inputState.commands;

  const markdownEditor = createConfiguredMessageEditor({
    inlineMedia: true,
    disableMentionTracking: true,
    type: 'markdown',
    namespace: props.markdownNamespace ?? 'discussion-input-markdown',
    enableMentions: true,
    users: props.participants,
    scrollContainer,
    onMentionCreate: mentionsTracker.onMentionCreate,
    onMentionRemove: mentionsTracker.onMentionRemove,
    onChange,
    onEnter: () => {
      if (isMobile()) return false;
      void commands.send();
      return true;
    },
  });

  // Build the editor handle immediately to ensure lexical is available for commands
  markdownEditor.buildHandle();

  const clearEditor = () => {
    // Blur before clearing on iOS so dictation finalizes its buffer.
    if (isIOS) {
      markdownEditor.controls.blur();
      markdownEditor.controls.clear();
      requestAnimationFrame(() => markdownEditor.controls.focus());
    } else {
      markdownEditor.controls.clear();
    }
  };

  props.onReady?.({
    clear: () => {
      clearEditor();
      inputState.reset();
      mentionsTracker.setMentions([]);
    },
    focus: () => markdownEditor.controls.focus(),
    send: () => commands.send(),
    attachFiles: (files: File[]) => commands.attachFiles(files),
    restoreSnapshot: (snapshot) => {
      markdownEditor.controls.setMarkdown(snapshot.value);
      mentionsTracker.setMentions(snapshot.mentions);
      inputState.setValue(snapshot.value);
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
          <Input.Footer>
            <Switch>
              <Match when={props.children}>{props.children}</Match>
              <Match when>
                <DefaultActions
                  input={inputView()}
                  isSending={!!inputView().hasPendingAttachments}
                />
              </Match>
            </Switch>
          </Input.Footer>
        </Input.Layout>
      </Surface>
    </Input.Root>
  );
}
