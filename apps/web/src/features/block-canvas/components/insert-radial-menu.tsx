import ImageIcon from '@phosphor/image.svg';
import LinkIcon from '@phosphor/link.svg';
import UploadIcon from '@phosphor/upload-simple.svg';
import {
  ctrlJKMenuNavigation,
  wrapIndex,
} from '@ui/utils/menuKeyboardNavigation';
import { createSignal, For } from 'solid-js';
import { radialSliceAtPoint } from '../core/insert';

false && ctrlJKMenuNavigation;

export function CanvasInsertRadialMenu(props: {
  center: { x: number; y: number };
  onMedia: () => void;
  onUpload: () => void;
  onReference: () => void;
}) {
  const choices = [
    {
      label: 'Media',
      icon: ImageIcon,
      action: props.onMedia,
      position: 'left-1/2 top-4 -translate-x-1/2',
    },
    {
      label: 'Upload media',
      icon: UploadIcon,
      action: props.onUpload,
      position: 'right-0 top-40',
    },
    {
      label: 'Reference',
      icon: LinkIcon,
      action: props.onReference,
      position: 'left-0 top-40',
    },
  ];
  const [index, setIndex] = createSignal(0);
  const [active, setActive] = createSignal<number | undefined>(0);
  const sliceAngle = 360 / choices.length;
  const ringLength = 2 * Math.PI * 16;
  const sliceAt = (event: PointerEvent | MouseEvent, element: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return radialSliceAtPoint(
      event.clientX - rect.left - rect.width / 2,
      event.clientY - rect.top - rect.height / 2,
      choices.length
    );
  };
  const buttons: HTMLButtonElement[] = [];
  let menu!: HTMLDivElement;
  return (
    <div
      class="relative h-dvh w-screen"
      on:pointermove={(event) => {
        const next = sliceAt(event, menu);
        setActive(next);
        if (next !== undefined) {
          setIndex(next);
          buttons[next]?.focus({ preventScroll: true });
        }
      }}
      on:pointerdown={(event) => {
        if (!(event.target as Element).closest('button'))
          event.preventDefault();
      }}
      onClick={(event) => {
        if ((event.target as Element).closest('button')) return;
        const next = active();
        if (next !== undefined) choices[next].action();
      }}
    >
      <div
        ref={menu}
        role="menu"
        aria-label="Insert"
        class="absolute h-64 w-80 max-w-[calc(100vw-1rem)]"
        style={{
          left: `clamp(8px, ${props.center.x - 160}px, calc(100vw - 328px))`,
          top: `clamp(8px, ${props.center.y - 128}px, calc(100dvh - 264px))`,
        }}
        use:ctrlJKMenuNavigation={{ macOnly: false }}
        on:keydown={(event) => {
          if (event.isComposing) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            const selected = active();
            if (selected !== undefined) choices[selected].action();
            return;
          }
          const delta =
            event.key === 'ArrowDown' || event.key === 'ArrowRight'
              ? 1
              : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
                ? -1
                : 0;
          if (!delta && event.key !== 'Home' && event.key !== 'End') return;
          event.preventDefault();
          event.stopPropagation();
          const next =
            event.key === 'Home'
              ? 0
              : event.key === 'End'
                ? choices.length - 1
                : wrapIndex(index(), choices.length, delta);
          buttons[next]?.focus();
        }}
      >
        <For each={choices}>
          {(choice, itemIndex) => (
            <button
              ref={(el) => {
                buttons[itemIndex()] = el;
              }}
              type="button"
              role="menuitem"
              aria-label={choice.label}
              tabIndex={index() === itemIndex() ? 0 : -1}
              data-highlighted={active() === itemIndex() ? '' : undefined}
              onFocus={() => {
                setIndex(itemIndex());
                setActive(itemIndex());
              }}
              onClick={choice.action}
              class={`menu-surface absolute flex h-10 w-36 items-center gap-2 rounded-md px-3 text-sm outline-none data-highlighted:bg-[linear-gradient(var(--color-hover),var(--color-hover))] data-highlighted:ring-1 data-highlighted:ring-edge-focus ${choice.position}`}
            >
              <choice.icon class="size-4 shrink-0" />
              {choice.label}
            </button>
          )}
        </For>
        <div
          aria-hidden="true"
          class="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        >
          <span class="absolute bottom-full left-1/2 mb-2 -translate-x-1/2 text-xs text-ink-muted">
            Insert
          </span>
          <svg class="size-10" viewBox="0 0 40 40" fill="none">
            <For each={choices}>
              {(_, slice) => (
                <circle
                  cx="20"
                  cy="20"
                  r="16"
                  stroke="currentColor"
                  stroke-width="4"
                  stroke-dasharray={`${ringLength / choices.length - 3} ${ringLength - ringLength / choices.length + 3}`}
                  transform={`rotate(${-90 - sliceAngle / 2 + sliceAngle * slice() + (3 / ringLength) * 180} 20 20)`}
                  class={
                    active() === slice() ? 'text-accent' : 'text-edge-muted'
                  }
                  data-active={active() === slice() ? '' : undefined}
                />
              )}
            </For>
          </svg>
        </div>
      </div>
    </div>
  );
}
