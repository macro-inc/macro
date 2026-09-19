import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { AgentChangesContext } from '../context/agent-changes-context';
import { AgentChangesControllerProvider } from '../context/agent-changes-controller';
import {
  type AgentChangesController,
  createAgentChanges,
  type DiffStyle,
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

// Pierre mounts a custom element and highlights with shiki; the pane test
// covers everything around it and leaves the diff body to the browser.
vi.mock('../components/PierreFileDiff', () => ({
  PierreFileDiff: (props: { path: string }) => (
    <div data-testid="diff" data-path={props.path} />
  ),
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
  const [diffStyle, setDiffStyle] = createSignal<DiffStyle>('unified');
  const [dismissed, setDismissed] = createSignal<string>();
  let controller!: AgentChangesController;
  const result = render(() => {
    controller = createAgentChanges({
      context,
      storage: createMemoryStorage(),
      diffStyle: [diffStyle, setDiffStyle],
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

    fireEvent.click(screen.getAllByRole('button', { name: /^Hide / })[0]!);
    expect(screen.getAllByTestId('diff')).toHaveLength(1);
    expect(screen.getByText('Show diff')).toBeTruthy();

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
    fireEvent.click(screen.getByRole('button', { name: 'View pull request' }));
    expect(context.opened).toEqual([url]);
    expect(context.sent).toEqual([]);
  });

  it('closes and spotlights from its header', () => {
    const context = readyContext();
    const { controller } = mount(context, () => <ChangesPane />);
    controller().layout.open();
    fireEvent.click(
      screen.getByRole('button', { name: 'Expand changes to the full width' })
    );
    expect(controller().layout.layout()).toBe('changes-only');
    fireEvent.click(
      screen.getByRole('button', { name: 'Bring the session back' })
    );
    expect(controller().layout.layout()).toBe('split');
    fireEvent.click(
      screen.getByRole('button', { name: 'Close the changes pane' })
    );
    expect(controller().layout.layout()).toBe('agent-only');
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
