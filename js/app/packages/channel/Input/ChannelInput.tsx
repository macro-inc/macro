import type { JSX } from 'solid-js';
import { MarkdownShell } from '@core/component/LexicalMarkdown/builder/MarkdownShell';
import {
  NODE_TRANSFORM,
  type NodeTransformType,
} from '@core/component/LexicalMarkdown/plugins';
import { FORMAT_TEXT_COMMAND, type TextFormatType } from 'lexical';
import { isMobile } from '@core/mobile/isMobile';
import { Input } from './Input';
import { FormattingRibbon } from './FormattingRibbon';
import { createConfiguredChannelMarkdownEditor } from './createConfiguredChannelMarkdownEditor';
import type {
  InputActions,
  InputAttachmentKind,
  InputAttachmentTracker,
  InputData,
} from './types';

type ChannelInputProps = {
  input: InputData;
  actions: InputActions;
  attachmentTracker: InputAttachmentTracker;
};

export function ChannelInput(props: ChannelInputProps) {
  const markdownEditor = createConfiguredChannelMarkdownEditor({
    namespace: 'channel-input-markdown',
    enableMentions: true,
    onChange: (markdown) => {
      props.actions.onChange?.({
        input: props.input,
        value: markdown,
      });
    },
    onEnter: (event, markdown) => {
      if (isMobile()) return false;
      props.actions.onSend?.({
        input: props.input,
        event,
        value: markdown,
      });
      return true;
    },
  });

  const selection = () => markdownEditor.selection;
  const selectionState = () => selection();

  const applyInlineFormat = (format: TextFormatType) => {
    try {
      const editor = markdownEditor.lexical;
      editor.focus();
      editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
    } catch { }
  };

  const applyNodeFormat = (format: NodeTransformType) => {
    try {
      const editor = markdownEditor.lexical;
      editor.focus();
      editor.dispatchCommand(NODE_TRANSFORM, format);
    } catch { }
  };

  return (
    <Input.Root
      input={props.input}
      actions={props.actions}
      attachmentTracker={props.attachmentTracker}
    >
      <Input.Layout>
        <Input.DropOverlay />
        <Input.FormatRibbon>
          <FormattingRibbon
            selectionState={selectionState}
            onInlineFormat={applyInlineFormat}
            onNodeFormat={applyNodeFormat}
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
              placeholder={props.input.placeholder}
              initialValue={props.input.value}
              autofocus={!isMobile()}
              class="text-sm mobile:text-base"
            />
          </Input.Editor>
        </Input.EditorShell>
        <Input.Attachments kind="video" />
        <Input.Attachments kind="image" />
        <Input.Attachments kind="document" />
        <Input.TaskPreview>{/** ADD task preview component **/}</Input.TaskPreview>
        <Input.Footer>
          <Input.AttachMenu>
            {/** ADD Attach menu **/}
          </Input.AttachMenu>
          <Input.PrimaryActions />
          <Input.SendAction />
        </Input.Footer>
      </Input.Layout>
    </Input.Root>
  );
}
