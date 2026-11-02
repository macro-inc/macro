import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  wasm: Promise.withResolvers<void>(),
  ui: Promise.withResolvers<void>(),
  wasmStarted: Promise.withResolvers<void>(),
  uiStarted: Promise.withResolvers<void>(),
  constructEditor: vi.fn(),
  constructDocument: vi.fn(),
}));
vi.mock('loro-crdt', async () => {
  state.wasmStarted.resolve();
  await state.wasm.promise;
  return { LoroDoc: state.constructDocument };
});
vi.mock('./component/Block', async () => {
  state.uiStarted.resolve();
  await state.ui.promise;
  return { default: state.constructEditor };
});

it('admits UI and WASM together without constructing an editor or document', async () => {
  const { loadMarkdownComponent } = await import('./load-component');
  const loading = loadMarkdownComponent();
  await Promise.all([state.wasmStarted.promise, state.uiStarted.promise]);
  state.wasm.resolve();
  state.ui.resolve();
  expect((await loading).default).toBe(state.constructEditor);
  expect(state.constructEditor).not.toHaveBeenCalled();
  expect(state.constructDocument).not.toHaveBeenCalled();
});
