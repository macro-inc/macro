import { expect, test } from 'bun:test';
import { browserConfig } from '../config.ts';

test('the browser answers where startup says, screenshots go to its private state, and the driver files are the harness’s and its own', () => {
  expect(
    browserConfig({
      browserEndpoint: 'http://127.0.0.1:9333',
      state: {
        private: (owner) => `/state/private/${owner}`,
        run: (owner) => `/state/run/${owner}`,
      },
      config: { home: '/home/macro/agent' },
      join: (...parts) => parts.join('/'),
    })
  ).toEqual({
    endpoint: 'http://127.0.0.1:9333',
    screenshots: '/state/private/browser/screenshots',
    screenDriver: '/home/macro/agent/state/screen-driver',
    solverLease: '/state/run/browser/solver-lease.json',
  });
});
