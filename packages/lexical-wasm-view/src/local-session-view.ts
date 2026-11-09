import {
  Access,
  SessionConfigMsg,
  SessionInputMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { SessionTelemetry } from '@macro-inc/collaboration/session/telemetry';
import type { EditorSession } from '@macro-inc/collaboration/session/wasm';
import { Telemetry } from '@macro-inc/observability';
import { mountSessionView } from './session-view';
import type { ViewOptions } from './view/editor-view';
import type { NodeViewRegistry } from './view/registry';

export interface LocalSessionOptions {
  viewEngine: number;
  viewOs: number;
  /** The host selects the native node/plugin preset after loading WASM. */
  create(config: Uint8Array, now: number, wall: number): EditorSession;
}

/** Independent, non-durable native editor for composers and read-only views. */
export function mountLocalSessionView(
  root: HTMLElement,
  registry: NodeViewRegistry,
  view: ViewOptions,
  options: LocalSessionOptions
) {
  const owner = crypto.randomUUID();
  const doc = `local-${owner}`;
  const span =
    view.parentSpan?.span('editor.local') ?? Telemetry.span('editor.local');
  const telemetry = new SessionTelemetry(span);
  let mounted: Awaited<ReturnType<typeof mountSessionView>> | undefined;
  try {
    mounted = mountSessionView(root, registry, view, {
      doc,
      owner,
      user: '',
      create: (now, wall) =>
        options.create(
          SessionConfigMsg.encode({
            doc,
            session: owner,
            user: '',
            peers: [...crypto.getRandomValues(new BigUint64Array(4))].map(
              (peer) => peer & ((1n << 63n) - 1n)
            ),
            // Local read-only views still need to import their supplied content.
            // Editability belongs to the view; there is no remote authority.
            access: Access.Edit,
            transport: Transport.None,
            durable: false,
            chatter: false,
            headless: false,
            viewEngine: options.viewEngine,
            viewOs: options.viewOs,
            token: '',
            traceparent: span.traceparent() ?? '',
            coalesce: 25,
            snapshotInterval: 0,
            observed: [],
          }),
          now,
          wall
        ),
      auth: {
        async token() {
          throw new Error('Local editors cannot request sync authorization');
        },
        subscribe: () => () => {},
      },
      socketUrl() {
        throw new Error('Local editors cannot connect to sync');
      },
      telemetry,
    });
    const runtime = mounted;
    // mountSessionView starts the session. A new local document also needs an
    // empty optimistic seed before native editor inputs can be accepted.
    runtime.executor.run(() =>
      runtime.executor.session.input(
        SessionInputMsg.encode(emptyInput(1)),
        runtime.executor.now(),
        Date.now()
      )
    );
    let closing: Promise<void> | undefined;
    return {
      ...runtime,
      close() {
        closing ??= (async () => {
          try {
            await runtime.close();
          } finally {
            telemetry.close();
            span.end();
          }
        })();
        return closing;
      },
    };
  } catch (error) {
    const finish = () => {
      telemetry.close();
      span.end();
    };
    if (mounted) {
      mounted
        .close()
        .finally(finish)
        .catch((closeError) =>
          Telemetry.error(closeError, { surface: 'editor.local.close' })
        );
    } else {
      finish();
    }
    throw error;
  }
}
