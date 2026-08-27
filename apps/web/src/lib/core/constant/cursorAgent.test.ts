import { describe, expect, it } from 'vitest';
import { isMacroStaffEmail } from './cursorAgent';

describe('isMacroStaffEmail', () => {
  it('accepts the Macro domain case-insensitively', () => {
    expect(isMacroStaffEmail('staff@macro.com')).toBe(true);
    expect(isMacroStaffEmail('staff@MACRO.COM')).toBe(true);
  });

  it('rejects missing and lookalike domains', () => {
    expect(isMacroStaffEmail(undefined)).toBe(false);
    expect(isMacroStaffEmail('staff@example.com')).toBe(false);
    expect(isMacroStaffEmail('staff@macro.com.example.com')).toBe(false);
    expect(isMacroStaffEmail('staff@evil.com@macro.com')).toBe(false);
  });
});
