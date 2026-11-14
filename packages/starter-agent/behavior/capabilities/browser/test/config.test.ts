import { expect, test } from 'bun:test';
import { browserConfig } from '../config.ts';

test('the browser answers where startup says, and screenshots go to its private state', () => {
  expect(
    browserConfig({
      browserEndpoint: 'http://127.0.0.1:9333',
      state: { private: (owner) => `/state/private/${owner}` },
      join: (...parts) => parts.join('/'),
    })
  ).toEqual({
    endpoint: 'http://127.0.0.1:9333',
    screenshots: '/state/private/browser/screenshots',
  });
});
