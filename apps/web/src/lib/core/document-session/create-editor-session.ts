import type { NativeMarkdownEditingPort } from '@core/component/LexicalMarkdown/editing/nativeMarkdownPorts';
import { SYNC_SERVICE_HOSTS } from '@core/constant/servers';
import {
  ABI_MAJOR,
  type IViewEffectMsg,
  SessionConfigMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import type { SessionAuthorization } from '@macro-inc/collaboration/session/executor';
import { SessionTelemetry } from '@macro-inc/collaboration/session/telemetry';
import {
  type EditorView,
  mountSessionView,
  type NodeViewRegistry,
  type ViewOptions,
} from '@macro-inc/lexical-wasm-view';
import type { Span } from '@macro-inc/observability';

type SessionModule = typeof import('@macro-inc/collaboration/session/wasm');

/** App configuration over the shared SessionExecutor/SessionPort view composition. */
export async function createRustEditorSession(options: {
  module: SessionModule;
  root: HTMLElement;
  registry: NodeViewRegistry;
  view: ViewOptions;
  documentId: string;
  user: string;
  access: number;
  authorization: SessionAuthorization;
  viewEngine: number;
  viewOs: number;
  span: Span;
  onStatus(status: IViewEffectMsg): void;
  installEditing?: (view: EditorView) => NativeMarkdownEditingPort;
}) {
  const owner = crypto.randomUUID();
  const sessionSpan = options.span.span('doc.session');
  const telemetry = new SessionTelemetry(sessionSpan);
  try {
    const mounted = await mountSessionView(
      options.root,
      options.registry,
      options.view,
      {
        doc: options.documentId,
        owner,
        user: options.user,
        create: (now, wall) =>
          options.module.EditorSession.createMacro(
            ABI_MAJOR,
            SessionConfigMsg.encode({
              doc: options.documentId,
              session: owner,
              user: options.user,
              peers: [...crypto.getRandomValues(new BigUint64Array(4))].map(
                (value) => value & ((1n << 63n) - 1n)
              ),
              access: options.access,
              transport: Transport.Direct,
              durable: true,
              chatter: true,
              headless: false,
              viewEngine: options.viewEngine,
              viewOs: options.viewOs,
              token: '',
              traceparent: sessionSpan.traceparent() ?? '',
              coalesce: 25,
              snapshotInterval: 15000,
              observed: [],
            }),
            now,
            wall
          ),
        auth: {
          token: (doc) =>
            sessionSpan.run(() => options.authorization.token(doc)),
          subscribe: (callback) => options.authorization.subscribe(callback),
        },
        socketUrl(doc, token, traceparent) {
          const url = new URL(
            `${SYNC_SERVICE_HOSTS.ws}/document/${encodeURIComponent(doc)}/connect`
          );
          url.searchParams.set('token', token);
          if (traceparent) url.searchParams.set('traceparent', traceparent);
          return url.toString();
        },
        telemetry,
        onStatus: options.onStatus,
      }
    );
    let editing: NativeMarkdownEditingPort | undefined;
    try {
      editing = options.installEditing?.(mounted.view);
    } catch (error) {
      await mounted.close();
      throw error;
    }
    let closing: Promise<void> | undefined;
    return {
      ...mounted,
      editing,
      close() {
        closing ??= (async () => {
          try {
            editing?.dispose();
          } finally {
            try {
              await mounted.close();
            } finally {
              telemetry.close();
              sessionSpan.end();
            }
          }
        })();
        return closing;
      },
    };
  } catch (error) {
    telemetry.close();
    sessionSpan.end();
    throw error;
  }
}
