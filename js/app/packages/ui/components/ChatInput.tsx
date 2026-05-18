import { createContext, Show, splitProps, useContext } from 'solid-js';
import { cn } from '../utils/classname';
import type { JSX  } from 'solid-js';

export type ChatInputRows = 1 | 2 | 3;

type ChatInputContextValue = { rows: () => ChatInputRows; };

const ChatInputContext = createContext<ChatInputContextValue>();

function useChatInputContext(): ChatInputContextValue {
  const ctx = useContext(ChatInputContext);
  if (!ctx) {
    throw new Error(
      'ChatInput.* components must be used inside <ChatInput.Root>',
    );
  }
  return ctx;
}

export type ChatInputProps = Omit<JSX.HTMLAttributes<HTMLDivElement>, 'style'> & {
  style?: JSX.CSSProperties;
  rows?: ChatInputRows;
};

function gridStyle(rows: ChatInputRows): JSX.CSSProperties {
  switch (rows) {
    case 1:
      return {
        'grid-template-areas': '"left editor right"',
        'grid-template-columns': 'auto minmax(0, 1fr) auto',
        'grid-template-rows': 'auto',
      };
    case 2:
      return {
        'grid-template-areas': '"editor editor editor" "left . right"',
        'grid-template-columns': 'auto minmax(0, 1fr) auto',
        'grid-template-rows': 'minmax(0, 1fr) auto',
      };
    case 3:
      return {
        'grid-template-areas':
          '"extras extras extras" "editor editor editor" "left . right"',
        'grid-template-columns': 'auto minmax(0, 1fr) auto',
        'grid-template-rows': 'auto minmax(0, 1fr) auto',
      };
  }
}

function ChatInputRoot(props: ChatInputProps) {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'rows',
    'style',
  ]);

  const rows = (): ChatInputRows => local.rows ?? 2;

  return (
    <ChatInputContext.Provider value={{ rows }}>
      <div
        class={cn('grid w-full items-center', local.class)}
        style={{
          ...gridStyle(rows()),
          ...local.style,
        }}
        data-chat-input
        data-chat-input-rows={rows()}
        {...rest}
      >
        {local.children}
      </div>
    </ChatInputContext.Provider>
  );
}

type SlotProps = JSX.HTMLAttributes<HTMLDivElement>;

function Editor(props: SlotProps) {
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <div
      class={cn('min-w-0 w-full', local.class)}
      style={{ 'grid-area': 'editor' }}
      data-chat-input-editor
      {...rest}
    >
      {local.children}
    </div>
  );
}

function Extras(props: SlotProps) {
  const ctx = useChatInputContext();
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <Show when={ctx.rows() === 3}>
      <div
        class={cn('min-w-0 w-full', local.class)}
        style={{ 'grid-area': 'extras' }}
        data-chat-input-extras
        {...rest}
      >
        {local.children}
      </div>
    </Show>
  );
}

function LeftActions(props: SlotProps) {
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <div
      class={cn('flex flex-row items-center gap-2', local.class)}
      style={{ 'grid-area': 'left' }}
      data-chat-input-actions="left"
      {...rest}
    >
      {local.children}
    </div>
  );
}

function RightActions(props: SlotProps) {
  const [local, rest] = splitProps(props, ['class', 'children']);

  return (
    <div
      class={cn('flex flex-row items-center gap-2 justify-end', local.class)}
      style={{ 'grid-area': 'right' }}
      data-chat-input-actions="right"
      {...rest}
    >
      {local.children}
    </div>
  );
}

export const ChatInput = Object.assign(ChatInputRoot, {
  Editor,
  Extras,
  LeftActions,
  RightActions,
});
