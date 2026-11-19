import { describe, expect, it } from 'vitest';
import { applyColorScheme } from './css';

describe('applyColorScheme', () => {
  const css =
    '@media (prefers-color-scheme:dark){.a{color:white}}@media (prefers-color-scheme:light){.b{color:black}}.c{color:red}';

  it('applies dark rules for a dark theme and drops light ones', () => {
    expect(applyColorScheme(css, 'dark')).toEqual({
      css: '@media all{.a{color:white}}.c{color:red}',
      hasDarkRules: true,
    });
  });

  it('applies light rules for a light theme and drops dark ones', () => {
    expect(applyColorScheme(css, 'light')).toEqual({
      css: '@media all{.b{color:black}}.c{color:red}',
      hasDarkRules: true,
    });
  });

  it('keeps the other conditions of a matching query', () => {
    expect(
      applyColorScheme(
        '@media only screen and (max-width:600px) and (PREFERS-COLOR-SCHEME:DARK),print{.a{color:white}}',
        'dark'
      ).css
    ).toBe('@media only screen and (max-width:600px),print{.a{color:white}}');
    expect(
      applyColorScheme(
        '@media (prefers-color-scheme:dark) and (max-width:600px){.a{color:white}}',
        'dark'
      ).css
    ).toBe('@media (max-width:600px){.a{color:white}}');
    expect(
      applyColorScheme(
        '@media screen and (prefers-color-scheme:dark),print{.a{color:white}}',
        'light'
      ).css
    ).toBe('@media print{.a{color:white}}');
  });

  it('resolves rules nested inside other at-rules', () => {
    expect(
      applyColorScheme(
        '@media screen{@media (prefers-color-scheme:dark){.a{color:white}}.b{color:red}}',
        'light'
      ).css
    ).toBe('@media screen{.b{color:red}}');
  });

  it('drops queries it cannot evaluate for either theme', () => {
    for (const scheme of ['light', 'dark'] as const) {
      expect(
        applyColorScheme(
          '@media not screen and (prefers-color-scheme:dark){.a{color:white}}@media (not (prefers-color-scheme:dark)){.b{color:red}}.c{color:blue}',
          scheme
        ).css
      ).toBe('.c{color:blue}');
    }
  });

  it('reports no dark rules for light-only or unrelated media queries', () => {
    expect(
      applyColorScheme(
        '@media (prefers-color-scheme:light){.a{color:black}}@media (max-width:600px){.b{color:red}}',
        'dark'
      )
    ).toEqual({
      css: '@media (max-width:600px){.b{color:red}}',
      hasDarkRules: false,
    });
  });
});
