import { NOOP_SPAN } from '@macro-inc/observability';
import init, {
  EditorSession,
  prepareMacroPaste,
} from '../../../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import {
  ABI_MAJOR,
  Access,
  SessionConfigMsg,
  Transport,
} from '../abi.generated';
import { SessionExecutor } from '../executor';
import { SessionTelemetry } from '../telemetry';

/** Real WASM and real executor, including durable storage and owner lease. */
export async function revokedClose(
  mode: 'unstarted' | 'before-start' | 'after-start' | 'reentrant-start'
) {
  await init();
  prepareMacroPaste();
  prepareMacroPaste();
  const owner = crypto.randomUUID();
  const doc = `revoked-close-${owner}`;
  const replies: number[] = [];
  let revoke = () => {};
  let freed = false;
  let revokeOnView = false;
  let revocations = 0;
  const runtime = new SessionExecutor({
    doc,
    owner,
    user: 'fixture-user',
    create: (now, wall) => {
      const session = EditorSession.create(
        ABI_MAJOR,
        SessionConfigMsg.encode({
          doc,
          session: owner,
          user: 'fixture-user',
          peers: [7n, 8n, 9n],
          access: Access.Edit,
          transport: Transport.Direct,
          durable: true,
          chatter: true,
          headless: false,
          viewEngine: 1,
          viewOs: 0,
          token: '',
          traceparent: '',
          coalesce: 25,
          snapshotInterval: 15000,
          observed: [],
        }),
        now,
        wall
      );
      const free = session.free.bind(session);
      session.free = () => {
        free();
        freed = true;
      };
      return session;
    },
    view: {
      apply: (_words, _strings, effects) => {
        if (revokeOnView) {
          revokeOnView = false;
          revoke();
        }
        for (const effect of effects) {
          if (effect.kind === 2)
            throw new Error(`native view error: ${effect.code}`);
          if (effect.kind === 5 && effect.code === 0)
            replies.push(effect.request);
        }
      },
    },
    auth: {
      token: async () => {
        throw new Error('offline');
      },
      subscribe: (callback) => {
        revoke = () => {
          revocations++;
          callback(false, false, false);
        };
        if (mode === 'before-start') revoke();
        return () => {};
      },
    },
    socketUrl: () => {
      throw new Error('revoked session must not dial');
    },
    telemetry: new SessionTelemetry(NOOP_SPAN),
  });
  revokeOnView = mode === 'reentrant-start';
  if (mode !== 'unstarted') runtime.start();
  if (mode === 'after-start') revoke();
  const closing = runtime.close();
  const idempotent = closing === runtime.close();
  await closing;
  await runtime.close();
  return { replies, freed, idempotent, revocations };
}
