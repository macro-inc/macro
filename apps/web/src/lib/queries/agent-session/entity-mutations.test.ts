import { err, ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rename: vi.fn(),
  delete: vi.fn(),
  changed: vi.fn(),
  invalidate: vi.fn(),
  soup: vi.fn(),
}));
vi.mock('@service-agent-harness/client', () => ({
  agentHarnessServiceClient: { rename: mocks.rename, delete: mocks.delete },
}));
vi.mock('../client', () => ({
  queryClient: { invalidateQueries: mocks.invalidate },
}));
vi.mock('../soup/cache', () => ({ invalidateAllSoup: mocks.soup }));
vi.mock('./session-metadata-sync', () => ({
  handleAgentSessionRenamed: mocks.changed,
}));

import { deleteAgentSession, renameAgentSession } from './entity-mutations';

beforeEach(() => vi.clearAllMocks());
it('renames through the owning API and refreshes shared consumers', async () => {
  mocks.rename.mockResolvedValue(ok(undefined));
  await renameAgentSession('session', 'New title');
  expect(mocks.rename).toHaveBeenCalledWith('session', 'New title');
  expect(mocks.changed).toHaveBeenCalledWith({
    agentSessionId: 'session',
    name: 'New title',
  });
  expect(mocks.soup).toHaveBeenCalledOnce();
  expect(mocks.invalidate).toHaveBeenCalledTimes(2);
});
it('does not publish a failed rename', async () => {
  mocks.rename.mockResolvedValue(err(new Error('forbidden')));
  await expect(
    renameAgentSession('session', 'New title')
  ).rejects.toBeDefined();
  expect(mocks.changed).not.toHaveBeenCalled();
  expect(mocks.soup).not.toHaveBeenCalled();
});
it('deletes through the owning API, not a document deletion', async () => {
  mocks.delete.mockResolvedValue(ok(undefined));
  await deleteAgentSession('session');
  expect(mocks.delete).toHaveBeenCalledWith('session');
  expect(mocks.soup).toHaveBeenCalledOnce();
});
