/**
 * Test-only: a native session that loads a given Loro snapshot through the
 * ordinary Seed input (snapshot import -> Seeded -> the editor's initial-state
 * build), the production load path. It composes the public mountSessionView
 * with the same non-durable, transport-free configuration mountLocalSessionView
 * uses; nothing here is a production API.
 */
import * as native from '@core/document-session/wasm/document_session_wasm.js';
import {
  ABI_MAJOR,
  Access,
  SessionConfigMsg,
  SessionInputMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { SessionTelemetry } from '@macro-inc/collaboration/session/telemetry';
import {
  createBuiltinRegistry,
  mountSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN } from '@macro-inc/observability';

/**
 * Seed origins as document_session_wasm machine.rs decodes SessionInputMsg
 * kind 1: code 0 => SeedKind::Optimistic, code 1 => SeedKind::CachedS3.
 * loro-null-fields-load.parity.test.ts checks these against that decoder.
 */
export const SEED_CODE = { optimistic: 0, 'cached-s3': 1 } as const;
export type SeedOrigin = keyof typeof SEED_CODE;

const NAMESPACE = 'seeded-session';

/** Several releases failed; every raw failure is kept, in release order. */
export class ReleaseFailures extends Error {
  constructor(readonly failures: readonly unknown[]) {
    super(`${failures.length} seeded-session releases failed`);
  }
}
/** Setup failed and its teardown failed too; both are kept raw. */
export class SetupFailure extends Error {
  constructor(
    readonly primary: unknown,
    readonly releaseFailures: readonly unknown[]
  ) {
    super('Seeded session setup failed and its teardown failed');
  }
}
/** Throw nothing, the one raw failure (even undefined/null), or all of them. */
function rethrow(failures: readonly unknown[]) {
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new ReleaseFailures(failures);
}
/** Real releases this fixture's lifetime controls can witness. */
export type SeededSessionRelease = 'session.free' | 'telemetry.close';
/**
 * Fault injection for this fixture's own lifetime controls (test-only). The
 * release hooks run only after the real release they follow, so a fault never
 * skips one; `released` witnesses each real release as it completes.
 */
export interface SeededSessionFaults {
  readonly afterMount?: (root: HTMLElement) => void;
  readonly afterSessionClose?: () => void;
  readonly afterTelemetryClose?: () => void;
  readonly released?: (release: SeededSessionRelease) => void;
}

/**
 * Mount a session and seed it. The caller owns the result as soon as this
 * resolves: close() releases the session and the telemetry independently,
 * always removes the root last, keeps every raw failure and is idempotent. A
 * setup failure awaits that same teardown before rejecting: with the raw
 * primary alone, or SetupFailure(primary, every release failure). `seed`
 * undefined sends the empty optimistic seed of a new local document.
 */
export async function mountSeededSession(
  seed: { origin: SeedOrigin; snapshot: Uint8Array } | undefined,
  faults: SeededSessionFaults = {}
) {
  const root = document.createElement('div');
  document.body.append(root);
  const errors: unknown[] = [];
  const telemetry = new SessionTelemetry(NOOP_SPAN);
  let mounted: ReturnType<typeof mountSessionView> | undefined;
  let closing: Promise<void> | undefined;
  const close = () => {
    closing ??= (async () => {
      const failures: unknown[] = [];
      try {
        try {
          await mounted?.close();
        } catch (error) {
          failures.push(error);
        }
        try {
          faults.afterSessionClose?.();
        } catch (error) {
          failures.push(error);
        }
        try {
          telemetry.close();
          faults.released?.('telemetry.close');
        } catch (error) {
          failures.push(error);
        }
        try {
          faults.afterTelemetryClose?.();
        } catch (error) {
          failures.push(error);
        }
      } finally {
        root.remove();
      }
      rethrow(failures);
    })();
    return closing;
  };
  try {
    const owner = crypto.randomUUID();
    const doc = `seeded-${owner}`;
    mounted = mountSessionView(
      root,
      registerMacroElementViews(createBuiltinRegistry()),
      {
        namespace: NAMESPACE,
        theme: {},
        editable: true,
        preset: 'rich',
        parentSpan: NOOP_SPAN,
        onError(error) {
          errors.push(error);
        },
      },
      {
        doc,
        owner,
        user: '',
        create: (now, wall) => {
          const session = native.EditorSession.createMacroWithNamespace(
            ABI_MAJOR,
            SessionConfigMsg.encode({
              doc,
              session: owner,
              user: '',
              peers: [...crypto.getRandomValues(new BigUint64Array(4))].map(
                (peer) => peer & ((1n << 63n) - 1n)
              ),
              access: Access.Edit,
              transport: Transport.None,
              durable: false,
              chatter: false,
              headless: false,
              viewEngine: 1,
              viewOs: 0,
              token: '',
              traceparent: '',
              coalesce: 25,
              snapshotInterval: 0,
              observed: [],
            }),
            now,
            wall,
            NAMESPACE
          );
          const free = session.free.bind(session);
          session.free = () => {
            free();
            faults.released?.('session.free');
          };
          return session;
        },
        auth: {
          async token() {
            throw new Error(
              'Seeded test sessions cannot request authorization'
            );
          },
          subscribe: () => () => {},
        },
        socketUrl() {
          throw new Error('Seeded test sessions cannot connect to sync');
        },
        telemetry,
      },
      native
    );
    const runtime = mounted;
    faults.afterMount?.(root);
    // mountSessionView sends Start; the ordinary Seed input follows.
    runtime.executor.run(() =>
      runtime.executor.session.input(
        SessionInputMsg.encode(
          seed
            ? {
                ...emptyInput(1),
                code: SEED_CODE[seed.origin],
                bytes: seed.snapshot,
              }
            : emptyInput(1)
        ),
        runtime.executor.now(),
        Date.now()
      )
    );
    return { view: runtime.view, port: runtime.port, root, errors, close };
  } catch (primary) {
    // Join the owned teardown; the setup failure stays the primary cause.
    let releaseFailures: readonly unknown[] = [];
    try {
      await close();
    } catch (failure) {
      releaseFailures =
        failure instanceof ReleaseFailures ? failure.failures : [failure];
    }
    if (releaseFailures.length > 0)
      throw new SetupFailure(primary, releaseFailures);
    throw primary;
  }
}
