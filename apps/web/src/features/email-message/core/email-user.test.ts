import { describe, expect, it } from 'vitest';
import { getRecipientDisplayName } from './email-user';

describe('getRecipientDisplayName', () => {
  it("names the viewer's own address Me whatever its case", () => {
    expect(
      getRecipientDisplayName(
        { email: 'Viewer@Example.com', name: 'Viewer Person' },
        'viewer@example.com'
      )
    ).toBe('Me');
  });

  it('does not call an addressless recipient Me while the viewer is unknown', () => {
    expect(getRecipientDisplayName({ name: 'Alex Doe' }, undefined)).toBe(
      'Alex'
    );
  });
});
