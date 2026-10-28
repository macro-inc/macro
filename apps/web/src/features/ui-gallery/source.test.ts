import { describe, expect, it } from 'vitest';
import {
  extractDemoSource,
  extractGuidelines,
  extractTypeSource,
} from './source';

const FILE = [
  "import { Button } from '@ui';",
  '',
  '// #region demo:variants',
  'function VariantsDemo() {',
  '  return (',
  '    <div class="flex gap-2">',
  '      <Button variant="ghost">Ghost</Button>',
  '    </div>',
  '  );',
  '}',
  '// #endregion',
  '',
  '// #region demo:sizes',
  'function SizesDemo() {',
  '  return <Button size="sm">Small</Button>;',
  '}',
  '// #endregion',
].join('\n');

describe('extractDemoSource', () => {
  it('returns the source between a demo region and its endregion', () => {
    expect(extractDemoSource(FILE, 'variants')).toBe(
      [
        'function VariantsDemo() {',
        '  return (',
        '    <div class="flex gap-2">',
        '      <Button variant="ghost">Ghost</Button>',
        '    </div>',
        '  );',
        '}',
      ].join('\n')
    );
  });

  it('picks the region matching the id, not the first one', () => {
    expect(extractDemoSource(FILE, 'sizes')).toBe(
      [
        'function SizesDemo() {',
        '  return <Button size="sm">Small</Button>;',
        '}',
      ].join('\n')
    );
  });

  it('does not match an id that is a prefix of another', () => {
    const source = [
      '// #region demo:size',
      'const a = 1;',
      '// #endregion',
    ].join('\n');
    expect(extractDemoSource(source, 'sizes')).toBeNull();
  });

  it('dedents the block to its own left margin', () => {
    const source = [
      '  // #region demo:nested',
      '  const value = {',
      '    key: 1,',
      '  };',
      '  // #endregion',
    ].join('\n');
    expect(extractDemoSource(source, 'nested')).toBe(
      ['const value = {', '  key: 1,', '};'].join('\n')
    );
  });

  it('closes on the matching endregion when regions nest', () => {
    const source = [
      '// #region demo:outer',
      'const a = 1;',
      '// #region detail',
      'const b = 2;',
      '// #endregion',
      'const c = 3;',
      '// #endregion',
      'const after = 4;',
    ].join('\n');
    expect(extractDemoSource(source, 'outer')).toBe(
      [
        'const a = 1;',
        '// #region detail',
        'const b = 2;',
        '// #endregion',
        'const c = 3;',
      ].join('\n')
    );
  });

  it('trims blank lines at the edges but keeps interior spacing', () => {
    const source = [
      '// #region demo:spaced',
      '',
      'const a = 1;',
      '',
      'const b = 2;',
      '',
      '// #endregion',
    ].join('\n');
    expect(extractDemoSource(source, 'spaced')).toBe(
      'const a = 1;\n\nconst b = 2;'
    );
  });

  it('returns null for a missing region', () => {
    expect(extractDemoSource(FILE, 'nope')).toBeNull();
  });

  it('returns null for an unterminated region', () => {
    const source = ['// #region demo:open', 'const a = 1;'].join('\n');
    expect(extractDemoSource(source, 'open')).toBeNull();
  });
});

describe('extractGuidelines', () => {
  it('reads @do and @dont tags out of a doc block', () => {
    const source = [
      '/**',
      ' * A button.',
      ' *',
      ' * @do Give every screen one primary action.',
      ' * @dont Do not use it for navigation.',
      ' */',
      'export function Button() {}',
    ].join('\n');

    expect(extractGuidelines(source)).toEqual({
      do: ['Give every screen one primary action.'],
      dont: ['Do not use it for navigation.'],
    });
  });

  it('joins a tag that wraps onto following lines', () => {
    const source = [
      '/**',
      ' * @do Always set `label` on icon-only buttons so the control',
      ' *   still has an accessible name.',
      ' * @dont Do not nest them.',
      ' */',
    ].join('\n');

    const { do: dos, dont } = extractGuidelines(source);
    expect(dos).toEqual([
      'Always set `label` on icon-only buttons so the control still has an accessible name.',
    ]);
    expect(dont).toEqual(['Do not nest them.']);
  });

  it('collects tags from every doc block in the file', () => {
    const source = [
      '/** @do First. */',
      'export function A() {}',
      '/** @do Second. */',
      'export function B() {}',
    ].join('\n');
    expect(extractGuidelines(source).do).toEqual(['First.', 'Second.']);
  });

  it('returns empty lists when the file has no tags', () => {
    expect(extractGuidelines('/** Plain. */\nexport const a = 1;')).toEqual({
      do: [],
      dont: [],
    });
  });
});

describe('extractTypeSource', () => {
  it('returns an exported type declaration', () => {
    const source = [
      'const x = 1;',
      'export type ButtonProps = {',
      '  variant?: string;',
      '};',
      'const y = 2;',
    ].join('\n');
    expect(extractTypeSource(source, 'ButtonProps')).toBe(
      'export type ButtonProps = {\n  variant?: string;\n};'
    );
  });

  it('finds a non-exported declaration too', () => {
    expect(
      extractTypeSource('type PanelProps = SurfaceProps;', 'PanelProps')
    ).toBe('type PanelProps = SurfaceProps;');
  });

  // The `>` in `=> void` has no opening partner; counting it would cut the
  // declaration short at the next semicolon.
  it('does not stop early on an arrow-function member', () => {
    const source = [
      'export type ToggleSwitchProps = {',
      '  onChange?: (checked: boolean) => void;',
      '  size?: string;',
      '};',
    ].join('\n');
    expect(extractTypeSource(source, 'ToggleSwitchProps')).toContain(
      'size?: string;'
    );
  });

  it('handles a generic intersection', () => {
    const source =
      "export type P = Root<'button'> & Props<'button'> & { a?: string };\n";
    expect(extractTypeSource(source, 'P')).toBe(
      "export type P = Root<'button'> & Props<'button'> & { a?: string };"
    );
  });

  it('does not match a similarly named type', () => {
    const source = 'export type ButtonVariantProps = string;';
    expect(extractTypeSource(source, 'ButtonProps')).toBeNull();
  });

  it('returns null when absent', () => {
    expect(extractTypeSource('const a = 1;', 'Nope')).toBeNull();
  });
});
