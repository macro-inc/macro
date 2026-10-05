import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDatabaseDiscoverySync } from './databases';
import { databasesKeys } from './keys';

const mocks = vi.hoisted(() => ({
  flag: (): boolean => true,
  invalidate: vi.fn(async () => {}),
}));
vi.mock('@app/lib/analytics', () => ({ analytics: {} }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.flag() }),
}));
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));
vi.mock('@queries/client', () => ({
  queryClient: { invalidateQueries: mocks.invalidate },
}));

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  vi.clearAllMocks();
});
function setup() {
  return createRoot((cleanup) => {
    dispose = cleanup;
    const [active, setActive] = createSignal(false);
    const [enabled, setEnabled] = createSignal(true);
    mocks.flag = enabled;
    useDatabaseDiscoverySync(active);
    return { setActive, setEnabled };
  });
}

describe('database command discovery refresh', () => {
  it('refreshes the shared catalog on each opening, covering AI creation between openings', () => {
    const { setActive } = setup();
    expect(mocks.invalidate).not.toHaveBeenCalled();
    setActive(true);
    expect(mocks.invalidate).toHaveBeenCalledExactlyOnceWith({
      queryKey: databasesKeys.list.queryKey,
    });
    setActive(false);
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
    setActive(true);
    expect(mocks.invalidate).toHaveBeenCalledTimes(2);
  });
  it('does not refresh when databases are disabled and responds when the flag becomes available', () => {
    const { setActive, setEnabled } = setup();
    setEnabled(false);
    setActive(true);
    expect(mocks.invalidate).not.toHaveBeenCalled();
    setEnabled(true);
    expect(mocks.invalidate).toHaveBeenCalledOnce();
  });
});
