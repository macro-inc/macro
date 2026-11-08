import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { build } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { assetFileNames } from './tutorial-assets';

const temporaryDirectories: string[] = [];
afterEach(() => {
  for (const path of temporaryDirectories.splice(0))
    rmSync(path, { recursive: true, force: true });
});

const STRIP = join(import.meta.dirname, 'strip-native-tutorials.sh');

function files(root: string): string[] {
  return readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(root, join(entry.parentPath, entry.name)))
    .sort();
}

/**
 * Builds an app that imports a tutorial video and poster, another image of the
 * feature's, and a video of another feature's.
 */
async function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'tutorial-assets-'));
  temporaryDirectories.push(root);
  for (const [path, content] of Object.entries({
    'index.html': '<script type="module" src="/src/main.ts"></script>',
    'src/main.ts': [
      "import video from './features/video-tutorials/assets/mail.mp4';",
      "import poster from './features/video-tutorials/assets/mail-poster.jpg';",
      "import presenter from './features/video-tutorials/assets/presenter.jpg';",
      "import other from './other.mp4';",
      'console.log(video, poster, presenter, other);',
    ].join('\n'),
    'src/features/video-tutorials/assets/mail.mp4': 'v'.repeat(8192),
    'src/features/video-tutorials/assets/mail-poster.jpg': 'p'.repeat(8192),
    'src/features/video-tutorials/assets/presenter.jpg': 'f'.repeat(8192),
    'src/other.mp4': 'o'.repeat(8192),
  })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  await build({
    root,
    configFile: false,
    logLevel: 'silent',
    build: {
      outDir: 'dist',
      rollupOptions: {
        output: { assetFileNames: assetFileNames('[name]-[hash][extname]') },
      },
    },
  });
  return join(root, 'dist');
}

describe('tutorial assets in the build', () => {
  it('puts only the tutorial videos and posters under assets/tutorials', async () => {
    const dist = await buildFixture();

    const built = files(dist);
    const tutorials = built.filter((file) =>
      file.startsWith('assets/tutorials/')
    );
    expect(tutorials).toHaveLength(2);
    expect(tutorials).toContainEqual(
      expect.stringMatching(/^assets\/tutorials\/mail-[\w-]+\.mp4$/)
    );
    expect(tutorials).toContainEqual(
      expect.stringMatching(/^assets\/tutorials\/mail-poster-[\w-]+\.jpg$/)
    );
    expect(built).toContainEqual(
      expect.stringMatching(/^assets\/other-[\w-]+\.mp4$/)
    );
    expect(built).toContainEqual(
      expect.stringMatching(/^assets\/presenter-[\w-]+\.jpg$/)
    );
  });

  it('strips them from a native build and keeps everything else', async () => {
    const dist = await buildFixture();
    const before = files(dist);

    const result = spawnSync('bash', [STRIP, dist], { encoding: 'utf8' });

    expect(result.status).toBe(0);
    const after = files(dist);
    expect(after.filter((file) => file.endsWith('.jpg'))).toEqual([
      expect.stringMatching(/^assets\/presenter-/),
    ]);
    expect(after.filter((file) => file.endsWith('.mp4'))).toEqual([
      expect.stringMatching(/^assets\/other-/),
    ]);
    expect(after).toEqual(
      before.filter((file) => !file.startsWith('assets/tutorials/'))
    );
  });

  it('refuses a directory that is not a build', () => {
    const root = mkdtempSync(join(tmpdir(), 'tutorial-assets-'));
    temporaryDirectories.push(root);
    mkdirSync(join(root, 'assets/tutorials'), { recursive: true });

    const result = spawnSync('bash', [STRIP, root], { encoding: 'utf8' });

    expect(result.status).toBe(1);
    expect(files(root)).toEqual([]);
    expect(readdirSync(join(root, 'assets'))).toEqual(['tutorials']);
  });
});
