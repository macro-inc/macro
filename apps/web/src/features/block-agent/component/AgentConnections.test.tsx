import { AppConnectionContext } from '@core/pipedream/connection-context';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { useContext } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgentConnections } from './AgentConnections';

const mocks = vi.hoisted(() => ({
  owner: 'owner',
  viewer: 'owner',
  turn: 'idle',
  revision: 0,
  connect: vi.fn(),
  issue: vi.fn(),
  notify: vi.fn(),
}));
vi.mock('@queries/pipedream-connectors', () => ({
  connectPipedreamApp: mocks.connect,
}));
vi.mock('@core/component/Toast/Toast', () => ({
  toast: { alert: mocks.notify },
}));
vi.mock('./prompt-action', () => ({
  promptActionOf: (prompt: string) => ({ type: 'prompt', prompt }),
}));
vi.mock('../context/AgentSessionContext', () => ({
  useAgentSession: () => ({
    sessionId: () => 'agent-session',
    pending: () => false,
    loadFailed: () => false,
    session: () => ({ canEdit: true, ownerId: mocks.owner }),
    userId: () => mocks.viewer,
    turn: () => mocks.turn,
    queue: { entries: () => [] },
    messages: () => [{ turn: mocks.revision, author: { kind: 'agent' } }],
    issue: mocks.issue,
  }),
}));
function Button() {
  const context = useContext(AppConnectionContext)!;
  return (
    <button
      disabled={context.disabled()}
      onClick={() => context.connect({ appSlug: 'notion', name: 'Notion' })}
    >
      Connect Notion
    </button>
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.owner = 'owner';
  mocks.viewer = 'owner';
  mocks.turn = 'idle';
  mocks.revision = 0;
  mocks.issue.mockResolvedValue({ isErr: () => false });
});
afterEach(cleanup);

it('registers then issues exactly one agent prompt without touching the composer', async () => {
  mocks.connect.mockResolvedValue('connected');
  render(() => (
    <AgentConnections>
      <Button />
      <textarea />
    </AgentConnections>
  ));
  fireEvent.input(screen.getByRole('textbox'), {
    target: { value: 'unsent draft' },
  });
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() =>
    expect(mocks.issue).toHaveBeenCalledExactlyOnceWith({
      type: 'prompt',
      prompt:
        'I connected Notion. Continue my previous request using the newly available tools.',
    })
  );
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(
    'unsent draft'
  );
});
it('cancellation never prompts the agent', async () => {
  mocks.connect.mockResolvedValue('closed');
  render(() => (
    <AgentConnections>
      <Button />
    </AgentConnections>
  ));
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() =>
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(
      false
    )
  );
  expect(mocks.issue).not.toHaveBeenCalled();
});
it('collaborators cannot connect their account on behalf of the session owner', () => {
  mocks.viewer = 'collaborator';
  render(() => (
    <AgentConnections>
      <Button />
    </AgentConnections>
  ));
  expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
});
it('surfaces a rejected continuation', async () => {
  mocks.connect.mockResolvedValue('connected');
  mocks.issue.mockResolvedValue({ isErr: () => true });
  render(() => (
    <AgentConnections>
      <Button />
    </AgentConnections>
  ));
  fireEvent.click(screen.getByRole('button'));
  await waitFor(() => expect(mocks.notify).toHaveBeenCalledOnce());
});
