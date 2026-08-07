import { FoldedMessagesProvider } from '@channel/Message';
import {
  createFoldedMessages,
  type FoldedMessageLookup,
} from '@queries/channel/folded-messages';
import type { Accessor, JSX, Resource } from 'solid-js';

/**
 * A channel's fold, as `Channel.tsx` needs it: one thing to create, one
 * accessor to read it without suspending, one component to wrap the message
 * tree in.
 *
 * Without this, a caller has to know the resource's own shape to use it
 * safely - branching on `.state` to read it early, and remembering to force
 * a read so `<Suspense>` waits on it (see {@link AwaitFold}) - which is
 * plumbing the fold's consumer should not have to repeat.
 */
export type FoldedMessagesScope = {
  /**
   * The fold's lookup once ready, `undefined` otherwise. Safe to read
   * anywhere - including inside a memo that must not itself suspend - because
   * unlike calling the resource directly, this never throws to a `<Suspense>`
   * boundary.
   */
  readyLookup: Accessor<FoldedMessageLookup | undefined>;
  /**
   * Wrap the message tree in this. Forces the enclosing `<Suspense>` to wait
   * for the fold and exposes the live lookup to every `FoldedMessageLayout`
   * beneath it via context.
   */
  Provider: (props: { children: JSX.Element }) => JSX.Element;
};

/** Create and wire up a channel's fold. See {@link FoldedMessagesScope}. */
export function createFoldedMessagesScope(
  channelId: Accessor<string>
): FoldedMessagesScope {
  const foldedMessages = createFoldedMessages(channelId);

  const readyLookup = () =>
    foldedMessages.state === 'ready' ? foldedMessages() : undefined;

  const Provider = (props: { children: JSX.Element }) => (
    <>
      <AwaitFold fold={foldedMessages} />
      <FoldedMessagesProvider value={foldedMessages}>
        {props.children}
      </FoldedMessagesProvider>
    </>
  );

  return { readyLookup, Provider };
}

/**
 * Reads the fold so the enclosing `<Suspense>` waits on it, and renders
 * nothing.
 *
 * The fold has two jobs that pull in opposite directions: the channel should
 * not paint until it is done, and the messages must re-read it when it lands.
 * The second needs an accessor in context; the first needs somebody to
 * actually call it. This is that caller.
 */
function AwaitFold(props: { fold: Resource<FoldedMessageLookup> }) {
  props.fold();
  return null;
}
