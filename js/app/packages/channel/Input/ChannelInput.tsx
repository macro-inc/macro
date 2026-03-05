import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { isMobile } from '@core/mobile/isMobile';
import { Input } from './Input';
import { FormattingRibbon } from './FormattingRibbon';
import { createConfiguredChannelMarkdownEditor } from './configured-markdown-editor';
import { createInputAttachmentTracker } from './attachment-tracker';
import { createInputState } from './create-input-state';
import { createMentionsTracker } from './mentions-tracker';
import { chatRuleset, uploadFile } from '@core/util/upload';
import { uploadInputAttachments } from './upload-attachments';
import type {
  InputCallbacks,
  InputData,
  InputDraftAdapter,
  InputHandle,
} from './types';
import { applyInlineFormat, applyNodeFormat } from './formatting';

type ChannelInputProps = InputCallbacks & {
  input: InputData;
  markdownNamespace?: string;
  draft?: InputDraftAdapter;
  onReady?: (handle: InputHandle) => void;
};

export function ChannelInput(props: ChannelInputProps) {
  const mentionsTracker = createMentionsTracker();
  const attachmentTracker = createInputAttachmentTracker({
    initialAttachments: props.input.attachments,
  });
  let notifyInputChange = () => {};

  const inputState = createInputState({
    initialInput: props.input,
    mentions: mentionsTracker.mentions,
    attachmentTracker,
    attachFiles: async (files) => {
      await uploadInputAttachments({
        files,
        tracker: attachmentTracker,
        uploadFile: async (file) => {
          return uploadFile(file, chatRuleset, {
            hideProgressIndicator: true,
          });
        },
        onUpdated: notifyInputChange,
      });
    },
    callbacks: {
      onChange: props.onChange,
      onSend: props.onSend,
      onToggleFormatRibbon: props.onToggleFormatRibbon,
      onCloseDraft: props.onCloseDraft,
      onRemoveAttachment: props.onRemoveAttachment,
    },
    draft: props.draft,
  });

  notifyInputChange = inputState.notifyChange;

  const markdownEditor = createConfiguredChannelMarkdownEditor({
    namespace: props.markdownNamespace ?? 'channel-input-markdown',
    enableMentions: true,
    onMentionCreate: (mention) => {
      mentionsTracker.onMentionCreate(mention);
      inputState.notifyChange();
    },
    onMentionRemove: (mention) => {
      mentionsTracker.onMentionRemove(mention);
      inputState.notifyChange();
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

  props.onReady?.({
    clear: () => markdownEditor.controls.clear(),
    focus: () => markdownEditor.controls.focus(),
  });

  return (
    <Input.Root input={inputState.view()} commands={inputState.commands}>
      <Input.Layout>
        <Input.DropOverlay />
        <Input.FormatRibbon>
          <FormattingRibbon
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
              initialValue={props.input.value}
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
    </Input.Root>
  );
}
