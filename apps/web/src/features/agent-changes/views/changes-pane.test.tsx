import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentChangesContext } from '../context/agent-changes-context';
import { AgentChangesControllerProvider } from '../context/agent-changes-controller';
import { createLocalPaneViewState } from '../pane-view-state';
import {
  type AgentChangesController,
  createAgentChanges,
} from '../primitives/create-agent-changes';
import { createMemoryStorage } from '../tests/memory-storage';
import {
  createMockAgentChangesContext,
  MOCK_PATCH,
  mockChangeset,
} from '../tests/mock-context';
import { ChangesPane } from './ChangesPane';
import {
  ChangesHandoff,
  ChangesToggle,
  ReviewNotesDock,
} from './SessionChangesControls';

const device = vi.hoisted(() => ({ touch: false }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => device.touch,
}));
afterEach(() => {
  device.touch = false;
});

// Pierre mounts a custom element and highlights with shiki; the pane test
// covers everything around it and leaves the diff body to the browser.
vi.mock('@app/components/diff-view/pierre/PierreFileDiff', () => ({
  PierreFileDiff: (props: { path: string; diffStyle: string }) => (
    <div
      data-testid="diff"
      data-path={props.path}
      data-style={props.diffStyle}
    />
  ),
}));

// jsdom has no ResizeObserver; the file tree's collapse animation measures with one.
vi.mock('@solid-primitives/resize-observer', () => ({
  createResizeObserver: () => {},
  createElementSize: () => ({ width: 0, height: 0 }),
}));

// Module-load quarantine, not a dependency substitute: the connection-gateway
// websocket connects when imported, which jsdom cannot do.
vi.mock('@service-connection/websocket', () => ({
  ws: { send() {}, addEventListener() {}, removeEventListener() {} },
  state: () => 'closed',
  createConnectionBlockWebsocketEffect() {},
  createConnectionWebsocketEffect() {},
  parseWebsocketPayload: () => undefined,
}));

// The block registry globs every block definition (and their heavy
// dependencies) at import time; the pane never reads it.
vi.mock('@core/constant/allBlocks', () => ({
  blocks: {},
  blockAcceptedMimetypeToFileExtension: {},
  blockAcceptedFileExtensionToMimeType: {},
}));

vi.mock('@service-storage/websocket', () => ({
  storageWS: { send() {}, addEventListener() {}, removeEventListener() {} },
  createWebSocketJob: () => Promise.reject(new Error('no websocket in tests')),
}));

function mount(
  context: AgentChangesContext,
  ui: () => ReturnType<typeof ChangesPane>
) {
  const [dismissed, setDismissed] = createSignal<string>();
  let controller!: AgentChangesController;
  const result = render(() => {
    controller = createAgentChanges({
      context,
      storage: createMemoryStorage(),
      view: createLocalPaneViewState(),
      dismissed: [dismissed, setDismissed],
    });
    return (
      <AgentChangesControllerProvider value={controller}>
        {ui()}
      </AgentChangesControllerProvider>
    );
  });
  return { ...result, controller: () => controller };
}

function readyContext() {
  return createMockAgentChangesContext({
    summary: { capturing: false, changeset: mockChangeset() },
    patch: MOCK_PATCH,
  });
}

describe('ChangesPane', () => {
  it('returns to the touch conversation and uses unified diffs without a side tree', async () => {
    device.touch = true;
    const { controller } = mount(readyContext(), () => <ChangesPane />);
    controller().layout.open();
    controller().setDiffStyle('split');
    await waitFor(() => expect(screen.getAllByTestId('diff')).toHaveLength(2));
    expect(
      screen
        .getAllByTestId('diff')
        .every((diff) => diff.dataset.style === 'unified')
    ).toBe(true);
    expect(
      screen.queryByRole('button', { name: 'Expand changes to the full width' })
    ).toBeNull();
    expect(screen.queryByRole('button', { name: /file tree/ })).toBeNull();
    expect(screen.queryByLabelText('Diff layout')).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'Back to conversation' })
    );
    expect(controller().layout.changesVisible()).toBe(false);
  });
  it('lists files and collapses individual or all diffs without viewed controls', async () => {
    const context = readyContext();
    const { controller } = mount(context, () => <ChangesPane />);
    controller().layout.open();

    expect(
      screen.getByText('agent/unread-archived-sessions → main')
    ).toBeTruthy();
    await waitFor(() => expect(screen.getAllByTestId('diff')).toHaveLength(2));
    expect(screen.queryByRole('button', { name: /^Viewed$/ })).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Mark all viewed' })
    ).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Hide a.ts' }));
    expect(screen.getAllByTestId('diff')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Show a.ts' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }));
    expect(screen.queryAllByTestId('diff')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }));
    expect(screen.getAllByTestId('diff')).toHaveLength(2);
  });

  it('supports a PR host with no agent capabilities', async () => {
    const context = readyContext();
    const { controller } = mount(
      {
        ...context,
        host: {
          ...context.host,
          scopeKey: () => 'pr:macro-inc/macro/1482',
          agent: undefined,
        },
      },
      () => (
        <>
          <ChangesPane />
          <ReviewNotesDock />
        </>
      )
    );
    controller().layout.open();
    await waitFor(() => expect(screen.getAllByTestId('diff')).toHaveLength(2));
    controller().sendQueuedNotes();
    expect(context.sent).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Send to agent' })).toBeNull();
  });

  it('shows refresh failures without discarding the current diff and allows retry', async () => {
    const context = readyContext();
    const refresh = vi
      .fn()
      .mockRejectedValueOnce(new Error('unavailable'))
      .mockResolvedValueOnce(undefined);
    context.source.refresh = refresh;
    const { controller } = mount(context, () => <ChangesPane />);
    controller().layout.open();
    fireEvent.click(
      screen.getByRole('button', { name: /Refresh pull request changes/ })
    );
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        'could not be refreshed'
      )
    );
    expect(screen.getAllByTestId('diff')).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('explains that a linked GitHub PR is required', () => {
    const context = createMockAgentChangesContext({
      summary: {
        capturing: false,
        attempt: {
          startedAt: 't',
          finishedAt: 't',
          outcome: 'not_ready',
          error:
            'Link a GitHub pull request to this session to review its changes.',
        },
      },
    });
    const { controller } = mount(context, () => <ChangesPane />);
    controller().layout.open();
    expect(screen.getByText('Pull request changes unavailable')).toBeTruthy();
    expect(
      screen.getByText(
        'Link a GitHub pull request to this session to review its changes.'
      )
    ).toBeTruthy();
  });

  it('offers to capture when nothing has been captured, and refreshes', async () => {
    const context = createMockAgentChangesContext({
      summary: { capturing: false },
    });
    const { controller } = mount(context, () => <ChangesPane />);
    controller().layout.open();
    fireEvent.click(screen.getByRole('button', { name: /Refresh changes/ }));
    await waitFor(() => expect(context.refreshes()).toBe(1));
  });

  it('opens the linked GitHub PR without creating another one', () => {
    const context = readyContext();
    const url = 'https://github.com/macro-inc/macro/pull/1482';
    context.setPullRequestUrl(url);
    const { controller } = mount(context, () => <ChangesPane />);
    controller().layout.open();
    expect(
      screen.queryByRole('button', { name: 'Create pull request' })
    ).toBeNull();
    fireEvent.click(
      screen.getByRole('button', { name: 'View pull request #1482' })
    );
    expect(context.opened).toEqual([url]);
    expect(context.sent).toEqual([]);
  });

  it('hides and shows the file tree from the toolbar', async () => {
    const context = readyContext();
    const { controller } = mount(context, () => <ChangesPane />);
    controller().layout.open();
    const tree = () => screen.queryByRole('group', { name: 'Changed files' });
    expect(tree()).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide file tree' }));
    await waitFor(() => expect(tree()).toBeNull());
    expect(controller().layout.treeOpen()).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Show file tree' }));
    await waitFor(() => expect(tree()).toBeTruthy());
  });

  it('closes and spotlights from its header', () => {
    const context = readyContext();
    const { controller } = mount(context, () => <ChangesPane />);
    controller().layout.open();
    fireEvent.click(
      screen.getByRole('button', { name: 'Expand changes to the full width' })
    );
    expect(controller().layout.layout()).toBe('full');
    fireEvent.click(screen.getByRole('button', { name: 'Back to the split' }));
    expect(controller().layout.layout()).toBe('split');
    fireEvent.click(
      screen.getByRole('button', { name: 'Close the changes pane' })
    );
    expect(controller().layout.layout()).toBe('closed');
  });
});

describe('session controls', () => {
  it('toggles the pane and shows addition/deletion totals', () => {
    const context = readyContext();
    const { controller } = mount(context, () => <ChangesToggle />);
    const toggle = screen.getByRole('button', { name: /Changes/ });
    expect(toggle.textContent).toContain('Changes+3−1');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(toggle);
    expect(controller().layout.layout()).toBe('split');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
  });

  it('uses GitHub API totals without falling back to captured estimates', () => {
    const context = readyContext();
    const [counts, setCounts] = createSignal<
      { additions: number; deletions: number } | undefined
    >({ additions: 8, deletions: 2 });
    context.host.pullRequestChangeCounts = counts;
    const { controller } = mount(context, () => <ChangesToggle />);
    const toggle = screen.getByRole('button', { name: /Changes/ });
    expect(toggle.textContent).toBe('Changes+8−2');

    // A missing or stale PR capture must not replace GitHub totals.
    context.setSummary(undefined);
    expect(toggle.textContent).toBe('Changes+8−2');
    context.setSummary({ capturing: true, changeset: mockChangeset() });
    expect(toggle.textContent).toBe('Changes+8−2');
    expect(toggle.querySelector('.animate-pulse')).toBeNull();
    expect(controller().changeCounts()).toEqual({ additions: 8, deletions: 2 });
    // Missing GitHub data must not expose the snapshot's +3 / −1 estimates.
    setCounts(undefined);
    expect(toggle.textContent).toBe('Changes');
    expect(controller().changeCounts()).toBeUndefined();

    setCounts({ additions: 12, deletions: 0 });
    expect(toggle.textContent).toBe('Changes+12');
    setCounts({ additions: 0, deletions: 4 });
    expect(toggle.textContent).toBe('Changes−4');
    setCounts({ additions: 0, deletions: 0 });
    expect(toggle.textContent).toBe('Changes');
    fireEvent.click(toggle);
    expect(controller().layout.changesVisible()).toBe(true);
  });

  it('does not display fake zero counts before a snapshot loads or for empty snapshots', () => {
    const context = createMockAgentChangesContext();
    mount(context, () => <ChangesToggle />);
    const toggle = screen.getByRole('button', { name: /Changes/ });
    expect(toggle.textContent).toBe('Changes');
    context.setSummary({
      capturing: false,
      changeset: mockChangeset({ files: [], additions: 0, deletions: 0 }),
    });
    expect(toggle.textContent).toBe('Changes');
    context.setSummary({ capturing: false, changeset: mockChangeset() });
    expect(toggle.textContent).toBe('Changes+3−1');
  });

  it('hands off to the pane while it is closed, and can be dismissed', () => {
    const context = readyContext();
    const { controller } = mount(context, () => <ChangesHandoff />);
    expect(screen.getByText('Changes ready to review')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Review changes' }));
    expect(controller().layout.layout()).toBe('split');
    expect(controller().review.active()).toBe('apps/web/src/a.ts');
    expect(screen.queryByText('Changes ready to review')).toBeNull();

    controller().layout.close();
    expect(screen.getByText('Changes ready to review')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('Changes ready to review')).toBeNull();
  });

  it('sends queued notes to the agent from the dock', () => {
    const context = readyContext();
    const { controller } = mount(context, () => <ReviewNotesDock />);
    expect(screen.queryByText(/review note/)).toBeNull();
    controller().review.addNote(
      {
        path: 'apps/web/src/a.ts',
        side: 'additions',
        lineNumber: 2,
        endLineNumber: 2,
      },
      'Use a constant'
    );
    expect(screen.getByText(/review note/).textContent).toContain('1');
    fireEvent.click(
      screen.getByRole('button', { name: /1 review note queued/ })
    );
    const editor = screen.getByLabelText(
      'Review note on apps/web/src/a.ts, line 2 (new)'
    ) as HTMLTextAreaElement;
    expect(editor.value).toBe('Use a constant');
    fireEvent.input(editor, { target: { value: 'Use a named constant' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to agent' }));
    expect(context.sent[0]).toContain('`apps/web/src/a.ts`, line 2 (new)');
    expect(context.sent[0]).toContain('Use a named constant');
    expect(screen.queryByText(/review note/)).toBeNull();
  });

  it('renders nothing for a host that can never have changes', () => {
    const context = readyContext();
    const [coding, setCoding] = createSignal(false);
    const { controller } = mount(
      { ...context, host: { ...context.host, canHaveChanges: coding } },
      () => (
        <>
          <ChangesToggle />
          <ChangesHandoff />
          <ReviewNotesDock />
        </>
      )
    );
    controller().review.addNote(
      {
        path: 'apps/web/src/a.ts',
        side: 'additions',
        lineNumber: 2,
        endLineNumber: 2,
      },
      'Use a constant'
    );
    expect(screen.queryByRole('button', { name: /Changes/ })).toBeNull();
    expect(screen.queryByText('Changes ready to review')).toBeNull();
    expect(screen.queryByText(/review note/)).toBeNull();

    setCoding(true);
    expect(screen.getByRole('button', { name: /Changes/ })).toBeTruthy();
    expect(screen.getByText('Changes ready to review')).toBeTruthy();
    expect(screen.getByText(/review note/)).toBeTruthy();
  });

  it("opens the note's file from the expanded dock", () => {
    const context = readyContext();
    const { controller } = mount(context, () => <ReviewNotesDock />);
    controller().review.addNote(
      {
        path: 'apps/web/src/a.ts',
        side: 'additions',
        lineNumber: 2,
        endLineNumber: 2,
      },
      'Use a constant'
    );
    fireEvent.click(
      screen.getByRole('button', { name: /1 review note queued/ })
    );
    fireEvent.click(
      screen.getByRole('button', { name: /apps\/web\/src\/a.ts/ })
    );
    expect(controller().layout.changesVisible()).toBe(true);
    expect(controller().review.active()).toBe('apps/web/src/a.ts');
  });
});
