import { fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
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
  type MockAgentChangesContext,
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
  context: MockAgentChangesContext,
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
  it('lists the files, tracks viewed progress, and folds viewed files', async () => {
    const context = readyContext();
    const { controller } = mount(context, () => <ChangesPane />);
    controller().layout.open();

    expect(
      screen.getByText('agent/unread-archived-sessions → main')
    ).toBeTruthy();
    expect(screen.getByText('0', { selector: 'b' })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByTestId('diff')).toHaveLength(2));

    const viewedButtons = screen.getAllByRole('button', { name: /^Viewed$/ });
    fireEvent.click(viewedButtons[0]!);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '1'
    );
    expect(screen.getAllByTestId('diff')).toHaveLength(1);
    expect(screen.getByText('Show diff')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Mark all viewed' }));
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
      '2'
    );
    expect(screen.getByRole('button', { name: 'Clear viewed' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Expand all' })).toBeTruthy();
  });

  it('explains an unsupported harness', () => {
    const context = createMockAgentChangesContext({
      summary: {
        capturing: false,
        attempt: {
          startedAt: 't',
          finishedAt: 't',
          outcome: 'unsupported',
          error: 'Sandbox sessions do not report changes.',
        },
      },
    });
    const { controller } = mount(context, () => <ChangesPane />);
    controller().layout.open();
    expect(
      screen.getByText('This session does not report its changes')
    ).toBeTruthy();
    expect(
      screen.getByText('Sandbox sessions do not report changes.')
    ).toBeTruthy();
  });

  it('offers to capture when nothing has been captured, and refreshes', async () => {
    const context = createMockAgentChangesContext({
      summary: { capturing: false },
    });
    const { controller } = mount(context, () => <ChangesPane />);
    controller().layout.open();
    fireEvent.click(screen.getByRole('button', { name: /Capture again/ }));
    await waitFor(() => expect(context.refreshes()).toBe(1));
  });

  it('creates a pull request from the header and shows it once linked', async () => {
    const context = readyContext();
    const { controller } = mount(context, () => <ChangesPane />);
    controller().layout.open();

    fireEvent.click(
      screen.getByRole('button', { name: 'Create pull request' })
    );
    await waitFor(() => expect(context.sent).toHaveLength(1));
    expect(context.sent[0]).toContain('- Title: Drafted title');
    expect(
      screen.getAllByText(/Asking the agent to open the pull request/).length
    ).toBeGreaterThan(0);

    context.setPullRequestUrl('https://github.com/macro-inc/macro/pull/1482');
    await waitFor(() =>
      expect(screen.getByText('Pull request #1482 opened')).toBeTruthy()
    );
    fireEvent.click(screen.getByRole('button', { name: 'Back to changes' }));
    expect(
      screen.getByRole('button', { name: /Pull request #1482/ })
    ).toBeTruthy();
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
  it('toggles the pane and shows the file count', () => {
    const context = readyContext();
    const { controller } = mount(context, () => <ChangesToggle />);
    const toggle = screen.getByRole('button', { name: /Changes/ });
    expect(toggle.textContent).toContain('2');
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
    fireEvent.click(screen.getByRole('button', { name: 'Send to agent' }));
    expect(context.sent[0]).toContain('`apps/web/src/a.ts`, line 2 (new)');
    expect(context.sent[0]).toContain('Use a constant');
    expect(screen.queryByText(/review note/)).toBeNull();
  });
});
