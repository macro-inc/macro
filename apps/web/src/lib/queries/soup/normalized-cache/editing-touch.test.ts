import { describe, expect, it, vi } from 'vitest';
import { createEditingSessions, EDITING_IDLE_MS } from './editing-touch';

vi.mock('./operations', () => ({ bumpSoupEntityTouchedAt: vi.fn() }));

describe('content edits as Recent touches', () => {
  it('stamps the first edit of a session and none while typing goes on', () => {
    const stamp = vi.fn();
    const edit = createEditingSessions(stamp);

    edit('doc', 0);
    edit('doc', 60_000);
    // Each edit extends the session, so steady typing never stamps again.
    edit('doc', 60_000 + EDITING_IDLE_MS - 1);
    expect(stamp).toHaveBeenCalledExactlyOnceWith('doc');
  });

  it('starts a new session after the idle window, per document', () => {
    const stamp = vi.fn();
    const edit = createEditingSessions(stamp);

    edit('doc', 0);
    edit('other', 1_000);
    edit('doc', EDITING_IDLE_MS);
    expect(stamp.mock.calls).toEqual([['doc'], ['other'], ['doc']]);
  });
});
