import {
  SessionExecutor,
  type ExecutorOptions,
} from '@macro-inc/collaboration/session/executor';
import type { EditorSession } from '@macro-inc/collaboration/session/wasm';
import { EditorView, type ViewOptions } from './view/editor-view';
import { SessionPort } from './view/session-port';
import type { NodeViewRegistry } from './view/registry';
import type { ViewSink } from './view/port';

/** Connect the view to the existing I/O executor after the host loads WASM. */
export async function mountSessionView(
  root: HTMLElement,
  registry: NodeViewRegistry,
  options: ViewOptions,
  session: Omit<ExecutorOptions<EditorSession>, 'view'>
) {
  let view: EditorView | undefined;
  const pending: Parameters<ViewSink['apply']>[] = [];
  const sink: ViewSink = {
    apply(...output) {
      if (view) view.apply(...output);
      else pending.push(output);
    },
    acknowledgeText(input) {
      if (!view) throw new Error('Text input before view mount');
      view.acknowledgeText(input);
    },
    acknowledgeSelection(selection) {
      if (!view) throw new Error('Selection input before view mount');
      view.acknowledgeSelection(selection);
    },
    text(key) {
      return view?.text(key) ?? null;
    },
  };
  const executor = new SessionExecutor({ ...session, view: sink });
  const port = new SessionPort(executor, sink);
  try {
    view = EditorView.mount(root, port, registry, options);
    for (const output of pending) view.apply(...output);
    pending.length = 0;
    executor.start();
    const mounted = view;
    return {
      view,
      port,
      executor,
      async close() {
        try {
          await executor.close();
        } finally {
          mounted.dispose();
        }
      },
    };
  } catch (error) {
    const failed = view;
    view = undefined;
    failed?.dispose();
    await executor.close();
    throw error;
  }
}
