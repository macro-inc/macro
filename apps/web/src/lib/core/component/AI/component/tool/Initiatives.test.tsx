import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import {
  type Component,
  createSignal,
  type JSX,
  type ParentProps,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { initiativeToolHandlers } from './Initiatives';

const open = vi.hoisted(() => vi.fn());
const invalidate = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const [projectsEnabled, setProjectsEnabled] = createSignal(true);
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: projectsEnabled() }),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableProjects: { key: 'enable-projects' },
  isFeatureEnabled: () => projectsEnabled(),
}));
vi.mock('@queries/client', () => ({
  queryClient: { invalidateQueries: invalidate },
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => ({ openWithSplit: open }),
}));
vi.mock('@app/features/activity/views/activity-timeline-row', () => ({
  ActivityTimelineRow: () => null,
}));
vi.mock('@app/features/activity/open-entity-in-split', () => ({
  openEntityInSplit: vi.fn(),
}));
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdownContext: (props: ParentProps) => props.children,
    StaticMarkdown: (props: { markdown: string }) => <p>{props.markdown}</p>,
  })
);
vi.mock('@ui', () => ({
  Layer: (props: ParentProps) => props.children,
  Button: (props: JSX.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button
      type="button"
      onClick={props.onClick}
      aria-expanded={props['aria-expanded']}
    >
      {props.children}
    </button>
  ),
}));
beforeEach(() => setProjectsEnabled(true));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const projectId = '01992d2f-8444-7000-8000-000000000001';
const messageId = '01992d2f-8444-7000-8000-000000000002';
function tool(
  name: keyof typeof initiativeToolHandlers,
  data: unknown,
  response?: unknown
) {
  return render(() => (
    <Dynamic
      component={
        initiativeToolHandlers[name].render as Component<
          Record<string, unknown>
        >
      }
      tool={{ name, data }}
      response={response === undefined ? undefined : { name, data: response }}
      renderContext={{ isStreaming: response === undefined, grouped: false }}
    />
  ));
}

it('shows a pending search without claiming empty results', () => {
  tool('ListInitiatives', {});
  expect(screen.getByText('Find projects')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
  expect(screen.queryByText('No matching projects.')).toBeNull();
});

it('expands project results and opens a native project view', () => {
  tool(
    'ListInitiatives',
    {},
    {
      projects: [
        {
          initiativeId: projectId,
          name: 'Launch',
          completedTaskCount: 2,
          taskCount: 5,
        },
      ],
      truncated: true,
    }
  );
  const toggle = screen.getByRole('button', { name: '1+ projects' });
  expect(toggle.getAttribute('aria-expanded')).toBe('false');
  fireEvent.click(toggle);
  expect(screen.getByText('2/5 tasks done')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Launch' }), {
    shiftKey: true,
  });
  expect(open).toHaveBeenCalledWith(
    { type: 'component', id: `initiative-view~${projectId}~overview` },
    { preferNewSplit: true }
  );
});

it('expands posted comments and links to the exact discussion', () => {
  tool(
    'PostInitiativeComment',
    { initiativeId: projectId, content: 'Ship it' },
    { id: messageId, content: 'Ship it', reactions: [], deleted_at: null }
  );
  fireEvent.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.getByText('Ship it')).toBeTruthy();
  fireEvent.click(
    screen.getAllByRole('button', { name: 'Open discussion' })[0]
  );
  expect(open).toHaveBeenCalledWith(
    {
      type: 'component',
      id: `initiative-view~${projectId}~overview~${messageId}`,
    },
    { preferNewSplit: false }
  );
});

it('preserves per-task failures and unavailable references in expandable results', () => {
  tool(
    'SetTaskInitiative',
    { initiativeId: projectId },
    {
      results: [
        { taskId: 'a', status: 'assigned' },
        { taskId: 'b', status: 'skippedNoPermission' },
      ],
    }
  );
  fireEvent.click(screen.getByRole('button', { name: '2 tasks' }));
  expect(screen.getByText('Task 2: skipped no permission')).toBeTruthy();
  cleanup();
  tool(
    'ReadTaskInitiatives',
    { taskIds: ['a'] },
    {
      references: [{ state: 'unavailable', taskId: 'a' }],
    }
  );
  fireEvent.click(screen.getByRole('button', { name: '1 task' }));
  expect(screen.getByText('Unavailable project')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Project' })).toBeNull();
});

it('keeps successful deletion results inspectable without a stale project link', () => {
  tool('DeleteInitiative', { initiativeId: projectId }, { success: true });
  fireEvent.click(screen.getByRole('button', { name: 'Deleted' }));
  expect(screen.getByText('Project deleted.')).toBeTruthy();
  expect(screen.getByText('Result data')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Project' })).toBeNull();
});

it('shows complete thread replies and hides deleted comment text', () => {
  tool(
    'ReadInitiativeDiscussions',
    { initiativeId: projectId, threadId: messageId },
    {
      type: 'thread',
      thread: {
        root: { id: messageId, content: 'Original', reactions: [] },
        replies: [
          { id: 'reply', content: 'Reply content', reactions: [] },
          {
            id: 'deleted',
            content: 'Removed text',
            reactions: [],
            deleted_at: '2026-09-22T12:00:00Z',
          },
        ],
      },
    }
  );
  fireEvent.click(screen.getByRole('button', { name: '3 comments' }));
  expect(screen.getByText('Original')).toBeTruthy();
  expect(screen.getByText('Reply content')).toBeTruthy();
  expect(screen.getByText('Comment deleted')).toBeTruthy();
  expect(screen.queryByText('Removed text')).toBeNull();
});

it('refreshes native project caches after a completed tool mutation', async () => {
  await initiativeToolHandlers.CreateInitiative.handleResponse?.({} as never);
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['initiatives'] });
});

it('keeps historical results readable while disabling project navigation', () => {
  setProjectsEnabled(false);
  tool(
    'ListInitiatives',
    {},
    {
      projects: [
        {
          initiativeId: projectId,
          name: 'Launch',
          completedTaskCount: 2,
          taskCount: 5,
        },
      ],
      truncated: false,
    }
  );
  fireEvent.click(screen.getByRole('button', { name: '1 project' }));
  expect(screen.getByText('Launch')).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Launch' })).toBeNull();

  setProjectsEnabled(true);
  expect(screen.getByRole('button', { name: 'Launch' })).toBeTruthy();
  setProjectsEnabled(false);
  expect(screen.queryByRole('button', { name: 'Launch' })).toBeNull();
  expect(open).not.toHaveBeenCalled();
});

it('does not refresh project data when projects are disabled', async () => {
  setProjectsEnabled(false);
  await initiativeToolHandlers.CreateInitiative.handleResponse?.({} as never);
  expect(invalidate).not.toHaveBeenCalled();
});
