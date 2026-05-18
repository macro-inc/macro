import FormatIcon from '@icon/text-aa.svg';
import TrashIcon from '@icon/trash.svg';
import PaperclipIcon from '@phosphor-icons/core/regular/paperclip.svg?component-solid';
import { Button, cn } from '@ui';
import { children, type JSX, Show, splitProps } from 'solid-js';
import { CHANNEL_FILE_PICKER_ACCEPT } from './accepted-file-types';
import { useInput, useInputCommands } from './context';
import { isReplyInput } from './types';

export function InputActionButton(props: {
  label: string;
  onClick?: (event: MouseEvent) => void;
  active?: boolean;
  children: JSX.Element;
}) {
  return (
    <Button
      title={props.label}
      aria-label={props.label}
      label={props.label}
      onClick={(event) => props.onClick?.(event)}
      classList={{ 'bg-active': props.active }}
    >
      {props.children}
    </Button>
  );
}

export function PrimaryActions(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const input = useInput();
  const commands = useInputCommands();
  const [local, rest] = splitProps(props, ['class', 'children']);
  const resolved = children(() => local.children);
  let fileInputRef: HTMLInputElement | undefined;

  const openAttachPicker = () => {
    fileInputRef?.click();
  };

  const onAttachFiles: JSX.EventHandlerUnion<HTMLInputElement, Event> = (
    event
  ) => {
    const files = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = '';
    if (files.length === 0) return;
    void commands.attachFiles(files);
  };

  return (
    <div
      class={cn('flex flex-row items-center gap-2', local.class)}
      data-input-primary-actions
      {...rest}
    >
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
        when={resolved()}
        fallback={
          <>
            <InputActionButton
              label="Attach files"
              onClick={() => openAttachPicker()}
            >
              <PaperclipIcon class="size-5" />
            </InputActionButton>
            <InputActionButton
              label="Format"
              active={input().showFormatRibbon}
              onClick={() => commands.toggleFormatRibbon()}
            >
              <FormatIcon class="size-5" />
            </InputActionButton>
            <Show when={isReplyInput(input())}>
              <InputActionButton
                label="Delete reply"
                onClick={() => commands.close()}
              >
                <TrashIcon class="size-5" />
              </InputActionButton>
            </Show>
          </>
        }
      >
        {(children) => children()}
      </Show>
    </div>
  );
}
