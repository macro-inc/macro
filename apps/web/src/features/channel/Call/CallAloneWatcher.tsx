import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { lazyNamed } from '@core/util/lazyNamed';
import { stayInCall } from '@queries/call/call';
import {
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
  Show,
  Suspense,
} from 'solid-js';
import { useCallContext } from './CallContext';
import {
  type CallAloneWarningEvent,
  createCallEventsEffect,
} from './call-events';
import { useMaybeNativeCallState } from './native-call-state';
import {
  dismissNativeAlonePrompt,
  isNativeIosCallKitEnabled,
  registerAlonePromptStayHandler,
  showNativeAlonePrompt,
} from './use-callkit';

const CallAlonePrompt = lazyNamed(
  () => import('./CallAlonePrompt'),
  'CallAlonePrompt'
);

const sameCallId = (first: string, second: string) =>
  first.toLowerCase() === second.toLowerCase();

/**
 * Surfaces the server's warning that a call this client is in will end
 * because the user has been alone in it: a native alert for iOS CallKit
 * calls, the shared dialog everywhere else. Stay keeps the call going.
 *
 * Mount once inside `<CallProvider>`.
 */
export function CallAloneWatcher() {
  const callCtx = useCallContext();
  const nativeCall = useMaybeNativeCallState();
  const [warning, setWarning] = createSignal<CallAloneWarningEvent | null>(
    null
  );
  const [dismissed, setDismissed] = createSignal<CallAloneWarningEvent | null>(
    null
  );
  const [staying, setStaying] = createSignal(false);
  const clear = (callId: string) =>
    setWarning((current) =>
      current && sameCallId(current.callId, callId) ? null : current
    );

  createCallEventsEffect({
    // Re-sent every minute until resolved; an unchanged warning stays the
    // same object so a dismissed prompt doesn't reopen.
    onCallAloneWarning: (event) =>
      setWarning((current) =>
        current &&
        sameCallId(current.callId, event.callId) &&
        current.endsAt === event.endsAt
          ? current
          : event
      ),
    onCallAloneCleared: ({ callId }) => clear(callId),
    onCallEnded: ({ callId }) => clear(callId),
  });

  // Only the call this client is in; a warning for an older session is moot.
  const pending = createMemo(() => {
    const current = warning();
    const activeCallId = callCtx.activeCallId();
    return current && activeCallId && sameCallId(current.callId, activeCallId)
      ? current
      : null;
  });

  // Past the deadline the server ends the call, and the prompt goes with it.
  createEffect(
    on(pending, (current) => {
      if (!current) return;
      const expiry = setTimeout(
        () => clear(current.callId),
        Math.max(0, current.endsAt - Date.now())
      );
      onCleanup(() => clearTimeout(expiry));
    })
  );

  async function stay(callId: string) {
    setStaying(true);
    try {
      await stayInCall(callId);
      clear(callId);
    } catch (error) {
      console.error('failed to stay in call', error);
      toast.failure("Couldn't keep the call going");
    } finally {
      setStaying(false);
    }
  }

  const nativeOwns = (current: CallAloneWarningEvent) => {
    if (!isNativeIosCallKitEnabled()) return false;
    const snapshot = nativeCall?.snapshot();
    return !!snapshot && sameCallId(snapshot.callId, current.callId);
  };

  if (isNativeIosCallKitEnabled()) {
    const unregisterStay = registerAlonePromptStayHandler((callId) => {
      const current = pending();
      // Native reports its uppercase UUID; answer with the server's id.
      if (!current || !sameCallId(current.callId, callId)) return;
      fireAndForget(stay(current.callId), 'channel-call');
    });
    onCleanup(unregisterStay);
    // The native drawer covers the webview, so iOS shows its own alert.
    createEffect(
      on(pending, (current, previous) => {
        if (previous && previous !== current)
          fireAndForget(
            dismissNativeAlonePrompt(previous.callId),
            'channel-call'
          );
        if (current && nativeOwns(current))
          fireAndForget(
            showNativeAlonePrompt(current.callId, current.endsAt),
            'channel-call'
          );
      })
    );
  }

  const dialogWarning = () => {
    const current = pending();
    return current && current !== dismissed() && !nativeOwns(current)
      ? current
      : null;
  };

  return (
    <Show when={dialogWarning()}>
      {(current) => (
        <Suspense>
          <CallAlonePrompt
            endsAt={current().endsAt}
            pending={staying()}
            onStay={() => fireAndForget(stay(current().callId), 'channel-call')}
            onDismiss={() => setDismissed(current())}
          />
        </Suspense>
      )}
    </Show>
  );
}
