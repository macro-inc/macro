import MacroJump from '@app/component/MacroJump';
import { useSplitPanel } from '@app/component/split-layout/layoutUtils';
import { Popover, type PopoverRootProps } from '@kobalte/core/popover';
import { createMutationObserver } from '@solid-primitives/mutation-observer';
import {
  createEffect,
  createSignal,
  type JSX,
  type JSXElement,
  type ParentComponent,
  Show,
} from 'solid-js';
import { Button } from './Button';

type Size = 'SM' | 'Base';
type Theme = 'primary' | 'secondary';
type ShadowTheme = 'Base' | 'AccentSpread';

const DropdownMenu: ParentComponent<
  {
    size?: Size;
    theme?: Theme;
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
  const panelRef = useSplitPanel()?.panelRef;
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
      layoutPosition
      open={open()}
      onOpenChange={onOpenChange}
      arrowPadding={0}
      placement="bottom-start"
      gutter={0}
      overflowPadding={0}
      boundary={props.boundary ?? panelRef}
    >
      <Popover.Trigger
        size={props.size}
        active={open()}
        classList={{
          '!block': true,
        }}
        as={Button}
        theme={props.theme}
        ref={triggerEl}
      >
        {props.triggerLabel}
      </Popover.Trigger>
      <Popover.Portal ref={setPopoverPortalEl}>
        <Popover.Content ref={popoverContentEl}>
          <div class="pointer-events-none">
            <Show when={props.shadowTheme === 'AccentSpread'}>
              <div class="absolute flex inset-[-4px] ">
                <div class="h-full grow bg-accent/20"></div>
                <div
                  class="shrink-0 self-end bottom-0 h-[4px] bg-accent/20"
                  style={{
                    width: `${triggerSize().width}px`,
                  }}
                ></div>
                <div
                  class="self-end w-[4px] bg-accent/20"
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
                class="absolute bg-panel"
                style={{
                  width: `calc(100% - ${triggerSize().width - (props.dropdownCutout ?? 2)}px)`,
                  '--dropdown-cutout': `${props.dropdownCutout ?? 4}px`,
                }}
                classList={{
                  '-left-[var(--dropdown-cutout)] -right-[var(--dropdown-cutout)] -top-[var(--dropdown-cutout)] -bottom-[var(--dropdown-cutout)]':
                    popoverPosition() === 'top-right',
                  '-right-[var(--dropdown-cutout)] -top-[var(--dropdown-cutout)] -bottom-[var(--dropdown-cutout)]':
                    popoverPosition() === 'top-left',
                }}
              />
              <div
                class="absolute bg-ink/20 w-full h-full left-[4px] top-[4px]"
                classList={{
                  'translate-x-[-8px]': popoverPosition() === 'top-left',
                }}
              >
                <div
                  class="absolute bg-ink/20 left-0 top-0 w-[4px] bottom-0"
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
            class="relative bg-panel"
            classList={{
              'border-accent border-[2px]': props.shadowAccent ?? true,
            }}
            ref={popoverBorderEl}
          >
            {props.children}
          </div>
        </Popover.Content>
        <MacroJump tabbableParent={() => popoverContentEl} />
      </Popover.Portal>
    </Popover>
  );
};

export default DropdownMenu;
