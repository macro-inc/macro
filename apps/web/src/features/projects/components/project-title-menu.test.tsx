import type { BlockTool } from '@components/app/block-tool';
import type { SplitFileMenuViews } from '@components/app/split-layout/components/SplitFileMenu';
import { Permissions } from '@core/component/SharePermissions';
import type { Property } from '@property/types';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal, type ParentProps } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import type {
  ProjectSource,
  ProjectsContext,
} from '../context/projects-context';
import type { ProjectDetail } from '../core/project';
import { ProjectTitleMenu } from '../project-title-menu';

const mocks = vi.hoisted(() => ({
  mobile: true,
  touch: true,
  trigger: vi.fn(),
  tools: [] as BlockTool[],
  views: undefined as SplitFileMenuViews | undefined,
  permissions: undefined as Permissions | undefined,
  entity: undefined as { type: string; ownerId: string } | undefined,
  openProject: vi.fn(),
}));

vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => mocks.mobile }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.touch,
}));
vi.mock('@core/component/EntityIcon', () => ({
  EntityIcon: () => null,
  getIconConfig: () => ({ icon: () => null }),
}));
vi.mock('@components/app/split-layout/components/HeaderIsland', () => ({
  HeaderIsland: (
    props: ParentProps<{ onClick?: (event: MouseEvent) => void }>
  ) => <div onClick={props.onClick}>{props.children}</div>,
}));
vi.mock('@components/app/split-layout/components/SplitLabel', () => ({
  SplitTitleFileMenu: (props: ParentProps) => <>{props.children}</>,
  titleFileMenuMount: () => () => {},
}));
vi.mock('@components/app/split-layout/components/SplitFileMenu', () => ({
  SplitFileMenu: (props: {
    tools: BlockTool[];
    mobileViews?: SplitFileMenuViews;
    permissions: Permissions;
    entity: { type: string; ownerId: string };
  }) => {
    mocks.tools = props.tools;
    mocks.views = props.mobileViews;
    mocks.permissions = props.permissions;
    mocks.entity = props.entity;
    return null;
  },
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({}),
}));
vi.mock('@components/app/split-layout/layoutUtils', () => ({
  useSplitPanelOrThrow: () => ({ titleFileMenuTrigger: () => mocks.trigger }),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({ canAppendSplit: () => true }),
}));
vi.mock('@app/lib/i18n', () => ({ t: (key: string) => key }));
vi.mock('../open-project', () => ({ openProject: mocks.openProject }));
vi.mock('../context/projects-context', () => ({
  useProjectsContext: () => ({
    createPropertyDefinitionsSource: () => ({ properties: () => [] }),
  }),
}));
vi.mock('./rename-project-dialog', () => ({
  RenameProjectDialog: () => <div>Rename dialog</div>,
}));
vi.mock('./delete-projects-dialog', () => ({
  DeleteProjectsDialog: () => <div>Delete dialog</div>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.mobile = true;
  mocks.touch = true;
  mocks.views = undefined;
  mocks.tools = [];
});

const project: ProjectDetail = {
  id: 'p',
  name: 'Launch',
  ownerId: 'owner',
  memberIds: [],
  taskIds: [],
  access: 'owner',
  createdAt: '',
  updatedAt: '',
};

function mount(access: ProjectDetail['access'] = 'owner') {
  let section!: () => 'overview' | 'tasks';
  const source: ProjectSource = {
    project: () => project,
    properties: () => [] as Property[],
    loading: () => false,
    error: () => undefined,
    refresh: vi.fn(),
  };
  const unavailable = (): never => {
    throw new Error('Unavailable test capability');
  };
  const commands: ReturnType<ProjectsContext['createCommands']> = {
    pending: () => false,
    rename: vi.fn(),
    delete: vi.fn(),
    createTask: unavailable,
    create: unavailable,
    setMembers: unavailable,
    deleteMany: unavailable,
    assignTasks: unavailable,
    saveProperty: unavailable,
    saveProperties: unavailable,
  };
  render(() => {
    const [currentSection] = createSignal<'overview' | 'tasks'>('overview');
    section = currentSection;
    return (
      <ProjectTitleMenu
        project={{ ...project, access }}
        source={source}
        commands={commands}
        section={section()}
        onShare={vi.fn()}
        onDelete={vi.fn()}
      />
    );
  });
  return { section };
}

it('opens the actions-only shared title drawer from a phone island', () => {
  mount();
  fireEvent.click(screen.getByText('Launch'));
  expect(mocks.trigger).toHaveBeenCalledOnce();
  expect(mocks.views).toBeUndefined();
  expect(mocks.permissions).toBe(Permissions.OWNER);
  expect(mocks.entity).toMatchObject({ type: 'initiative', ownerId: 'owner' });
});

it('retains split navigation for touch tablets', () => {
  mocks.mobile = false;
  mocks.touch = true;
  mount();
  const action = mocks.tools.find(
    (tool) =>
      typeof tool.label === 'function' &&
      tool.label() === 'entityActions.openInNewSplit'
  );
  expect(action?.condition?.()).toBe(true);
});

it('keeps editing and deletion gated while retaining desktop navigation', () => {
  mocks.mobile = false;
  mocks.touch = false;
  mount('view');
  expect(mocks.views).toBeUndefined();
  expect(mocks.permissions).toBe(Permissions.CAN_VIEW);
  expect(
    mocks.tools
      .filter((tool) => tool.condition?.() !== false)
      .map((tool) =>
        typeof tool.label === 'function' ? tool.label() : tool.label
      )
  ).not.toContain('entityActions.rename');
  expect(
    mocks.tools
      .find(
        (tool) =>
          typeof tool.label === 'function' &&
          tool.label() === 'entityActions.delete'
      )
      ?.condition?.()
  ).toBe(false);
  expect(
    mocks.tools
      .find(
        (tool) =>
          typeof tool.label === 'function' &&
          tool.label() === 'entityActions.openInNewSplit'
      )
      ?.condition?.()
  ).toBe(true);
});
