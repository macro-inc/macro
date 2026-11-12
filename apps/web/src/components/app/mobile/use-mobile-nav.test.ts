import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { SplitContent } from '../split-layout/layoutManager';

const mocks = vi.hoisted(() => ({
  content: (): SplitContent | undefined => undefined,
  open: vi.fn(),
  replace: vi.fn(),
  native: false,
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({
    activeSplit: () => ({ content: mocks.content }),
  }),
}));
vi.mock('../split-layout/layout', () => ({
  useSplitLayout: () => ({
    openWithSplit: mocks.open,
    replaceAllSplits: mocks.replace,
  }),
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({ toggleSettings: vi.fn() }),
}));
vi.mock('@core/mobile/isNativeMobilePlatform', () => ({
  isNativeMobilePlatform: () => mocks.native,
}));
vi.mock(
  '@app/features/notifications-inbox/use-unified-notifications-flag',
  () => ({ useUnifiedNotificationsFlag: () => () => false })
);

import {
  useForegroundMobileView,
  useMobileNavNavigate,
} from './use-mobile-nav';

describe('mobile Projects navigation', () => {
  it('opens the project collection separately from Tasks and recognizes pushed project details', () => {
    createRoot((dispose) => {
      const [content, setContent] = createSignal<SplitContent>({
        type: 'component',
        id: 'tasks',
      });
      mocks.content = content;
      mocks.native = false;
      const current = useForegroundMobileView();
      const navigate = useMobileNavNavigate();
      expect(current()).toBe('tasks');
      navigate('projects');
      const target = mocks.open.mock.calls.at(-1)?.[0];
      expect(target.entryMetadata.route.matches.at(-1).id).toBe(
        'tasks-projects'
      );
      setContent(target);
      expect(current()).toBe('projects');
      setContent({
        type: 'component',
        id: 'tasks',
        entryMetadata: {
          route: {
            matches: [
              { id: 'app', params: {} },
              { id: 'view-tasks', params: {} },
              { id: 'tasks-project', params: { projectId: 'project' } },
            ],
          },
        },
      });
      expect(current()).toBe('projects');
      navigate('tasks');
      setContent(mocks.open.mock.calls.at(-1)?.[0]);
      expect(current()).toBe('tasks');
      dispose();
    });
  });
});
