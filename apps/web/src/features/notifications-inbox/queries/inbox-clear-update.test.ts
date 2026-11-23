import { describe, expect, it } from 'vitest';
import { parseInboxClearUpdate } from './inbox-clear-update';

const ID = '0193b1ea-a542-7589-893b-2b4a509c1e76';

describe('parseInboxClearUpdate', () => {
  it('reads the clear a hint names, as an object or as JSON text', () => {
    const hint = { clearId: ID, status: 'applying', revision: 2 };
    expect(parseInboxClearUpdate(hint)).toBe(ID);
    expect(parseInboxClearUpdate(JSON.stringify(hint))).toBe(ID);
  });

  it('ignores what is not a hint', () => {
    expect(parseInboxClearUpdate({ clearId: 'everything' })).toBeUndefined();
    expect(parseInboxClearUpdate('not json')).toBeUndefined();
    expect(parseInboxClearUpdate(null)).toBeUndefined();
  });
});
