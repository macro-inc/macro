/**
 * A script run the way the running agent runs one: in a process of its own,
 * `cli.ts exec`, with a cleared environment, reaching a fake Macro through
 * the agent's relay. The script's process never has the agent's key.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inSubprocess } from '@macro-inc/muppet/core/code';
import { childEnvironment } from '../children.ts';
import { type Relay, startRelay } from '../relay.ts';

const realKey = 'mak_real_key_never_in_a_script';
const agentId = 'macro|agent@example.com';
const packageRoot = join(import.meta.dir, '..', '..', '..');
const linked = [
  'cli.ts',
  'index.ts',
  'behavior',
  'tsconfig.json',
  'package.json',
  'node_modules',
  'AGENT.md',
];
const settingsExample = 'agent.example.json';
const settingsFile = 'agent.json';
/**
 * The settings to run with: the template's example, or in an agent's own
 * repository (which has its rendered `agent.json` and no example) that.
 */
const settingsSource = (root: string): string =>
  existsSync(join(root, settingsExample))
    ? join(root, settingsExample)
    : join(root, settingsFile);
// The script's process type-checks the agent's code from cold.
const coldCheckMs = 120_000;

const seen: { path: string; key: string | null }[] = [];
let macro: ReturnType<typeof Bun.serve>;
let relay: Relay;
let workspace: string;

beforeAll(async () => {
  macro = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: (request) => {
      seen.push({
        path: new URL(request.url).pathname,
        key: request.headers.get('x-macro-user-api-key'),
      });
      return Response.json({ user_id: agentId });
    },
  });
  relay = startRelay({
    targets: { auth: `${macro.url.origin}/auth` },
    speech: `${macro.url.origin}/agent-harness-egress/brain/inference`,
    apiKey: realKey,
  });
  // A workspace of this template's code, with settings of its own.
  workspace = await mkdtemp(join(tmpdir(), 'starter-agent-subprocess-'));
  for (const name of linked)
    await symlink(join(packageRoot, name), join(workspace, name));
  await Bun.write(
    join(workspace, settingsFile),
    await Bun.file(settingsSource(packageRoot)).text()
  );
});

afterAll(async () => {
  relay.stop();
  macro.stop(true);
  await rm(workspace, { recursive: true, force: true });
});

test(
  "a script reaches Macro through the relay, and can't read the agent's key",
  async () => {
    const run = inSubprocess({
      timeoutMs: coldCheckMs,
      run: async (source, { timeoutMs }) => {
        const child = Bun.spawn(
          [
            process.execPath,
            join(workspace, 'cli.ts'),
            'exec',
            '--result-line',
            '-',
          ],
          {
            cwd: workspace,
            stdin: new Blob([source]),
            stdout: 'pipe',
            stderr: 'pipe',
            env: childEnvironment(
              { ...process.env, MACRO_API_KEY: realKey },
              {
                AGENT_WORKSPACE: workspace,
                MUPPET_RELAY_URL: relay.url,
                MUPPET_RELAY_TOKEN: relay.token,
                MUPPET_CREDENTIAL_NAMES: 'MACRO_API_KEY,MACRO_GATEWAY',
              }
            ),
          }
        );
        const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        clearTimeout(timer);
        return { kind: 'exited', code, stdout, stderr };
      },
    });
    const executed = await run(
      [
        `import type { Script } from ${JSON.stringify(join(workspace, 'behavior', 'index.ts'))};`,
        '',
        'export async function main({ context, log }: Script) {',
        "  const read = await context.credentials.get('MACRO_API_KEY').then(() => 'read', (error: unknown) => String(error));",
        '  log(read);',
        '  return {',
        '    principal: await (await context.macro()).myPrincipalId(),',
        '    names: await context.credentials.names(),',
        "    inEnvironment: JSON.stringify(Reflect.get(Reflect.get(globalThis, 'process'), 'env')).includes('mak_real'),",
        '  };',
        '}',
      ].join('\n')
    );
    expect(executed).toMatchObject({
      kind: 'succeeded',
      output: {
        principal: agentId,
        names: ['MACRO_API_KEY', 'MACRO_GATEWAY'],
        inEnvironment: false,
      },
    });
    expect(executed.logs).toContain('credentials stay with the agent');
    expect(executed.logs).not.toContain(realKey);
    expect(seen).toEqual([{ path: '/auth/user/me', key: realKey }]);
  },
  coldCheckMs + 10_000
);

/** Runs `cli.ts` with only this environment, and returns how it ended. */
const cli = async (env: Record<string, string>, ...args: string[]) => {
  const child = Bun.spawn(
    [process.execPath, join(workspace, 'cli.ts'), ...args],
    {
      cwd: workspace,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { PATH: process.env.PATH ?? '', ...env },
    }
  );
  const [stderr, code] = await Promise.all([
    new Response(child.stderr).text(),
    child.exited,
  ]);
  return { code, stderr };
};

test('a missing variable, or a credential file it can’t read, exits 78 and says which', async () => {
  expect(await cli({}, 'list')).toMatchObject({
    code: 78,
    stderr: expect.stringContaining('AGENT_WORKSPACE is not set'),
  });
  expect(await cli({ AGENT_WORKSPACE: workspace }, 'list')).toMatchObject({
    code: 78,
    stderr: expect.stringContaining('MUPPET_CREDENTIALS_FILE is not set'),
  });
  const credentials = join(workspace, 'agent.env');
  await Bun.write(
    credentials,
    'MACRO_GATEWAY="https://gateway.example.com"\nMACRO_API_KEY mak_leaked\n'
  );
  const malformed = await cli(
    { AGENT_WORKSPACE: workspace, MUPPET_CREDENTIALS_FILE: credentials },
    'list'
  );
  expect(malformed.code).toBe(78);
  expect(malformed.stderr).toContain('line 2');
  expect(malformed.stderr).not.toContain('mak_leaked');
  await Bun.write(
    credentials,
    'MACRO_API_KEY="mak_real"\nMACRO_GATEWAY="https://gateway.example.com"\n'
  );
  expect(
    await cli(
      { AGENT_WORKSPACE: workspace, MUPPET_CREDENTIALS_FILE: credentials },
      'run'
    )
  ).toMatchObject({
    code: 78,
    stderr: expect.stringContaining('MUPPET_LAST_GOOD_FILE is not set'),
  });
  expect(
    await cli(
      {
        AGENT_WORKSPACE: workspace,
        MUPPET_CREDENTIALS_FILE: credentials,
        MUPPET_MCP_SERVERS_JSON: '{nope',
      },
      'list'
    )
  ).toMatchObject({
    code: 78,
    stderr: expect.stringContaining('MUPPET_MCP_SERVERS_JSON'),
  });
}, 60_000);
