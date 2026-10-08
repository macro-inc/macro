import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useMobileNavNavigate } from './use-mobile-nav';

const mocks = vi.hoisted(() => ({
  native: false,
  openWithSplit: vi.fn(),
  replaceAllSplits: vi.fn(),
}));

vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({
    activeSplit: () => ({ content: () => ({ type: 'component', id: 'home' }) }),
  }),
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ toggleSettings: vi.fn() }),
}));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => mocks.native,
}));
vi.mock('../split-layout/layout', () => ({
  useSplitLayout: () => mocks,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.native = false;
});

describe('mobile navigation defaults', () => {
  it.each([false, true])(
    'passes Files and Reviews destinations through navigation (native: %s)',
    (native) => {
      mocks.native = native;
      const navigate = useMobileNavNavigate();
      const open = native ? mocks.replaceAllSplits : mocks.openWithSplit;
      const unused = native ? mocks.openWithSplit : mocks.replaceAllSplits;

      navigate('documents');
      expect(open.mock.calls[0][0]).toMatchObject({
        type: 'component',
        id: 'documents',
        entryMetadata: {
          route: {
            matches: [
              { id: 'app', params: {} },
              { id: 'drive', params: {} },
              { id: 'drive-tab', params: { tab: 'recent' } },
            ],
          },
        },
      });

      navigate('reviews');
      expect(open.mock.calls[1][0]).toMatchObject({
        type: 'component',
        id: 'reviews',
        entryMetadata: { search: { reviews: { tab: ['all'] } } },
      });
      expect(unused).not.toHaveBeenCalled();
      if (!native) {
        expect(open.mock.calls[1][1]).toEqual({
          mergeHistory: true,
          search: {},
        });
      }
    }
  );
});
