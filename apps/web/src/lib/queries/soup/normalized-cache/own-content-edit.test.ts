import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  clearOwnContentEditStamps,
  OWN_CONTENT_EDIT_STAMP_INTERVAL_MS,
  stampOwnContentEdit,
} from './own-content-edit';

const bumpSoupEntityTouchedAt = vi.hoisted(() => vi.fn());

vi.mock('./operations', () => ({ bumpSoupEntityTouchedAt }));

afterEach(() => {
  clearOwnContentEditStamps();
  bumpSoupEntityTouchedAt.mockClear();
});

describe('own content-edit stamps', () => {
  it('stamps the first edit right away', () => {
    stampOwnContentEdit('doc-1', 1_000);

    expect(bumpSoupEntityTouchedAt).toHaveBeenCalledWith('doc-1');
  });

  it('drops the rest of the window, then stamps again', () => {
    stampOwnContentEdit('doc-1', 1_000);
    stampOwnContentEdit('doc-1', 1_001);
    stampOwnContentEdit(
      'doc-1',
      1_000 + OWN_CONTENT_EDIT_STAMP_INTERVAL_MS - 1
    );

    expect(bumpSoupEntityTouchedAt).toHaveBeenCalledTimes(1);

    stampOwnContentEdit('doc-1', 1_000 + OWN_CONTENT_EDIT_STAMP_INTERVAL_MS);

    expect(bumpSoupEntityTouchedAt).toHaveBeenCalledTimes(2);
  });

  it('throttles each entity on its own', () => {
    stampOwnContentEdit('doc-1', 1_000);
    stampOwnContentEdit('sheet-1', 1_001);

    expect(bumpSoupEntityTouchedAt).toHaveBeenCalledWith('doc-1');
    expect(bumpSoupEntityTouchedAt).toHaveBeenCalledWith('sheet-1');
  });
});
