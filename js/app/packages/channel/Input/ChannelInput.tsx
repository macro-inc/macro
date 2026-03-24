import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { isMobile } from '@core/mobile/isMobile';
import { Input } from './Input';
import { FormatButtons } from './FormatButtons';
import { createConfiguredChannelMarkdownEditor } from './configured-markdown-editor';
import { createInputAttachmentTracker } from './attachment-tracker';
import { createInputState } from './create-input-state';
import { createMentionsTracker } from './mentions-tracker';
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
import { Match, Show, Switch, type Accessor, type JSX } from 'solid-js';
import { isReplyInput } from './types';
import type { IUser } from '@core/user/types';

export type ChannelInputProps = InputCallbacks & {
  input: InputData;
  markdownNamespace?: string;
  persistenceKey?: InputPersistenceKey;
  attachmentTracker?: InputAttachmentTracker;
  participants?: Accessor<IUser[]>;
  onReady?: (handle: InputHandle) => void;
  children?: JSX.Element;
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
  const mentionsTracker = createMentionsTracker();
  const attachmentTracker =
    props.attachmentTracker ??
    createInputAttachmentTracker({
      initialAttachments: props.input.attachments,
    });
  let clearComposer = () => {};

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
      onSend: props.onSend,
      onToggleFormatRibbon: props.onToggleFormatRibbon,
      onClose: props.onClose,
      onRemoveAttachment: props.onRemoveAttachment,
    },
    persistenceKey: props.persistenceKey,
  });

  const markdownEditor = createConfiguredChannelMarkdownEditor({
    namespace: props.markdownNamespace ?? 'channel-input-markdown',
    enableMentions: true,
    users: props.participants,
    onMentionCreate: (mention) => {
      mentionsTracker.onMentionCreate(mention);
    },
    onMentionRemove: (mention) => {
      mentionsTracker.onMentionRemove(mention);
    },
    onChange: (markdown) => {
      inputState.setValue(markdown);
    },
    onEnter: () => {
      if (isMobile()) return false;
      inputState.commands.send();
      return true;
    },
    onPasteFilesAndDirs: (files, directories) => {
      void handleFileFolderDrop(files, directories, (entries) =>
        inputState.commands.attachFiles(entries.map((entry) => entry.file))
      );
    },
  });
  clearComposer = () => markdownEditor.controls.clear();

  props.onReady?.({
    clear: () => markdownEditor.controls.clear(),
    focus: () => markdownEditor.controls.focus(),
    attachFiles: (files) => inputState.commands.attachFiles(files),
  });

  return (
    <Input.Root input={inputState.view()} commands={inputState.commands}>
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
            onClick={(event) => {
              event.stopPropagation();
              markdownEditor.controls.focus();
            }}
          >
            <Input.Editor>
              <MarkdownShell
                config={markdownEditor}
                placeholder={inputState.view().placeholder}
                initialValue={inputState.view().value}
                autofocus={!isMobile()}
                class="text-sm mobile:text-base"
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
    </Input.Root>
  );
}
