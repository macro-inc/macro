import type { HotkeyToken } from '@core/hotkey/tokens';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { PolymorphicProps } from '@kobalte/core/polymorphic';
import {
  Tooltip as KobalteTooltip,
  type TooltipTriggerProps as KobalteTooltipTriggerProps,
} from '@kobalte/core/tooltip';
import {
  type Accessor,
  type ComponentProps,
  createContext,
  createSignal,
  For,
  onCleanup,
  type ParentProps,
  Show,
  splitProps,
  useContext,
  type ValidComponent,
} from 'solid-js';
import { tooltipsEnabled } from '../signals/signals';
import { cn } from '../utils/classname';
import { Hotkey } from './Hotkey';
import { Surface } from './Surface';

export type TooltipClassOptions = {
  class?: string;
};

/** Canonical classes for tooltip content and tooltip-like static hints. */
export function tooltipClasses(options: TooltipClassOptions = {}): string {
  return cn(
    'flex items-center justify-center rounded-lg bg-tooltip p-2 text-xs text-ink-muted wrap-break-word',
    options.class
  );
}

const TooltipContext = createContext<{
  visible: Accessor<boolean>;
  close: () => void;
}>();

type TooltipRootProps = ComponentProps<typeof KobalteTooltip>;

function TooltipRoot(props: TooltipRootProps) {
  const [local, rest] = splitProps(props, [
    'children',
    'disabled',
    'open',
    'defaultOpen',
    'onOpenChange',
  ]);
  const [open, setOpen] = createSignal(local.defaultOpen ?? false);
  const enabled = () =>
    import.meta.env.MODE !== 'test' &&
    !local.disabled &&
    !isTouchDevice() &&
    tooltipsEnabled();
  const visible = () => enabled() && (local.open ?? open());
  const changeOpen = (value: boolean) => {
    const next = value && enabled();
    setOpen(next);
    local.onOpenChange?.(next);
  };

  return (
    <TooltipContext.Provider
      value={{ visible, close: () => changeOpen(false) }}
    >
      <KobalteTooltip
        placement="bottom"
        ignoreSafeArea
        overflowPadding={16}
        fitViewport
        hideWhenDetached
        openDelay={400}
        closeDelay={0}
        flip
        gutter={4}
        {...rest}
        open={visible()}
        onOpenChange={changeOpen}
        disabled={!enabled()}
      >
        {local.children}
      </KobalteTooltip>
    </TooltipContext.Provider>
  );
}

function TooltipTrigger<T extends ValidComponent = 'button'>(
  props: PolymorphicProps<T, KobalteTooltipTriggerProps<T>>
) {
  const context = useContext(TooltipContext);
  // A removed trigger retires its popup through Solid's lifecycle, not a
  // document-wide observer. Disposing the root also disposes its portal.
  onCleanup(() => context?.close());
  return <KobalteTooltip.Trigger<T> {...props} />;
}

function TooltipContent(props: ComponentProps<typeof KobalteTooltip.Content>) {
  const context = useContext(TooltipContext);
  const [local, rest] = splitProps(props, ['class', 'children']);
  return (
    <Show when={context?.visible()}>
      <KobalteTooltip.Content
        {...rest}
        class={cn(
          // Kobalte mutates inline pointer-events as its layer stack changes.
          'pointer-events-none! z-tool-tip max-w-[calc(100vw-32px)]',
          local.class
        )}
      >
        <Surface class={tooltipClasses()} depth={3}>
          {local.children}
        </Surface>
      </KobalteTooltip.Content>
    </Show>
  );
}

type TooltipProps = ParentProps<{
  hotkey?: HotkeyToken | HotkeyToken[];
  /** Raw shortcuts for actions without a registered HotkeyToken. */
  shortcut?: string | string[];
  placement?: TooltipRootProps['placement'];
  as?: 'div' | 'span';
  class?: string;
  label: string;
  /** Allows a non-interactive target to receive keyboard focus. */
  tabIndex?: number;
  disabled?: boolean;
  open?: boolean;
}>;

/** Assembled tooltip; use the compound parts to keep a control as the trigger. */
function TooltipComponent(props: TooltipProps) {
  if (import.meta.env.MODE === 'test') return <>{props.children}</>;

  const tokens = () => {
    const value = props.hotkey;
    return value == null ? [] : Array.isArray(value) ? value : [value];
  };
  const shortcuts = () => {
    const value = props.shortcut;
    return value == null ? [] : Array.isArray(value) ? value : [value];
  };

  return (
    <TooltipRoot
      disabled={props.disabled}
      open={props.open}
      placement={props.placement}
    >
      <TooltipTrigger
        class={cn('inline-flex items-center', props.class)}
        tabIndex={props.tabIndex}
        as={props.as ?? 'div'}
      >
        {props.children}
      </TooltipTrigger>
      <KobalteTooltip.Portal>
        <TooltipContent>
          <div class="flex items-center gap-2">
            <div class="text-xs">{props.label}</div>
            <Show when={tokens().length > 0 || shortcuts().length > 0}>
              <div class="ml-auto flex items-center gap-1">
                <For each={tokens()}>
                  {(token, index) => (
                    <>
                      <Hotkey token={token} theme="subtle" />
                      <Show when={index() < tokens().length - 1}>
                        <span class="text-ink-extra-muted">then</span>
                      </Show>
                    </>
                  )}
                </For>
                <For each={shortcuts()}>
                  {(shortcut, index) => (
                    <>
                      <Hotkey shortcut={shortcut} theme="subtle" />
                      <Show when={index() < shortcuts().length - 1}>
                        <span class="text-ink-extra-muted">then</span>
                      </Show>
                    </>
                  )}
                </For>
              </div>
            </Show>
          </div>
        </TooltipContent>
      </KobalteTooltip.Portal>
    </TooltipRoot>
  );
}

export const Tooltip = Object.assign(TooltipComponent, {
  Root: TooltipRoot,
  Trigger: TooltipTrigger,
  Portal: KobalteTooltip.Portal,
  Content: TooltipContent,
});
