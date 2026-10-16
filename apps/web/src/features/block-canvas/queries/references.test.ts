import { err, ok } from 'neverthrow';
import { beforeEach, expect, it, vi } from 'vitest';
import { canvasReferenceSource } from './references';

const mocks = vi.hoisted(() => ({
  token: vi.fn(),
  create: vi.fn(),
  remove: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock('@core/signal/token', () => ({ getPermissionToken: mocks.token }));
vi.mock('@queries/client', () => ({
  queryClient: { invalidateQueries: mocks.invalidate },
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    createEntityMention: mocks.create,
    deleteEntityMention: mocks.remove,
  },
}));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.token.mockResolvedValue('permission');
  mocks.create.mockResolvedValue(ok({ id: 'mention' }));
  mocks.remove.mockResolvedValue(ok({}));
});

it('registers a document backlink with source authorization and refreshes references', async () => {
  await expect(canvasReferenceSource('canvas').create('target')).resolves.toBe(
    'mention'
  );
  expect(mocks.token).toHaveBeenCalledWith('document', 'canvas');
  expect(mocks.create).toHaveBeenCalledWith(
    {
      source_entity_type: 'document',
      source_entity_id: 'canvas',
      entity_type: 'document',
      entity_id: 'target',
    },
    'permission'
  );
  expect(mocks.invalidate).toHaveBeenCalledOnce();
});

it('retries deletion safely after a previously completed removal', async () => {
  mocks.remove.mockResolvedValueOnce(
    err([{ code: 'NOT_FOUND', message: 'Gone' }])
  );
  await expect(
    canvasReferenceSource('canvas').remove('mention')
  ).resolves.toBeUndefined();
  expect(mocks.remove).toHaveBeenCalledWith(
    { mention_id: 'mention' },
    'permission'
  );
  expect(mocks.invalidate).toHaveBeenCalledOnce();
  mocks.remove.mockResolvedValueOnce(
    err([{ code: 'UNKNOWN', message: 'Offline' }])
  );
  await expect(
    canvasReferenceSource('canvas').remove('mention')
  ).rejects.toThrow('Offline');
  expect(mocks.invalidate).toHaveBeenCalledOnce();
});

it('surfaces registration and authorization failures for persistence retry', async () => {
  mocks.create.mockResolvedValueOnce(
    err([{ code: 'UNKNOWN', message: 'Offline' }])
  );
  await expect(
    canvasReferenceSource('canvas').create('target')
  ).rejects.toThrow('Offline');
  expect(mocks.invalidate).not.toHaveBeenCalled();
  mocks.token.mockResolvedValue(undefined);
  await expect(
    canvasReferenceSource('canvas').create('target')
  ).rejects.toThrow('authorize');
  await expect(
    canvasReferenceSource('canvas').remove('mention')
  ).rejects.toThrow('authorize');
  expect(mocks.create).toHaveBeenCalledOnce();
  expect(mocks.remove).not.toHaveBeenCalled();
});
