import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { isMobile } from '@core/mobile/isMobile';
import { Input } from './Input';
import { FormatButtons } from './FormatButtons';
import { createConfiguredChannelMarkdownEditor } from './configured-markdown-editor';
import { createInputAttachmentTracker } from './attachment-tracker';
import { createInputState } from './create-input-state';
import { createMentionsTracker } from './mentions-tracker';
import { chatRuleset, uploadFile } from '@core/util/upload';
import { uploadInputAttachments } from './upload-attachments';
import type {
  InputAttachmentTracker,
  InputCallbacks,
  InputData,
  InputHandle,
  InputPersistenceKey,
} from './types';
import { applyInlineFormat, applyNodeFormat } from './utils/formatting';

type ChannelInputProps = InputCallbacks & {
  input: InputData;
  markdownNamespace?: string;
  persistenceKey?: InputPersistenceKey;
  attachmentTracker?: InputAttachmentTracker;
  onReady?: (handle: InputHandle) => void;
};

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
            <Input.PrimaryActions />
            <Input.SendAction />
          </Input.Footer>
        </Input.Layout>
      </Input.DropZone>
    </Input.Root>
  );
}
