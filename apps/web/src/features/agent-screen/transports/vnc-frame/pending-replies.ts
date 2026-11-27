/**
 * Requests to the sandboxed frame that expect one reply each. A reply that
 * never comes (the frame threw, or is gone) settles as `undefined` after
 * `timeoutMs`, so a caller awaiting it (the loupe) never stalls.
 */
export function createPendingReplies<Reply>(timeoutMs: number) {
  let nextId = 0;
  const pending: Record<
    number,
    {
      settle: (reply: Reply | undefined) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  > = {};

  const settle = (id: number, reply: Reply | undefined) => {
    const entry = pending[id];
    if (!entry) return false;
    clearTimeout(entry.timer);
    delete pending[id];
    entry.settle(reply);
    return true;
  };

  return {
    /** Sends a request with a fresh id and waits for its reply. */
    request(send: (id: number) => void): Promise<Reply | undefined> {
      const id = ++nextId;
      return new Promise((resolve) => {
        pending[id] = {
          settle: resolve,
          timer: setTimeout(() => settle(id, undefined), timeoutMs),
        };
        send(id);
      });
    },
    /** A reply arrived; false when it was already settled (late, or unknown). */
    settle,
    settleAll() {
      for (const id of Object.keys(pending)) settle(Number(id), undefined);
    },
  };
}
