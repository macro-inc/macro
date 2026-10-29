import { useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import ArrowsIn from '@icon/system/regular/arrows-in-simple.svg';
import ArrowsOut from '@icon/system/regular/arrows-out-simple.svg';
import CaretUp from '@icon/system/regular/caret-up.svg';
import Minus from '@icon/system/regular/minus.svg';
import X from '@icon/system/regular/x.svg';
import { Button, cn } from '@ui';
import { createEffect, on, type ParentProps, Show } from 'solid-js';

/**
 * A reply floating over the app: in the bottom-right corner, shrunk to its
 * title bar, or filling the screen. It is not modal; the app stays usable
 * around it.
 */
export function ReplyWindowFrame(
  props: ParentProps<{
    title: string;
    minimized: boolean;
    expanded: boolean;
    /** Bumped when the window should take focus. */
    focusRequest: number;
    onMinimizedChange: (minimized: boolean) => void;
    onExpandedChange: (expanded: boolean) => void;
    /** Returns the reply to its thread. */
    onClose: () => void;
  }>
) {
  const [attachHotkeys] = useHotkeyDOMScope('email-reply-window');
  let body: HTMLDivElement | undefined;

  createEffect(
    on(
      () => props.focusRequest,
      () => {
        const editable = body?.querySelector<HTMLElement>(
          '[contenteditable]:not([contenteditable="false"])'
        );
        editable?.focus();
      }
    )
  );

  // The wrapper only places the window: the panel's glass makes itself
  // `position: relative`, which would override `fixed` on the same element.
  return (
    <div
      ref={attachHotkeys}
      role="dialog"
      aria-modal="false"
      aria-label={`Reply: ${props.title}`}
      class={cn(
        // Not modal, so no backdrop sets it apart: it casts its own shadow.
        'fixed right-4 bottom-4 z-float rounded-[24px] shadow-menu',
        props.minimized
          ? 'h-11 w-80'
          : props.expanded
            ? 'h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)]'
            : 'h-[min(32rem,calc(100dvh-2rem))] w-[min(34rem,calc(100vw-2rem))]'
      )}
    >
      {/* The raised, opaque surface dialogs and the launcher use. */}
      <div class="elevated-surface flex size-full flex-col overflow-hidden">
        <header
          class={cn(
            'flex h-11 shrink-0 items-center gap-1 pr-1.5 pl-4',
            !props.minimized && 'border-b border-edge-muted'
          )}
          onDblClick={() => props.onMinimizedChange(!props.minimized)}
        >
          <h2 class="ph-no-capture min-w-0 flex-1 truncate text-sm font-medium">
            {props.title}
          </h2>
          <Button
            variant="ghost"
            size="icon-sm"
            tooltip={props.minimized ? 'Restore' : 'Minimize'}
            aria-label={props.minimized ? 'Restore' : 'Minimize'}
            onClick={() => props.onMinimizedChange(!props.minimized)}
          >
            <Show
              when={props.minimized}
              fallback={<Minus class="size-4 shrink-0" />}
            >
              <CaretUp class="size-4 shrink-0" />
            </Show>
          </Button>
          <Show when={!props.minimized}>
            <Button
              variant="ghost"
              size="icon-sm"
              tooltip={props.expanded ? 'Exit full screen' : 'Full screen'}
              aria-label={props.expanded ? 'Exit full screen' : 'Full screen'}
              onClick={() => props.onExpandedChange(!props.expanded)}
            >
              <Show
                when={props.expanded}
                fallback={<ArrowsOut class="size-4 shrink-0" />}
              >
                <ArrowsIn class="size-4 shrink-0" />
              </Show>
            </Button>
          </Show>
          <Button
            variant="ghost"
            size="icon-sm"
            tooltip={{
              content: 'Back to thread',
              hotkey: TOKENS.email.popOutReply,
            }}
            aria-label="Back to thread"
            onClick={() => props.onClose()}
          >
            <X class="size-4 shrink-0" />
          </Button>
        </header>
        <div
          ref={body}
          hidden={props.minimized}
          class={cn(
            'flex min-h-0 flex-1 flex-col px-4 pt-2 pb-3',
            props.expanded && 'mx-auto w-full max-w-3xl'
          )}
        >
          {props.children}
        </div>
      </div>
    </div>
  );
}
