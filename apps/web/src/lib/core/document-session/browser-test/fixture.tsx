import {
  ABI_MAJOR,
  Access,
  SessionConfigMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import {
  createBuiltinRegistry,
  registerMacroElementViews,
} from '@macro-inc/lexical-wasm-view';
import { NOOP_SPAN } from '@macro-inc/observability';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import {
  createRustEditorSession,
  createRustSession,
} from '../create-editor-session';
import {
  EditorEngineBoundary,
  EditorEngineProvider,
  useEditorEngine,
} from '../editor-engine';

function EditorSubtree() {
  const engine = useEditorEngine();
  const [attachment, setAttachment] = createSignal('');
  // A real native factory must be available synchronously when this runs.
  if (engine.enabled() && !engine.module().EditorSession)
    throw new Error('Missing initialized native session factory');
  async function attachSession() {
    const root = document.createElement('div');
    const runtime = createRustEditorSession({
      module: engine.module(),
      root,
      registry: registerMacroElementViews(createBuiltinRegistry()),
      view: {
        namespace: 'durable-factory-fixture',
        theme: {},
        editable: false,
        preset: 'rich',
        onError(error) {
          throw error;
        },
      },
      documentId: crypto.randomUUID(),
      user: 'fixture-user',
      access: Access.Edit,
      authorization: {
        async token() {
          throw new Error('Fixture stays offline');
        },
        subscribe: () => () => {},
      },
      viewEngine: 1,
      viewOs: 0,
      span: NOOP_SPAN,
      onStatus() {},
    });
    // A scoped createEditor factory must receive the actual attachment before
    // returning. There is no temporary model and no microtask before this read.
    if (
      runtime.view.root !== root ||
      !runtime.port ||
      !runtime.executor.session
    )
      throw new Error('Missing synchronous document attachment');
    await runtime.close();
    setAttachment('Durable attachment closed');
  }
  async function attachSessionOnly(
    mode: 'ordinary' | 'revoked' | 'cancelled' | 'reentrant' = 'ordinary'
  ) {
    const revoked = mode === 'revoked';
    const cancelled = mode === 'cancelled';
    let closingStarted = false;
    let reenter: (() => Promise<void>) | undefined;
    let reentered: Promise<void> | undefined;
    let authorizationCalls = 0;
    let outputCalls = 0;
    let created = false;
    const module = engine.module();
    const runtime = createRustSession({
      create(config, now, wall) {
        const decoded = SessionConfigMsg.decode(config);
        if (
          decoded.headless ||
          decoded.transport !== Transport.Direct ||
          !decoded.durable
        )
          throw new Error('Incorrect session-only document configuration');
        created = true;
        // Test host I/O with the real generic core; integration supplies its
        // actual compat constructor without changing this host composition.
        return module.EditorSession.create(ABI_MAJOR, config, now, wall);
      },
      sink: {
        apply() {
          outputCalls++;
          if (closingStarted && mode === 'reentrant') reentered = reenter?.();
        },
      },
      documentId: crypto.randomUUID(),
      user: 'fixture-user',
      access: Access.Edit,
      authorization: {
        async token() {
          authorizationCalls++;
          throw new Error('Fixture stays offline');
        },
        subscribe(callback) {
          if (revoked) callback(false, false, false);
          return () => {};
        },
      },
      viewEngine: 1,
      viewOs: 0,
      span: NOOP_SPAN,
      onStatus() {},
    });
    if (
      !created ||
      !runtime.executor.session ||
      authorizationCalls ||
      outputCalls
    )
      throw new Error('Document session started before registration');
    if (!cancelled) runtime.start();
    if (revoked && outputCalls === 0)
      throw new Error('Deferred authorization revocation was lost');
    reenter = () => runtime.close();
    closingStarted = true;
    const closing = runtime.close();
    if (closing !== runtime.close())
      throw new Error('Session close must be idempotent');
    await closing;
    if (mode === 'reentrant') {
      if (reentered !== closing)
        throw new Error('Reentrant close changed promise identity');
      setAttachment('Reentrant attachment closed');
    } else if (cancelled) setAttachment('Unstarted attachment closed');
    else
      setAttachment(
        revoked ? 'Revoked attachment closed' : 'Session-only attachment closed'
      );
  }
  return (
    <>
      <div>Editor subtree ready</div>
      <button onClick={attachSession}>Attach durable session</button>
      <button onClick={() => attachSessionOnly()}>
        Attach session without DOM
      </button>
      <button onClick={() => attachSessionOnly('revoked')}>
        Attach revoked session
      </button>
      <button onClick={() => attachSessionOnly('cancelled')}>
        Close unstarted session
      </button>
      <button onClick={() => attachSessionOnly('reentrant')}>
        Close session reentrantly
      </button>
      <div>{attachment()}</div>
    </>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing fixture root');
render(
  () => (
    <EditorEngineProvider>
      <div>Application shell ready</div>
      <EditorEngineBoundary
        fallback={<div>Loading editor engine</div>}
        failure={(retry) => (
          <div>
            <span>Editor engine failed</span>
            <button onClick={retry}>Retry</button>
          </div>
        )}
      >
        <EditorSubtree />
      </EditorEngineBoundary>
    </EditorEngineProvider>
  ),
  root
);
