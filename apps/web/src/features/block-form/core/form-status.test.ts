import { describe, expect, it } from 'vitest';
import { primaryAction } from './form-status';

describe('primaryAction', () => {
  it('offers Publish while nobody responded and the form is shared with no one', () => {
    expect(
      primaryAction({ audience: 'members', responses: 0, shared: false })
    ).toBe('publish');
  });

  it('offers Open form once it is shared, public, or answered', () => {
    expect(
      primaryAction({ audience: 'members', responses: 0, shared: true })
    ).toBe('open');
    expect(
      primaryAction({ audience: 'public', responses: 0, shared: false })
    ).toBe('open');
    expect(
      primaryAction({ audience: 'members', responses: 2, shared: false })
    ).toBe('open');
  });

  it('waits on Publish while whether it is shared is still unknown', () => {
    expect(
      primaryAction({ audience: 'members', responses: 0, shared: undefined })
    ).toBe('publish');
  });
});
