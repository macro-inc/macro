import CaretDownIcon from '@phosphor/caret-down.svg';
import { cn } from '@ui';
import { createSignal, For, type JSX, onCleanup, Show } from 'solid-js';

export type CollapsibleSidebarSectionItem = {
  id: string;
  visible: () => JSX.Element;
  dropdown: () => JSX.Element;
};

export function CollapsibleSidebarSection(props: {
  label: string;
  items: readonly CollapsibleSidebarSectionItem[];
  headerMenu?: () => JSX.Element;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = createSignal(props.defaultOpen ?? true);
  let openChangeTimer: ReturnType<typeof setTimeout> | undefined;

  onCleanup(() => {
    if (openChangeTimer !== undefined) clearTimeout(openChangeTimer);
  });

  const toggleOpen = () => {
    const next = !open();
    setOpen(next);
    props.onOpenChange?.(next);
    if (openChangeTimer !== undefined) clearTimeout(openChangeTimer);
    openChangeTimer = setTimeout(() => {
      openChangeTimer = undefined;
      props.onOpenChange?.(next);
    }, 130);
  };

  return (
    <section class="w-full flex flex-col">
      <header class="group/section relative">
        <button
          type="button"
          class="flex h-7 w-full min-w-0 items-center justify-start gap-1 rounded-md px-2 pr-9 text-left text-[13px] font-medium text-ink-extra-muted/60 transition-colors group-hover/section:bg-ink/3 group-hover/section:text-ink-muted"
          aria-expanded={open()}
          onClick={toggleOpen}
        >
          <span class="min-w-0 truncate">{props.label}</span>
          <CaretDownIcon
            class={cn(
              'size-3 shrink-0 transition-transform duration-[120ms] ease-in-out',
              !open() && '-rotate-90'
            )}
          />
        </button>
        <Show when={props.headerMenu}>
          {(headerMenu) => (
            <div class="absolute right-1 top-1/2 -translate-y-1/2 flex items-center">
              {headerMenu()()}
            </div>
          )}
        </Show>
      </header>
      <div
        class={cn('grid overflow-hidden', !open() && 'pointer-events-none')}
        aria-hidden={!open()}
        style={{
          'grid-template-rows': open() ? '1fr' : '0fr',
          'margin-top': open() ? '0.125rem' : '0',
          opacity: open() ? '1' : '0',
          visibility: open() ? 'visible' : 'hidden',
          transition: open()
            ? 'grid-template-rows 120ms ease-in-out, margin-top 120ms ease-in-out, opacity 120ms ease-in-out, visibility 0ms linear 0ms'
            : 'grid-template-rows 120ms ease-in-out, margin-top 120ms ease-in-out, opacity 120ms ease-in-out, visibility 0ms linear 120ms',
        }}
      >
        <div class="min-h-0 overflow-hidden flex flex-col gap-0.5">
          <For each={props.items}>
            {(item) => <div class="w-full">{item.visible()}</div>}
          </For>
        </div>
      </div>
    </section>
  );
}
