import type { MessageActions, MessageData } from '@core/messages/types';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { createSignal, type JSX } from 'solid-js';
import { ActionDrawer } from './ActionDrawer';
import {
  MessageActionDrawerContextProvider,
  type MessageActionDrawerState,
  useMessageActionDrawer,
} from './message-action-drawer-context';

/**
 * On mobile: provides drawer context and renders the ActionDrawer (opened via
 * long-press on Message.Root).
 * On desktop: renders children as-is with no context, signals, or drawer.
 */
export function MaybeMessageActionDrawerManager(props: {
  children: JSX.Element;
}) {
  if (!isTouchDevice() || useMessageActionDrawer()) return props.children;

  const [isOpen, setIsOpen] = createSignal(false);
  const [message, setMessage] = createSignal<MessageData | undefined>();
  const [actions, setActions] = createSignal<MessageActions | undefined>();

  const ctx: MessageActionDrawerState = {
    isOpen,
    message,
    actions,
    open: (msg: MessageData, acts: MessageActions | undefined) => {
      setMessage(() => msg);
      setActions(() => acts);
      setIsOpen(true);
    },
    close: () => setIsOpen(false),
  };

  return (
    <MessageActionDrawerContextProvider value={ctx}>
      {props.children}
      <ActionDrawer />
    </MessageActionDrawerContextProvider>
  );
}
