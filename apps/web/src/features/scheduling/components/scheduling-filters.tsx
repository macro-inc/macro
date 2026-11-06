import { MobileFilterDrawer } from '@app/components/view-shell/MobileFilterDrawer';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import Funnel from '@icon/system/regular/funnel-simple.svg';
import { Accordion } from '@kobalte/core/accordion';
import { Popover } from '@kobalte/core/popover';
import { Button, ButtonGroup } from '@ui';
import { createSignal, type JSX, Show } from 'solid-js';

export function SchedulingFilters(props: {
  grouped?: boolean;
  title: string;
  activeCount: number;
  onClear: () => void;
  children: JSX.Element;
  mobileChildren: JSX.Element;
}) {
  const [trigger, setTrigger] = createSignal<HTMLButtonElement>();
  const [mobileOpen, setMobileOpen] = createSignal(false);
  const triggerSize = () => {
    if (props.activeCount > 0) return props.grouped ? 'sm' : 'md';
    return props.grouped ? 'icon-sm' : 'icon-md';
  };
  return (
    <Show
      when={isTouchDevice()}
      fallback={
        <Popover placement="bottom-end" gutter={8} modal={false} fitViewport>
          <Popover.Trigger
            aria-label={props.title}
            tooltip={props.title}
            as={props.grouped ? ButtonGroup.Button : Button}
            ref={setTrigger}
            type="button"
            variant="ghost"
            size={triggerSize()}
          >
            <Funnel
              class="size-4 touch:size-6 shrink-0 pointer-events-none"
              aria-hidden="true"
            />
            <Show when={props.activeCount > 0}>
              <span class="flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-xxs font-medium leading-none text-surface">
                {props.activeCount}
              </span>
            </Show>
          </Popover.Trigger>
          <Popover.Portal
            mount={
              trigger()?.closest<HTMLElement>('.portal-scope') ?? undefined
            }
          >
            <Popover.Content class="portal-scope menu-surface z-action-menu w-72 max-w-[min(var(--kb-popper-content-available-width),calc(100vw-1rem))] p-4 outline-none">
              <Popover.Title class="mb-4 text-sm font-medium">
                {props.title}
              </Popover.Title>
              <div class="flex max-h-[calc(var(--kb-popper-content-available-height)-4rem)] min-w-0 flex-col gap-3 overflow-y-auto">
                {props.children}
              </div>
            </Popover.Content>
          </Popover.Portal>
        </Popover>
      }
    >
      <MobileFilterDrawer
        label={props.title}
        activeCount={props.activeCount}
        onClear={props.onClear}
        open={mobileOpen()}
        onOpenChange={setMobileOpen}
      >
        <Accordion
          multiple
          collapsible
          defaultValue={['booking-links']}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || event.defaultPrevented) return;
            // Escape dismisses the drawer, rather than collapsing its sections.
            event.preventDefault();
            event.stopPropagation();
            setMobileOpen(false);
          }}
        >
          <div class="flex flex-col gap-3">{props.mobileChildren}</div>
        </Accordion>
      </MobileFilterDrawer>
    </Show>
  );
}
