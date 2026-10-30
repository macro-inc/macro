import { pickNativePhotoLibraryMedia } from '@core/mobile/nativePhotoLibrary';
import { fireAndForget } from '@core/util/fireAndForget';
import { isPlatform } from '@core/util/platform';
import PaperclipIcon from '@icon/system/regular/paperclip.svg';
import FormatIcon from '@icon/system/regular/text-aa.svg';
import TrashIcon from '@icon/system/regular/trash.svg';
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
  props: {
    accept?: string | null;
    disabled?: boolean;
    children?: JSX.Element;
    /** Custom actions share the file input; Photos narrows it to images. */
    trigger?: (openPicker: () => void, openImages: () => void) => JSX.Element;
  } = {}
) {
  const commands = useInputCommands();
  let fileInputRef: HTMLInputElement | undefined;

  const onAttachFiles: JSX.EventHandlerUnion<HTMLInputElement, Event> = (
    event
  ) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (files.length === 0) return;
    fireAndForget(commands.attachFiles(files), 'channel-input');
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
      {props.trigger ? (
        props.trigger(
          () => {
            if (!fileInputRef) return;
            if (props.accept === null) fileInputRef.removeAttribute('accept');
            else
              fileInputRef.accept = props.accept ?? CHANNEL_FILE_PICKER_ACCEPT;
            fileInputRef.click();
          },
          () => {
            if (!fileInputRef) return;
            fileInputRef.accept = 'image/*';
            fileInputRef.click();
          }
        )
      ) : (
        <InputActionButton
          label="Attach files"
          disabled={props.disabled}
          onClick={() => fileInputRef?.click()}
        >
          {props.children ?? (
            <PaperclipIcon class="size-5 touch:size-6 shrink-0 pointer-events-none" />
          )}
        </InputActionButton>
      )}
    </>
  );
}

export function AttachNativeMediaAction() {
  // Android's WebView picker supports documents and media. Open it directly
  // inside the click gesture instead of awaiting an unavailable iOS plugin.
  if (isPlatform('android')) return <AttachFilesAction />;
  const commands = useInputCommands();
  let fileInputRef: HTMLInputElement | undefined;

  const onAttachFiles: JSX.EventHandlerUnion<HTMLInputElement, Event> = (
    event
  ) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (files.length === 0) return;
    fireAndForget(commands.attachFiles(files), 'channel-input');
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
        onClick={() => fireAndForget(onAttachMedia(), 'channel-input')}
      >
        <PaperclipIcon class="size-5 touch:size-6 shrink-0 pointer-events-none" />
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
      <FormatIcon class="size-5 touch:size-6 shrink-0 pointer-events-none" />
    </InputActionButton>
  );
}

export function CloseReplyAction() {
  const commands = useInputCommands();

  return (
    <InputActionButton label="Delete reply" onClick={() => commands.close()}>
      <TrashIcon class="size-5 touch:size-6 shrink-0 pointer-events-none" />
    </InputActionButton>
  );
}

export function DiscardDraftAction() {
  const commands = useInputCommands();

  return (
    <InputActionButton label="Discard Edit" onClick={() => commands.close()}>
      <TrashIcon class="size-5 touch:size-6 shrink-0 pointer-events-none" />
    </InputActionButton>
  );
}
