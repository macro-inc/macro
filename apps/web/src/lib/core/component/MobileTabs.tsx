import { cn } from '@ui';
import { createEffect } from 'solid-js';
import { type TabItem, Tabs } from './Tabs';

/**
 * Horizontally-scrollable tab bar for narrow/mobile layouts: the base {@link Tabs}
 * with a thin top indicator that keeps the active tab scrolled into view. Generic
 * and domain-free — wire it to whatever `list`/`value`/`onChange` you need.
 */
export const MobileTabs = (props: {
  list: TabItem[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  class?: string;
}) => {
  let wrapperRef: HTMLDivElement | undefined;

  // Keep the active tab scrolled into view as the selection or list changes.
  createEffect(() => {
    props.value;
    props.list;
    if (!wrapperRef) return;
    queueMicrotask(() => {
      const scrollEl = wrapperRef?.firstElementChild as HTMLElement | null;
      const active = scrollEl?.querySelector(
        '[data-checked]'
      ) as HTMLElement | null;
      if (!scrollEl || !active) return;
      const itemLeft = active.offsetLeft;
      const itemRight = itemLeft + active.offsetWidth;
      const viewRight = scrollEl.scrollLeft + scrollEl.clientWidth;
      if (itemLeft < scrollEl.scrollLeft) {
        scrollEl.scrollTo({ left: itemLeft, behavior: 'smooth' });
      } else if (itemRight > viewRight) {
        scrollEl.scrollTo({
          left: itemRight - scrollEl.clientWidth,
          behavior: 'smooth',
        });
      }
    });
  });

  return (
    <div ref={wrapperRef} class="h-full">
      <Tabs
        list={props.list}
        value={props.value}
        defaultValue={props.defaultValue}
        onChange={props.onChange}
        indicatorPosition="top"
        class={cn(
          '**:data-indicator:h-0.75 overflow-x-auto scrollbar-hidden [&>div]:w-max',
          props.class
        )}
      />
    </div>
  );
};
