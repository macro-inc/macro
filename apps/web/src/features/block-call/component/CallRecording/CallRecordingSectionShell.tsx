import Eye from '@phosphor/eye.svg';
import EyeSlash from '@phosphor/eye-slash.svg';
import UserCircle from '@phosphor/user-circle.svg';
import UserCircleMinus from '@phosphor/user-circle-minus.svg';
import { cn } from '@ui';
import type { JSX } from 'solid-js';
import {
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  Show,
} from 'solid-js';

export function CallRecordingSectionShell(props: {
  title: string;
  icon: JSX.Element;
  children: JSX.Element;
  class?: string;
  open?: boolean;
  accordion?: boolean;
  /** Used only for stacked accordion mode: cap open height as a % of the viewport height. */
  accordionOpenMaxVh?: number;
  onToggle?: () => void;
  toggleIconOpen?: JSX.Element;
  toggleIconClosed?: JSX.Element;
  toggleLabelOpen?: string;
  toggleLabelClosed?: string;
}) {
  const isOpen = () => props.open ?? true;
  const [viewportResizeTick, setViewportResizeTick] = createSignal(0);

  const accordionOpenCapPx = createMemo(() => {
    viewportResizeTick();
    if (!props.accordion) return Number.POSITIVE_INFINITY;
    if (typeof window === 'undefined') return Number.POSITIVE_INFINITY;
    const vh = props.accordionOpenMaxVh ?? 45;
    return Math.max(0, (window.innerHeight * vh) / 100);
  });

  createEffect(() => {
    if (!props.accordion) return;
    const onResize = () => setViewportResizeTick((n) => n + 1);
    window.addEventListener('resize', onResize);
    onCleanup(() => window.removeEventListener('resize', onResize));
  });

  const toggleLabel = () =>
    isOpen()
      ? (props.toggleLabelOpen ?? `Hide ${props.title.toLowerCase()}`)
      : (props.toggleLabelClosed ?? `Show ${props.title.toLowerCase()}`);
  return (
    <div
      class={cn(
        'min-h-0 overflow-hidden border-t border-edge-muted/50',
        props.class,
        props.accordion
          ? 'flex shrink-0 flex-col'
          : 'flex flex-col @[860px]:flex-1',
        !props.accordion && (isOpen() ? 'flex-1' : 'shrink-0')
      )}
    >
      <Show
        when={props.accordion && props.onToggle}
        fallback={
          <div class="isolate flex shrink-0 items-center gap-2 sticky top-0 bg-surface z-10 px-4 py-2 @[860px]:py-4 border-b border-edge-muted/50">
            {props.icon}
            <p class="font-semibold text-ink select-none text-sm shrink-0">
              {props.title}
            </p>
            <Show when={props.onToggle}>
              <button
                type="button"
                class="ml-auto shrink-0 rounded-xs border border-edge-muted/50 px-2 py-1 text-xs font-medium text-ink-muted  hover:bg-hover hover:text-ink flex items-center gap-1.5 transition-colors"
                aria-expanded={props.open}
                aria-label={toggleLabel()}
                title={toggleLabel()}
                onClick={() => props.onToggle?.()}
              >
                <Show
                  when={props.open}
                  fallback={
                    props.toggleIconClosed ?? (
                      <UserCircleMinus class="size-4 shrink-0" />
                    )
                  }
                >
                  {props.toggleIconOpen ?? (
                    <UserCircle class="size-4 shrink-0" />
                  )}
                </Show>
              </button>
            </Show>
          </div>
        }
      >
        <button
          type="button"
          class="isolate sticky top-0 z-10 flex w-full min-w-0 shrink-0  items-center gap-2 border-b border-edge-muted/50 bg-surface px-4 py-2 text-left @[860px]:py-4 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-0"
          aria-expanded={props.open}
          aria-label={toggleLabel()}
          title={toggleLabel()}
          onClick={() => props.onToggle?.()}
        >
          {props.icon}
          <p class="min-w-0 flex-1 font-semibold text-ink select-none text-sm truncate">
            {props.title}
          </p>
          <span class="ml-auto flex shrink-0 items-center text-ink-muted">
            <Show
              when={isOpen()}
              fallback={<EyeSlash class="size-4 shrink-0" />}
            >
              <Eye class="size-4 shrink-0" />
            </Show>
          </span>
        </button>
      </Show>
      <div
        class={cn(
          'min-h-0 overflow-hidden',
          props.accordion
            ? cn(
                'transition-[max-height] duration-300 ease-in-out',
                isOpen() ? '' : 'pointer-events-none'
              )
            : cn(
                'transition-[max-height,transform,opacity] duration-300 ease-out @[860px]:transition-none @[860px]:max-h-none @[860px]:opacity-100 @[860px]:translate-y-0',
                isOpen()
                  ? 'flex min-h-0 flex-1 flex-col max-h-dvh translate-y-0 opacity-100 @[860px]:h-full @[860px]:max-h-none'
                  : 'max-h-0 translate-y-2 opacity-0 pointer-events-none'
              )
        )}
        style={
          props.accordion
            ? {
                'max-height': isOpen() ? `${accordionOpenCapPx()}px` : '0px',
              }
            : undefined
        }
      >
        <div
          class={cn(
            'min-h-0 overflow-hidden',
            props.accordion
              ? 'flex h-full max-h-full flex-1 flex-col'
              : 'flex min-h-0 flex-1 flex-col @[860px]:h-full @[860px]:min-h-0'
          )}
        >
          {props.children}
        </div>
      </div>
    </div>
  );
}
