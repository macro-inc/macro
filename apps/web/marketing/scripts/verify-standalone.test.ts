import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { auditStandalone } from './verify-standalone';

const temporaryDirectories: string[] = [];

function fixture() {
  const repository = fs.mkdtempSync(
    path.join(os.tmpdir(), 'website-boundary-')
  );
  temporaryDirectories.push(repository);
  const website = path.join(repository, 'apps/web/marketing');
  const write = (name: string, text = '') => {
    const file = path.resolve(website, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
    return file;
  };
  write('package.json', '{"dependencies":{}}');
  write(
    'tsconfig.json',
    '{"compilerOptions":{"baseUrl":".","paths":{"@app/*":["src/*"]}}}'
  );
  write(
    'src/local.ts',
    'export interface Local { name: string }; export const name = "local";'
  );
  write('public/icon.svg', '<svg />');
  write('../src/private.ts', 'export const secret = 1;');
  return { website, write, inspect: () => auditStandalone(website) };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0))
    fs.rmSync(directory, { recursive: true, force: true });
});

describe('standalone website boundary', () => {
  it('accepts website-owned imports, assets, CSS scans, and declared third-party packages', () => {
    const { write, inspect } = fixture();
    write('package.json', '{"dependencies":{"third-party":"1.0.0"}}');
    write(
      'node_modules/third-party/package.json',
      '{"name":"third-party","main":"index.js"}'
    );
    write('node_modules/third-party/index.js', 'module.exports = {};');
    write('src/font.woff2');
    write('src/base.css', ':root { color: white; }');
    write(
      'src/site.css',
      '@import url("./base.css"); @source "./**/*.tsx"; @font-face { src: url("./font.woff2"); }'
    );
    write(
      'src/main.tsx',
      `
      import type { Local } from '@app/local';
      import 'third-party';
      import './site.css';
      export { name } from './local';
      const pages = import.meta.glob(['./pages/*.tsx', '!./pages/private*.tsx']);
      const load = () => import('./local');
      const font = new URL('./font.woff2', import.meta.url);
      const navigation = '/app/login';
      const dynamicAsset = (name: string) => '/images/' + name + '.png';
      export const image = <img src="/icon.svg" srcset="/icon.svg 1x, /icon.svg 2x" />;
    `
    );
    write(
      'index.html',
      '<link rel="icon" href="/icon.svg"><script type="module" src="/src/main.tsx"></script>'
    );
    expect(inspect().violations).toEqual([]);
  });

  it.each([
    "import { secret } from '../../src/private';",
    "import type { Secret } from '../../src/private';",
    "export type { Secret } from '../../src/private';",
    "type Secret = import('../../src/private').Secret;",
    "const load = () => import('../../src/private');",
    "const load = require('../../src/private');",
    "import secret = require('../../src/private');",
    "const files = import.meta.glob('../../src/**/*.tsx');",
    '/// <reference path="../../src/private.ts" />',
  ])(
    'rejects app dependencies even in unreachable/type-only modules: %s',
    (source) => {
      const { write, inspect } = fixture();
      write('src/unreachable.ts', source);
      expect(inspect().violations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            file: 'src/unreachable.ts',
            reason: expect.stringContaining('outside the website'),
          }),
        ])
      );
    }
  );

  it('rejects app aliases even when they have been mapped to a local stub', () => {
    const { write, inspect } = fixture();
    write(
      'tsconfig.json',
      '{"compilerOptions":{"paths":{"@core/*":["src/*"]}}}'
    );
    write('src/main.ts', "import type { Local } from '@core/local';");
    expect(inspect().violations[0].reason).toContain(
      'Application and workspace-package'
    );
  });

  it('rejects aliases and TypeScript configuration that reach outside the website', () => {
    const { write, inspect } = fixture();
    write('../tsconfig.json', '{}');
    write(
      'tsconfig.json',
      '{"extends":"../tsconfig.json","compilerOptions":{"paths":{"@app/*":["../src/*"]}}}'
    );
    const reasons = inspect().violations.map((item) => item.reason);
    expect(reasons).toContain('TypeScript configuration must be website-owned');
    expect(reasons).toContain(
      'Alias resolves outside the website or third-party node_modules'
    );
  });

  it('rejects undeclared dependencies inherited accidentally from the app install', () => {
    const { write, inspect } = fixture();
    write('../node_modules/app-only/package.json', '{"main":"index.js"}');
    write('../node_modules/app-only/index.js');
    write('src/main.ts', "import 'app-only';");
    expect(inspect().violations[0].reason).toContain(
      'declared in the website package.json'
    );
  });

  it('rejects workspace dependencies even when no source currently imports them', () => {
    const { write, inspect } = fixture();
    write(
      'package.json',
      '{"dependencies":{"@macro-inc/ui":"*","shared":"workspace:*","app":"file:../src"}}'
    );
    expect(inspect().violations).toHaveLength(3);
    expect(
      inspect().violations.every((item) => item.file === 'package.json')
    ).toBe(true);
  });

  it('follows package symlinks so node_modules cannot hide workspace source', () => {
    const { website, write, inspect } = fixture();
    write('package.json', '{"dependencies":{"local-ui":"1.0.0"}}');
    const workspace = path.dirname(
      write('../../../packages/local-ui/package.json', '{"main":"index.js"}')
    );
    write('../../../packages/local-ui/index.js', 'module.exports = {};');
    fs.mkdirSync(path.join(website, 'node_modules'));
    fs.symlinkSync(workspace, path.join(website, 'node_modules/local-ui'));
    write('src/main.ts', "import 'local-ui';");
    expect(inspect().violations[0].reason).toContain('workspace source');
  });

  it.each([
    '@import "../../src/private.css";',
    '@source "../../src/**/*.tsx";',
    '@import "./base.css" source("../../src");',
    '.icon { background: url("../../src/icon.svg"); }',
    '.icon { background: url("/live-editor/assets/editor.js"); }',
  ])('rejects CSS dependencies on the application: %s', (css) => {
    const { write, inspect } = fixture();
    write('src/base.css');
    write('../src/private.css');
    write('../src/icon.svg');
    write('src/site.css', css);
    expect(inspect().violations.length).toBeGreaterThan(0);
    expect(
      inspect().violations.every((item) => item.file === 'src/site.css')
    ).toBe(true);
  });

  it('rejects root/shared asset paths and app-hosted iframe payloads', () => {
    const { write, inspect } = fixture();
    write(
      'src/main.tsx',
      `
      export const demo = <iframe src="https://macro.com/live-editor/index.html" />;
      export const image = <img src="/shared-only.png" />;
    `
    );
    expect(inspect().violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          reference: 'https://macro.com/live-editor/index.html',
          reason: expect.stringContaining('authenticated app'),
        }),
        expect.objectContaining({
          reference: '/shared-only.png',
          reason: 'Local asset is missing from the website',
        }),
      ])
    );
  });

  it('rejects escaped public symlinks even when no source refers to the asset', () => {
    const { website, write, inspect } = fixture();
    const external = write('../src/icon.svg', '<svg/>');
    fs.symlinkSync(external, path.join(website, 'public/borrowed.svg'));
    expect(inspect().violations[0]).toMatchObject({
      file: 'public/borrowed.svg',
      reason: 'Website source and assets cannot be symlinked to external code',
    });
  });

  it('rejects stale compiled editor artifacts without parsing their generated code', () => {
    const { write, inspect } = fixture();
    write(
      'public/live-editor/assets/editor.js',
      "import 'many-app-dependencies';"
    );
    expect(inspect().violations).toHaveLength(1);
    expect(inspect().violations[0].file).toBe('public/live-editor');
  });

  it('rejects computed imports whose target cannot be verified', () => {
    const { write, inspect } = fixture();
    write('src/main.ts', 'const loader = (name: string) => import(name);');
    expect(inspect().violations[0].reason).toContain(
      'Import paths must be static'
    );
  });
});
