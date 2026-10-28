import { err, ok } from 'neverthrow';
import { expect, it, vi } from 'vitest';

const getCrmPipeline = vi.hoisted(() => vi.fn());
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getCrmPipeline },
}));
vi.mock('@core/constant/allBlocks', () => ({ itemToSafeName: () => '' }));
vi.mock('@service-cognition/client', () => ({ cognitionApiServiceClient: {} }));
vi.mock('@service-email/client', () => ({ emailClient: {} }));
vi.mock('@service-storage/messages', () => ({ entityMessagesClient: {} }));
vi.mock('../../email/thread', () => ({ threadQueryOptions: vi.fn() }));
vi.mock('../../client', () => ({ queryClient: {} }));
vi.mock('../../agent-session/mention-fetchers', () => ({
  fetchAgentSessionMentionPreviews: vi.fn(),
}));

import { fetchRestPreviewBatch } from '../fetchers';

const pipeline = {
  id: 'sales',
  name: 'Sales',
  userId: 'macro|owner@macro.com',
  trashedAt: null,
};

it('previews a pipeline by name, and a trashed or missing one as deleted', async () => {
  getCrmPipeline.mockResolvedValueOnce(ok(pipeline));
  const visible = await fetchRestPreviewBatch([
    { type: 'crm_pipeline', id: 'sales' },
  ]);
  expect(getCrmPipeline).toHaveBeenCalledWith('sales');
  expect(visible.get('sales')).toEqual({
    id: 'sales',
    type: 'crm_pipeline',
    access: 'access',
    loading: false,
    rawName: 'Sales',
    name: 'Sales',
    owner: 'macro|owner@macro.com',
  });

  getCrmPipeline.mockResolvedValueOnce(
    ok({ ...pipeline, trashedAt: '2026-10-01T00:00:00Z' })
  );
  const trashed = await fetchRestPreviewBatch([
    { type: 'crm_pipeline', id: 'sales' },
  ]);
  expect(trashed.get('sales')).toMatchObject({ access: 'does_not_exist' });

  getCrmPipeline.mockResolvedValueOnce(
    err([{ code: 'NOT_FOUND', message: 'Resource not found' }])
  );
  const missing = await fetchRestPreviewBatch([
    { type: 'crm_pipeline', id: 'gone' },
  ]);
  expect(missing.get('gone')).toMatchObject({ access: 'does_not_exist' });
});

it('previews a pipeline the viewer cannot read as no access', async () => {
  getCrmPipeline.mockResolvedValueOnce(
    err([{ code: 'FORBIDDEN', message: 'Forbidden' }])
  );
  const denied = await fetchRestPreviewBatch([
    { type: 'crm_pipeline', id: 'private' },
  ]);
  expect(denied.get('private')).toEqual({
    id: 'private',
    type: 'crm_pipeline',
    access: 'no_access',
    loading: false,
  });
});
