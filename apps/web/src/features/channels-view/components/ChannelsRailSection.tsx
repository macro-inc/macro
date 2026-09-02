import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import PlusIcon from '@phosphor/plus.svg';
import { cn, Scroll } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';

function SectionScrollArea(props: {
  contentRef: (element: HTMLDivElement) => void;
  containerClass?: string;
  class?: string;
  children: JSX.Element;
}) {
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();

  return (
    <div class={cn('relative min-h-0 flex-1', props.containerClass)}>
      <Scroll
        scrollRef={(element) => {
          setScrollRoot(element);
          props.contentRef(element);
        }}
      >
        <div role="group" class={props.class}>
          {props.children}
        </div>
      </Scroll>
      <ScrollIndicators
        scrollRef={scrollRoot}
        appearance="gradient"
        gradientColor="inset"
      />
    </div>
  );
}

function CollapsibleSectionRoot(props: {
  open: boolean;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <section
      class={cn(
        'flex min-h-0 flex-col gap-1',
        props.open && 'shrink',
        !props.open && 'shrink-0',
        props.open && 'max-h-[calc(50%_-_0.375rem)]',
        props.class
      )}
    >
      {props.children}
    </section>
  );
}

function CollapsibleSectionHeader(props: {
  focused: boolean;
  focusWithin: boolean;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <div
      class={cn(
        'flex w-full items-center rounded-xl text-xs font-semibold uppercase tracking-wide text-ink-extra-muted transition-colors hover:bg-hover hover:text-ink-muted',
        props.focused && 'bg-hover text-ink-muted',
        !props.focused && props.focusWithin && 'text-ink-muted',
        props.class
      )}
    >
      {props.children}
    </div>
  );
}

function CollapsibleSectionContent(props: {
  open: boolean;
  contentRef: (element: HTMLDivElement) => void;
  containerClass?: string;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <Show when={props.open}>
      <SectionScrollArea
        contentRef={props.contentRef}
        containerClass={props.containerClass}
        class={props.class}
      >
        {props.children}
      </SectionScrollArea>
    </Show>
  );
}

export const CollapsibleSection = {
  Root: CollapsibleSectionRoot,
  Header: CollapsibleSectionHeader,
  Content: CollapsibleSectionContent,
};

export function CreateRailAction(props: {
  label: string;
  slim?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      class={cn(
        'flex shrink-0 items-center justify-center text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent',
        props.slim &&
          'size-10 rounded-full border border-edge-muted bg-transparent',
        !props.slim && 'size-7 rounded-lg'
      )}
      aria-label={props.label}
      onClick={props.onClick}
    >
      <PlusIcon class="size-3.5" />
    </button>
  );
}
