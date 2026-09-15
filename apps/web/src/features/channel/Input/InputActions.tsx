import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { pickNativePhotoLibraryMedia } from '@core/mobile/nativePhotoLibrary';
import TaskIcon from '@phosphor/list-checks.svg';
import PaperclipIcon from '@phosphor/paperclip.svg';
import PlusIcon from '@phosphor/plus.svg';
import FormatIcon from '@phosphor/text-aa.svg';
import TrashIcon from '@phosphor/trash.svg';
import { Dropdown } from '@ui';
import { type JSX, Show } from 'solid-js';
import { InputActionButton } from './ActionButton';
import { CHANNEL_FILE_PICKER_ACCEPT } from './accepted-file-types';
import { useInput, useInputCommands } from './context';

export function AttachFilesAction(props: { onCreateTask?: () => void } = {}) {
  const input = useInput();
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
      <Show
        when={!isTouchDevice()}
        fallback={
          <InputActionButton
            label="Attach files"
            onClick={() => fileInputRef?.click()}
          >
            <PlusIcon />
          </InputActionButton>
        }
      >
        <Dropdown placement="top-start" modal={false}>
          <Dropdown.Trigger
            aria-label="Add to message"
            variant="ghost"
            size="icon-sm"
            class="rounded-full"
          >
            <PlusIcon />
          </Dropdown.Trigger>
          <Dropdown.Content>
            <Dropdown.Group>
              <Dropdown.Item onSelect={() => fileInputRef?.click()}>
                <PaperclipIcon class="size-4" /> Attach files
              </Dropdown.Item>
              <Dropdown.CheckboxItem
                closeOnSelect
                checked={!!input().showFormatRibbon}
                onChange={() => commands.toggleFormatRibbon()}
              >
                <FormatIcon class="size-4" /> Formatting
              </Dropdown.CheckboxItem>
              <Show when={props.onCreateTask}>
                <Dropdown.Item onSelect={() => props.onCreateTask?.()}>
                  <TaskIcon class="size-4" /> Create task
                </Dropdown.Item>
              </Show>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
      </Show>
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
        <PlusIcon />
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
