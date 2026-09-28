import { type Accessor, runWithOwner } from 'solid-js';
import { useCanvasDocument } from '../context/canvas-document-context';

/**
 * Utility for creating a document-shared set of utilities that for
 * performance or data-safety reasons should be enforced as a singleton
 * within one canvas. The document context owns each initialized instance.
 */
export function sharedInstance<T>(factory: () => T): Accessor<T> {
  const key = Symbol();
  return () => {
    const canvas = useCanvasDocument();
    const instances = canvas.state.instances;
    if (!instances.has(key)) {
      if (!canvas.instanceOwner) {
        throw new Error('Canvas document instance owner is not initialized');
      }
      const instance = runWithOwner(canvas.instanceOwner, factory);
      instances.set(key, instance);
    }
    return instances.get(key) as T;
  };
}
