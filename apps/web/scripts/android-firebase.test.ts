import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateAndroidFirebase } from './android-firebase';

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
        { ...valid, client: [{ ...client, api_key: [{ current_key: value }] }] },
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
