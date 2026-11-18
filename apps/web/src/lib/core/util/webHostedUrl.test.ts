import { afterEach, expect, it, vi } from 'vitest';
import { webHostedUrl } from './webHostedUrl';

const VIDEO = '/app/web-hosted/mail-BRY6OCv5.mp4';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it('keeps the build-relative URL on the web, where the file is same-origin', () => {
  vi.stubEnv('DEV', false);
  expect(webHostedUrl(VIDEO)).toBe(VIDEO);
});

it('points a production native build at the production web deploy', () => {
  vi.stubEnv('DEV', false);
  vi.stubEnv('MODE', 'production');
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  expect(webHostedUrl(VIDEO)).toBe(`https://macro.com${VIDEO}`);
});

it('points a development native build at the dev web deploy', () => {
  vi.stubEnv('DEV', false);
  vi.stubEnv('MODE', 'development');
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  expect(webHostedUrl(VIDEO)).toBe(`https://dev.macro.com${VIDEO}`);
});

it('keeps the dev server URL in a native app running against it', () => {
  vi.stubEnv('DEV', true);
  vi.stubGlobal('__TAURI_INTERNALS__', {});
  const served = '/src/features/video-tutorials/assets/mail.mp4';
  expect(webHostedUrl(served)).toBe(served);
});
