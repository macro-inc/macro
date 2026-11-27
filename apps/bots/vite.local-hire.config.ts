import { randomUUID } from 'node:crypto';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { botsBoundary } from './scripts/botsBoundary';
import { localAuth } from './scripts/localAuth';
import { localHire } from './scripts/localHire';
import { botsConfig } from './vite.config';

export default defineConfig((env) => {
  if (env.command !== 'serve' || env.isPreview || env.mode !== 'local-hire') {
    throw new Error(
      'Hire review is available only on an isolated local dev server'
    );
  }

  const [binary, socket, role, team, upstream] = [
    process.env.BOTS_HIRE_REVIEW_BINARY,
    process.env.BOTS_HIRE_REVIEW_SOCKET,
    process.env.BOTS_HIRE_REVIEW_DB_ROLE,
    process.env.BOTS_HIRE_REVIEW_TEAM,
    process.env.BOTS_HIRE_REVIEW_AUTH,
  ];
  if (
    !binary ||
    !socket ||
    !role ||
    !team ||
    upstream !== 'http://127.0.0.1:23211/auth' ||
    team !== '0193a1b2-0000-7000-8000-0000000000aa'
  ) {
    throw new Error(
      'Hire review requires a separate seeded database and local Auth issuer'
    );
  }

  const config = botsConfig(env);
  const path = `/bots-local-auth/${randomUUID()}`;
  const hire = localHire(
    binary,
    socket,
    role,
    team,
    'macro|macrobots-reviewer@example.test'
  );
  return {
    ...config,
    plugins: [
      botsBoundary(false),
      solid({ hot: false }),
      localAuth(path, { upstream, hire }),
    ],
    define: {
      __BOTS_LOCAL_AUTH__: JSON.stringify(path),
      __BOTS_LOCAL_HIRE__: true,
      __BOTS_FIXTURES__: false,
    },
    server: { host: '127.0.0.1', port: 0, strictPort: true, cors: false },
  };
});
