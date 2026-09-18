import { type ParentProps, splitProps } from 'solid-js';
import { cn } from '../utils/classname';
import { Dialog } from './Dialog';
import { Surface, type SurfaceProps } from './Surface';

type SlotProps = ParentProps<{ class?: string }>;

/** Presentation-only slots for small, focused actions. Hosts own dialog state and forms. */
function ActionDialogShellRoot(props: SurfaceProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <Surface
      depth={2}
      {...rest}
      class={cn('flex max-h-[75dvh] flex-col rounded-xl text-ink', local.class)}
    />
  );
}

function Body(props: SlotProps) {
  return (
    <div
      class={cn(
        'min-h-0 space-y-6 overflow-y-auto p-5',
        '[&_[data-slot=text-field]]:gap-2 [&_[data-slot=text-field-label]]:text-[13px] [&_[data-slot=text-field-label]]:leading-[18px] [&_[data-slot=text-field-label]]:font-medium',
        '[&_input[data-slot]]:h-11 [&_input[data-slot]]:text-sm [&_input[data-slot]]:shadow-none [&_input[data-slot]]:focus-visible:ring-2 [&_input[data-slot]]:focus-visible:ring-edge-muted [&_input[data-slot]]:focus-visible:outline-none',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

function Header(props: SlotProps) {
  return <div class={cn('space-y-2', props.class)}>{props.children}</div>;
}

const Title: typeof Dialog.Title = (props) => (
  <Dialog.Title
    {...props}
    class={cn(
      'text-[18px] leading-6 font-semibold tracking-tight',
      props.class
    )}
  />
);

const Description: typeof Dialog.Description = (props) => (
  <Dialog.Description
    {...props}
    class={cn('text-sm leading-5 text-ink-muted', props.class)}
  />
);

function Footer(props: SlotProps) {
  return (
    <div
      class={cn(
        'flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-edge-muted px-5 py-3',
        '[&_[data-slot=button]]:rounded-lg [&_[data-slot=button][data-disabled]]:opacity-100 [&_[data-slot=button][data-disabled]]:text-ink-muted [&_[data-slot=button][data-disabled]:not([data-variant=ghost])]:bg-ink/10',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

export const ActionDialogShell = Object.assign(ActionDialogShellRoot, {
  Body,
  Header,
  Title,
  Description,
  Footer,
});
