import { isMobile } from '@core/mobile/isMobile';
import { useTouchOutsideToDismissKeyboard } from '@core/mobile/useTouchOutsideToDismissKeyboard';
import { cn } from '@ui/utils/classname';
import { type JSX, splitProps } from 'solid-js';
import { InputProvider } from './context';
import { type InputCommands, type InputData, isReplyInput } from './types';

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

  let containerRef: HTMLDivElement | undefined;
  useTouchOutsideToDismissKeyboard(() => containerRef);

  return (
    <div
      ref={(el) => {
        containerRef = el;
      }}
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
