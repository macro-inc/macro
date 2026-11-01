import { describe, expect, test } from 'bun:test';
import { updateSignInMessage } from './theme-message';

describe('theme properties preservation', () => {
  test('adds an inherited message without changing existing properties', () => {
    const original =
      '# Custom messages\r\nlogin=Sign in\r\nother=Keep\\nthis\r\n';
    const updated = updateSignInMessage(original);
    expect(updated.startsWith(original)).toBe(true);
    expect(updateSignInMessage(updated)).toBe(updated);
  });

  test.each([
    '[IdentityProviderValidationException]',
    '\\[IdentityProviderValidationException\\]',
  ])(
    'replaces %s without changing adjacent properties or CRLF endings',
    (key) => {
      const original = `login=Sign in\r\n${key}=Old message\r\nother=Keep this\r\n`;
      const updated = updateSignInMessage(original);
      expect(updated.startsWith('login=Sign in\r\n')).toBe(true);
      expect(updated.endsWith('\r\nother=Keep this\r\n')).toBe(true);
      expect(updated).not.toContain('Old message');
      expect(updateSignInMessage(updated)).toBe(updated);
    }
  );

  test.each([
    '[IdentityProviderValidationException]=first\n[IdentityProviderValidationException]=second',
    '[IdentityProviderValidationException]=continued\\\nmore',
    'other=continued\\\n[IdentityProviderValidationException]=part of other',
    'other=continued\\',
    'other=continued\\\n',
  ])(
    'rejects ambiguous properties without producing a replacement',
    (original) => {
      expect(() => updateSignInMessage(original)).toThrow();
    }
  );
});
