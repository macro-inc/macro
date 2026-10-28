import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import { errAsync } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';
import { prepareViewCreation } from './view-creation';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  board: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock('./views', () => ({
  createDatabaseView: mocks.create,
  createBoardWithStatusColumn: mocks.board,
}));
vi.mock('@queries/client', () => ({
  queryClient: { fetchQuery: mocks.fetch },
}));
vi.mock('@queries/storage/databases', () => ({
  databaseDetailQueryOptions: () => ({ queryKey: ['detail'] }),
}));
const current: DatabaseView = {
  id: 'all',
  databaseId: 'db',
  tableId: 'table',
  name: 'All records',
  position: '',
  query: { filter: null, sort: [] },
  layout: { kind: 'table', columns: [] },
  createdAt: '',
  updatedAt: '',
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.create.mockReturnValue(errAsync({ kind: 'unexpected-result' }));
  mocks.board.mockReturnValue(errAsync({ kind: 'unexpected-result' }));
});
it('reuses the committed view after a lost response instead of creating twice', async () => {
  const intent = prepareViewCreation(
    current,
    { name: 'Planning', layout: 'table' },
    []
  );
  await intent.save();
  expect(mocks.create.mock.calls[0][3]).toBe(intent.view.id);
  mocks.fetch.mockResolvedValue({ tables: [{ views: [intent.view] }] });
  expect((await intent.save())._unsafeUnwrap()).toBe(intent.view);
  expect(mocks.create).toHaveBeenCalledOnce();
});
it('retries an uncommitted new-status board with the same view, column and option ids', async () => {
  const intent = prepareViewCreation(
    current,
    { name: 'Board', layout: 'board', groupBy: { kind: 'new-status' } },
    []
  );
  await intent.save();
  mocks.fetch.mockResolvedValue({ tables: [{ views: [] }] });
  await intent.save();
  expect(mocks.board.mock.calls[0]).toEqual(mocks.board.mock.calls[1]);
  expect(mocks.board.mock.calls[0][0].viewId).toBe(intent.view.id);
});
it('does not write again when checking a previous attempt fails', async () => {
  const intent = prepareViewCreation(
    current,
    { name: 'Planning', layout: 'table' },
    []
  );
  await intent.save();
  mocks.fetch.mockRejectedValue(new Error('Offline'));
  expect((await intent.save()).isErr()).toBe(true);
  expect(mocks.create).toHaveBeenCalledOnce();
});
