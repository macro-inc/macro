import { describe, expect, it } from 'vitest';
import { sessionCodeQuery } from './session-code-details';

describe('session code query', () => {
  it('bounds a cold header lookup to one session and its owner', () => {
    const query = sessionCodeQuery('session-one', 'owner-one');
    expect(query.params).toEqual({
      expand: true,
      sort_method: 'updated_at',
      limit: 1,
    });
    expect(query.body.asf).toEqual({
      '&': [
        { l: 'inc' },
        { '&': [{ l: { id: 'session-one' } }, { l: { o: 'owner-one' } }] },
      ],
    });
    expect(query.body.cf).toEqual({
      l: { cid: '00000000-0000-0000-0000-000000000000' },
    });
  });
});
