import { appendFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import { createAppViteConfig } from './vite.base.ts';

export default defineConfig((env) => {
  const config = createAppViteConfig()(env);
  config.plugins = [
    ...(config.plugins ?? []),
    {
      name: 'agent-focus-debug-log',
      configureServer(server) {
        server.middlewares.use('/__agent-focus-debug', (request, response) => {
          let body = '';
          request.setEncoding('utf8');
          request.on('data', (chunk) => {
            body += chunk;
          });
          request.on('end', () => {
            try {
              appendFileSync('/opt/cursor/logs/debug.log', `${body}\n`);
              response.statusCode = 204;
            } catch {
              response.statusCode = 500;
            }
            response.end();
          });
        });
      },
    },
  ];
  return config;
});
