/**
 * The lab stays a leaf: nothing in production refers to it, it refers to no
 * production code, and it exports nothing an agent or MCP server could load.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const PACKAGE = resolve(import.meta.dir, '..');
const REPOSITORY = join(PACKAGE, '..', '..');

describe('isolation', () => {
  test('no code outside the lab names it', () => {
    // Only docs and CI (and the generator of its workflow) may mention the lab.
    const found = Bun.spawnSync(
      [
        'git',
        'grep',
        '-l',
        '-e',
        'captcha-vision-lab',
        '--',
        '.',
        ':!packages/captcha-vision-lab',
        ':!docs',
        ':!.github',
        ':!tooling/xtask/crates/xtask_workflows',
      ],
      { cwd: REPOSITORY }
    );

    // git grep exits 1 when nothing matches.
    expect(found.exitCode).toBe(1);
    expect(found.stdout.toString()).toBe('');
  });

  test('the lab imports only its own files, node, playwright and zod', () => {
    // Every import form (static, dynamic, re-export, require), in every file
    // under src and test, as Bun's own parser sees it.
    const transpiler = new Bun.Transpiler({ loader: 'ts' });
    const files = ['src', 'test'].flatMap((directory) =>
      readdirSync(join(PACKAGE, directory), { recursive: true })
        .map((file) => join(PACKAGE, directory, String(file)))
        .filter((file) => file.endsWith('.ts'))
    );
    const imports = files.flatMap((file) =>
      transpiler
        .scanImports(readFileSync(file, 'utf8'))
        .map(({ path }) => ({ file, path }))
    );

    expect(imports.length).toBeGreaterThan(0);
    for (const { file, path } of imports) {
      if (path.startsWith('.')) {
        // A relative import must stay inside this package.
        const target = resolve(dirname(file), path);
        expect(target.startsWith(`${PACKAGE}/`)).toBe(true);
        expect(target).not.toContain('/node_modules/');
      } else {
        expect(path).toMatch(/^(node:|bun:test$|playwright$|zod$)/);
      }
    }
  });

  test('the package exports nothing and depends on no agent or MCP code', () => {
    const manifest = JSON.parse(
      readFileSync(join(PACKAGE, 'package.json'), 'utf8')
    );

    expect(manifest.private).toBe(true);
    expect(manifest.main).toBeUndefined();
    expect(manifest.exports).toBeUndefined();
    expect(manifest.bin).toBeUndefined();
    expect(Object.keys(manifest.dependencies).sort()).toEqual([
      'playwright',
      'zod',
    ]);
  });

  test('the root workspace does not include the lab', () => {
    const root = JSON.parse(
      readFileSync(join(REPOSITORY, 'package.json'), 'utf8')
    );

    expect(root.workspaces.packages).not.toContain(
      'packages/captcha-vision-lab'
    );
  });
});
