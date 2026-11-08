import {
  type ExecutorOptions,
  SessionExecutor,
} from '@macro-inc/collaboration/session/executor';
import type { EditorSession } from '@macro-inc/collaboration/session/wasm';
import { EditorView, type ViewOptions } from './view/editor-view';
import type { ViewSink } from './view/port';
import type { NodeViewRegistry } from './view/registry';
import { SessionPort } from './view/session-port';

/** Connect the view to the existing I/O executor after the host loads WASM. */
export async function mountSessionView(
  root: HTMLElement,
  registry: NodeViewRegistry,
  options: ViewOptions,
  session: Omit<ExecutorOptions<EditorSession>, 'view'>
) {
  let view: EditorView | undefined;
  let disposed = false;
  let closing: Promise<void> | undefined;
  const pending: Parameters<ViewSink['apply']>[] = [];
  const sink: ViewSink = {
    apply(...output) {
      if (disposed) return;
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
      close() {
        if (closing) return closing;
        disposed = true;
        view = undefined;
        pending.length = 0;
        mounted.dispose();
        closing = executor.close();
        return closing;
      },
    };
  } catch (error) {
    disposed = true;
    const failed = view;
    view = undefined;
    failed?.dispose();
    await executor.close();
    throw error;
  }
}
