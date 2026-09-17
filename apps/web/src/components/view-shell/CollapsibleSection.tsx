import { Collapsible, useCollapsibleContext } from '@kobalte/core/collapsible';
import CaretDownIcon from '@phosphor/caret-down.svg';
import { cn } from '@ui';
import {
  type ComponentProps,
  type JSX,
  Show,
  Suspense,
  splitProps,
} from 'solid-js';
import { CollapseTransition } from './CollapseTransition';
import { ViewSidebar } from './ViewSidebar';

export type CollapsibleSectionRootProps = Omit<
  ComponentProps<typeof Collapsible>,
  'defaultOpen' | 'forceMount' | 'onOpenChange' | 'open'
> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

function Root(props: CollapsibleSectionRootProps) {
  const [local, rest] = splitProps(props, ['class']);
  return (
    <Collapsible
      {...rest}
      // Content owns presence so exit motion finishes before it unmounts.
      forceMount
      class={cn('group/sidebar-section min-w-0 shrink-0', local.class)}
    />
  );
}

function Header(props: JSX.HTMLAttributes<HTMLDivElement>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <div
      {...rest}
      class={cn(
        'flex h-(--sidebar-row-height) min-w-0 shrink-0 items-center gap-1 pr-(--sidebar-action-inset)',
        local.class
      )}
    >
      {local.children}
    </div>
  );
}

function Trigger(props: ComponentProps<typeof Collapsible.Trigger>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  return (
    <Collapsible.Trigger
      {...rest}
      class={cn(
        'flex h-(--sidebar-row-height) w-full min-w-0 items-center gap-1 rounded-lg px-(--sidebar-item-inset) py-1 text-left text-xs leading-5 font-medium text-ink-muted outline-none transition-colors group-hover/sidebar-section:text-ink focus-visible:outline-2 focus-visible:outline-accent',
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
        'flex size-4 shrink-0 items-center justify-center text-ink-extra-muted opacity-0 -rotate-90 transition-[opacity,rotate] duration-200 motion-reduce:transition-none group-hover/sidebar-section:opacity-100 group-data-closed/sidebar-section:opacity-100 group-data-expanded/sidebar-section:rotate-0',
        local.class
      )}
    >
      <Show when={local.children} fallback={<CaretDownIcon class="size-2.5" />}>
        {local.children}
      </Show>
    </span>
  );
}

function Content(props: ComponentProps<typeof Collapsible.Content>) {
  const [local, rest] = splitProps(props, ['children', 'class']);
  const context = useCollapsibleContext();
  return (
    <CollapseTransition open={context.isOpen()}>
      <Collapsible.Content
        {...rest}
        class={cn('min-w-0 pt-(--sidebar-section-content-gap)', local.class)}
      >
        {/* Content queries must not detach the section header or its neighbors. */}
        <Suspense>{local.children}</Suspense>
      </Collapsible.Content>
    </CollapseTransition>
  );
}

export const CollapsibleSection = Object.assign(Root, {
  Root,
  Header,
  Action: ViewSidebar.Control,
  Trigger,
  Indicator,
  Content,
});
