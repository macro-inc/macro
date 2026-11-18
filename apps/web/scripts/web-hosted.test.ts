import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, type Rolldown } from 'vite';
import { afterEach, expect, it, vi } from 'vitest';
import { createAppViteConfig } from '../vite.base';

const root = fileURLToPath(new URL('..', import.meta.url));

afterEach(() => vi.unstubAllEnvs());

// NO_MINIFY drops hashes from bundled names, but a native bundle loads hosted
// videos from the web deploy, whose names are hashed.
it.each([
  'false',
  'true',
])('writes tutorial videos to web-hosted/ with hashed names and keeps posters in assets/ (NO_MINIFY=%s)', async (noMinify) => {
  vi.stubEnv('NO_MINIFY', noMinify);
  const config = await createAppViteConfig()({
    command: 'build',
    mode: 'production',
  });
  const output = config.build?.rolldownOptions?.output;
  if (!output || Array.isArray(output)) throw new Error('unexpected output');
  const result = (await build({
    ...config,
    configFile: false,
    root,
    publicDir: false,
    logLevel: 'silent',
    build: {
      ...config.build,
      write: false,
      rolldownOptions: {
        input: `${root}/src/features/video-tutorials/catalog.ts`,
        preserveEntrySignatures: 'strict',
        // The app's startup chunking is keyed to its HTML entries.
        output: { ...output, codeSplitting: undefined },
      },
    },
  })) as Rolldown.RolldownOutput;

  const assets = result.output
    .filter((file) => file.type === 'asset')
    .map((file) => file.fileName);
  const videos = assets.filter((name) => name.endsWith('.mp4'));
  expect(videos).toHaveLength(17);
  for (const video of videos) {
    expect(video).toMatch(/^web-hosted\/[\w-]+-[\w-]{8}\.mp4$/);
  }
  const posters = assets.filter((name) => name.endsWith('.jpg'));
  expect(posters).toHaveLength(17);
  for (const poster of posters) expect(poster).toMatch(/^assets\//);

  const code = result.output
    .filter((file) => file.type === 'chunk')
    .map((file) => file.code)
    .join('\n');
  for (const video of videos) expect(code).toContain(`/app/${video}`);
}, 120_000);

it('leaves web-hosted/ out of every native bundle', () => {
  const read = (path: string) => readFileSync(resolve(root, path), 'utf8');
  const justfile = read('justfile');
  for (const recipe of ['build-tauri', 'build-tauri-dev']) {
    const body = justfile.split(`\n${recipe}:`)[1]?.split('\n\n')[0];
    expect(body, recipe).toContain('rm -rf dist/web-hosted');
  }
  expect(justfile).toMatch(/zip -qr "\$TARGET" \. -x [^\n]*'web-hosted\/\*'/);
  expect(read('../../infra/stacks/web-app/index.ts')).toContain(
    'rm -rf ${shellQuote(`${appArchiveOutputPath}/web-hosted`)}'
  );
  expect(read('../../nix/tauri-desktop.nix')).toContain(
    'rm -rf "$out/web-hosted"'
  );
});
