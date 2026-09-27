import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import type { ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  popover: false,
  close: vi.fn(),
  open: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('@app/features/tasks-view/route', () => ({
  projectDetailRoute: {},
  tasksProjectsRoute: {},
}));
vi.mock('@app/lib/split-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({
    openWithSplit: fixtures.open,
    replaceSplit: fixtures.replace,
  }),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({
    handle: {
      isPopover: () => fixtures.popover,
      close: fixtures.close,
      setDisplayName: vi.fn(),
    },
  }),
}));
vi.mock('@components/app/split-panel', () => ({
  SplitPanel: {
    Root: (props: ParentProps) => props.children,
    Body: (props: ParentProps) => props.children,
  },
}));
vi.mock('./projects', () => ({
  Projects: (props: ParentProps) => props.children,
}));
vi.mock('./views/create-project', () => ({
  CreateProject: (props: { onCreated(id: string): void }) => (
    <button
      onClick={() => props.onCreated('01992d2f-8444-7000-8000-000000000001')}
    >
      Create
    </button>
  ),
}));

import { CreateProjectView } from './project-view';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it.each([true, false])(
  'opens the created project while respecting popover=%s',
  (popover) => {
    fixtures.popover = popover;
    const view = render(() => <CreateProjectView />);
    fireEvent.click(view.getByRole('button'));
    const content = {
      type: 'component',
      id: 'initiative-view~01992d2f-8444-7000-8000-000000000001~overview',
    };
    if (popover) {
      expect(fixtures.close).toHaveBeenCalledOnce();
      expect(fixtures.open).toHaveBeenCalledWith(content, {
        preferNewSplit: true,
      });
      expect(fixtures.replace).not.toHaveBeenCalled();
    } else {
      expect(fixtures.replace).toHaveBeenCalledWith({ content });
      expect(fixtures.open).not.toHaveBeenCalled();
    }
  }
);
