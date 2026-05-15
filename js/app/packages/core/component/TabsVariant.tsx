import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  SegmentedControl as KSegmentedControl,
  type SegmentedControlRootProps,
  useSegmentedControlContext,
} from '@kobalte/core/segmented-control';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { cn, Layer } from '@ui';
import {
  batch,
  type ComponentProps,
  createEffect,
  createSignal,
  For,
  type JSX,
  Match,
  on,
  Switch,
  splitProps,
} from 'solid-js';

// ============================================================================
// Types
// ============================================================================

export type TabItem = {
  value: string;
  label: string | JSX.Element;
};

export type TabsVariantType =
  | 'accent-line'
  | 'accent-bg'
  | 'inset'
  | 'inset-rounded'
  | 'linear';

export type TabsVariantProps = {
  list: TabItem[];
  value?: string;
  defaultValue?: string;
  indicatorPosition?: 'top' | 'bottom';
  class?: string;
  variant?: TabsVariantType;
} & Omit<SegmentedControlRootProps, 'defaultValue'>;

// ============================================================================
// Router Component
// ============================================================================

export const TabsVariant = (props: TabsVariantProps) => {
  const variant = () => props.variant ?? 'accent-line';

  return (
    <Switch>
      <Match when={variant() === 'accent-line'}>
        <TabsAccentLine {...props} />
      </Match>
      <Match when={variant() === 'accent-bg'}>
        <TabsAccentBg {...props} />
      </Match>
      <Match when={variant() === 'inset'}>
        <TabsInset {...props} />
      </Match>
      <Match when={variant() === 'inset-rounded'}>
        <TabsInsetRounded {...props} />
      </Match>
      <Match when={variant() === 'linear'}>
        <TabsLinear {...props} />
      </Match>
    </Switch>
  );
};

// ============================================================================
// Variant 1: Accent Line (same as original Tabs)
// ============================================================================

export const TabsAccentLine = (props: Omit<TabsVariantProps, 'variant'>) => {
  const [local, rootProps] = splitProps(props, [
    'list',
    'value',
    'defaultValue',
    'disabled',
    'indicatorPosition',
    'class',
  ]);

  return (
    <KSegmentedControl
      value={local.value}
      defaultValue={local.defaultValue ?? local.list[0]?.value}
      disabled={local.disabled}
      {...rootProps}
      class={cn('h-full', local.class)}
    >
      <div class="relative flex items-center h-full">
        <For each={local.list}>
          {(item) => (
            <KSegmentedControl.Item
              value={item.value}
              disabled={local.disabled}
            >
              <KSegmentedControl.ItemInput class="absolute inset-0 pointer-events-none" />
              <KSegmentedControl.ItemLabel
                class="flex items-center px-2 py-1 text-sm font-medium text-ink-extra-muted data-checked:text-accent hover:text-accent transition-colors duration-150"
                onPointerDown={(e) => {
                  if (isTouchDevice()) e.preventDefault();
                }}
                onClick={() => rootProps.onChange?.(item.value)}
              >
                {item.label}
              </KSegmentedControl.ItemLabel>
            </KSegmentedControl.Item>
          )}
        </For>
        <LineIndicator
          class={cn(
            'absolute h-0.5! bg-accent transition-[transform,width] duration-150 pointer-events-none',
            (local.indicatorPosition ?? 'bottom') === 'top'
              ? 'top-0'
              : 'bottom-0'
          )}
        />
      </div>
    </KSegmentedControl>
  );
};

// ============================================================================
// Variant 2: Accent Background
// ============================================================================

export const TabsAccentBg = (props: Omit<TabsVariantProps, 'variant'>) => {
  const [local, rootProps] = splitProps(props, [
    'list',
    'value',
    'defaultValue',
    'disabled',
    'class',
  ]);

  return (
    <KSegmentedControl
      value={local.value}
      defaultValue={local.defaultValue ?? local.list[0]?.value}
      disabled={local.disabled}
      {...rootProps}
      class={cn('h-full', local.class)}
    >
      <div class="relative flex items-center h-full isolate">
        <BgIndicator class="absolute inset-y-1 bg-accent/20 rounded-sm transition-[transform,width] duration-150 pointer-events-none z-0" />
        <For each={local.list}>
          {(item) => (
            <KSegmentedControl.Item
              value={item.value}
              disabled={local.disabled}
              class="z-10"
            >
              <KSegmentedControl.ItemInput class="absolute inset-0 pointer-events-none" />
              <KSegmentedControl.ItemLabel
                class="flex items-center px-2 py-1 text-sm font-medium text-ink-extra-muted data-checked:text-accent hover:text-accent transition-colors duration-150"
                onPointerDown={(e) => {
                  if (isTouchDevice()) e.preventDefault();
                }}
                onClick={() => rootProps.onChange?.(item.value)}
              >
                {item.label}
              </KSegmentedControl.ItemLabel>
            </KSegmentedControl.Item>
          )}
        </For>
      </div>
    </KSegmentedControl>
  );
};

// ============================================================================
// Variant 3: Inset Style
// ============================================================================

export const TabsInset = (props: Omit<TabsVariantProps, 'variant'>) => {
  const [local, rootProps] = splitProps(props, [
    'list',
    'value',
    'defaultValue',
    'disabled',
    'class',
  ]);

  return (
    <KSegmentedControl
      value={local.value}
      defaultValue={local.defaultValue ?? local.list[0]?.value}
      disabled={local.disabled}
      {...rootProps}
      class={cn('h-full flex items-center', local.class)}
    >
      <Layer depth={0}>
        <div class="relative flex items-center bg-surface rounded-lg p-0.5 ring ring-edge-muted">
          <For each={local.list}>
            {(item) => (
              <Layer depth={2}>
                <KSegmentedControl.Item
                  value={item.value}
                  disabled={local.disabled}
                >
                  <KSegmentedControl.ItemInput class="absolute inset-0 pointer-events-none" />
                  <KSegmentedControl.ItemLabel
                    class="flex items-center px-2 py-1 text-xs font-medium data-checked:ring data-checked:ring-edge-muted ring-inset rounded-md text-ink-extra-muted hover:text-ink data-checked:bg-surface data-checked:text-ink data-checked:shadow-sm"
                    onPointerDown={(e) => {
                      if (isTouchDevice()) e.preventDefault();
                    }}
                    onClick={() => rootProps.onChange?.(item.value)}
                  >
                    {item.label}
                  </KSegmentedControl.ItemLabel>
                </KSegmentedControl.Item>
              </Layer>
            )}
          </For>
        </div>
      </Layer>
    </KSegmentedControl>
  );
};

// ============================================================================
// Variant 4: Inset Rounded
// ============================================================================

export const TabsInsetRounded = (props: Omit<TabsVariantProps, 'variant'>) => {
  const [local, rootProps] = splitProps(props, [
    'list',
    'value',
    'defaultValue',
    'disabled',
    'class',
  ]);

  return (
    <KSegmentedControl
      value={local.value}
      defaultValue={local.defaultValue ?? local.list[0]?.value}
      disabled={local.disabled}
      {...rootProps}
      class={cn('h-full', local.class)}
    >
      <Layer depth={0}>
        <div class="relative flex items-center h-full bg-active rounded-full p-1">
          <For each={local.list}>
            {(item) => (
              <Layer depth={3}>
                <KSegmentedControl.Item
                  value={item.value}
                  disabled={local.disabled}
                >
                  <KSegmentedControl.ItemInput class="absolute inset-0 pointer-events-none" />
                  <KSegmentedControl.ItemLabel
                    class="flex items-center px-2 py-1 text-sm font-medium rounded-full text-ink-muted hover:text-ink data-checked:bg-surface data-checked:text-ink data-checked:shadow-sm transition-colors duration-150"
                    onPointerDown={(e) => {
                      if (isTouchDevice()) e.preventDefault();
                    }}
                    onClick={() => rootProps.onChange?.(item.value)}
                  >
                    {item.label}
                  </KSegmentedControl.ItemLabel>
                </KSegmentedControl.Item>
              </Layer>
            )}
          </For>
        </div>
      </Layer>
    </KSegmentedControl>
  );
};

// ============================================================================
// Variant 5: Linear Style
// ============================================================================

export const TabsLinear = (props: Omit<TabsVariantProps, 'variant'>) => {
  const [local, rootProps] = splitProps(props, [
    'list',
    'value',
    'defaultValue',
    'disabled',
    'class',
  ]);

  return (
    <KSegmentedControl
      value={local.value}
      defaultValue={local.defaultValue ?? local.list[0]?.value}
      disabled={local.disabled}
      {...rootProps}
      class={cn('h-full', local.class)}
    >
      <div class="relative flex items-center h-full gap-1">
        <For each={local.list}>
          {(item) => (
            <KSegmentedControl.Item
              value={item.value}
              disabled={local.disabled}
            >
              <KSegmentedControl.ItemInput class="absolute inset-0 pointer-events-none" />
              <KSegmentedControl.ItemLabel
                class="flex items-center px-2 py-1 text-sm font-medium rounded-full text-ink-extra-muted ring ring-edge-muted hover:text-ink-extra-muted hover:bg-hover data-checked:bg-ink data-checked:text-surface transition-colors duration-150"
                onPointerDown={(e) => {
                  if (isTouchDevice()) e.preventDefault();
                }}
                onClick={() => rootProps.onChange?.(item.value)}
              >
                {item.label}
              </KSegmentedControl.ItemLabel>
            </KSegmentedControl.Item>
          )}
        </For>
      </div>
    </KSegmentedControl>
  );
};

// ============================================================================
// Shared Indicator Components
// ============================================================================

const LineIndicator = (props: ComponentProps<'div'>) => {
  const context = useSegmentedControlContext();

  const [style, setStyle] = createSignal<JSX.CSSProperties>();
  const [resizing, setResizing] = createSignal(false);

  const computeStyle = () => {
    const element = context.selectedItem();
    if (!element) {
      setStyle(undefined);
      return;
    }
    setStyle({
      width: `${element.offsetWidth}px`,
      transform: `translateX(${element.offsetLeft}px)`,
      'transition-duration': resizing() ? '0ms' : undefined,
    });
  };

  createEffect(
    on(context.selectedItem, () => {
      setResizing(!style());
      computeStyle();
      setResizing(false);
    })
  );

  createResizeObserver(context.root, () => {
    batch(() => {
      setResizing(true);
      computeStyle();
      setResizing(false);
    });
  });

  return (
    <div
      role="presentation"
      style={style()}
      data-resizing={resizing()}
      data-orientation={context.orientation()}
      {...props}
    />
  );
};

const BgIndicator = (props: ComponentProps<'div'>) => {
  const context = useSegmentedControlContext();

  const [style, setStyle] = createSignal<JSX.CSSProperties>();
  const [resizing, setResizing] = createSignal(false);

  const computeStyle = () => {
    const element = context.selectedItem();
    if (!element) {
      setStyle(undefined);
      return;
    }
    setStyle({
      width: `${element.offsetWidth}px`,
      transform: `translateX(${element.offsetLeft}px)`,
      'transition-duration': resizing() ? '0ms' : undefined,
    });
  };

  createEffect(
    on(context.selectedItem, () => {
      setResizing(!style());
      computeStyle();
      setResizing(false);
    })
  );

  createResizeObserver(context.root, () => {
    batch(() => {
      setResizing(true);
      computeStyle();
      setResizing(false);
    });
  });

  return (
    <div
      role="presentation"
      style={style()}
      data-resizing={resizing()}
      data-orientation={context.orientation()}
      {...props}
    />
  );
};
