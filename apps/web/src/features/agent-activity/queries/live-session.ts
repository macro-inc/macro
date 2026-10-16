import { AgentSession } from '@core/agent-session/AgentSession';
import type {
  FoldedMessage,
  FoldedStreamEvent,
  SessionMetadata,
} from '@service-agent-fold/generated/types';
import type { AgentAction } from '@service-agent-harness/generated/schemas';
import {
  type Accessor,
  batch,
  createMemo,
  createSignal,
  onCleanup,
} from 'solid-js';

/**
 * How long a session's shared fold outlives the last surface showing it. The
 * typing row follows the newest message; moving there re-acquires the fold
 * instead of loading the whole session again.
 */
export const RELEASE_DELAY_MS = 5_000;

/**
 * One shared subscription to an agent session for a conversation surface: a
 * typing row's live tail, a reply message's steps. Every surface showing the
 * same session shares its fold through {@link AgentSession.acquire}; text
 * paints at most 4 Hz.
 *
 * A viewer who cannot read the session is `denied`, which is not a failure:
 * the conversation still shows the bot typing and the steps it posted.
 */
export function createLiveSession(sessionId: Accessor<string | undefined>) {
  const [messages, setMessages] = createSignal<FoldedMessage[]>([]);
  const [metadata, setMetadata] = createSignal<SessionMetadata>();
  const [loaded, setLoaded] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  const [denied, setDenied] = createSignal(false);
  const [retry, setRetry] = createSignal(0);
  // Callers derive the id from state that changes for other reasons, such as
  // a typing heartbeat; only a different session resubscribes.
  const currentId = createMemo(sessionId);
  const live = createMemo(() => {
    retry();
    const id = currentId();
    batch(() => {
      setMessages([]);
      setMetadata(undefined);
      setLoaded(false);
      setFailed(false);
      setDenied(false);
    });
    if (!id) return undefined;
    const session = AgentSession.acquire(id);
    const rows = new Map<string, FoldedMessage>();
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const key = (row: FoldedMessage) => `${row.turn}:${row.author.kind}`;
    const flush = () => {
      timer = undefined;
      if (!disposed) setMessages([...rows.values()]);
    };
    const apply = (events: FoldedStreamEvent[]) => {
      for (const event of events) {
        if (event.kind === 'metadata') setMetadata(event.metadata);
        else if (event.kind === 'replace') {
          rows.clear();
          for (const row of event.messages) rows.set(key(row), row);
        } else rows.set(key(event.message), event.message);
      }
      timer ??= setTimeout(flush, 250);
    };
    const unsubscribe = session.subscribe(apply);
    const load = async () => {
      try {
        await session.load();
        const snapshot = await session.snapshot();
        if (disposed) return;
        apply([
          { kind: 'replace', messages: snapshot.messages },
          { kind: 'metadata', metadata: snapshot.metadata },
        ]);
        if (timer) clearTimeout(timer);
        flush();
        setLoaded(true);
      } catch (error) {
        if (disposed) return;
        // Not readable by this viewer: a channel member watching someone
        // else's thread reply. Duck-typed so tests can stub the session.
        if (
          (error as { name?: string } | undefined)?.name ===
          'AgentSessionAccessDenied'
        )
          setDenied(true);
        else setFailed(true);
      }
    };
    void load();
    onCleanup(() => {
      disposed = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      setTimeout(() => session.release(), RELEASE_DELAY_MS);
    });
    return session;
  });
  return {
    messages,
    metadata,
    loaded,
    failed,
    denied,
    retry: () => setRetry((value) => value + 1),
    issue: (action: AgentAction) => live()?.issue(action),
  };
}
