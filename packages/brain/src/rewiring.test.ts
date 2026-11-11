import assert from 'node:assert/strict';
import * as nodeFs from 'node:fs/promises';
import * as nodeOs from 'node:os';
import * as nodePath from 'node:path';
import { test } from 'node:test';
import { closeHttp, httpPort, serveHttp } from './http.ts';
import { runCommand } from './subprocess.ts';
import { supervise, workspaceSupervisor } from './supervisor.ts';
import { useTestLibrary } from './test-library.ts';
import { gitCli, Workspace } from './workspace.ts';

useTestLibrary();

test('a broken main composition is restored in real git and remembered for the next turn', async () => {
  const root = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), 'brain-revert-')
  );
  const git = gitCli(root);
  const started: string[] = [];
  const previousHealthMinutes = process.env['BRAIN_HEALTH_MINUTES'];
  process.env['BRAIN_HEALTH_MINUTES'] = '5';
  try {
    const copy = await runCommand('cp', {
      args: [
        '-r',
        `${new URL('../template/', import.meta.url).pathname}.`,
        root,
      ],
      clearEnv: true,
      env: { PATH: process.env['PATH'] ?? '' },
    });
    assert.deepEqual(copy.code, 0);
    await new Workspace(root).enforceGitignore();
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.name', 'Agent']);
    await git(['config', 'user.email', 'agent@example.com']);
    await git(['add', '-A']);
    await git(['-c', 'commit.gpgsign=false', 'commit', '-qm', 'seed']);
    const good = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    const original = await nodeFs.readFile(`${root}/brain.ts`, 'utf8');
    await nodeFs.mkdir(`${root}/cache/wiring`, { recursive: true });
    await nodeFs.writeFile(`${root}/cache/wiring/last-good`, good);
    await nodeFs.writeFile(
      `${root}/brain.ts`,
      'export default () => { throw new Error("broken"); };\n'
    );
    await git(['add', 'brain.ts']);
    await git(['-c', 'commit.gpgsign=false', 'commit', '-qm', 'break wiring']);
    const broken = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    const supervisor = await workspaceSupervisor(root, async (snapshot) => {
      started.push(snapshot);
      return {
        activate: async () => {},
        healthy: async () => true,
        exited: () => false,
        stop: async () => {},
      };
    });
    await supervisor.tick();
    assert.deepEqual(
      await nodeFs.readFile(`${root}/brain.ts`, 'utf8'),
      original
    );
    assert.deepEqual(started, [`${root}/cache/wiring/${good}`]);
    assert.ok(
      (
        await nodeFs.readFile(`${root}/memory/notes/brain-rewiring.md`, 'utf8')
      ).includes(broken)
    );
    assert.ok(
      (await nodeFs.readFile(`${root}/cache/rewiring-notice`, 'utf8')).includes(
        'check failed'
      )
    );
    assert.deepEqual(
      (await git(['status', '--porcelain', '--', 'brain.ts'])).stdout,
      ''
    );
    assert.deepEqual(
      (await git(['log', '-1', '--format=%s'])).stdout.trim(),
      'fix(brain): restore healthy wiring'
    );
    await nodeFs.writeFile(`${root}/brain.lock`, '99.0.0\n');
    await git(['add', 'brain.lock']);
    await git([
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'propose unavailable library',
    ]);
    await supervisor.tick();
    assert.deepEqual(
      await nodeFs.readFile(`${root}/brain.lock`, 'utf8'),
      '0.2.0\n'
    );
    await supervisor.stop();
  } finally {
    if (previousHealthMinutes === undefined)
      delete process.env['BRAIN_HEALTH_MINUTES'];
    else process.env['BRAIN_HEALTH_MINUTES'] = previousHealthMinutes;
    await nodeFs.rm(root, { recursive: true });
  }
});
test('real Node reload drains an in-flight turn while its control server stays available', async () => {
  const root = await nodeFs.mkdtemp(
    nodePath.join(nodeOs.tmpdir(), 'brain-drain-')
  );
  const git = gitCli(root);
  let beginTurn: () => void = () => {};
  const begun = new Promise<void>((resolve) => {
    beginTurn = resolve;
  });
  let drain: () => void = () => {};
  const draining = new Promise<void>((resolve) => {
    drain = resolve;
  });
  let finishTurn: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    finishTurn = resolve;
  });
  const restarted = Promise.withResolvers<void>();
  let generations = 0;
  let intakeCount = 0;
  const lateTurn = Promise.withResolvers<void>();
  let turnsStarted = 0;
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const server = await serveHttp(
    { hostname: '127.0.0.1', port: 0 },
    async (request) => {
      const path = new URL(request.url).pathname;
      if (path === '/auth/user/me') {
        generations++;
        if (generations === 2) restarted.resolve();
        return Response.json({ user_id: 'brain-test' });
      }
      if (path === '/hold') {
        turnsStarted++;
        if (turnsStarted === 2) lateTurn.resolve();
        beginTurn();
        await finished;
        return new Response('finished');
      }
      if (path === '/draining') {
        drain();
        return new Response('draining');
      }
      if (path === '/dss/channels/check')
        return Response.json({
          channel_id: 'check',
          channel_name: 'check',
          channel_type: 'direct_message',
        });
      if (path.endsWith('/typing')) return new Response(null, { status: 204 });
      if (path === '/dss/webhook/events/stream')
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              streams.add(controller);
              intakeCount++;
              if (streams.size === 1)
                controller.enqueue(
                  new TextEncoder().encode(
                    `data: ${JSON.stringify({ event_id: 'event', event_type: 'message.posted', metadata: { message_id: 'message', content: 'hold this turn', created_at: new Date().toISOString(), parent: { type: 'channel', id: 'check' }, root_id: 'message', sender: 'sender' } })}\n\n`
                  )
                );
            },
            cancel() {},
          })
        );
      return new Response('unexpected', { status: 500 });
    }
  );
  const portReservation = await serveHttp(
    { port: 0 },
    () => new Response('reserved')
  );
  const healthPort = httpPort(portReservation);
  await closeHttp(portReservation);
  const env = {
    BRAIN_WORKSPACE: root,
    BRAIN_HEALTH_MINUTES: '5',
    BRAIN_EXECUTABLE: '/opt/macro/brain',
    BRAIN_HEALTH_PORT: String(healthPort),
    MACRO_GATEWAY: `http://127.0.0.1:${httpPort(server)}`,
    OVERRIDE_DOCUMENT_STORAGE_SERVICE_URL: `http://127.0.0.1:${httpPort(server)}/dss`,
    OVERRIDE_AUTH_SERVICE_URL: `http://127.0.0.1:${httpPort(server)}/auth`,
    OVERRIDE_DOCUMENT_COGNITION_SERVICE_URL: `http://127.0.0.1:${httpPort(server)}/cognition`,
    OVERRIDE_AGENT_HARNESS_SERVICE_URL: `http://127.0.0.1:${httpPort(server)}/agent-harness`,
    OVERRIDE_SCHEDULED_ACTION_SERVICE_URL: `http://127.0.0.1:${httpPort(server)}/scheduled-action`,
    OVERRIDE_MCP_SERVICE_URL: `http://127.0.0.1:${httpPort(server)}/tools`,
    OVERRIDE_CONNECTION_GATEWAY_WEBSOCKET_URL: `ws://127.0.0.1:${httpPort(server)}/connection-gateway`,
    MACRO_API_KEY: 'fake',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${httpPort(server)}/anthropic`,
    ANTHROPIC_AUTH_TOKEN: 'fake',
  };
  const previous = new Map(
    Object.keys(env).map((name) => [name, process.env[name]])
  );
  let supervisor: Awaited<ReturnType<typeof workspaceSupervisor>> | undefined;
  try {
    for (const [name, value] of Object.entries(env)) process.env[name] = value;
    const copy = await runCommand('cp', {
      args: [
        '-r',
        `${new URL('../template/', import.meta.url).pathname}.`,
        root,
      ],
      clearEnv: true,
      env: { PATH: process.env['PATH'] ?? '' },
    });
    assert.deepEqual(copy.code, 0);
    await nodeFs.writeFile(
      `${root}/brain.ts`,
      `import { Brain, type Composition } from '@macro-inc/brain';
const compose: Composition = (deps) => {
  if (deps.config.healthPort === 0) return new Brain(deps);
  const brain = new Brain({ ...deps, runner: { start() {
    return { events: (async function* () {})(), inject() {}, abort() { throw new Error('turn was aborted'); },
      done: fetch(deps.config.gateway + '/hold').then(() => ({ status: 'success' as const, result: 'finished', costUsd: 0, sessionId: null })) };
  } } });
  return { prepare: (signal) => brain.prepare(signal), health: () => brain.health(), checkFixture: (fixture) => brain.checkFixture(fixture), post: (turn, channel, text) => brain.post(turn, channel, text), async run(signal) {
    signal.addEventListener('abort', () => { void fetch(deps.config.gateway + '/draining'); }, { once: true });
    await brain.run(signal);
  } };
};
export default compose;
`
    );
    await new Workspace(root).enforceGitignore();
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.name', 'Agent']);
    await git(['config', 'user.email', 'agent@example.com']);
    await git(['add', '-A']);
    await git(['-c', 'commit.gpgsign=false', 'commit', '-qm', 'seed']);
    const good = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    await nodeFs.mkdir(`${root}/cache/wiring`, { recursive: true });
    await nodeFs.writeFile(`${root}/cache/wiring/last-good`, good);
    supervisor = await workspaceSupervisor(root);
    await supervisor.tick();
    await begun;
    await nodeFs.writeFile(
      `${root}/brain.ts`,
      `${await nodeFs.readFile(`${root}/brain.ts`, 'utf8')}\n// A new composition revision.\n`
    );
    await git(['add', 'brain.ts']);
    await git(['-c', 'commit.gpgsign=false', 'commit', '-qm', 'rewire']);
    const reload = supervisor.tick();
    await draining;
    assert.deepEqual(generations, 1);
    assert.equal(intakeCount, 2, 'new intake connects before old turns drain');
    const replacement = [...streams].at(-1);
    assert.ok(replacement);
    replacement.enqueue(
      new TextEncoder().encode(
        `data: ${JSON.stringify({
          event_id: 'during-drain',
          event_type: 'message.posted',
          metadata: {
            message_id: 'late-message',
            content: 'arrived during reload',
            created_at: new Date().toISOString(),
            parent: { type: 'channel', id: 'check' },
            root_id: 'late-message',
            sender: 'sender',
          },
        })}\n\n`
      )
    );
    const health = await fetch(`http://127.0.0.1:${healthPort}/health`);
    assert.deepEqual(health.status, 503);
    const drainingHealth = await health.json();
    assert.deepEqual(drainingHealth.connected, false);
    assert.deepEqual(drainingHealth.turns.length, 1);
    finishTurn();
    await reload;
    await restarted.promise;
    await lateTurn.promise;
    assert.ok(
      (await nodeFs.readFile(`${root}/brain.ts`, 'utf8')).includes(
        'A new composition revision'
      )
    );
    await supervisor.stop();
    supervisor = undefined;
    const handled = await nodeFs.readFile(`${root}/log/handled.jsonl`, 'utf8');
    assert.ok(handled.includes('late-message'));
    assert.equal(
      handled
        .split('\n')
        .filter((line) => line.includes('"message_id":"message"')).length,
      1
    );
    assert.ok(handled.includes('"status":"success"'));
  } finally {
    finishTurn();
    await supervisor?.stop();
    for (const stream of streams) {
      try {
        stream.close();
      } catch {
        /* disconnected */
      }
    }
    await closeHttp(server);
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await nodeFs.rm(root, { recursive: true });
  }
});

test('supervisor rejects absent workspace and health interval settings', async () => {
  const workspace = process.env['BRAIN_WORKSPACE'];
  const minutes = process.env['BRAIN_HEALTH_MINUTES'];
  try {
    delete process.env['BRAIN_WORKSPACE'];
    await assert.rejects(supervise(), /BRAIN_WORKSPACE/);
    for (const value of [undefined, '', '0', 'NaN']) {
      if (value === undefined) delete process.env['BRAIN_HEALTH_MINUTES'];
      else process.env['BRAIN_HEALTH_MINUTES'] = value;
      await assert.rejects(
        workspaceSupervisor('/unused-brain-config-check'),
        /BRAIN_HEALTH_MINUTES/
      );
    }
  } finally {
    if (workspace === undefined) delete process.env['BRAIN_WORKSPACE'];
    else process.env['BRAIN_WORKSPACE'] = workspace;
    if (minutes === undefined) delete process.env['BRAIN_HEALTH_MINUTES'];
    else process.env['BRAIN_HEALTH_MINUTES'] = minutes;
  }
});
