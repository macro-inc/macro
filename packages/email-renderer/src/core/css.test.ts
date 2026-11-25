import { describe, expect, it } from 'vitest';
import { applyColorScheme } from './css';

describe('applyColorScheme', () => {
  const css =
    '@media (prefers-color-scheme:dark){.a{background-color:#111}}@media (prefers-color-scheme:light){.b{color:black}}.c{color:red}';

  it('applies dark rules for a dark theme and drops light ones', () => {
    expect(applyColorScheme(css, 'dark')).toEqual({
      css: '@media (min-width:0){.a{background-color:#111}}.c{color:red}',
      darkBackground: true,
    });
  });

  it('applies light rules for a light theme and drops dark ones', () => {
    expect(applyColorScheme(css, 'light')).toEqual({
      css: '@media (min-width:0){.b{color:black}}.c{color:red}',
      darkBackground: false,
    });
  });

  it('keeps the other conditions of a matching query', () => {
    expect(
      applyColorScheme(
        '@media only screen and (max-width:600px) and (PREFERS-COLOR-SCHEME:DARK),print{.a{color:white}}',
        'dark'
      ).css
    ).toBe(
      '@media only screen and (max-width:600px) and (min-width:0),print{.a{color:white}}'
    );
    expect(
      applyColorScheme(
        '@media screen and (prefers-color-scheme:dark),not print{.a{color:white}}',
        'light'
      ).css
    ).toBe('@media not print{.a{color:white}}');
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
          '@media not screen and (prefers-color-scheme:dark){.a{background:#111}}@media (not (prefers-color-scheme:dark)){.b{color:red}}.c{color:blue}',
          scheme
        )
      ).toEqual({ css: '.c{color:blue}', darkBackground: false });
    }
  });

  it('reports a dark background only for applied dark rules that paint one', () => {
    expect(
      applyColorScheme(
        '@media (prefers-color-scheme:dark){a{color:#9cf}}@media (max-width:600px){.b{background:#111}}',
        'dark'
      ).darkBackground
    ).toBe(false);
    expect(
      applyColorScheme(
        '@media screen{@media (prefers-color-scheme:dark){.a{background-image:linear-gradient(#000,#111)}}}',
        'dark'
      ).darkBackground
    ).toBe(true);
    expect(
      applyColorScheme(
        '@media (prefers-color-scheme:dark){.wrap{background:black}}',
        'dark'
      ).darkBackground
    ).toBe(true);
  });

  it('counts a custom-property background and checks the remaining media conditions', () => {
    const css =
      '@media print and (prefers-color-scheme:dark){.wrap{background:var(--surface)}}';
    expect(applyColorScheme(css, 'dark').darkBackground).toBe(true);
    expect(
      applyColorScheme(css, 'dark', (query) => !query.includes('print'))
        .darkBackground
    ).toBe(false);
  });

  it('does not count image swaps, resets or nested light rules as a dark background', () => {
    for (const rule of [
      '.logo{background-image:url(cid:dark-logo)}',
      '.a{background:none}.b{background-color:transparent!important}',
      '@media (prefers-color-scheme:light){.a{background:#000}}',
    ])
      expect(
        applyColorScheme(`@media (prefers-color-scheme:dark){${rule}}`, 'dark')
          .darkBackground
      ).toBe(false);
  });
});
