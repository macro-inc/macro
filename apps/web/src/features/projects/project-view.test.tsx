import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { type Accessor, createSignal, type ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const fixtures = vi.hoisted(() => ({
  popover: false,
  close: vi.fn(),
  open: vi.fn(),
  replace: vi.fn(),
  navigate: vi.fn(),
  routed: (() => true) as Accessor<boolean>,
}));
vi.mock('@app/features/tasks-view/route', () => ({
  projectDetailRoute: {},
  tasksProjectsRoute: {},
}));
vi.mock('@app/lib/split-router', () => ({
  useNavigate: () => fixtures.navigate,
  useSplitHistory: () => () => (fixtures.routed() ? { index: 0 } : undefined),
}));
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

import { CreateProjectView, ProjectView } from './project-view';

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

it('redirects a project link once the router tracks its newly opened split', () => {
  const [routed, setRouted] = createSignal(false);
  fixtures.routed = routed;
  render(() => (
    <ProjectView
      route={{
        id: '01992d2f-8444-7000-8000-000000000001',
        section: 'tasks',
      }}
    />
  ));
  expect(fixtures.navigate).not.toHaveBeenCalled();
  setRouted(true);
  expect(fixtures.navigate).toHaveBeenCalledOnce();
  expect(fixtures.navigate.mock.calls[0][0].params).toEqual({
    projectId: '01992d2f-8444-7000-8000-000000000001',
    section: 'tasks',
  });
  setRouted(false);
  setRouted(true);
  expect(fixtures.navigate).toHaveBeenCalledOnce();
});
