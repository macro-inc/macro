import { describe, expect, it } from 'vitest';
import { validateAndroidFirebase } from './android-firebase';

const config = (project: string, packageName = 'com.macro.app.prod') => ({
  project_info: { project_id: project },
  client: [
    { client_info: { android_client_info: { package_name: packageName } } },
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
