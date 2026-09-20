import type { createCallLifecycle } from './call-lifecycle';
import type { NativeCallState } from './native-call-state';

/** Reconcile native events, including a call restored while an old leave settles. */
export function bindNativeCallLifecycle(
  nativeCall: Pick<NativeCallState, 'snapshot' | 'onSnapshot'>,
  lifecycle: ReturnType<typeof createCallLifecycle>
) {
  let snapshotChangedDuringJoin = false;
  const sync = () => {
    const snapshot = nativeCall.snapshot();
    if (snapshot?.connectionState === 'connected') {
      lifecycle.syncSession({
        channelId: snapshot.channelId,
        callId: snapshot.callId,
      });
    } else if (!snapshot || snapshot.connectionState === 'disconnected') {
      lifecycle.syncSession(undefined);
    }
  };
  const unsubscribeState = lifecycle.subscribe((state) => {
    if (
      state.t === 'idle' ||
      state.t === 'failed' ||
      (state.t === 'active' && snapshotChangedDuringJoin)
    ) {
      snapshotChangedDuringJoin = false;
      sync();
    }
  });
  const unsubscribeSnapshot = nativeCall.onSnapshot(() => {
    // A CallKit transaction acknowledges the start request separately from
    // media events. Replay an observed end/replacement after that join settles;
    // the initial null snapshot alone does not mean the new call has ended.
    if (lifecycle.getState().t === 'joining') snapshotChangedDuringJoin = true;
    sync();
  });
  return () => {
    unsubscribeSnapshot();
    unsubscribeState();
  };
}
