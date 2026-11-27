import { randomUUID } from 'node:crypto';
import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { botsBoundary } from './scripts/botsBoundary.ts';
import { localAuth } from './scripts/localAuth.ts';
import { botsConfig } from './vite.config.ts';

export default defineConfig((env) => {
  if (env.command !== 'serve' || env.isPreview || env.mode !== 'local-auth') {
    throw new Error(
      'Bots local auth is available only on the local dev server'
    );
  }

  const config = botsConfig(env);
  const path = `/bots-local-auth/${randomUUID()}`;
  return {
    ...config,
    plugins: [botsBoundary(false), solid({ hot: false }), localAuth(path)],
    define: {
      __BOTS_LOCAL_AUTH__: JSON.stringify(path),
      __BOTS_FIXTURES__: false,
      __BOTS_LOCAL_HIRE__: false,
    },
    server: {
      host: '127.0.0.1',
      port: 0,
      strictPort: true,
      cors: false,
    },
  };
});
