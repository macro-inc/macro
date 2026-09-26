import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { type JSX, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Button, type ButtonProps } from './Button';
import { Hotkey } from './Hotkey';

type SlotProps = JSX.HTMLAttributes<HTMLDivElement>;

/** Task and project composer layout; the split/popover host supplies the surface. */
function Root(props: SlotProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      {...rest}
      class={cn(
        'portal-scope flex flex-col relative h-full max-h-full min-h-0 p-4 gap-4',
        local.class
      )}
    />
  );
}

function Header(props: SlotProps) {
  const [local, rest] = splitProps(props, ['class']);
  return <div {...rest} class={cn('flex items-center gap-1', local.class)} />;
}

function Main(props: SlotProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      {...rest}
      class={cn('flex-1 min-h-0 flex flex-col overflow-hidden', local.class)}
    />
  );
}

function Title(props: SlotProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      {...rest}
      class={cn('shrink-0 flex gap-2 items-start px-2 mb-4', local.class)}
    />
  );
}

function Body(props: SlotProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      {...rest}
      class={cn(
        'overflow-auto scrollbar-hidden mb-6 min-h-24 grow px-2',
        local.class
      )}
    />
  );
}

function Properties(props: SlotProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      {...rest}
      class={cn(
        'flex min-h-7 flex-row flex-wrap items-center gap-2 text-sm m-px',
        local.class
      )}
    />
  );
}

function Footer(props: SlotProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <div
      {...rest}
      class={cn('shrink-0 flex justify-between items-end gap-2', local.class)}
    />
  );
}

function Submit(props: Omit<ButtonProps, 'variant'> & { hasContent: boolean }) {
  const [local, rest] = splitProps(props, ['class', 'children', 'hasContent']);
  return (
    <Button
      {...rest}
      variant={local.hasContent ? 'accent' : 'ghost'}
      depth={3}
      class={cn(
        'gap-3 rounded-lg border-0',
        !isTouchDevice() && 'rounded-full h-[33.75px] px-[15px]',
        local.class
      )}
    >
      {local.children}
      <Hotkey shortcut="cmd+enter" theme="current" />
    </Button>
  );
}

export const EntityComposer = {
  Root,
  Header,
  Main,
  Title,
  Body,
  Properties,
  Footer,
  Submit,
};
