import { describe, expect, it } from 'vitest';
import { passwordlessRedirectUri } from './passwordlessRedirectUri';

describe('passwordlessRedirectUri', () => {
  it.each([
    [
      {
        host: 'forge.tail66c63e.ts.net:3000',
        origin: 'https://forge.tail66c63e.ts.net:3000',
        protocol: 'https:',
      },
      'https://forge.tail66c63e.ts.net:3000/app',
    ],
    [
      {
        host: 'localhost:3003',
        origin: 'http://localhost:3003',
        protocol: 'http:',
      },
      'http://localhost:3003/app',
    ],
    [
      {
        host: 'localhost',
        origin: 'tauri://localhost',
        protocol: 'tauri:',
      },
      'https://localhost/app',
    ],
  ])('uses the browser-visible web origin for %o', (location, expected) => {
    expect(passwordlessRedirectUri(location)).toBe(expected);
  });
});
