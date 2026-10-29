const codexAccess = vi.hoisted(() => ({ enabled: true }));
vi.mock('@core/codex/flag', () => ({
  useCodexAgentsAccess: () => () => codexAccess.enabled,
}));

/**
 * @vitest-environment jsdom
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@solidjs/testing-library';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AgentRuntimes } from './AgentRuntimes';

vi.mock('@ui', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@ui')>()),
  confirmDialog: vi.fn(async () => true),
}));

vi.mock('./codex/views/CodexHarness', () => ({
  CodexHarness: () => <div data-testid="codex-harness" />,
}));

const mocks = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastFailure: vi.fn(),
}));

const harnessMocks = vi.hoisted(() => ({
  query: {
    isSuccess: true,
    isPending: false,
    data: [] as unknown[],
    isError: false,
  },
  deleteHarness: vi.fn(),
}));

vi.mock('@queries/harnesses/harnesses', () => ({
  useHarnessesQuery: () => harnessMocks.query,
  useDeleteHarnessMutation: () => ({
    mutateAsync: harnessMocks.deleteHarness,
    isPending: false,
  }),
  invalidateHarnesses: vi.fn(),
}));

vi.mock('@core/component/Toast/Toast', () => ({
  toast: {
    success: mocks.toastSuccess,
    failure: mocks.toastFailure,
  },
}));

const REGISTERED_HARNESS = {
  id: '3f1c9d2e-8a4b-4c5d-9e6f-1a2b3c4d5e6f',
  kind: 'macrod',
  name: 'Dev box',
  owner: { type: 'team', team_id: 'team-1' },
  created_by: 'macro|user@example.com',
  created_at: '2026-08-27T12:00:00Z',
  updated_at: '2026-08-27T12:00:00Z',
  connected: true,
  last_connected_at: '2026-08-27T12:34:00Z',
};

beforeAll(() => {
  vi.stubGlobal('scrollTo', vi.fn());
});

beforeEach(() => {
  codexAccess.enabled = true;
  vi.clearAllMocks();
  harnessMocks.query.data = [];
  harnessMocks.query.isError = false;
  harnessMocks.deleteHarness.mockResolvedValue(undefined);
});

describe('AgentRuntimes', () => {
  it.each([false, true])(
    'shows Codex settings only within its rollout (access %s)',
    (enabled) => {
      codexAccess.enabled = enabled;
      render(() => <AgentRuntimes onNewRuntime={vi.fn()} />);
      expect(Boolean(screen.queryByTestId('codex-harness'))).toBe(enabled);
    }
  );

  it('lists Macro Agent, but not Cursor, among the built-in runtimes', () => {
    render(() => <AgentRuntimes onNewRuntime={vi.fn()} />);

    expect(screen.getByRole('heading', { name: 'Macro Agent' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Cursor' })).toBeNull();
    expect(
      screen.getByText(/Uses official Macro tools and MCPs to get the job done/)
    ).toBeTruthy();
  });

  it('hides the empty paired runtimes section', () => {
    render(() => <AgentRuntimes onNewRuntime={vi.fn()} />);

    expect(screen.queryByText('No paired runtimes yet')).toBeNull();
    expect(
      screen.queryByRole('heading', { name: 'Paired runtimes' })
    ).toBeNull();
    expect(
      screen.queryByRole('button', { name: 'Enter pairing code' })
    ).toBeNull();
  });

  it('asks to pair a new runtime from New runtime', () => {
    const onNewRuntime = vi.fn();
    render(() => <AgentRuntimes onNewRuntime={onNewRuntime} />);

    fireEvent.click(screen.getByRole('button', { name: 'New runtime' }));
    expect(onNewRuntime).toHaveBeenCalledOnce();
  });

  it('renders a registered harness row', () => {
    harnessMocks.query.data = [REGISTERED_HARNESS];

    render(() => <AgentRuntimes onNewRuntime={vi.fn()} />);

    expect(screen.getByText('Dev box')).toBeTruthy();
    expect(screen.getByText('Team')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Connected' })).toBeTruthy();
    expect(screen.getByText(/Last connected /)).toBeTruthy();
    expect(screen.queryByText('Never connected')).toBeNull();
  });

  it('shows a disconnected private harness that never connected', () => {
    harnessMocks.query.data = [
      {
        ...REGISTERED_HARNESS,
        owner: { type: 'user', user_id: 'macro|user@example.com' },
        connected: false,
        last_connected_at: null,
      },
    ];

    render(() => <AgentRuntimes onNewRuntime={vi.fn()} />);

    expect(screen.getByText('Private')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Disconnected' })).toBeTruthy();
    expect(screen.getByText('Never connected')).toBeTruthy();
  });

  it('confirms before removing a harness', async () => {
    harnessMocks.query.data = [REGISTERED_HARNESS];

    render(() => <AgentRuntimes onNewRuntime={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Remove Dev box?')).toBeTruthy();
    expect(
      within(dialog).getByText(/Agents using this runtime will stop running/)
    ).toBeTruthy();
    expect(harnessMocks.deleteHarness).not.toHaveBeenCalled();

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Remove runtime' })
    );

    await waitFor(() => {
      expect(harnessMocks.deleteHarness).toHaveBeenCalledWith({
        harnessId: REGISTERED_HARNESS.id,
      });
      expect(mocks.toastSuccess).toHaveBeenCalledWith('Runtime removed');
      expect(screen.queryByRole('dialog')).toBeNull();
    });
  });
});
