import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { lazyNamed } from '@core/util/lazyNamed';
import { type ParentProps, Show, Suspense } from 'solid-js';
import { Portal } from 'solid-js/web';
import { ReplyWindowProvider } from './context';
import { createReplyWindowState } from './primitives/reply-window-state';

const ReplyWindowView = lazyNamed(
  () => import('./reply-window-view'),
  'ReplyWindowView'
);

/**
 * Gives the app one reply window: a reply popped out of its thread floats
 * over every view until it is sent, discarded or returned. Touch devices
 * reply in a drawer instead.
 */
export function EmailReplyWindowHost(props: ParentProps) {
  const state = createReplyWindowState();
  return (
    <ReplyWindowProvider value={state}>
      {props.children}
      <Show when={!isTouchDevice() && state.reply()}>
        <Portal>
          <Suspense>
            <ReplyWindowView state={state} />
          </Suspense>
        </Portal>
      </Show>
    </ReplyWindowProvider>
  );
}
