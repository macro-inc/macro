import { splitProps, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { InputProvider } from './context';
import { isReplyInput, type InputCommands, type InputData } from './types';
import { isMobile } from '@core/mobile/isMobile';

const NoopInputCommands: InputCommands = {
  send: async () => false,
  attachFiles: async () => {},
  toggleFormatRibbon: () => {},
  close: () => {},
  removeAttachment: () => {},
};

type RootProps = JSX.HTMLAttributes<HTMLDivElement> & {
  input: InputData;
  commands?: InputCommands;
};

export function Root(props: RootProps) {
  const [local, rest] = splitProps(props, [
    'children',
    'class',
    'input',
    'commands',
  ]);

  return (
    <div
      class={cn(
        'relative macro-message-width flex flex-col flex-1 items-center justify-between bg-input border border-edge-muted rounded-[5px]',
        isMobile() &&
          !isReplyInput(local.input) &&
          'border-b-0 border-l-0 border-r-0 rounded-b-none',
        isReplyInput(local.input) && 'rounded-b-[5px] mb-4',
        local.class
      )}
      data-input
      data-input-id={local.input.id}
      {...rest}
    >
      <InputProvider
        value={{
          view: () => local.input,
          commands: local.commands ?? NoopInputCommands,
        }}
      >
        {local.children}
      </InputProvider>
    </div>
  );
}
