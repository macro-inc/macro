import { EmailBodyOpenProvider } from '@app/features/email-message/context/body-open';
import { useEmailRenderCacheRollout } from '@app/lib/email-render-cache/session';
import { ContentLoading } from '@components/app/ContentLoading';
import {
  EntityLoadGate,
  type EntityLoadResult,
} from '@core/component/EntityLoadGate';
import { EmailDebouncedReadMarker } from '@notifications';
import type { ComponentProps, ParentProps } from 'solid-js';
import {
  createComputed,
  createEffect,
  on,
  onCleanup,
  Show,
  Suspense,
} from 'solid-js';
import { createThreadOpenTracker } from './thread-open';

const INPUT_EVENT = /^(click|key|pointer|mouse|touch)/;

/** The input being dispatched, when an input handler opened the thread. */
function currentInputEvent(): Event | undefined {
  const event = (globalThis as { event?: Event }).event;
  return event && INPUT_EVENT.test(event.type) ? event : undefined;
}

export type EmailThreadLoadGateProps<Data> = ParentProps<{
  result: EntityLoadResult<Data>;
  notificationSource: ComponentProps<
    typeof EmailDebouncedReadMarker
  >['notificationSource'];
  threadId: string;
  linkId?: string;
  debounceTime?: number;
  onRetry: () => void;
}>;

/** Shared load and read-state policy for every mounted email detail host. */
export function EmailThreadLoadGate<Data>(
  props: EmailThreadLoadGateProps<Data>
) {
  const opens = createThreadOpenTracker(useEmailRenderCacheRollout());
  // Runs before the new thread renders, so the open covers its bodies.
  createComputed(
    on(
      () => props.threadId,
      (threadId) => opens.start(threadId, currentInputEvent())
    )
  );
  createEffect(() => {
    if (props.result.data() !== undefined) opens.ready();
    else if (props.result.error()) opens.fail();
  });
  onCleanup(() => opens.dispose());
  return (
    <Suspense fallback={<ContentLoading />}>
      <EntityLoadGate
        result={{
          data: props.result.data,
          error: props.result.error,
          // Hosts supply identity-checked data from createEmailThreadSource.
          // Keep that composer's data during server-ID adoption; navigation to
          // another thread clears it and restores the loading state.
          // Identity resolution can precede the query's loading state. With
          // no data or error yet, the email is still waiting to load.
          isPending: () =>
            props.result.data() === undefined &&
            (props.result.isPending() || props.result.error() === undefined),
        }}
        loadErrorTitle="Unable to load this email"
        onRetry={props.onRetry}
      >
        <Show when={props.threadId} keyed>
          {(threadId) => (
            <EmailDebouncedReadMarker
              notificationSource={props.notificationSource}
              threadId={threadId}
              linkId={props.linkId}
              debounceTime={props.debounceTime}
            />
          )}
        </Show>
        <EmailBodyOpenProvider value={opens.observer}>
          {props.children}
        </EmailBodyOpenProvider>
      </EntityLoadGate>
    </Suspense>
  );
}
