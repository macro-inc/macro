import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import { AnimatedSquareSidebarIcon } from '@icon/square-sidebar';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CaretUpIcon from '@phosphor/caret-up.svg';
import PlusIcon from '@phosphor/plus.svg';
import SpinnerIcon from '@phosphor/spinner.svg';
import { Button, cn, Scroll, Tooltip } from '@ui';
import { createSignal, For, type JSX, Match, Show, Switch } from 'solid-js';
import { useOffscreenActivity } from './hooks/useOffscreenActivity';

const LOADING_SKELETON_ROWS = [0, 1, 2];

function SectionScrollArea(props: {
  contentRef: (element: HTMLDivElement) => void;
  containerClass?: string;
  class?: string;
  activityTargetId?: string;
  activityLabel?: string;
  activityTooltip?: boolean;
  onActivityVisible?: (targetId: string) => void;
  children: JSX.Element;
}) {
  const [scrollRoot, setScrollRoot] = createSignal<HTMLDivElement>();
  const activity = useOffscreenActivity({
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
        gradientColor="panel"
      />
      <Show when={activity.direction()}>
        {(direction) => (
          <Tooltip
            label={props.activityLabel ?? 'New activity'}
            placement={direction() === 'start' ? 'bottom' : 'top'}
            disabled={!props.activityTooltip}
            class={cn(
              'absolute left-1/2 z-annotation-layer max-w-[calc(100%-0.5rem)] -translate-x-1/2',
              direction() === 'start' ? 'top-1' : 'bottom-1'
            )}
          >
            <button
              type="button"
              class="flex h-7 max-w-full items-center gap-1 rounded-full border border-edge bg-lift px-2 text-xxs font-medium text-ink-muted shadow-sm transition-colors hover:bg-surface hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
              aria-label={`${props.activityLabel ?? 'New activity'} ${
                direction() === 'start' ? 'above' : 'below'
              }; scroll to it`}
              onClick={activity.scrollToTarget}
            >
              <Switch>
                <Match when={direction() === 'start'}>
                  <CaretUpIcon class="size-3 shrink-0" />
                </Match>
                <Match when={true}>
                  <CaretDownIcon class="size-3 shrink-0" />
                </Match>
              </Switch>
              <Show when={props.activityLabel}>
                {(label) => <span class="truncate">{label()}</span>}
              </Show>
            </button>
          </Tooltip>
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
        'flex w-full items-center rounded-xl text-xs font-semibold uppercase tracking-wide text-ink-extra-muted hover:bg-hover hover:text-ink-muted',
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
  activityTooltip?: boolean;
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
        activityTooltip={props.activityTooltip}
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

export function RailListLoading() {
  return (
    <div class="grid min-h-20 place-items-center text-ink-muted">
      <SpinnerIcon
        aria-label="Loading conversations"
        class="size-4 animate-spin"
      />
    </div>
  );
}

export function RailListLoadingMore(props: {
  variant: 'channel' | 'recent' | 'slim';
}) {
  return (
    <div role="status" aria-label="Loading more conversations">
      <For each={LOADING_SKELETON_ROWS}>
        {(row) => (
          <div
            aria-hidden="true"
            class={cn(
              'flex items-center',
              props.variant === 'slim' && 'h-10 justify-center',
              props.variant === 'channel' && 'h-10 gap-2 px-2',
              props.variant === 'recent' && 'h-18 items-start gap-3 px-2 py-2'
            )}
          >
            <div
              class={cn(
                'skeleton-shimmer shrink-0 rounded-full bg-skeleton',
                props.variant === 'channel' && 'size-6',
                props.variant !== 'channel' && 'size-8'
              )}
            />
            <Show when={props.variant !== 'slim'}>
              <div class="flex min-w-0 flex-1 flex-col gap-2">
                <div
                  class={cn(
                    'skeleton-shimmer h-2.5 rounded-full bg-skeleton',
                    row % 2 === 0 ? 'w-1/2' : 'w-2/3'
                  )}
                />
                <Show when={props.variant === 'recent'}>
                  <div class="skeleton-shimmer h-2 w-4/5 rounded-full bg-skeleton" />
                </Show>
              </div>
            </Show>
          </div>
        )}
      </For>
    </div>
  );
}

export function RailListError(props: {
  retry: () => Promise<void>;
  compact?: boolean;
}) {
  return (
    <div
      class={cn(
        'flex items-center justify-center gap-2 px-2 text-xs text-ink-muted',
        props.compact ? 'py-2' : 'min-h-20 flex-col'
      )}
    >
      <span>Couldn’t load conversations.</span>
      <Button variant="outline" size="xs" onClick={() => void props.retry()}>
        Try again
      </Button>
    </div>
  );
}

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

export function RailModeButton(props: {
  expanded: boolean;
  onToggle: () => void;
}) {
  const [hovering, setHovering] = createSignal(false);

  return (
    <Button
      variant="ghost"
      size="icon-sm"
      label={props.expanded ? 'Collapse chat rail' : 'Expand chat rail'}
      tooltipPlacement={props.expanded ? 'bottom' : 'right'}
      onClick={props.onToggle}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <AnimatedSquareSidebarIcon class="size-4" triggerAnimation={hovering()} />
    </Button>
  );
}
