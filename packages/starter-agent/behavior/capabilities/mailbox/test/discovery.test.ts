/**
 * The mailbox as the agent meets it: in the catalog every wake lists, in the
 * docs it reads, and from a script run the way the agent runs one, in a
 * process of its own reaching a fake Macro through the relay. "Your email"
 * reaches only the agent's own mailbox, and a send goes out once under the
 * key its purpose makes.
 */
import { afterAll, beforeAll, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inSubprocess } from '@macro-inc/muppet/core/code';
import { childEnvironment } from '../../../context/children.ts';
import { type Relay, startRelay } from '../../../context/relay.ts';

const realKey = 'mak_real_key_never_in_a_script';
const packageRoot = join(import.meta.dir, '..', '..', '..', '..');
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
const settingsSource = (root: string): string =>
  existsSync(join(root, settingsExample))
    ? join(root, settingsExample)
    : join(root, settingsFile);
// The script's process type-checks the agent's code from cold.
const coldCheckMs = 120_000;

const seen: { method: string; path: string }[] = [];
const sendBodies: unknown[] = [];
let macro: ReturnType<typeof Bun.serve>;
let relay: Relay;
let workspace: string;
let credentials: string;

beforeAll(async () => {
  macro = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      const path = new URL(request.url).pathname;
      seen.push({ method: request.method, path });
      if (
        request.method === 'POST' &&
        path.endsWith('/agent-mailbox/messages')
      ) {
        sendBodies.push(await request.json());
        return Response.json(
          { id: 'sent-1', threadId: 't-new' },
          { status: 201 }
        );
      }
      if (path.endsWith('/agent-mailbox/messages'))
        return Response.json({
          messages: [
            {
              id: 'in-1',
              from: 'person@example.org',
              to: ['agent@example.net'],
              cc: [],
              subject: 'Lunch?',
              direction: 'inbound',
              threadId: 't-1',
            },
          ],
          nextCursor: null,
        });
      if (path.endsWith('/agent-mailbox'))
        return Response.json({
          id: 'mb-1',
          address: 'agent@example.net',
          provider: 'dead_simple',
          state: 'active',
          vendorMode: 'fake',
          notice: 'fake vendor, not live',
        });
      return new Response('not here', { status: 404 });
    },
  });
  relay = startRelay({
    targets: { email: `${macro.url.origin}/email` },
    speech: `${macro.url.origin}/agent-harness-egress/brain/inference`,
    apiKey: realKey,
  });
  workspace = await mkdtemp(join(tmpdir(), 'starter-agent-mailbox-'));
  for (const name of linked)
    await symlink(join(packageRoot, name), join(workspace, name));
  await Bun.write(
    join(workspace, settingsFile),
    await Bun.file(settingsSource(packageRoot)).text()
  );
  credentials = join(workspace, 'agent.env');
  await Bun.write(
    credentials,
    'MACRO_API_KEY="mak_fake"\nMACRO_GATEWAY="https://gateway.example.com"\n'
  );
});

afterAll(async () => {
  relay.stop();
  macro.stop(true);
  await rm(workspace, { recursive: true, force: true });
});

/** `cli.ts` with only this environment: its output, and how it ended. */
const cli = async (...args: string[]) => {
  const child = Bun.spawn(
    [process.execPath, join(workspace, 'cli.ts'), ...args],
    {
      cwd: workspace,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        PATH: process.env.PATH ?? '',
        AGENT_WORKSPACE: workspace,
        MUPPET_CREDENTIALS_FILE: credentials,
      },
    }
  );
  const [stdout, code] = await Promise.all([
    new Response(child.stdout).text(),
    child.exited,
  ]);
  return { code, stdout };
};

test(
  'the catalog every wake sees lists the mailbox as your email, and its docs route away from connected inboxes',
  async () => {
    const listed = await cli('list');
    expect(listed.code).toBe(0);
    const line = listed.stdout
      .split('\n')
      .find((entry) => entry.startsWith('- mailbox '));
    expect(line).toMatch(/your own email/i);
    expect(line).toContain('sendMyEmail');

    const described = await cli('describe', 'mailbox');
    expect(described.code).toBe(0);
    expect(described.stdout).toContain('"Your email"');
    expect(described.stdout).toContain('Never use macro.email');
    expect(described.stdout).toContain('purpose');
  },
  coldCheckMs
);

test(
  "a script reaches only the agent's own mailbox, and sends from it once per purpose",
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
    const capability = join(
      workspace,
      'behavior',
      'capabilities',
      'mailbox',
      'index.ts'
    );
    const executed = await run(
      [
        `import type { Script } from ${JSON.stringify(join(workspace, 'behavior', 'index.ts'))};`,
        `import { listMyEmail, myEmailAddress, sendMyEmail } from ${JSON.stringify(capability)};`,
        '',
        'export async function main({ context }: Script) {',
        "  const email = { to: ['person@example.org'], subject: 'Friday', text: 'Friday works.', purpose: 'task t-1: confirm Friday' };",
        '  return {',
        '    mine: await myEmailAddress(context),',
        '    page: await listMyEmail(context, { limit: 5 }),',
        '    sent: await sendMyEmail(context, email),',
        '    again: await sendMyEmail(context, email),',
        '  };',
        '}',
      ].join('\n')
    );
    expect(executed).toMatchObject({
      kind: 'succeeded',
      output: {
        mine: {
          address: 'agent@example.net',
          state: 'active',
          notice: 'fake vendor, not live',
        },
        page: { messages: [{ id: 'in-1', untrusted: { subject: 'Lunch?' } }] },
        sent: { id: 'sent-1', threadId: 't-new' },
        again: { id: 'sent-1', threadId: 't-new' },
      },
    });
    // Only the agent's own mailbox was reached, and both sends carried one
    // key, which the server sends once.
    expect(seen).toEqual([
      { method: 'GET', path: '/email/email/agent-mailbox' },
      { method: 'GET', path: '/email/email/agent-mailbox/messages' },
      { method: 'POST', path: '/email/email/agent-mailbox/messages' },
      { method: 'POST', path: '/email/email/agent-mailbox/messages' },
    ]);
    const [first, second] = sendBodies;
    expect(first).toMatchObject({
      to: ['person@example.org'],
      subject: 'Friday',
      textBody: 'Friday works.',
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/),
    });
    expect(second).toEqual(first);
    expect(first).not.toHaveProperty('confirmation');
  },
  coldCheckMs + 10_000
);
