import FormatIcon from '@icon/regular/text-aa.svg';
import TrashIcon from '@icon/regular/trash.svg';
import PaperclipIcon from '@phosphor-icons/core/regular/paperclip.svg?component-solid';
import type { JSX } from 'solid-js';
import { InputActionButton } from './ActionButton';
import { CHANNEL_FILE_PICKER_ACCEPT } from './accepted-file-types';
import { useInput, useInputCommands } from './context';

export function AttachFilesAction() {
  const commands = useInputCommands();
  let fileInputRef: HTMLInputElement | undefined;

  const onAttachFiles: JSX.EventHandlerUnion<HTMLInputElement, Event> = (
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
        accept={CHANNEL_FILE_PICKER_ACCEPT}
        onChange={onAttachFiles}
        data-input-attach-file-picker
      />
      <InputActionButton
        label="Attach files"
        onClick={() => fileInputRef?.click()}
      >
        <PaperclipIcon class="size-5" />
      </InputActionButton>
    </>
  );
}

export function ToggleFormatAction() {
  const input = useInput();
  const commands = useInputCommands();

  return (
    <InputActionButton
      label="Format"
      active={input().showFormatRibbon}
      onClick={() => commands.toggleFormatRibbon()}
    >
      <FormatIcon class="size-5" />
    </InputActionButton>
  );
}

export function CloseReplyAction() {
  const commands = useInputCommands();

  return (
    <InputActionButton label="Delete reply" onClick={() => commands.close()}>
      <TrashIcon class="size-5" />
    </InputActionButton>
  );
}

export function DiscardDraftAction() {
  const commands = useInputCommands();

  return (
    <InputActionButton label="Discard Edit" onClick={() => commands.close()}>
      <TrashIcon class="size-5" />
    </InputActionButton>
  );
}
