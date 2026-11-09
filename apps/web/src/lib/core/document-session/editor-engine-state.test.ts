import { createRoot, createSignal } from 'solid-js';
import { expect, test, vi } from 'vitest';
import { createEditorEngineState } from './editor-engine-state';

test('disabled editors use the existing engine without loading WASM', () => {
  createRoot((dispose) => {
    const load = vi.fn(async () => 'native');
    const engine = createEditorEngineState(() => false, load);
    expect(engine.ready()).toBe(true);
    expect(load).not.toHaveBeenCalled();
    expect(() => engine.module()).toThrow('Native editor engine is not ready');
    dispose();
  });
});

test('waits for flag resolution and exposes the initialized module synchronously', async () => {
  let resolve!: (value: string) => void;
  const pending = new Promise<string>((done) => {
    resolve = done;
  });
  const scope = createRoot((dispose) => {
    const [enabled, setEnabled] = createSignal<boolean | undefined>();
    const load = vi.fn(() => pending);
    const engine = createEditorEngineState(enabled, load);
    return { dispose, setEnabled, load, engine };
  });
  try {
    expect(scope.engine.ready()).toBe(false);
    expect(scope.load).not.toHaveBeenCalled();
    scope.setEnabled(true);
    expect(scope.load).toHaveBeenCalledTimes(1);
    expect(scope.engine.ready()).toBe(false);
    expect(() => scope.engine.module()).toThrow(
      'Native editor engine is not ready'
    );
    resolve('initialized native module');
    await pending;
    expect(scope.engine.ready()).toBe(true);
    expect(scope.engine.module()).toBe('initialized native module');
  } finally {
    scope.dispose();
  }
});

test('a late initialization cannot expose the native module after disabling the flag', async () => {
  let resolve!: (value: string) => void;
  const pending = new Promise<string>((done) => {
    resolve = done;
  });
  const scope = createRoot((dispose) => {
    const [enabled, setEnabled] = createSignal(true);
    const engine = createEditorEngineState(enabled, () => pending);
    return { dispose, setEnabled, engine };
  });
  try {
    expect(scope.engine.ready()).toBe(false);
    scope.setEnabled(false);
    expect(scope.engine.ready()).toBe(true);
    resolve('late native module');
    await pending;
    expect(scope.engine.ready()).toBe(true);
    expect(() => scope.engine.module()).toThrow(
      'Native editor engine is not ready'
    );
  } finally {
    scope.dispose();
  }
});
