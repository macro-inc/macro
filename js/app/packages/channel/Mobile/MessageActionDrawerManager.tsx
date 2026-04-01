import { createSignal, type JSX } from 'solid-js';
import { isMobile } from '@core/mobile/isMobile';
import {
  MessageActionDrawerContextProvider,
  type MessageActionDrawerState,
} from './message-action-drawer-context';
import { ActionDrawer } from './ActionDrawer';
import type { MessageActions, MessageData } from '../Message/types';

/**
 * On mobile: provides drawer context and renders the ActionDrawer (opened via
 * long-press on Message.Root).
 * On desktop: renders children as-is with no context, signals, or drawer.
 */
export function MaybeMessageActionDrawerManager(props: {
  children: JSX.Element;
}) {
  if (!isMobile()) return props.children;

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
