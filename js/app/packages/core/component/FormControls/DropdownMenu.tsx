import { Popover, type PopoverRootProps } from '@kobalte/core/popover';
import { createMutationObserver } from '@solid-primitives/mutation-observer';
import { Button } from '@ui';
import {
  type ComponentProps,
  createEffect,
  createSignal,
  type JSX,
  type JSXElement,
  type ParentComponent,
  Show,
} from 'solid-js';

type ShadowTheme = 'Base' | 'AccentSpread';

const DropdownMenu: ParentComponent<
  {
    size?: ComponentProps<typeof Button>['size'];
    shadowTheme?: ShadowTheme;
    dropdownCutout?: number;
    shadowAccent?: boolean;
    onClick?: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
    onMouseDown?: JSX.EventHandler<HTMLButtonElement, MouseEvent>;
    disabled?: boolean;
    triggerLabel: JSXElement | string;
    ref?: (ref: HTMLButtonElement) => void | HTMLButtonElement;
  } & PopoverRootProps
> = (props) => {
  const [open, setOpen] = createSignal(props.open ?? false);
  const [triggerSize, setTriggerSize] = createSignal({ width: 0, height: 0 });
  const [popoverPosition, setPopoverPosition] = createSignal<
    'top-left' | 'top-right'
  >('top-left');
  const [popoverPortalEl, setPopoverPortalEl] =
    createSignal<HTMLDivElement | null>(null);
  let popoverContentEl!: HTMLDivElement;
  let popoverBorderEl!: HTMLDivElement;
  let triggerEl!: HTMLButtonElement;

  createEffect(() => {
    if (props.open !== undefined) {
      setOpen(props.open);
    }
  });

  const [observe, { start, stop }] = createMutationObserver(
    [],
    { attributes: true, subtree: false },
    (records) => {
      records.forEach((record) => {
        if (record.attributeName !== 'style') return;

        const placement = getComputedStyle(record.target as HTMLElement)
          .getPropertyValue('--kb-popper-content-transform-origin')
          .replace(' ', '-') as 'top-left';
        const triggerRect = triggerEl.getBoundingClientRect();
        setTriggerSize({
          height: triggerRect.height,
          width: triggerRect.width,
        });
        if (placement) setPopoverPosition(placement);
      });
    }
  );

  const onOpenChange = (isOpen: boolean) => {
    if (props.open === undefined) {
      setOpen(isOpen);
    }
    props.onOpenChange?.(isOpen);
  };

  createEffect(() => {
    const _popoverPortalEl = popoverPortalEl()?.firstChild;
    if (!_popoverPortalEl) {
      stop();
      return;
    }

    start();
    observe(_popoverPortalEl);
  });

  return (
    <Popover
      modal
      open={open()}
      onOpenChange={onOpenChange}
      arrowPadding={0}
      placement="bottom-start"
      gutter={0}
      overflowPadding={0}
    >
      <Popover.Trigger
        size={props.size ?? 'md'}
        variant={open() ? 'active' : 'base'}
        classList={{
          'block!': true,
        }}
        as={Button}
        ref={triggerEl}
      >
        {props.triggerLabel}
      </Popover.Trigger>
      <Popover.Portal ref={setPopoverPortalEl}>
        <Popover.Content ref={popoverContentEl}>
          <div class="pointer-events-none">
            <Show when={props.shadowTheme === 'AccentSpread'}>
              <div class="absolute flex -inset-1">
                <div class="h-full grow bg-accent/20"></div>
                <div
                  class="shrink-0 self-end bottom-0 h-1 bg-accent/20"
                  style={{
                    width: `${triggerSize().width}px`,
                  }}
                ></div>
                <div
                  class="self-end w-1 bg-accent/20"
                  style={{
                    height: `calc(100% + ${triggerSize().height - 8}px)`,
                  }}
                ></div>
              </div>
            </Show>
            <Show
              when={props.shadowTheme === 'Base' || props.shadowTheme == null}
            >
              <div
                class="absolute bg-surface"
                style={{
                  width: `calc(100% - ${triggerSize().width - (props.dropdownCutout ?? 2)}px)`,
                  '--dropdown-cutout': `${props.dropdownCutout ?? 4}px`,
                }}
                classList={{
                  '-inset-(--dropdown-cutout)':
                    popoverPosition() === 'top-right',
                  '-right-(--dropdown-cutout) -inset-y-(--dropdown-cutout)':
                    popoverPosition() === 'top-left',
                }}
              />
              <div
                class="absolute bg-ink/20 size-full left-1 top-1"
                classList={{
                  '-translate-x-2': popoverPosition() === 'top-left',
                }}
              >
                <div
                  class="absolute bg-ink/20 left-0 inset-y-0 w-1"
                  classList={{
                    'left-0': popoverPosition() === 'top-left',
                    'right-0': popoverPosition() === 'top-right',
                  }}
                  style={{
                    height: `${triggerSize().height}px`,
                    transform: `translateY(${-triggerSize().height}px)`,
                  }}
                />
              </div>
            </Show>
          </div>
          <div
            class="relative bg-surface"
            classList={{
              'border-accent border-2': props.shadowAccent ?? true,
            }}
            ref={popoverBorderEl}
          >
            {props.children}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover>
  );
};

export default DropdownMenu;
