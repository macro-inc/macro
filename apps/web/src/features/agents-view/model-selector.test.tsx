import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { UnifiedModelSelectorState } from './components/unified-model-selector/root';
import { UnifiedModelSelector } from './model-selector';

const mocks = vi.hoisted(() => ({
  userId: (): string | undefined => 'user-a',
  selector: undefined as UnifiedModelSelectorState | undefined,
  afterPaint: vi.fn(),
  finish: vi.fn(),
  cancel: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@core/context/user', () => ({
  useUserId: () => () => mocks.userId(),
}));
vi.mock('@core/mobile/isTouchDevice', () => ({ isTouchDevice: () => false }));
vi.mock('@app/observability/ui-operation', () => ({
  startUiOperation: () => ({
    run: (action: () => unknown) => action(),
    afterPaint: mocks.afterPaint,
    finish: mocks.finish,
    cancel: mocks.cancel,
    span: { error: mocks.error },
  }),
}));
vi.mock('./views/model-selector/desktop-model-selector', async () => {
  const { useUnifiedModelSelector } = await import(
    './components/unified-model-selector/root'
  );
  return {
    DesktopModelSelector: () => {
      mocks.selector = useUnifiedModelSelector();
      return null;
    },
  };
});

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  mocks.userId = () => 'user-a';
});
afterEach(cleanup);

function mount(onModel: UnifiedModelSelectorState['onModel']) {
  render(() => (
    <UnifiedModelSelector
      state={{
        models: [],
        suggestedModels: [],
        onModel,
        onEffort: vi.fn(),
        onSpeed: vi.fn(),
      }}
    />
  ));
}

describe('selector action ownership', () => {
  it('keeps the operation open and records history only after async confirmation', async () => {
    let finish!: (value: boolean) => void;
    mount(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        })
    );
    await mocks.selector!.onModel('accepted-model');
    expect(mocks.selector!.recentModelIds).toEqual([]);
    expect(mocks.afterPaint).not.toHaveBeenCalled();
    finish(true);
    await Promise.resolve();
    expect(mocks.selector!.recentModelIds).toEqual(['accepted-model']);
    expect(mocks.afterPaint).toHaveBeenCalledOnce();
  });
  it('does not remember rejected choices and records failure', async () => {
    mount(async () => false);
    await mocks.selector!.onModel('rejected-model');
    await Promise.resolve();
    expect(mocks.selector!.recentModelIds).toEqual([]);
    expect(mocks.finish).toHaveBeenCalledWith('error');
  });
  it('does not write an old account selection into a new account', async () => {
    const [userId, setUserId] = createSignal('user-a');
    mocks.userId = userId;
    let finish!: (value: boolean) => void;
    mount(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        })
    );
    await mocks.selector!.onModel('late-model');
    setUserId('user-b');
    finish(true);
    await Promise.resolve();
    expect(mocks.selector!.recentModelIds).toEqual([]);
    expect(localStorage.getItem('agent-model-recent-v1:user-a')).toBeNull();
    expect(localStorage.getItem('agent-model-recent-v1:user-b')).toBeNull();
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });
});
