import type { DatabaseView } from '@service-storage/generated/schemas/databaseView';
import { errAsync, ok, okAsync, type Result, ResultAsync } from 'neverthrow';
import { createRoot } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import { createViewCreation } from './view-creation';

const view: DatabaseView = {
  id: 'local-id',
  databaseId: 'db',
  tableId: 'table',
  name: 'Planning',
  position: '',
  query: { filter: null, sort: [] },
  layout: { kind: 'table', columns: [] },
  createdAt: '',
  updatedAt: '',
};
describe('optimistic view creation', () => {
  it('shows the stable id while saving and settles without navigating a second time', async () => {
    const { controller, dispose } = createRoot((dispose) => ({
      controller: createViewCreation(),
      dispose,
    }));
    let finish!: (result: Result<DatabaseView, never>) => void;
    const request = new ResultAsync<DatabaseView, never>(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const save = vi.fn(() => request);
    controller.start({ view, needsColumn: false, save });
    expect(controller.drafts()[0]).toMatchObject({
      view: { id: 'local-id' },
      pending: true,
    });
    controller.retry(view.id);
    expect(save).toHaveBeenCalledOnce();
    finish(ok<DatabaseView, never>(view));
    await request;
    await Promise.resolve();
    expect(controller.drafts()).toEqual([]);
    dispose();
  });
  it('retains a failed intent and retries the same save without creating another tab', async () => {
    const { controller, dispose } = createRoot((dispose) => ({
      controller: createViewCreation(),
      dispose,
    }));
    const save = vi
      .fn()
      .mockReturnValueOnce(errAsync({ kind: 'unexpected-result' }))
      .mockReturnValueOnce(okAsync(view));
    controller.start({ view, needsColumn: false, save });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(controller.drafts()[0]).toMatchObject({
      pending: false,
      failure: { kind: 'unexpected-result' },
    });
    controller.retry(view.id);
    expect(controller.drafts()).toHaveLength(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(save).toHaveBeenCalledTimes(2);
    expect(controller.drafts()).toEqual([]);
    dispose();
  });
});
