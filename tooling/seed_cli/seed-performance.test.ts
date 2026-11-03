import { expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('auth parse failures hide response contents; failed writes stop dependent categories', async () => {
  let mode = 'auth-json';
  const calls: string[] = [];
  const server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      calls.push(path);
      if (mode === 'auth-json')
        return new Response('sensitive-auth-fixture: broken JSON');
      if (path === '/auth/login/passwordless')
        return Response.json({ code: 'synthetic-code' });
      if (path.startsWith('/auth/oauth/passwordless/'))
        return Response.json({ access_token: 'synthetic-token' });
      if (path === '/auth/user/me')
        return Response.json({ user_id: 'synthetic-local-user' });
      return new Response('Synthetic failure', { status: 503 });
    },
  });
  try {
    for (const failure of ['auth-json', 'folder-error']) {
      mode = failure;
      calls.length = 0;
      const directory = mkdtempSync(join(tmpdir(), 'performance-seed-test-'));
      try {
        const child = Bun.spawn(
          [
            'bun',
            `${import.meta.dir}/seed-performance.ts`,
            '--origin',
            `http://127.0.0.1:${server.port}`,
            '--email',
            'user@example.com',
            '--manifest',
            `${directory}/manifest.json`,
          ],
          { stdout: 'pipe', stderr: 'pipe' }
        );
        const [output, error, exit] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        expect(exit).not.toBe(0);
        expect(output + error).not.toContain('sensitive-auth-fixture');
        if (failure === 'folder-error') {
          expect(calls.filter((path) => !path.startsWith('/auth/'))).toEqual([
            '/dss/projects',
            '/dss/projects',
          ]);
          const manifest = JSON.parse(
            readFileSync(`${directory}/manifest.json`, 'utf8')
          );
          expect(manifest.blocked).toHaveLength(1);
          expect(manifest.pending).toHaveLength(2);
        }
      } finally {
        rmSync(directory, { recursive: true });
      }
    }
  } finally {
    await server.stop(true);
  }
});
