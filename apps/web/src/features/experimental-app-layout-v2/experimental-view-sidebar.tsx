import { cn } from '@ui';
import { createSignal, type JSX, onCleanup, type ParentProps } from 'solid-js';

const DEFAULT_VIEW_SIDEBAR_WIDTH = 268;
const MIN_VIEW_SIDEBAR_WIDTH = 224;
const MAX_VIEW_SIDEBAR_WIDTH = 360;

const [viewSidebarWidth, setViewSidebarWidth] = createSignal(
  DEFAULT_VIEW_SIDEBAR_WIDTH
);

type ExperimentalViewSidebarProps = {
  label: string;
  children: JSX.Element;
  class?: string;
  collapsed?: boolean;
};

/**
 * Desktop-only navigation belonging to a specific view. Narrow layouts expose
 * the same destinations from the view header instead of using a drawer.
 */
export function ExperimentalViewSidebar(
  props: ExperimentalViewSidebarProps
) {
  const [resizing, setResizing] = createSignal(false);
  let stopResize: (() => void) | undefined;

  const clampWidth = (width: number) =>
    Math.min(MAX_VIEW_SIDEBAR_WIDTH, Math.max(MIN_VIEW_SIDEBAR_WIDTH, width));

  const startResize = (event: PointerEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();

    stopResize?.();
    setResizing(true);

    const startX = event.clientX;
    const startWidth = viewSidebarWidth();
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMove = (moveEvent: PointerEvent) => {
      setViewSidebarWidth(
        clampWidth(startWidth + moveEvent.clientX - startX)
      );
    };

    const finishResize = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', finishResize);
      window.removeEventListener('pointercancel', finishResize);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      setResizing(false);
      if (stopResize === finishResize) stopResize = undefined;
    };

    stopResize = finishResize;
    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', finishResize);
    window.addEventListener('pointercancel', finishResize);
  };

  const resizeWithKeyboard = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 24 : 8;
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setViewSidebarWidth((width) => clampWidth(width - step));
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setViewSidebarWidth((width) => clampWidth(width + step));
    } else if (event.key === 'Home') {
      event.preventDefault();
      setViewSidebarWidth(MIN_VIEW_SIDEBAR_WIDTH);
    } else if (event.key === 'End') {
      event.preventDefault();
      setViewSidebarWidth(MAX_VIEW_SIDEBAR_WIDTH);
    }
  };

  onCleanup(() => stopResize?.());

  return (
    <aside
      aria-label={props.label}
      class={cn(
        'relative mb-2 flex shrink-0 flex-col border-r border-edge px-4 pb-5 pt-4',
        '@max-[720px]/experimental-soup:hidden',
        props.collapsed && 'hidden',
        props.class
      )}
      style={{ width: `${viewSidebarWidth()}px` }}
    >
      {props.children}
      <div
        role="separator"
        aria-label={`Resize ${props.label}`}
        aria-orientation="vertical"
        aria-valuemin={MIN_VIEW_SIDEBAR_WIDTH}
        aria-valuemax={MAX_VIEW_SIDEBAR_WIDTH}
        aria-valuenow={Math.round(viewSidebarWidth())}
        tabIndex={0}
        class={cn(
          'absolute -right-1 inset-y-0 z-10 w-2 cursor-col-resize touch-none outline-none',
          'after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-accent after:opacity-0 after:transition-opacity',
          'hover:after:opacity-100 focus-visible:after:opacity-100',
          resizing() && 'after:opacity-100'
        )}
        onPointerDown={startResize}
        onKeyDown={resizeWithKeyboard}
      />
    </aside>
  );
}

/** Container for an in-view sidebar's navigation destinations. */
export function ExperimentalViewSidebarItems(
  props: ParentProps<{ class?: string }>
) {
  return <div class={props.class}>{props.children}</div>;
}
