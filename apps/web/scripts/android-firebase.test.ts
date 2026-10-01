import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  fetchAndroidFirebase,
  prepareAndroidFirebase,
  validateAndroidFirebase,
} from './android-firebase';

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFileSync: vi.fn(),
}));

afterEach(() => vi.mocked(execFileSync).mockReset());

const config = (project: string, packageName = 'com.macro.app.prod') => ({
  project_info: { project_id: project, project_number: '123456789' },
  client: [
    {
      client_info: {
        mobilesdk_app_id: '1:123456789:android:test',
        android_client_info: { package_name: packageName },
      },
      api_key: [{ current_key: 'test-api-key' }],
    },
  ],
});

describe('Android Firebase environment selection', () => {
  it('accepts the matching existing dev and production projects', () => {
    expect(() =>
      validateAndroidFirebase(config('macro-app-dev-12ae0'), 'dev')
    ).not.toThrow();
    expect(() =>
      validateAndroidFirebase(config('macro-app-955f1'), 'build')
    ).not.toThrow();
  });

  it('rejects crossed environments even with the correct package', () => {
    expect(() =>
      validateAndroidFirebase(config('macro-app-dev-12ae0'), 'build')
    ).toThrow('must use macro-app-955f1');
    expect(() =>
      validateAndroidFirebase(config('macro-app-955f1'), 'dev')
    ).toThrow('must use macro-app-dev-12ae0');
  });

  it('allows a fork project only with an explicit override', () => {
    const fork = config('my-fork');
    expect(() => validateAndroidFirebase(fork, 'build')).toThrow();
    expect(() => validateAndroidFirebase(fork, 'build', true)).not.toThrow();
    expect(() =>
      validateAndroidFirebase(config('macro-app-dev-12ae0'), 'build', true)
    ).toThrow('must use macro-app-955f1');
    expect(() =>
      validateAndroidFirebase(config('my-fork', 'wrong.package'), 'build', true)
    ).toThrow('must contain com.macro.app.prod');
  });

  it.each([undefined, ''])(
    'rejects missing or empty Firebase fields (%s)',
    (value) => {
      const valid = config('macro-app-dev-12ae0');
      const client = valid.client[0];
      for (const incomplete of [
        {
          ...valid,
          project_info: { ...valid.project_info, project_number: value },
        },
        {
          ...valid,
          client: [
            {
              ...client,
              client_info: { ...client.client_info, mobilesdk_app_id: value },
            },
          ],
        },
        {
          ...valid,
          client: [{ ...client, api_key: [{ current_key: value }] }],
        },
        { ...valid, client: [{ ...client, api_key: [] }] },
        { ...valid, client: [{ ...client, api_key: undefined }] },
      ]) {
        expect(() => validateAndroidFirebase(incomplete, 'dev')).toThrow(
          'Invalid Android Firebase configuration'
        );
      }
    }
  );

  it('copies Firebase config before the Android project directory exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'android-firebase-'));
    try {
      const source = join(root, 'google-services.json');
      const destination = join(root, 'gen/android/app/google-services.json');
      const contents = JSON.stringify(config('macro-app-dev-12ae0'));
      await writeFile(source, contents);
      const result = spawnSync('bun', [
        fileURLToPath(new URL('./android-firebase.ts', import.meta.url)),
        'dev',
        source,
        destination,
      ]);
      expect(result.status, result.stderr.toString()).toBe(0);
      expect(await readFile(destination, 'utf8')).toBe(contents);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects old scaffold packages and malformed configurations', () => {
    expect(() =>
      validateAndroidFirebase(
        config('macro-app-dev-12ae0', 'com.tauri.dev'),
        'dev'
      )
    ).toThrow('must contain com.macro.app.prod');
    expect(() => validateAndroidFirebase(null, 'dev')).toThrow(
      'Invalid Android Firebase configuration'
    );
  });
});

describe('Pinned Android Firebase download', () => {
  const contents = JSON.stringify(config('macro-app-955f1'));
  const pin = {
    project: 'android-release',
    config: 'prd',
    secret: 'GOOGLE_SERVICES_JSON_V1',
    sha256: createHash('sha256').update(contents).digest('hex'),
  };

  it('fetches only the pinned key and verifies it, ignoring CLI whitespace', () => {
    vi.mocked(execFileSync).mockReturnValue(`${contents}\n`);
    expect(fetchAndroidFirebase(pin)).toBe(contents);
    expect(execFileSync).toHaveBeenCalledWith(
      'doppler',
      [
        'secrets',
        'get',
        pin.secret,
        '--project',
        pin.project,
        '--config',
        pin.config,
        '--plain',
        '--raw',
        '--no-check-version',
      ],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }
    );
  });

  it('rejects a changed remote value without printing its contents', () => {
    vi.mocked(execFileSync).mockReturnValue('private-config-marker');
    expect(() => fetchAndroidFirebase(pin)).toThrow('checksum mismatch');
    expect(() => fetchAndroidFirebase(pin)).not.toThrow(
      'private-config-marker'
    );
  });

  it('reports authentication or CLI failures without exposing subprocess output', () => {
    vi.mocked(execFileSync).mockImplementation(() => {
      throw new Error('private-config-marker');
    });
    expect(() => fetchAndroidFirebase(pin)).toThrow('Install the Doppler CLI');
    expect(() => fetchAndroidFirebase(pin)).not.toThrow(
      'private-config-marker'
    );
  });

  it('never falls back to an existing destination when fetching fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'android-firebase-'));
    const destination = join(root, 'google-services.json');
    try {
      await writeFile(destination, contents);
      vi.mocked(execFileSync).mockImplementation(() => {
        throw new Error('offline');
      });
      await expect(
        prepareAndroidFirebase('build', '--doppler', destination)
      ).rejects.toThrow('Unable to fetch');
      expect(await readFile(destination, 'utf8')).toBe(contents);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('keeps the destination intact on invalid JSON and supports offline overrides', async () => {
    const root = await mkdtemp(join(tmpdir(), 'android-firebase-'));
    const source = join(root, 'source.json');
    const destination = join(root, 'google-services.json');
    try {
      await writeFile(destination, contents);
      await writeFile(source, 'invalid-private-config-marker');
      await expect(
        prepareAndroidFirebase('build', source, destination)
      ).rejects.toThrow('Invalid Android Firebase configuration JSON');
      expect(await readFile(destination, 'utf8')).toBe(contents);
      const fork = JSON.stringify(config('my-fork'));
      await writeFile(source, fork);
      await prepareAndroidFirebase('build', source, destination);
      expect(await readFile(destination, 'utf8')).toBe(fork);
      expect(execFileSync).not.toHaveBeenCalled();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
