import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CaretUpIcon from '@phosphor/caret-up.svg';
import PlusIcon from '@phosphor/plus.svg';
import { cn, Scroll } from '@ui';
import {
  type Accessor,
  createEffect,
  createSignal,
  type JSX,
  onCleanup,
  Show,
} from 'solid-js';

type ActivityDirection = 'start' | 'end';

function useOffscreenActivityIndicator(options: {
  scrollRoot: Accessor<HTMLDivElement | undefined>;
  targetId: Accessor<string | undefined>;
  onTargetVisible?: (targetId: string) => void;
}) {
  const [direction, setDirection] = createSignal<ActivityDirection>();
  let measuredTargetId: string | undefined;

  const update = (root: HTMLDivElement) => {
    const targetId = options.targetId();
    if (!targetId) {
      measuredTargetId = undefined;
      setDirection(undefined);
      return;
    }

    if (targetId !== measuredTargetId) {
      measuredTargetId = targetId;
      setDirection(undefined);
    }

    const target = document.getElementById(targetId);
    if (!target) {
      setDirection(undefined);
      return;
    }

    const rootBounds = root.getBoundingClientRect();
    const targetBounds = target.getBoundingClientRect();
    const targetIsVisible =
      targetBounds.bottom > rootBounds.top &&
      targetBounds.top < rootBounds.bottom;

    if (targetIsVisible || root.scrollHeight <= root.clientHeight + 1) {
      const wasOffscreen = direction() !== undefined;
      setDirection(undefined);
      if (wasOffscreen) options.onTargetVisible?.(targetId);
      return;
    }

    setDirection(targetBounds.bottom <= rootBounds.top ? 'start' : 'end');
  };

  createEffect(() => {
    const root = options.scrollRoot();
    if (!root) {
      setDirection(undefined);
      return;
    }

    measuredTargetId = undefined;
    const updateForRoot = () => update(root);
    root.addEventListener('scroll', updateForRoot, { passive: true });

    const resizeObserver = new ResizeObserver(updateForRoot);
    resizeObserver.observe(root);
    if (root.firstElementChild instanceof HTMLElement) {
      resizeObserver.observe(root.firstElementChild);
    }

    const mutationObserver = new MutationObserver(updateForRoot);
    mutationObserver.observe(root, { childList: true, subtree: true });

    queueMicrotask(updateForRoot);

    onCleanup(() => {
      root.removeEventListener('scroll', updateForRoot);
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    });
  });

  createEffect(() => {
    options.targetId();
    const root = options.scrollRoot();
    if (!root) return;

    queueMicrotask(() => {
      if (root === options.scrollRoot()) update(root);
    });
  });

  const scrollToTarget = () => {
    const root = options.scrollRoot();
    const targetId = options.targetId();
    const target = targetId ? document.getElementById(targetId) : undefined;
    if (!root || !target) return;

    const rootBounds = root.getBoundingClientRect();
    const targetBounds = target.getBoundingClientRect();
    const rootCenter = rootBounds.top + rootBounds.height / 2;
    const targetCenter = targetBounds.top + targetBounds.height / 2;

    root.scrollTo({
      top: root.scrollTop + targetCenter - rootCenter,
      behavior: 'smooth',
    });
  };

  return { direction, scrollToTarget };
}

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
