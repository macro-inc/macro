import {
  ABI_MAJOR,
  type Access,
  SessionConfigMsg,
  SessionInputMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { SessionTelemetry } from '@macro-inc/collaboration/session/telemetry';
import type * as Native from '@macro-inc/collaboration/session/wasm';
import {
  createBuiltinRegistry,
  mountSessionView,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { Telemetry } from '@macro-inc/observability';
import { LoroDoc, LoroMap, LoroMovableList, LoroText } from 'loro-crdt';
import { MARKDOWN_VERSION_COUNTER } from '../../../version';

/** A real remote-style snapshot, not SetState on an already-ready local editor. */
export function mountNewerDocumentFixture(
  root: HTMLElement,
  module: typeof Native,
  access: Access,
  onError: (error: unknown) => void
) {
  const doc = new LoroDoc();
  const stored = doc.getMap('root');
  stored.set('type', 'root');
  stored.set('version', 1);
  const state = stored.setContainer('$', new LoroMap());
  const metadata = state.setContainer('documentMetadata', new LoroMap());
  metadata.set('version', MARKDOWN_VERSION_COUNTER + 1);
  metadata.set('environmentTags', null);
  const children = stored.setContainer('children', new LoroMovableList());
  const paragraph = children.insertContainer(0, new LoroMap());
  paragraph.set('type', 'paragraph');
  paragraph.set('version', 1);
  const leaves = paragraph.setContainer('children', new LoroMovableList());
  const text = leaves.insertContainer(0, new LoroMap());
  text.set('type', 'text');
  text.set('version', 1);
  text.setContainer('text', new LoroText()).insert(0, 'Before');
  doc.commit();
  const snapshot = doc.export({ mode: 'snapshot' });
  const owner = crypto.randomUUID();
  const documentId = `version-fixture-${owner}`;
  const span = Telemetry.span('editor.version-fixture');
  const telemetry = new SessionTelemetry(span);
  const runtime = mountSessionView(
    root,
    registerMacroElementViews(createBuiltinRegistry()),
    {
      namespace: documentId,
      theme: {},
      editable: false,
      preset: 'rich',
      onError,
    },
    {
      doc: documentId,
      owner,
      user: '',
      create: (now, wall) =>
        module.EditorSession.createMacroWithNamespace(
          ABI_MAJOR,
          SessionConfigMsg.encode({
            doc: documentId,
            session: owner,
            user: '',
            peers: [71n, 72n, 73n, 74n],
            access,
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
          documentId
        ),
      auth: {
        async token() {
          throw new Error('No fixture authorization');
        },
        subscribe: () => () => {},
      },
      socketUrl() {
        throw new Error('No fixture network');
      },
      telemetry,
    },
    module
  );
  runtime.executor.run(() =>
    runtime.executor.session.input(
      SessionInputMsg.encode({ ...emptyInput(1), bytes: snapshot }),
      runtime.executor.now(),
      Date.now()
    )
  );
  return {
    ...runtime,
    async close() {
      try {
        await runtime.close();
      } finally {
        telemetry.close();
        span.end();
      }
    },
  };
}
