import './MobileCreateMenu.css';
import { hapticImpact } from '@core/mobile/haptics';
import { Dialog } from '@kobalte/core/dialog';
import PlusIcon from '@phosphor/plus.svg';
import { Layer } from '@ui/components/Layer';
import {
  type Component,
  createEffect,
  createSignal,
  For,
  type JSX,
  on,
  onCleanup,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { MobileDockIsland } from './MobileDockIsland';

export type MobileCreateMenuItem = {
  label: string;
  icon: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  onSelect: () => void;
  disabled?: boolean;
};

/** Floating create actions that unfold from the mobile New button. */
export function MobileCreateMenu(props: {
  items: readonly MobileCreateMenuItem[];
}) {
  const [open, setOpen] = createSignal(false);
  const [position, setPosition] = createSignal({
    right: 12,
    bottom: 70,
    width: 86,
  });
  let triggerRef!: HTMLButtonElement;
  let selectedAction: (() => void) | undefined;

  const updatePosition = () => {
    const rect = triggerRef.getBoundingClientRect();
    setPosition({
      right: Math.max(12, window.innerWidth - rect.right),
      bottom: Math.max(12, window.innerHeight - rect.bottom),
      width: rect.width,
    });
  };

  createEffect(
    on(open, (isOpen) => {
      if (!isOpen) return;
      // Keep the X over New when rotation or the software keyboard moves the dock.
      window.addEventListener('resize', updatePosition);
      window.visualViewport?.addEventListener('resize', updatePosition);
      onCleanup(() => {
        window.removeEventListener('resize', updatePosition);
        window.visualViewport?.removeEventListener('resize', updatePosition);
      });
    })
  );

  const changeOpen = (next: boolean) => {
    if (next) {
      updatePosition();
      selectedAction = undefined;
    }
    setOpen(next);
  };

  const select = (item: MobileCreateMenuItem) => {
    selectedAction = item.onSelect;
    hapticImpact('light');
    setOpen(false);
  };

  return (
    <Dialog open={open()} onOpenChange={changeOpen} modal>
      <MobileDockIsland class="shrink-0">
        <Dialog.Trigger
          ref={triggerRef}
          aria-label="New"
          onPointerDown={() => hapticImpact('light')}
          class="relative flex h-(--mobile-chrome-button-size) items-center justify-center gap-1.5 rounded-full pl-3 pr-4 text-[15px] font-medium whitespace-nowrap"
        >
          <PlusIcon class="size-5.5 shrink-0" />
          <span>New</span>
        </Dialog.Trigger>
      </MobileDockIsland>
      <Dialog.Portal>
        <Dialog.Overlay class="mobile-create-menu-overlay fixed inset-0 z-modal scrim-glass" />
        <Layer depth={3}>
          <Dialog.Content
            class="mobile-create-menu fixed z-modal flex max-w-[calc(100vw-24px)] flex-col items-end gap-3 outline-none"
            style={{
              right: `${position().right}px`,
              bottom: `${position().bottom}px`,
              'max-height': `calc(100dvh - ${position().bottom}px - var(--safe-top) - 12px)`,
            }}
            onCloseAutoFocus={() => {
              // Let the dialog restore New first, then hand focus to the next
              // composer/menu after its focus trap has been removed.
              const action = selectedAction;
              selectedAction = undefined;
              if (action) queueMicrotask(action);
            }}
          >
            <Dialog.Title class="sr-only">Create new</Dialog.Title>
            <Dialog.Description class="sr-only">
              Choose what to create.
            </Dialog.Description>
            <div class="-m-1 flex min-h-0 flex-col items-end gap-2 overflow-y-auto p-1">
              <For each={props.items}>
                {(item, index) => (
                  <div
                    class="mobile-create-menu-item shrink-0"
                    style={{
                      '--create-rise': `${(props.items.length - index()) * 54 + 4}px`,
                      '--create-delay': `${(props.items.length - index() - 1) * 22}ms`,
                    }}
                  >
                    <MobileDockIsland>
                      <button
                        type="button"
                        disabled={item.disabled}
                        onClick={() => select(item)}
                        class="flex h-(--mobile-chrome-button-size) items-center gap-3 rounded-full px-5 text-base font-medium text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40"
                      >
                        <Dynamic
                          component={item.icon}
                          class="size-5.5 shrink-0"
                        />
                        <span>{item.label}</span>
                      </button>
                    </MobileDockIsland>
                  </div>
                )}
              </For>
            </div>
            <MobileDockIsland class="shrink-0">
              <Dialog.CloseButton
                aria-label="Close create menu"
                style={{ width: `${position().width}px` }}
                onPointerDown={() => hapticImpact('light')}
                class="flex h-(--mobile-chrome-button-size) items-center justify-center gap-1.5 rounded-full pl-3 pr-4 text-[15px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <PlusIcon class="mobile-create-menu-plus size-5.5 shrink-0" />
                <span>New</span>
              </Dialog.CloseButton>
            </MobileDockIsland>
          </Dialog.Content>
        </Layer>
      </Dialog.Portal>
    </Dialog>
  );
}
