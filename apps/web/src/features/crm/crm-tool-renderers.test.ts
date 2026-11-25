import { expect, it, vi } from 'vitest';
import { mergeRecordsHandler } from './crm-tool-renderers';

const refresh = vi.hoisted(() => vi.fn(async () => {}));
vi.mock('./queries/merges', () => ({ refreshAfterMerge: refresh }));
vi.mock('@queries/client', () => ({ queryClient: { name: 'app client' } }));
vi.mock('@core/component/ItemPreview', () => ({ ItemPreview: () => null }));

it('the merge tool card forgets the merged companies when the merge lands', async () => {
  await mergeRecordsHandler.handleResponse?.({
    chat_id: 'chat',
    message_id: 'message',
    part_index: 0,
    isComplete: true,
    tool: {
      name: 'MergeRecords',
      data: { mergeId: 'm', survivorId: 'kept', mergedIds: ['old-1'] },
    },
  } as never);

  expect(refresh).toHaveBeenCalledWith(
    { name: 'app client' },
    { companies: ['old-1'], contacts: [] }
  );
});
