import {
  ABI_MAJOR,
  Access,
  SessionConfigMsg,
  SessionInputMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import { decodeOutput } from '@macro-inc/collaboration/session/output';
import { EditorView } from '@macro-inc/lexical-wasm-view/view/editor-view';
import { createBuiltinRegistry } from '@macro-inc/lexical-wasm-view/view/node-views/builtins';
import {
  registerMacroDecoratorViews,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view/view/node-views/macro';
import type { ViewSink } from '@macro-inc/lexical-wasm-view/view/port';
import { SessionPort } from '@macro-inc/lexical-wasm-view/view/session-port';
import type { Owner } from 'solid-js';
import { theme } from '../../theme';
import { createNativeFastSelectionDecoratorViews } from '../fast-selection-views';
import { createNativeSelectionDecoratorContext } from '../native-selection-host';
import initialize, { EditorSession } from './wasm/document_session_wasm.js';

/** Actual production WASM, execution port, and Diff-driven mounted view. */
export async function mountNativeSurface(
  root: HTMLElement,
  json: string,
  owner: Owner | null
) {
  await initialize();
  const session = EditorSession.createMacroWithNamespace(
    ABI_MAJOR,
    SessionConfigMsg.encode({
      doc: 'fast-decorator-fixture',
      session: '00000000-0000-0000-0000-000000000001',
      user: 'fixture-user',
      peers: [7n, 8n, 9n],
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
    0,
    0,
    'fast-decorator-fixture'
  );
  let view: EditorView | undefined;
  const sink: ViewSink = {
    apply: (words, strings, effects) => view?.apply(words, strings, effects),
    acknowledgeText: (input) => view?.acknowledgeText(input),
    acknowledgeSelection: (selection) => view?.acknowledgeSelection(selection),
    text: (key) => view?.text(key) ?? null,
  };
  let clock = 2;
  const executor = {
    session,
    now: () => ++clock,
    run(call: () => number, after?: (flags: number) => void) {
      const flags = call();
      if (flags & (1 | 2 | 8 | 16)) {
        const output = decodeOutput(session.takeOutput());
        sink.apply(output.view, output.strings, output.viewEffects);
      }
      after?.(flags);
    },
  };
  const port = new SessionPort(executor, sink, false);
  const selectionContext = createNativeSelectionDecoratorContext(theme);
  const registry = registerMacroElementViews(createBuiltinRegistry());
  registerMacroDecoratorViews(
    registry,
    createNativeFastSelectionDecoratorViews(selectionContext)
  );
  view = EditorView.mount(root, port, registry, {
    namespace: 'fast-decorator-fixture',
    theme,
    editable: true,
    preset: 'rich',
    owner: owner ?? undefined,
    onError(error) {
      throw error;
    },
  });
  executor.run(() =>
    session.input(SessionInputMsg.encode(emptyInput(0)), 1, 1)
  );
  executor.run(() =>
    session.input(SessionInputMsg.encode(emptyInput(1)), 2, 2)
  );
  const beforeImportDecorators = root.querySelectorAll(
    '[data-lexical-decorator]'
  ).length;
  port.setState(json);
  const mounted = view;
  return {
    view: mounted,
    port,
    beforeImportDecorators,
    serializedState: () => session.serializedState(),
    selectKind(type: string) {
      const node = [...mounted.mirror.values()].find(
        (node) => node.type === type
      );
      if (!node) throw new Error('Missing actual native decorator');
      port.selectionFromView({ kind: 'node', keys: [node.key] });
    },
    clearSelection() {
      port.selectionFromView({ kind: 'none' });
    },
    close() {
      selectionContext.dispose();
      mounted.dispose();
      session.free();
    },
  };
}
