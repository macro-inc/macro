import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/** Standalone browser development shares the local stack's stable CA. */
export function devHttps(
  env: Record<string, string | undefined> = process.env
): Plugin {
  let hostname: string;
  const caDir = fileURLToPath(
    new URL('../../../infra/local/certs/', import.meta.url)
  );

  return {
    name: 'macro-dev-https',
    apply: (_config, { command, isPreview }) =>
      command === 'serve' &&
      !isPreview &&
      !env.MACRO_LOCAL_BACKEND_PROXY &&
      !env.TAURI_ENV_PLATFORM &&
      !env.TAURI_DEV_HOST &&
      env.MACRO_DEV_HTTPS !== 'false',
    config() {
      hostname = execFileSync('hostname', { encoding: 'utf8' })
        .trim()
        .toLowerCase();
      const directory = mkdtempSync(join(tmpdir(), 'macro-vite-tls-'));
      try {
        execFileSync('bash', [
          join(caDir, 'issue-host.sh'),
          directory,
          hostname,
        ]);
        return {
          server: {
            https: {
              cert: readFileSync(join(directory, 'server.pem')),
              key: readFileSync(join(directory, 'server-key.pem')),
            },
            allowedHosts: [hostname],
          },
        };
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const address = server.httpServer?.address();
        if (!address || typeof address === 'string') return;
        server.config.logger.info(
          `\n  App: https://${hostname}:${address.port}/app/\n` +
            `  Trust ${join(caDir, 'ca.pem')} once in the visiting browser.\n`
        );
      });
    },
  };
}
