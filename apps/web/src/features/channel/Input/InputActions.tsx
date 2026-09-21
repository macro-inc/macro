import { pickNativePhotoLibraryMedia } from '@core/mobile/nativePhotoLibrary';
import PaperclipIcon from '@phosphor/paperclip.svg';
import FormatIcon from '@phosphor/text-aa.svg';
import TrashIcon from '@phosphor/trash.svg';
import type { JSX } from 'solid-js';
import { InputActionButton } from './ActionButton';
import { CHANNEL_FILE_PICKER_ACCEPT } from './accepted-file-types';
import { useInput, useInputCommands } from './context';

/**
 * The paperclip.
 *
 * `accept` narrows the picker, defaulting to the channel's own media and
 * document types. A surface whose upload path takes more than that — the
 * agent composer, where a source file is usually the point — passes `null`
 * to accept whatever it would accept on a drop.
 */
export function AttachFilesAction(
  props: { accept?: string | null; disabled?: boolean } = {}
) {
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
        accept={
          props.accept === null
            ? undefined
            : (props.accept ?? CHANNEL_FILE_PICKER_ACCEPT)
        }
        onChange={onAttachFiles}
        disabled={props.disabled}
        data-input-attach-file-picker
      />
      <InputActionButton
        label="Attach files"
        disabled={props.disabled}
        onClick={() => fileInputRef?.click()}
      >
        <PaperclipIcon />
      </InputActionButton>
    </>
  );
}

export function AttachNativeMediaAction() {
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

  const onAttachMedia = async () => {
    const files = await pickNativePhotoLibraryMedia();
    if (files === null) {
      fileInputRef?.click();
      return;
    }
    if (files.length > 0) {
      await commands.attachFiles(files);
    }
  };

  return (
    <>
      {/* File Input backup in case native photo picker fails */}
      <input
        ref={(element) => {
          fileInputRef = element;
        }}
        type="file"
        class="hidden"
        multiple
        accept={CHANNEL_FILE_PICKER_ACCEPT}
        onChange={onAttachFiles}
        data-input-attach-media-picker
      />
      <InputActionButton
        label="Attach photos or videos"
        onClick={() => void onAttachMedia()}
      >
        <PaperclipIcon />
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
      <FormatIcon />
    </InputActionButton>
  );
}

export function CloseReplyAction() {
  const commands = useInputCommands();

  return (
    <InputActionButton label="Delete reply" onClick={() => commands.close()}>
      <TrashIcon />
    </InputActionButton>
  );
}

export function DiscardDraftAction() {
  const commands = useInputCommands();

  return (
    <InputActionButton label="Discard Edit" onClick={() => commands.close()}>
      <TrashIcon />
    </InputActionButton>
  );
}
