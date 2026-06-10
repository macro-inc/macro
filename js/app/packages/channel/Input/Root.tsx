import { usePreserveFocusOnButtonTaps } from '@core/mobile/usePreserveFocusOnButtonTaps';
import { useTouchOutsideToDismissKeyboard } from '@core/mobile/useTouchOutsideToDismissKeyboard';
import { cn } from '@ui';
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
  usePreserveFocusOnButtonTaps(() => containerRef);

  return (
    <div
      ref={(el) => {
        containerRef = el;
      }}
      class={cn(
        'relative macro-message-width flex flex-col flex-1 items-center justify-between',
        isReplyInput(local.input) && 'mb-4',
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
