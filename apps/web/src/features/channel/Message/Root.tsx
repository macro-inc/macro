import { stickyGate } from '@core/util/debounce';
import { cn } from '@ui';
import { createSignal, type JSX, splitProps } from 'solid-js';
import {
  MessageActionMenuVisibilityProvider,
  MessageActionsProvider,
  MessageProvider,
} from './context';
import type { MessageActions, MessageData } from './types';

/**
 * How long the accent background fades once the message stops being
 * targeted. Mirrors the `targeted-message-accent-fade-out` animation
 * duration in index.css.
 */
const TARGETED_FADE_OUT_MS = 500;
const ACTION_MENU_POINTER_VISIBLE = 1;
const ACTION_MENU_FOCUS_VISIBLE = 2;
const ACTION_MENU_PERSISTENT = 4;

type RootProps = JSX.HTMLAttributes<HTMLDivElement> & {
  message: MessageData;
  actions?: MessageActions;
  /** This message is the selection cursor. Renders the background highlight. */
  selected?: boolean;
  /**
   * The unified-input mode's floating reply/edit input, or message
   * navigation, points at this message. Renders the accent bar.
   */
  targeted?: boolean;
};

function callEventHandler<E extends Event>(
  event: E & { currentTarget: HTMLDivElement; target: Element },
  handler: JSX.EventHandlerUnion<HTMLDivElement, E> | undefined
) {
  if (typeof handler === 'function') {
    handler(event);
  } else if (handler) {
    handler[0](handler[1], event);
  }
}

export function Root(props: RootProps) {
  const [local, rest] = splitProps(props, [
    'children',
    'class',
    'message',
    'actions',
    'selected',
    'targeted',
    'onPointerEnter',
    'onPointerLeave',
    'onFocusIn',
    'onFocusOut',
  ]);

  const [actionMenuVisibilityFlags, setActionMenuVisibilityFlags] =
    createSignal(0);
  const setActionMenuVisibilityFlag = (flag: number, visible: boolean) => {
    setActionMenuVisibilityFlags((current) =>
      visible ? current | flag : current & ~flag
    );
  };
  const actionMenuVisibility = {
    visible: () => actionMenuVisibilityFlags() !== 0,
    setPersistent: (persistent: boolean) =>
      setActionMenuVisibilityFlag(ACTION_MENU_PERSISTENT, persistent),
  };

  // When the message stops being targeted, the accent fades out instead of
  // cutting off: the sticky gate holds for the fade window after `targeted`
  // falls, so the fading flag is true exactly during that window.
  // Re-targeting mid-fade re-opens the gate, which cancels the fade.
  const targetedSticky = stickyGate(
    () => !!local.targeted,
    TARGETED_FADE_OUT_MS
  );
  const targetFading = () => targetedSticky() && !local.targeted;

  return (
    <div
      class={cn('group/message relative touch:no-select-children', local.class)}
      data-message
      data-message-id={local.message.id}
      data-selected={local.selected ? '' : undefined}
      data-targeted={local.targeted ? '' : undefined}
      data-targeted-fading={targetFading() ? '' : undefined}
      onPointerEnter={(event) => {
        setActionMenuVisibilityFlag(ACTION_MENU_POINTER_VISIBLE, true);
        callEventHandler(event, local.onPointerEnter);
      }}
      onPointerLeave={(event) => {
        setActionMenuVisibilityFlag(ACTION_MENU_POINTER_VISIBLE, false);
        callEventHandler(event, local.onPointerLeave);
      }}
      onFocusIn={(event) => {
        setActionMenuVisibilityFlag(ACTION_MENU_FOCUS_VISIBLE, true);
        callEventHandler(event, local.onFocusIn);
      }}
      onFocusOut={(event) => {
        const nextTarget = event.relatedTarget;
        if (
          !(
            nextTarget instanceof Node &&
            event.currentTarget.contains(nextTarget)
          )
        ) {
          setActionMenuVisibilityFlag(ACTION_MENU_FOCUS_VISIBLE, false);
        }
        callEventHandler(event, local.onFocusOut);
      }}
      {...rest}
    >
      <MessageProvider value={() => local.message}>
        <MessageActionsProvider value={local.actions}>
          <MessageActionMenuVisibilityProvider value={actionMenuVisibility}>
            {props.children}
          </MessageActionMenuVisibilityProvider>
        </MessageActionsProvider>
      </MessageProvider>
    </div>
  );
}
