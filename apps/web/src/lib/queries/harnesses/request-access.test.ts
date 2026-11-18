import { ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';
import { requestHarnessAccess } from './harnesses';

const mocks = vi.hoisted(() => ({
  state: vi.fn(),
  submit: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock('@queries/access-requests/requests', () => ({
  accessRequestsClient: { submit: mocks.submit },
  fetchAccessRequestState: mocks.state,
  refreshSharedAccess: mocks.refresh,
}));
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));
vi.mock('@queries/client', () => ({ queryClient: {} }));
vi.mock('@queries/agents/agents', () => ({ invalidateAgents: vi.fn() }));

const harnessId = '0198a805-3e22-75b2-97eb-d9c6b91accb0';

beforeEach(() => {
  mocks.state.mockReset();
  mocks.submit.mockReset();
  mocks.refresh.mockReset();
  mocks.submit.mockResolvedValue(ok({}));
});

it('sends a request and says it was sent', async () => {
  mocks.state.mockResolvedValue({ mine: null, requests: [] });

  expect(await requestHarnessAccess(harnessId)).toBe('sent');
  expect(mocks.submit).toHaveBeenCalledWith(
    { entityType: 'harness', entityId: harnessId },
    'edit',
    undefined
  );
});

it('does not ask again while a request for User access is waiting', async () => {
  mocks.state.mockResolvedValue({
    mine: { status: 'pending', requestedLevel: 'edit', revision: 3 },
    requests: [],
  });

  expect(await requestHarnessAccess(harnessId)).toBe('already_requested');
  expect(mocks.submit).not.toHaveBeenCalled();
});

it('raises a waiting request for Read to one for User access', async () => {
  mocks.state.mockResolvedValue({
    mine: { status: 'pending', requestedLevel: 'view', revision: 3 },
    requests: [],
  });

  expect(await requestHarnessAccess(harnessId)).toBe('sent');
  expect(mocks.submit).toHaveBeenCalledWith(
    { entityType: 'harness', entityId: harnessId },
    'edit',
    3
  );
});
