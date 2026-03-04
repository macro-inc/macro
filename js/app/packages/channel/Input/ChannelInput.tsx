import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import { isMobile } from '@core/mobile/isMobile';
import { Input } from './Input';
import { FormattingRibbon } from './FormattingRibbon';
import { createConfiguredChannelMarkdownEditor } from './configured-markdown-editor';
import { createInputAttachmentTracker } from './attachment-tracker';
import { createInputState } from './create-input-state';
import { createTaskMode } from './create-task-mode';
import { createMentionsTracker } from './mentions-tracker';
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

  const inputState = createInputState({
    initialInput: props.input,
    mentions: mentionsTracker.mentions,
    attachmentTracker,
    callbacks: {
      onChange: props.onChange,
      onSend: props.onSend,
      onToggleAttachMenu: props.onToggleAttachMenu,
      onToggleFormatRibbon: props.onToggleFormatRibbon,
      onToggleTaskMode: props.onToggleTaskMode,
      onCloseDraft: props.onCloseDraft,
      onRemoveAttachment: props.onRemoveAttachment,
    },
    draft: props.draft,
  });

  const taskMode = createTaskMode(() => inputState.view().value ?? '');

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
    <Input.Root
      input={{
        ...inputState.view(),
        taskModeEnabled: taskMode.enabled(),
        tasks: taskMode.tasks(),
      }}
      commands={{ ...inputState.commands, toggleTaskMode: taskMode.toggle }}
    >
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
        <Input.Attachments kind="video" />
        <Input.Attachments kind="image" />
        <Input.Attachments kind="document" />
        <Input.TaskPreview>
          {/** ADD task preview component **/}
        </Input.TaskPreview>
        <Input.Footer>
          <Input.AttachMenu>{/** ADD Attach menu **/}</Input.AttachMenu>
          <Input.PrimaryActions />
          <Input.SendAction />
        </Input.Footer>
      </Input.Layout>
    </Input.Root>
  );
}
