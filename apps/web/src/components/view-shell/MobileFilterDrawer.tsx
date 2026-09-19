import {
  MobileDrawer,
  scrollToFocusedInput,
} from '@components/app/mobile/MobileDrawer';
import { pressPulse } from '@components/app/mobile/pressPulse';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import { Accordion } from '@kobalte/core/accordion';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import XIcon from '@phosphor/x.svg';
import SlidersHorizontalIcon from '@phosphor-icons/core/regular/sliders-horizontal.svg?component-solid';
import { Button, cn } from '@ui';
import {
  type Accessor,
  createContext,
  createSignal,
  type JSX,
  Show,
  useContext,
} from 'solid-js';

const ScrollContext = createContext<Accessor<HTMLElement | undefined>>();

type MobileFilterDrawerProps = {
  children: JSX.Element;
  activeCount: number;
  onClear: () => void;
  triggerLabel?: string;
  label?: string;
  class?: string;
  /** Active filter chips or other controls beside Clear all. */
  footer?: JSX.Element;
};

/** Presentation only; callers own filter state and compose the drawer contents. */
function Root(props: MobileFilterDrawerProps) {
  const [scrollRef, setScrollRef] = createSignal<HTMLElement>();

  return (
    <MobileDrawer
      side="bottom"
      preventScroll={false}
      preventScrollbarShift={false}
      breakPoints={[0.85]}
    >
      <MobileDrawer.Trigger
        as={Button}
        aria-label={props.triggerLabel ?? 'Open filters'}
        variant="ghost"
        size="sm"
        depth={3}
        class={cn(
          'island bg-chrome pointer-events-auto relative size-10 shrink-0 rounded-full [&_svg]:size-6',
          props.class
        )}
        ref={pressPulse}
      >
        <SlidersHorizontalIcon />
        <Show when={props.activeCount > 0}>
          <span class="pointer-events-none absolute -top-0.5 right-0 flex size-4 translate-x-1/2 items-center justify-center rounded-full bg-accent text-xxs font-medium leading-none text-surface">
            {props.activeCount}
          </span>
        </Show>
      </MobileDrawer.Trigger>
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay class="fixed inset-0 z-modal-overlay bg-modal-overlay pattern-diagonal-4 pattern-edge-muted" />
        <MobileDrawer.Content
          aria-label={props.label ?? 'Filters'}
          class="h-[80vh]"
        >
          <MobileDrawer.Handle class="pb-1" />
          <div class="relative min-h-0 flex-1">
            <ScrollIndicators scrollRef={scrollRef} noBorderStart noBorderEnd />
            <div
              ref={setScrollRef}
              onFocusIn={(e) => scrollToFocusedInput(e)}
              class="h-full overflow-y-auto pb-1 scrollbar-hidden"
            >
              <ScrollContext.Provider value={scrollRef}>
                {props.children}
              </ScrollContext.Provider>
            </div>
          </div>
          <Show when={props.activeCount > 0}>
            <div class="shrink-0 border-t border-edge-muted p-2">
              <div class="flex flex-wrap items-center gap-2">
                {props.footer}
                <Button
                  variant="outline"
                  size="sm"
                  class="min-h-10 rounded-lg bg-active!"
                  onClick={() => props.onClear()}
                >
                  <XIcon class="size-3!" />
                  Clear all
                </Button>
              </div>
            </div>
          </Show>
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

function Section(props: {
  value: string;
  label: string;
  activeCount: number;
  class?: string;
  children: JSX.Element;
}) {
  const scrollRef = useContext(ScrollContext);
  const scrollToSection = (e: MouseEvent) => {
    const scrollEl = scrollRef?.();
    const item = (e.currentTarget as HTMLElement).closest(
      '[data-closed],[data-expanded]'
    );
    if (!scrollEl || !(item instanceof HTMLElement)) return;
    requestAnimationFrame(() => {
      if (!item.hasAttribute('data-expanded')) return;
      scrollEl.scrollTo({
        top:
          scrollEl.scrollTop +
          item.getBoundingClientRect().top -
          scrollEl.getBoundingClientRect().top,
        behavior: 'smooth',
      });
    });
  };

  return (
    <MobileDrawer.Section
      as={Accordion.Item}
      value={props.value}
      class={props.class}
    >
      <Accordion.Header>
        <Accordion.Trigger
          class="group mb-px flex w-full items-center justify-between bg-surface p-3 text-sm text-ink outline-none transition-colors hover:bg-hover"
          onClick={scrollToSection}
        >
          <span class="font-medium">{props.label}</span>
          <div class="flex items-center gap-2">
            <Show when={props.activeCount > 0}>
              <span class="group-data-expanded:hidden flex size-4 items-center justify-center rounded-full bg-accent text-xxs font-medium leading-none text-surface">
                {props.activeCount}
              </span>
            </Show>
            <CaretDownIcon class="size-3.5 text-ink-muted transition-transform duration-200 group-data-expanded:rotate-180" />
          </div>
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Content>{props.children}</Accordion.Content>
    </MobileDrawer.Section>
  );
}

function Option(props: {
  children: JSX.Element;
  icon?: JSX.Element;
  checked: boolean;
  onChange: (checked: boolean) => void;
  selectionMode?: 'single' | 'multiple';
}) {
  return (
    <button
      type="button"
      role={props.selectionMode === 'single' ? 'radio' : 'checkbox'}
      aria-checked={props.checked}
      class="flex w-full items-center gap-3 bg-surface px-3 py-2.5 text-left text-sm transition-colors hover:bg-hover not-last:mb-px"
      onClick={() => props.onChange(!props.checked)}
    >
      <span
        class={cn(
          'flex size-4 shrink-0 items-center justify-center border transition-colors',
          props.selectionMode === 'single' && 'rounded-full',
          props.checked ? 'border-accent bg-accent' : 'border-edge'
        )}
      >
        <Show when={props.checked}>
          <CheckIcon class="size-2.5 text-surface" />
        </Show>
      </span>
      <Show when={props.icon}>
        {(icon) => (
          <span class="flex size-4 shrink-0 items-center justify-center">
            {icon()}
          </span>
        )}
      </Show>
      <span class="min-w-0 flex-1 truncate">{props.children}</span>
    </button>
  );
}

export const MobileFilterDrawer = Object.assign(Root, { Section, Option });
