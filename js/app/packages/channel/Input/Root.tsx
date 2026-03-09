import { splitProps, type JSX } from 'solid-js';
import { cn } from '@ui/utils/classname';
import { InputProvider } from './context';
import { isReplyInput, type InputCommands, type InputData } from './types';

const NoopInputCommands: InputCommands = {
  send: async () => false,
  attachFiles: async () => {},
  toggleFormatRibbon: () => {},
  closeDraft: () => {},
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
        local.class,
        {
          'rounded-b-[5px] border-b mb-4': isReplyInput(local.input),
        }
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
