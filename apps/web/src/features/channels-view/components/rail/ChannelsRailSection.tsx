import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CaretUpIcon from '@phosphor/caret-up.svg';
import PlusIcon from '@phosphor/plus.svg';
import { cn, Scroll } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';
import { useOffscreenActivityIndicator } from './useOffscreenActivityIndicator';

function SectionScrollArea(props: {
  contentRef: (element: HTMLDivElement) => void;
  containerClass?: string;
  class?: string;
  activityTargetId?: string;
  activityLabel?: string;
  onActivityVisible?: (targetId: string) => void;
  children: JSX.Element;
}) {
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  const activity = useOffscreenActivityIndicator({
    scrollRoot,
    targetId: () => props.activityTargetId,
    onTargetVisible: (targetId) => props.onActivityVisible?.(targetId),
  });

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
      <Show when={activity.direction()}>
        {(direction) => (
          <button
            type="button"
            class={cn(
              'absolute left-1/2 z-annotation-layer flex h-7 max-w-[calc(100%-0.5rem)] -translate-x-1/2 items-center gap-1 rounded-full border border-edge bg-lift px-2 text-xxs font-medium text-ink-muted shadow-sm transition-colors hover:bg-surface hover:text-ink focus-visible:ring-2 focus-visible:ring-accent',
              direction() === 'start' ? 'top-1' : 'bottom-1'
            )}
            aria-label={`${props.activityLabel ?? 'New activity'} ${
              direction() === 'start' ? 'above' : 'below'
            }; scroll to it`}
            title={props.activityLabel ?? 'New activity'}
            onClick={activity.scrollToTarget}
          >
            <Show
              when={direction() === 'start'}
              fallback={<CaretDownIcon class="size-3 shrink-0" />}
            >
              <CaretUpIcon class="size-3 shrink-0" />
            </Show>
            <Show when={props.activityLabel}>
              {(label) => <span class="truncate">{label()}</span>}
            </Show>
          </button>
        )}
      </Show>
    </div>
  );
}

function CollapsibleSectionRoot(props: {
  open: boolean;
  fillAvailable?: boolean;
  class?: string;
  children: JSX.Element;
}) {
  return (
    <section
      class={cn(
        'flex min-h-0 flex-col gap-1',
        props.open && props.fillAvailable && 'flex-1',
        props.open && !props.fillAvailable && 'shrink',
        !props.open && 'shrink-0',
        props.open && !props.fillAvailable && 'max-h-[calc(50%_-_0.375rem)]',
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
  activityTargetId?: string;
  activityLabel?: string;
  onActivityVisible?: (targetId: string) => void;
  children: JSX.Element;
}) {
  return (
    <Show when={props.open}>
      <SectionScrollArea
        contentRef={props.contentRef}
        containerClass={props.containerClass}
        class={props.class}
        activityTargetId={props.activityTargetId}
        activityLabel={props.activityLabel}
        onActivityVisible={props.onActivityVisible}
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
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      class="flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-muted transition-colors hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
      aria-label={props.label}
      onClick={props.onClick}
    >
      <PlusIcon class="size-3.5" />
    </button>
  );
}
