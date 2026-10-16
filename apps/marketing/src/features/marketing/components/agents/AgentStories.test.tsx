import { cleanup, fireEvent, render, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  createDummyWorkspace,
  type DummyWorkspace,
} from '../../primitives/createDummyWorkspace';
import DummyWorkspaceView from '../workspace/DummyWorkspace';
import { AgentMcpDemo } from './AgentStories';
import { NorthwindCollaboration } from './NorthwindCollaboration';
import { NorthwindSession, NorthwindStory } from './NorthwindSession';
import { createNorthwindAccessTask, NORTHWIND_PLAN } from './northwindScenario';

let intersections: IntersectionObserverCallback[];
let reduced = false;
beforeEach(() => {
  intersections = [];
  reduced = false;
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn());
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => false);
  vi.stubGlobal('matchMedia', () => ({
    get matches() {
      return reduced;
    },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        intersections.push(callback);
      }
      observe() {}
      disconnect() {}
    }
  );
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.advanceTimersByTime(100);
  expect(fetch).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function visible() {
  for (const callback of intersections)
    callback(
      [{ isIntersecting: true } as IntersectionObserverEntry],
      {} as IntersectionObserver
    );
}

it.each(['complete', 'sources', 'actions'] as const)(
  'keeps the %s scene in one pane until a visitor opens a record',
  (scene) => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
    const view = render(() => (
      <NorthwindSession
        workspace={createDummyWorkspace('agents')}
        scene={scene}
      />
    ));
    expect(view.queryByRole('region', { name: 'Opened item' })).toBeNull();
    visible();
    vi.advanceTimersByTime(6000);
    expect(view.queryByRole('region', { name: 'Opened item' })).toBeNull();
    fireEvent.click(view.getAllByRole('button', { name: 'rollout plan' })[0]);
    expect(view.getByRole('region', { name: 'Opened item' })).toBeTruthy();
    fireEvent.click(view.getByRole('button', { name: 'Close opened item' }));
    expect(view.queryByRole('region', { name: 'Opened item' })).toBeNull();
  }
);

it('keeps the completed reduced-motion scene in one pane', () => {
  reduced = true;
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  const view = render(() => <NorthwindStory scene="actions" />);
  expect(view.getByRole('button', { name: 'SSO verification' })).toBeTruthy();
  expect(view.queryByRole('region', { name: 'Opened item' })).toBeNull();
});

it('opens the hero on the completed job and keeps task edits when reopened', () => {
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const view = render(() => (
    <DummyWorkspaceView
      initialView="agents"
      initialAgent="northwind"
      embedded
    />
  ));
  const log = within(view.getByRole('log', { name: 'Northwind rollout' }));
  fireEvent.click(log.getByRole('button', { name: 'SSO verification' }));
  const opened = within(view.getByRole('region', { name: 'Opened item' }));
  expect(opened.getByRole('textbox', { name: 'Task title' }).textContent).toBe(
    'Verify Northwind SSO before the pilot'
  );
  const title = opened.getByRole('textbox', { name: 'Task title' });
  title.textContent = 'Send the revised pricing';
  Object.defineProperty(title, 'innerText', {
    configurable: true,
    value: 'Send the revised pricing',
  });
  fireEvent.blur(title);
  fireEvent.click(view.getByRole('button', { name: 'Close opened item' }));
  fireEvent.click(log.getByRole('button', { name: 'SSO verification' }));
  expect(view.getByRole('textbox', { name: 'Task title' }).textContent).toBe(
    'Send the revised pricing'
  );
});

it('opens the email and call evidence from the same conversation', () => {
  const view = render(() => <NorthwindStory scene="sources" />);
  visible();
  vi.advanceTimersByTime(3900);
  fireEvent.click(
    view.getByRole('button', { name: /Northwind rollout requirements/ })
  );
  const opened = within(view.getByRole('region', { name: 'Opened item' }));
  expect(
    opened.getByText(/operations group has grown to 40 people/)
  ).toBeTruthy();
  fireEvent.click(view.getByRole('button', { name: 'Close opened item' }));
  fireEvent.click(
    view.getByRole('button', { name: /Northwind rollout decision/ })
  );
  expect(
    view.getByRole('heading', { name: 'Northwind rollout decision' })
  ).toBeTruthy();
  expect(view.getByRole('heading', { name: 'Transcript' })).toBeTruthy();
});

it('reveals the conflicting sources before its judgment without changing the records', () => {
  let w!: DummyWorkspace;
  const view = render(() => {
    w = createDummyWorkspace('agents');
    return <NorthwindSession workspace={w} scene="sources" />;
  });
  expect(
    view.getByRole('button', { name: '1 hit' }).getAttribute('aria-expanded')
  ).toBe('true');
  expect(view.queryByText(/Friday isn’t ready yet\./)).toBeNull();
  visible();
  vi.advanceTimersByTime(1300);
  expect(view.getByRole('button', { name: '2 hits' })).toBeTruthy();
  vi.advanceTimersByTime(1300);
  expect(view.getByRole('button', { name: '4 hits' })).toBeTruthy();
  vi.advanceTimersByTime(1300);
  expect(view.getByText(/Friday isn’t ready yet\./)).toBeTruthy();
  expect(
    w.data.documents.find((d) => d.id === 'northwind-plan')?.body
  ).not.toBe(NORTHWIND_PLAN);
  expect(w.data.tasks.find((t) => t.id === 'northwind-training')?.owner).toBe(
    'jacob'
  );
  expect(w.data.tasks.some((t) => t.id === 'northwind-sso')).toBe(false);
  fireEvent.click(view.getByRole('button', { name: '4 hits' }));
  expect(
    view.queryByRole('button', { name: /Northwind rollout requirements/ })
  ).toBeNull();
  fireEvent.click(view.getByRole('button', { name: '4 hits' }));
  expect(
    view.getByRole('button', { name: /Northwind rollout requirements/ })
  ).toBeTruthy();
});

it('shows the complete discovery with reduced motion', () => {
  reduced = true;
  const view = render(() => <NorthwindStory scene="sources" />);
  expect(view.getByRole('button', { name: '4 hits' })).toBeTruthy();
  expect(view.getByText(/Friday isn’t ready yet\./)).toBeTruthy();
});

it('updates the plan once visible and starts completed for reduced motion', () => {
  reduced = true;
  const view = render(() => <NorthwindStory scene="actions" />);
  fireEvent.click(view.getByRole('button', { name: 'rollout plan' }));
  expect(
    view.getByText(/Start with 10 operations staff on Friday/)
  ).toBeTruthy();
});

it('does not overwrite an edit after a visitor takes control', () => {
  let workspace!: DummyWorkspace;
  const view = render(() => {
    workspace = createDummyWorkspace('agents');
    return <NorthwindSession workspace={workspace} scene="actions" />;
  });
  visible();
  fireEvent.pointerDown(view.getByRole('log', { name: 'Northwind rollout' }));
  workspace.setData(
    'documents',
    (d) => d.id === 'northwind-plan',
    'body',
    'Keep my revised plan.'
  );
  vi.advanceTimersByTime(6000);
  expect(
    workspace.data.documents.find((d) => d.id === 'northwind-plan')?.body
  ).toBe('Keep my revised plan.');
});

it('updates the plan and task ownership without falsely completing the access check', () => {
  let w!: DummyWorkspace;
  const view = render(() => {
    w = createDummyWorkspace('agents');
    return <NorthwindSession workspace={w} scene="actions" />;
  });
  expect(w.data.tasks.find((t) => t.id === 'northwind-training')?.owner).toBe(
    'jacob'
  );
  expect(w.data.tasks.some((t) => t.id === 'northwind-sso')).toBe(false);
  expect(view.queryByRole('button', { name: 'rollout plan' })).toBeNull();
  visible();
  vi.advanceTimersByTime(1300);
  expect(view.getByRole('button', { name: 'rollout plan' })).toBeTruthy();
  expect(
    view.queryByRole('button', { name: 'Training for 40 people' })
  ).toBeNull();
  expect(w.data.documents.find((d) => d.id === 'northwind-plan')?.body).toBe(
    NORTHWIND_PLAN
  );
  expect(w.data.tasks.find((t) => t.id === 'northwind-training')?.owner).toBe(
    'jacob'
  );
  vi.advanceTimersByTime(1300);
  expect(
    view.getByRole('button', { name: 'Training for 40 people' })
  ).toBeTruthy();
  expect(view.queryByRole('button', { name: 'SSO verification' })).toBeNull();
  expect(w.data.tasks.find((t) => t.id === 'northwind-training')?.owner).toBe(
    'julia'
  );
  vi.advanceTimersByTime(1300);
  expect(view.getByRole('button', { name: 'SSO verification' })).toBeTruthy();
  expect(w.data.tasks.find((t) => t.id === 'northwind-sso')).toMatchObject({
    owner: 'teo',
    status: 'Not Started',
    priority: 'Urgent',
  });
  createNorthwindAccessTask(w);
  expect(w.data.tasks.filter((t) => t.id === 'northwind-sso')).toHaveLength(1);
});

it('shows both collaborators’ edits and preserves a visitor’s later writing', () => {
  const view = render(() => <NorthwindCollaboration />);
  visible();
  vi.advanceTimersByTime(3900);
  const body = view.getByRole('textbox', { name: 'Document body' });
  expect(body.textContent).toContain('Teo verifies SSO before the pilot.');
  expect(body.textContent).toContain(
    'Marcus will send the names of the 10 pilot participants today.'
  );
  fireEvent.pointerDown(body);
  body.textContent = 'Keep my own rollout note.';
  fireEvent.blur(body);
  vi.advanceTimersByTime(5000);
  expect(body.textContent).toBe('Keep my own rollout note.');
});

it('switches Work and Code while keeping the unsent prompt', () => {
  const view = render(() => (
    <DummyWorkspaceView initialView="agents" embedded />
  ));
  const input = view.getByRole('textbox', { name: 'Message the agent' });
  input.textContent = 'Investigate the customer follow-up';
  fireEvent.input(input);
  fireEvent.click(view.getByRole('radio', { name: 'Code' }));
  expect(
    view.getByRole('heading', { name: 'What should we build?' })
  ).toBeTruthy();
  expect(
    view.getByRole('textbox', { name: 'Message the agent' }).textContent
  ).toBe('Investigate the customer follow-up');
  expect(view.getByRole('button', { name: 'Choose repository' })).toBeTruthy();
});

it('lists the real MCP command and does not report copy success on failure', async () => {
  const view = render(() => <AgentMcpDemo />);
  expect(
    view.getByText(
      'claude mcp add --transport http macro https://mcp-server.macro.com/mcp'
    )
  ).toBeTruthy();
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error('Not allowed')) },
  });
  fireEvent.click(view.getByRole('button', { name: 'Copy' }));
  await Promise.resolve();
  expect(view.queryByText('Copied')).toBeNull();
});

it('returns focus to Share when the local sharing sheet closes', async () => {
  const view = render(() => <NorthwindStory scene="sources" />);
  const share = view.getByRole('button', { name: 'Share' });
  fireEvent.click(share);
  await Promise.resolve();
  const input = view.getByRole('textbox', { name: 'Email or group' });
  expect(document.activeElement).toBe(input);
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(view.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(share);
});

it('applies the scripted document edit once the action scene becomes visible', () => {
  let workspace!: DummyWorkspace;
  render(() => {
    workspace = createDummyWorkspace('agents');
    return <NorthwindSession workspace={workspace} scene="actions" />;
  });
  expect(
    workspace.data.documents.find((doc) => doc.id === 'northwind-plan')?.body
  ).not.toBe(NORTHWIND_PLAN);
  visible();
  vi.advanceTimersByTime(4000);
  expect(
    workspace.data.documents.find((doc) => doc.id === 'northwind-plan')?.body
  ).toBe(NORTHWIND_PLAN);
});

it('filters the conversation list and restores it on Escape', async () => {
  const view = render(() => (
    <DummyWorkspaceView initialView="agents" embedded />
  ));
  fireEvent.click(view.getByRole('button', { name: 'Search conversations' }));
  await Promise.resolve();
  const search = view.getByRole('searchbox', { name: 'Search conversations' });
  fireEvent.input(search, { target: { value: 'Northwind' } });
  expect(view.getByRole('button', { name: 'Northwind rollout' })).toBeTruthy();
  expect(
    view.queryByRole('button', { name: 'Fix the deploy pipeline' })
  ).toBeNull();
  fireEvent.keyDown(search, { key: 'Escape' });
  expect(
    view.getByRole('button', { name: 'Fix the deploy pipeline' })
  ).toBeTruthy();
});

it('keeps the created task linked to the same rollout plan and source discussion', () => {
  const view = render(() => (
    <DummyWorkspaceView
      initialView="agents"
      initialAgent="northwind"
      embedded
    />
  ));
  fireEvent.click(view.getByRole('button', { name: 'SSO verification' }));
  const pane = within(view.getByRole('region', { name: 'Opened item' }));
  expect(
    pane.getByRole('button', { name: 'Northwind rollout plan' })
  ).toBeTruthy();
  expect(pane.queryByRole('button', { name: 'Q3 launch plan' })).toBeNull();
  fireEvent.click(pane.getByRole('button', { name: 'From customers' }));
  expect(view.getByText(/Northwind now needs 40 seats and SSO/)).toBeTruthy();
});
