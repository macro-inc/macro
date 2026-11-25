/**
 * The lab stays a leaf: nothing in production refers to it, it refers to no
 * production code, and it exports nothing an agent or MCP server could load.
 */
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGE = join(import.meta.dir, '..');
const REPOSITORY = join(PACKAGE, '..', '..');

describe('isolation', () => {
  test('no code outside the lab names it', () => {
    // Only docs and CI may mention the lab.
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
      ],
      { cwd: REPOSITORY }
    );

    // git grep exits 1 when nothing matches.
    expect(found.exitCode).toBe(1);
    expect(found.stdout.toString()).toBe('');
  });

  test('the lab imports only its own files, node, playwright and zod', () => {
    const files = ['src', 'test'].flatMap((directory) =>
      readdirSync(join(PACKAGE, directory)).map((file) =>
        join(PACKAGE, directory, file)
      )
    );
    const specifiers = files.flatMap((file) =>
      [
        ...readFileSync(file, 'utf8').matchAll(
          /^} from '([^']+)';$|^import .* from '([^']+)';$/gm
        ),
      ].map((match) => (match[1] ?? match[2])!)
    );

    expect(specifiers.length).toBeGreaterThan(0);
    for (const specifier of specifiers) {
      expect(specifier).toMatch(/^(\.\.?\/|node:|bun:test$|playwright$|zod$)/);
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
