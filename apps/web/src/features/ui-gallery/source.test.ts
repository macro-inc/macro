import { describe, expect, it } from 'vitest';
import { extractDemoSource } from './source';

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
