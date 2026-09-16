import { WorkerPoolManager } from '@pierre/diffs/worker';
import DiffWorker from '@pierre/diffs/worker/worker.js?worker';
import { createSingletonRoot } from '@solid-primitives/rootless';
import { createSignal, onCleanup } from 'solid-js';

type DiffWorkers =
  | { kind: 'loading' }
  | { kind: 'ready'; pool: WorkerPoolManager }
  | { kind: 'failed' };

/** Share a bounded pool only while diff bodies are mounted. Never start on import. */
export const useDiffWorkers = createSingletonRoot(() => {
  const [state, setState] = createSignal<DiffWorkers>({ kind: 'loading' });
  const pool = new WorkerPoolManager(
    {
      workerFactory: () => new DiffWorker(),
      poolSize: 2,
      totalASTLRUCacheSize: 20,
    },
    { lineDiffType: 'none' }
  );
  onCleanup(() => pool.terminate());

  async function initialize() {
    try {
      await pool.initialize();
      setState({ kind: 'ready', pool });
    } catch (error) {
      // Do not let Pierre fall back to main-thread syntax highlighting.
      console.error('[pierre-diff] worker initialization failed', error);
      setState({ kind: 'failed' });
    }
  }
  void initialize();
  return state;
});
