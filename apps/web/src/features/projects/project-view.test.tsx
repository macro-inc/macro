import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { type Accessor, createSignal, type ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type { ProjectCreationResult } from './context/projects-context';
import {
  failedProjectDraft,
  type ProjectComposerSubmission,
} from './primitives/create-project';

const fixtures = vi.hoisted(() => ({
  popover: false,
  close: vi.fn(),
  open: vi.fn(),
  replace: vi.fn(),
  navigate: vi.fn(),
  routed: (() => true) as Accessor<boolean>,
  submission: undefined as ProjectComposerSubmission | undefined,
  manager: { openWithSplit: vi.fn(), createPopoverSplit: vi.fn() },
  toast: vi.fn(),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => fixtures.manager,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { success: fixtures.toast },
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableProjects: {},
  isFeatureEnabled: () => true,
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
  CreateProject: (props: {
    onSubmit(submission: ProjectComposerSubmission): void;
  }) => (
    <button onClick={() => props.onSubmit(fixtures.submission!)}>Create</button>
  ),
}));

import { CreateProjectView, ProjectView } from './project-view';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const projectId = '01992d2f-8444-7000-8000-000000000001';
const draft = { name: 'Launch', shareWithTeam: true, properties: [] };
function submit(popover: boolean) {
  fixtures.popover = popover;
  const result = Promise.withResolvers<ProjectCreationResult>();
  fixtures.submission = { draft, result: result.promise };
  const view = render(() => <CreateProjectView />);
  fireEvent.click(view.getByRole('button'));
  return { ...view, settle: result.resolve };
}

it.each([true, false])(
  'closes on submit and offers the created project without navigating, popover=%s',
  async (popover) => {
    const { settle, unmount } = submit(popover);
    if (popover) {
      expect(fixtures.close).toHaveBeenCalledOnce();
      expect(fixtures.replace).not.toHaveBeenCalled();
    } else {
      // Back must not return to the submitted composer.
      expect(fixtures.replace).toHaveBeenCalledWith({
        content: { type: 'component', id: 'tasks-projects' },
        mergeHistory: true,
      });
    }
    // The server answers after the composer, and its panel, are gone.
    unmount();
    settle({ status: 'created', id: projectId });
    await vi.waitFor(() => expect(fixtures.toast).toHaveBeenCalledOnce());
    expect(fixtures.manager.openWithSplit).not.toHaveBeenCalled();
    const [message, { actions }] = fixtures.toast.mock.calls[0];
    expect(message).toBe('Project created');
    actions[1].onClick();
    expect(fixtures.manager.openWithSplit).toHaveBeenCalledWith(
      { type: 'component', id: `initiative-view~${projectId}~overview` },
      { preferNewSplit: true }
    );
    expect(fixtures.open).not.toHaveBeenCalled();
  }
);

it.each([
  { status: 'failed', error: new Error('offline') },
  { status: 'propertiesFailed', id: projectId, error: new Error('offline') },
] satisfies Exclude<ProjectCreationResult, { status: 'created' }>[])(
  'reopens the composer with the draft after $status',
  async (result) => {
    const { settle, unmount } = submit(true);
    unmount();
    settle(result);
    await vi.waitFor(() =>
      expect(fixtures.manager.createPopoverSplit).toHaveBeenCalledOnce()
    );
    expect(fixtures.manager.createPopoverSplit).toHaveBeenCalledWith({
      content: {
        type: 'component',
        id: 'project-compose',
        params: { initialDraft: failedProjectDraft(draft, result) },
      },
    });
    expect(fixtures.toast).not.toHaveBeenCalled();
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
