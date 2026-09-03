import { describe, expect, it } from 'vitest';
import {
  buildBarrelExportMap,
  compileSvgComponent,
  parsePhosphorSpecifier,
  phosphorExportKey,
  rewriteBarrelImports,
  rewritePhosphorImports,
} from './vite-dev-speed';

describe('parsePhosphorSpecifier', () => {
  it('parses the @phosphor alias as regular', () => {
    expect(parsePhosphorSpecifier('@phosphor/plus.svg')).toEqual({
      weight: 'regular',
      file: 'plus.svg',
    });
  });

  it('parses package paths and query suffixes', () => {
    expect(
      parsePhosphorSpecifier(
        '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid'
      )
    ).toEqual({
      weight: 'bold',
      file: 'spinner-gap-bold.svg',
    });
    expect(
      parsePhosphorSpecifier(
        '@phosphor-icons/core/assets/regular/envelope-open.svg'
      )
    ).toEqual({
      weight: 'regular',
      file: 'envelope-open.svg',
    });
  });
});

describe('rewriteBarrelImports', () => {
  const files = new Map<string, string>([
    [
      '/ui/index.ts',
      `
export { Button } from './components/Button';
export { cn } from './utils/classname';
export type { ButtonProps } from './components/Button';
`,
    ],
    [
      '/ui/components/Button.tsx',
      `export function Button() {}\nexport type ButtonProps = { x: number };`,
    ],
    ['/ui/utils/classname.ts', `export function cn(...args: string[]) {}`],
    [
      '/entity/index.ts',
      `
export { EntityProvider } from './Provider';
export { EntityIcon as EntityRowIcon } from './extractors/entity-icon';
export * from './types/entity';
`,
    ],
    [
      '/entity/Provider.tsx',
      `export function EntityProvider() {}`,
    ],
    [
      '/entity/extractors/entity-icon.ts',
      `export function EntityIcon() {}`,
    ],
    [
      '/entity/types/entity.ts',
      `export type EntityData = { id: string };\nexport const ENTITY_KIND = 'entity';`,
    ],
    [
      '/property/index.ts',
      `export * as PropertyUtils from './utils';\nexport { useProperty } from './core/context';`,
    ],
    ['/property/utils/index.ts', `export function format() {}`],
    ['/property/core/context.ts', `export function useProperty() {}`],
  ]);

  const exists = (path: string) => files.has(path);
  const read = (path: string) => {
    const contents = files.get(path);
    if (!contents) throw new Error(`missing ${path}`);
    return contents;
  };

  it('rewrites value and type imports to the concrete modules', () => {
    const ui = buildBarrelExportMap('/ui/index.ts', '@ui', read, exists);
    const entity = buildBarrelExportMap(
      '/entity/index.ts',
      '@entity',
      read,
      exists
    );
    const rewritten = rewriteBarrelImports(
      `import { cn, Button, type ButtonProps } from '@ui';
import { EntityProvider, EntityRowIcon, ENTITY_KIND } from '@entity';
import type { EntityData } from '@entity';
`,
      '/app/Root.tsx',
      new Map([
        ['@ui', ui],
        ['@entity', entity],
      ])
    );
    expect(rewritten).toContain("from '@ui/utils/classname'");
    expect(rewritten).toContain("from '@ui/components/Button'");
    expect(rewritten).toContain("from '@entity/Provider'");
    expect(rewritten).toContain(
      "import { EntityIcon as EntityRowIcon } from '@entity/extractors/entity-icon'"
    );
    expect(rewritten).toContain("from '@entity/types/entity'");
    expect(rewritten).not.toContain("from '@ui'");
    expect(rewritten).not.toContain("from '@entity'");
  });

  it('rewrites namespace re-exports to namespace imports', () => {
    const property = buildBarrelExportMap(
      '/property/index.ts',
      '@property',
      read,
      exists
    );
    const rewritten = rewriteBarrelImports(
      `import { PropertyUtils, useProperty } from '@property';`,
      '/app/File.tsx',
      new Map([['@property', property]])
    );
    expect(rewritten).toContain(
      "import * as PropertyUtils from '@property/utils'"
    );
    expect(rewritten).toContain("from '@property/core/context'");
  });
});

describe('rewritePhosphorImports', () => {
  it('collapses default and re-exported icons onto the virtual module', () => {
    const rewritten = rewritePhosphorImports(
      `import Plus from '@phosphor/plus.svg';
import Spinner from '@phosphor-icons/core/bold/spinner-gap-bold.svg?component-solid';
export { default as Notepad } from '@phosphor/notepad.svg';
`,
      (specifier) => {
        const parsed = parsePhosphorSpecifier(specifier);
        if (!parsed) return null;
        return {
          key: phosphorExportKey(parsed.weight, parsed.file),
          ...parsed,
          absPath: `/icons/${parsed.file}`,
        };
      }
    );
    expect(rewritten).toContain(
      "import Plus from 'virtual:macro-phosphor/regular_plus'"
    );
    expect(rewritten).toContain(
      "import Spinner from 'virtual:macro-phosphor/bold_spinner_gap_bold'"
    );
    expect(rewritten).toContain(
      "export { default as Notepad } from 'virtual:macro-phosphor/regular_notepad'"
    );
  });
});

describe('compileSvgComponent', () => {
  it('emits a solid template that spreads props onto the svg', () => {
    const code = compileSvgComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"></svg>',
      'default'
    );
    expect(code).toContain('template(`<svg');
    expect(code).toContain('spread(el, props, true)');
    expect(code).toContain('export default function Icon');
  });
});
