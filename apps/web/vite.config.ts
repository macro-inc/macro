import { appendFileSync } from 'node:fs';
import { defineConfig, mergeConfig, type Plugin } from 'vite';
import { createAppViteConfig } from './vite.base.ts';

function agentDebugLogPlugin(): Plugin {
  return {
    name: 'agent-debug-log',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__agent-debug-log', (req, res) => {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });
        req.on('end', () => {
          try {
            const entry = JSON.parse(body);
            // #region agent log
            appendFileSync(
              '/opt/cursor/logs/debug.log',
              `${JSON.stringify(entry)}\n`
            );
            // #endregion
            res.statusCode = 204;
          } catch {
            res.statusCode = 400;
          }
          res.end();
        });
      });
    },
  };
}

export default defineConfig(async (env) => {
  const base = await createAppViteConfig()(env);
  return mergeConfig(base, { plugins: [agentDebugLogPlugin()] });
});
