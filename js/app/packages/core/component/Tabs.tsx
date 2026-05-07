import {
  SegmentedControl as KSegmentedControl,
  useSegmentedControlContext,
  type SegmentedControlRootProps,
} from '@kobalte/core/segmented-control';
import {
  type JSX,
  batch,
  type ComponentProps,
  createEffect,
  createSignal,
  For,
  on,
  splitProps,
} from 'solid-js';
import { cn } from '@ui';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { isTouchDevice } from '@core/mobile/isTouchDevice';

export type TabItem = {
  value: string;
  label: string | JSX.Element;
};

export const Tabs = (
  props: {
    list: TabItem[];
    value?: string;
    defaultValue?: string;
    indicatorPosition?: 'top' | 'bottom';
    class?: string;
  } & Omit<SegmentedControlRootProps, 'defaultValue'>
) => {
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
                class={cn(
                  'flex items-center px-2 py-1 text-sm font-medium',
                  'text-ink-extra-muted',
                  'data-checked:text-accent hover:text-accent'
                )}
                // We don't want touches on touch to unfocus inputs
                onPointerDown={(e) => {
                  if (isTouchDevice()) e.preventDefault();
                }}
                onClick={() => {
                  rootProps.onChange?.(item.value);
                }}
              >
                {item.label}
              </KSegmentedControl.ItemLabel>
            </KSegmentedControl.Item>
          )}
        </For>
        <Indicator
          data-indicator
          class={cn(
            'absolute h-[2px]! bg-accent transition-[transform,width] duration-150 pointer-events-none',
            (local.indicatorPosition ?? 'bottom') === 'top'
              ? 'top-0'
              : 'bottom-0'
          )}
        />
      </div>
    </KSegmentedControl>
  );
};

// This is based off of the KSegmentedControl.Indicator but removes the
// height and Y translation styles
const Indicator = (props: ComponentProps<'div'>) => {
  const context = useSegmentedControlContext();

  const [style, setStyle] = createSignal<JSX.CSSProperties>();
  const [resizing, setResizing] = createSignal(false);

  const computeTransform = (element: HTMLElement): string | undefined => {
    const x = element.offsetLeft;

    return `translateX(${x}px)`;
  };

  const computeStyle = () => {
    const element = context.selectedItem();

    if (!element) {
      setStyle(undefined);
      return;
    }

    setStyle({
      width: `${element.offsetWidth}px`,
      transform: computeTransform(element),
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
