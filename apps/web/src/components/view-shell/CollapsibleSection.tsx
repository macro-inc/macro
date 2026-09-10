import { Collapsible } from '@kobalte/core/collapsible';
import CaretDownIcon from '@phosphor/caret-down.svg';
import { cn } from '@ui';
import { type ComponentProps, type JSX, Show, splitProps } from 'solid-js';

export type CollapsibleSectionRootProps = Omit<
  ComponentProps<typeof Collapsible>,
  'defaultOpen' | 'onOpenChange' | 'open'
> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function Root(props: CollapsibleSectionRootProps) {
  return <Collapsible {...props} />;
}

function Trigger(props: ComponentProps<typeof Collapsible.Trigger>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <Collapsible.Trigger
      {...rest}
      class={cn(
        'group flex h-9 w-full min-w-0 items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm font-medium text-ink-muted outline-none hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/30',
        local.class
      )}
    >
      {local.children}
    </Collapsible.Trigger>
  );
}

function Indicator(props: JSX.HTMLAttributes<HTMLSpanElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <span
      {...rest}
      aria-hidden="true"
      class={cn(
        'ml-auto flex size-4 shrink-0 items-center justify-center text-ink-extra-muted transition-transform group-data-expanded:rotate-90',
        local.class
      )}
    >
      <Show
        when={local.children}
        fallback={<CaretDownIcon class="size-3 -rotate-90" />}
      >
        {local.children}
      </Show>
    </span>
  );
}

function Content(props: ComponentProps<typeof Collapsible.Content>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <Collapsible.Content
      {...rest}
      class={cn('min-w-0 data-closed:hidden', local.class)}
    >
      {local.children}
    </Collapsible.Content>
  );
}

export const CollapsibleSection = Object.assign(Root, {
  Root,
  Trigger,
  Indicator,
  Content,
});
