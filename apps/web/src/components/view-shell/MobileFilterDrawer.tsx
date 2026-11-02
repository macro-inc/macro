import {
  MobileDrawer,
  scrollToFocusedInput,
} from '@components/app/mobile/MobileDrawer';
import { ScrollIndicators } from '@core/component/VerticalScrollIndicators';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import CheckIcon from '@icon/system/regular/check.svg';
import SlidersHorizontalIcon from '@icon/system/regular/sliders-horizontal.svg?component-solid';
import XIcon from '@icon/system/regular/x.svg';
import { Accordion } from '@kobalte/core/accordion';
import { createElementSize } from '@solid-primitives/resize-observer';
import { Button, cn } from '@ui';
import {
  type Accessor,
  children,
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
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onContentPresentChange?: (present: boolean) => void;
  /** Overlays the bottom of the scroll content, immediately above the footer. */
  contentOverlay?: () => JSX.Element;
  /** Additional controls beside Clear all, also shown without active filters. */
  footer?: JSX.Element;
  /** Trailing actions rendered within the drawer's dialog scope. */
  footerEnd?: () => JSX.Element;
};

/** Presentation only; callers own filter state and compose the drawer contents. */
function Root(props: MobileFilterDrawerProps) {
  const [scrollRef, setScrollRef] = createSignal<HTMLElement>();
  const [overlayRef, setOverlayRef] = createSignal<HTMLDivElement>();
  const overlaySize = createElementSize(overlayRef);
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();

  return (
    <MobileDrawer
      side="bottom"
      open={props.open}
      onOpenChange={props.onOpenChange}
      onContentPresentChange={props.onContentPresentChange}
      preventScroll={false}
      preventScrollbarShift={false}
      breakPoints={[0.85]}
      restoreFocus
      finalFocusEl={trigger()}
    >
      <MobileDrawer.Trigger
        ref={setTrigger}
        as={Button}
        aria-label={props.triggerLabel ?? 'Open filters'}
        variant="ghost"
        size="icon-md"
        class={cn(
          'island bg-chrome pointer-events-auto relative z-10 size-10 shrink-0 rounded-full',
          props.class
        )}
      >
        <SlidersHorizontalIcon class="size-6 shrink-0" />
        <Show when={props.activeCount > 0}>
          <span class="pointer-events-none absolute -top-0.5 right-0 z-10 flex size-4 translate-x-1/2 items-center justify-center rounded-full bg-accent text-xxs font-medium leading-none text-surface">
            {props.activeCount}
          </span>
        </Show>
      </MobileDrawer.Trigger>
      <MobileDrawer.Portal>
        <MobileDrawer.Overlay />
        <MobileDrawer.Content
          aria-label={props.label ?? 'Filters'}
          class="h-[80vh]"
        >
          <MobileDrawer.Handle class="pb-1" />
          <div class="flex shrink-0 items-center justify-between gap-3 px-6 pb-3">
            <h2 class="truncate text-lg font-semibold text-ink">
              {props.label ?? 'Filters'}
            </h2>
            <MobileDrawer.Close
              as={Button}
              variant="ghost"
              size="icon-sm"
              aria-label="Close filters"
              class="shrink-0 rounded-full bg-ink/6"
            >
              <XIcon class="size-4" />
            </MobileDrawer.Close>
          </div>
          <div class="relative min-h-0 flex-1">
            <ScrollIndicators scrollRef={scrollRef} noBorderStart noBorderEnd />
            <div
              ref={setScrollRef}
              onFocusIn={(e) => scrollToFocusedInput(e)}
              class="h-full overflow-y-auto scrollbar-hidden"
              style={{
                'padding-bottom': `calc(${overlaySize.height ?? 0}px + 0.75rem)`,
                'scroll-padding-bottom': `${overlaySize.height ?? 0}px`,
              }}
            >
              <ScrollContext.Provider value={scrollRef}>
                {props.children}
              </ScrollContext.Provider>
            </div>
            <div
              ref={setOverlayRef}
              class="absolute inset-x-0 bottom-0 z-10 bg-menu"
            >
              {props.contentOverlay?.()}
            </div>
          </div>
          <Footer
            activeCount={props.activeCount}
            onClear={props.onClear}
            footer={props.footer}
            footerEnd={props.footerEnd}
          />
        </MobileDrawer.Content>
      </MobileDrawer.Portal>
    </MobileDrawer>
  );
}

function Footer(
  props: Pick<
    MobileFilterDrawerProps,
    'activeCount' | 'onClear' | 'footer' | 'footerEnd'
  >
) {
  const footer = children(() => props.footer);
  const end = children(() => props.footerEnd?.());
  return (
    <Show
      when={
        props.activeCount > 0 ||
        footer.toArray().length > 0 ||
        end.toArray().length > 0
      }
    >
      <div class="shrink-0 px-6 pt-3 pb-2">
        <div class="flex flex-wrap items-center gap-2">
          {footer()}
          <Show when={props.activeCount > 0}>
            <Button
              variant="ghost"
              size="sm"
              class="min-h-10 px-4 text-failure-ink not-touch:not-disabled:hover:text-failure-ink"
              onClick={() => props.onClear()}
            >
              Clear all
            </Button>
          </Show>
          <div class="ml-auto flex flex-wrap items-center justify-end gap-2">
            {end()}
          </div>
        </div>
      </div>
    </Show>
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
          as={MobileDrawer.Item}
          class="group justify-between font-medium data-expanded:bg-ink/5"
          onClick={scrollToSection}
        >
          <span class="font-medium">{props.label}</span>
          <div class="flex items-center gap-2">
            <Show when={props.activeCount > 0}>
              <span class="group-data-expanded:hidden flex size-4 items-center justify-center rounded-full bg-accent text-xxs font-medium leading-none text-surface">
                {props.activeCount}
              </span>
            </Show>
            <CaretDownIcon class="size-4 text-ink-muted transition-transform duration-200 group-data-expanded:rotate-180" />
          </div>
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Content class="pt-1">{props.children}</Accordion.Content>
    </MobileDrawer.Section>
  );
}

function Option(props: {
  children: JSX.Element;
  icon?: JSX.Element;
  checked: boolean;
  onChange: (checked: boolean) => void;
  selectionMode?: 'single' | 'multiple';
  class?: string;
}) {
  return (
    <MobileDrawer.Item
      role={props.selectionMode === 'single' ? 'radio' : 'checkbox'}
      aria-checked={props.checked}
      class={cn(
        '[&[role=checkbox][aria-checked=true]:has(+[role=checkbox][aria-checked=true])]:rounded-b-none [&[role=checkbox][aria-checked=true]+[role=checkbox][aria-checked=true]]:rounded-t-none',
        props.class
      )}
      onClick={() => props.onChange(!props.checked)}
    >
      <Show when={props.icon}>
        {(icon) => (
          <span class="flex size-5 shrink-0 items-center justify-center text-ink-muted [&>svg]:size-5">
            {icon()}
          </span>
        )}
      </Show>
      <span class="min-w-0 flex-1 truncate">{props.children}</span>
      <span class="flex size-5 shrink-0 items-center justify-center">
        <Show when={props.checked}>
          <CheckIcon class="size-4 text-ink" />
        </Show>
      </span>
    </MobileDrawer.Item>
  );
}

export const MobileFilterDrawer = Object.assign(Root, { Section, Option });
