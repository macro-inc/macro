import { match, P } from 'ts-pattern';
import type { createCallLifecycle } from './call-lifecycle';
import type { NativeCallState } from './native-call-state';

/** Reconcile native events, including a call restored while an old leave settles. */
export function bindNativeCallLifecycle(
  nativeCall: Pick<NativeCallState, 'snapshot' | 'onSnapshot'>,
  lifecycle: ReturnType<typeof createCallLifecycle>
) {
  let nativeSessionObserved = false;
  const sync = () => {
    match(nativeCall.snapshot())
      .with({ connectionState: 'connected' }, (snapshot) => {
        nativeSessionObserved = true;
        lifecycle.syncSession({
          channelId: snapshot.channelId,
          callId: snapshot.callId.toLowerCase(),
        });
      })
      .with({ connectionState: P.union('connecting', 'reconnecting') }, () => {
        nativeSessionObserved = true;
      })
      .with(
        null,
        { connectionState: P.union('disconnected', 'disconnecting') },
        () => {
          // CallKit acknowledges start before media snapshots necessarily
          // arrive. An empty snapshot only ends an observed native session.
          if (nativeSessionObserved) lifecycle.syncSession(undefined);
        }
      )
      .exhaustive();
  };
  const unsubscribeState = lifecycle.subscribe((state) => {
    if (state.t === 'joining') nativeSessionObserved = false;
    if (
      state.t === 'joining' ||
      state.t === 'idle' ||
      state.t === 'failed' ||
      state.t === 'active'
    ) {
      sync();
    }
  });
  const unsubscribeSnapshot = nativeCall.onSnapshot(sync);
  return () => {
    unsubscribeSnapshot();
    unsubscribeState();
  };
}
