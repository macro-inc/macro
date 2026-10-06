import { describe, expect, it } from 'vitest';
import { canBypassOnboarding, isMacroStaffEmail } from './staff';

describe('canBypassOnboarding', () => {
  it('shows Bypass for @macro.com accounts', () => {
    expect(canBypassOnboarding('wolf@macro.com')).toBe(true);
    expect(canBypassOnboarding('Wolf@Macro.com')).toBe(true);
    expect(canBypassOnboarding('  wolf@macro.com  ')).toBe(true);
  });

  it('hides Bypass from everyone else', () => {
    expect(canBypassOnboarding('ada@gmail.com')).toBe(false);
    expect(canBypassOnboarding('ada@notmacro.com')).toBe(false);
    expect(canBypassOnboarding(undefined)).toBe(false);
    expect(canBypassOnboarding('not-an-email')).toBe(false);
  });
});

describe('isMacroStaffEmail', () => {
  it('matches only the macro.com domain', () => {
    expect(isMacroStaffEmail('ada@macro.com')).toBe(true);
    expect(isMacroStaffEmail('ada@MACRO.com')).toBe(true);
    expect(isMacroStaffEmail('ada@sub.macro.com')).toBe(false);
    expect(isMacroStaffEmail('ada@gmail.com')).toBe(false);
  });
});
