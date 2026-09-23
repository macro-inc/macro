import { err, ok } from 'neverthrow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  graphql: true,
  archive: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: {},
  isFeatureEnabled: () => mocks.graphql,
}));
vi.mock('@service-email/client', () => ({
  emailClient: { flagArchived: mocks.archive },
}));
vi.mock('@service-storage/client', () => ({ storageServiceClient: {} }));
vi.mock('../soup/graphql/active-queries', () => ({
  refreshActiveGraphqlSoupQueries: mocks.refresh,
}));

import { archiveEmailThread } from './integration';

beforeEach(() => {
  vi.resetAllMocks();
  mocks.graphql = true;
  mocks.refresh.mockResolvedValue(undefined);
});

describe('archive GraphQL list revalidation', () => {
  it.each([true, false])(
    'refreshes mounted lists after archive=%s commits, including undo/redo',
    async (value) => {
      let finish!: () => void;
      mocks.archive.mockImplementation(async () => {
        await new Promise<void>((resolve) => {
          finish = resolve;
        });
        return ok(undefined);
      });
      const result = archiveEmailThread({ id: 'thread', value }, 'secondary');
      expect(mocks.archive).toHaveBeenCalledWith(
        { id: 'thread', value },
        'secondary'
      );
      expect(mocks.refresh).not.toHaveBeenCalled();
      finish();
      await result;
      expect(mocks.refresh).toHaveBeenCalledOnce();
    }
  );

  it('reconciles an uncertain failure without swallowing it', async () => {
    mocks.archive.mockResolvedValue(err(new Error('archive failed')));
    await expect(
      archiveEmailThread({ id: 'thread', value: true })
    ).rejects.toThrow();
    expect(mocks.refresh).toHaveBeenCalledOnce();
  });

  it('does not start GraphQL queries on the REST path', async () => {
    mocks.graphql = false;
    mocks.archive.mockResolvedValue(ok(undefined));
    await archiveEmailThread({ id: 'thread', value: true });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});
