import { describe, expect, it } from 'vitest';
import { formatTabTitle } from './tabTitle';

describe('formatTabTitle', () => {
  it('uses the Rox display name with and without a page title', () => {
    expect(formatTabTitle(undefined)).toMatch(/Rox$/);
    expect(formatTabTitle('Inbox')).toMatch(/Rox - Inbox$/);
  });
});
