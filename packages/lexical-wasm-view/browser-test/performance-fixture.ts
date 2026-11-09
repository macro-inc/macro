import {
  ABI_MAJOR,
  CommandCode,
} from '@macro-inc/collaboration/session/abi.generated';
import { Telemetry, type TelemetryInitConfig } from '@macro-inc/observability';
import {
  createWebTracingProvider,
  StackContextManager,
} from '@macro-inc/observability/web';
import init, {
  EditorSession,
} from '../../../apps/web/src/lib/core/document-session/wasm/document_session_wasm.js';
import {
  startEditorOperation,
  startEditorScrollTelemetry,
} from '../../../apps/web/src/observability/editor';
import { initializeUiOperationTelemetry } from '../../../apps/web/src/observability/ui-operation';
import { mountLocalSessionView } from '../src/local-session-view';
import { createBuiltinRegistry } from '../src/view/node-views/builtins';
import { registerMacroElementViews } from '../src/view/node-views/macro';

const batches: string[] = [];
const errors: string[] = [];
const config: TelemetryInitConfig<'perf'> = {
  serviceName: 'editor-performance-fixture',
  environment: 'test',
  sampling: { perf: 1 },
  samplingKey: () => 'synthetic-performance-fixture',
  tracesUrl: 'http://127.0.0.1/fixture-traces',
  enabled: async () => true,
  contextManager: new StackContextManager(),
  tracingProvider: (resource, getUserId, sampling) =>
    createWebTracingProvider(config, resource, getUserId, sampling),
  exportFetch: async (_input, options) => {
    batches.push(await new Response(options?.body).text());
    return new Response('{}', { status: 200 });
  },
};
await Telemetry.init(config);
initializeUiOperationTelemetry();
await init();
const root = document.getElementById('editor');
if (!root) throw new Error('Missing editor root');
const native = await mountLocalSessionView(
  root,
  registerMacroElementViews(createBuiltinRegistry()),
  {
    namespace: 'block-md-main',
    theme: {},
    editable: true,
    preset: 'rich',
    onError: (error) => errors.push(String(error)),
    startPerformance: (name) => startEditorOperation(name, 'fixture-document'),
  },
  {
    viewEngine: 1,
    viewOs: 0,
    create: (config, now, wall) =>
      EditorSession.createMacro(ABI_MAJOR, config, now, wall),
  }
);
native.port.setState(
  JSON.stringify({
    root: {
      type: 'root',
      version: 1,
      children: Array.from({ length: 100 }, (_, index) => ({
        type: 'paragraph',
        version: 1,
        children: [
          {
            type: 'text',
            version: 1,
            text: `Fixture paragraph ${index}.`,
            format: 0,
            mode: 'normal',
            style: '',
            detail: 0,
          },
        ],
      })),
    },
  })
);
native.port.command(CommandCode.ClearHistory);
const stopScroll = startEditorScrollTelemetry(native.view, 'fixture-document');

Object.assign(window, {
  editorPerformance: {
    model: () => native.view.query.serializedState(),
    async flush() {
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      await Telemetry.flush();
      return { batches, errors };
    },
    stopScroll,
    blockNextPaste() {
      // Test-only browser work proves delivery after the current task ends.
      root.addEventListener(
        'paste',
        () => {
          const start = performance.now();
          while (performance.now() - start < 80) {}
        },
        { once: true }
      );
    },
  },
});
window.resolveEditorPerformanceReady();

declare global {
  interface Window {
    editorPerformanceReady: Promise<void>;
    resolveEditorPerformanceReady(): void;
    editorPerformance: {
      model(): string;
      flush(): Promise<{ batches: string[]; errors: string[] }>;
      stopScroll(): void;
      blockNextPaste(): void;
    };
  }
}
