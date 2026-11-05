import { assertEquals, assertStringIncludes } from '@std/assert';
import { workspaceSupervisor } from './supervisor.ts';
import { gitCli, Workspace } from './workspace.ts';

Deno.test('a broken main composition is restored in real git and remembered for the next turn', async () => {
  const root = await Deno.makeTempDir({ prefix: 'brain-revert-' });
  const git = gitCli(root);
  const started: string[] = [];
  try {
    const copy = await new Deno.Command('cp', {
      args: [
        '-r',
        `${new URL('../template/', import.meta.url).pathname}.`,
        root,
      ],
      clearEnv: true,
      env: { PATH: Deno.env.get('PATH') ?? '' },
    }).output();
    assertEquals(copy.code, 0);
    await new Workspace(root).enforceGitignore();
    await git(['init', '-q', '-b', 'main']);
    await git(['config', 'user.name', 'Agent']);
    await git(['config', 'user.email', 'agent@example.com']);
    await git(['add', '-A']);
    await git(['-c', 'commit.gpgsign=false', 'commit', '-qm', 'seed']);
    const good = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    const original = await Deno.readTextFile(`${root}/brain.ts`);
    await Deno.mkdir(`${root}/cache/wiring`, { recursive: true });
    await Deno.writeTextFile(`${root}/cache/wiring/last-good`, good);
    await Deno.writeTextFile(
      `${root}/brain.ts`,
      'export default () => { throw new Error("broken"); };\n'
    );
    await git(['add', 'brain.ts']);
    await git(['-c', 'commit.gpgsign=false', 'commit', '-qm', 'break wiring']);
    const broken = (await git(['rev-parse', 'HEAD'])).stdout.trim();
    const supervisor = await workspaceSupervisor(root, async (snapshot) => {
      started.push(snapshot);
      return {
        healthy: async () => true,
        exited: () => false,
        stop: async () => {},
      };
    });
    await supervisor.tick();
    assertEquals(await Deno.readTextFile(`${root}/brain.ts`), original);
    assertEquals(started, [`${root}/cache/wiring/${good}`]);
    assertStringIncludes(
      await Deno.readTextFile(`${root}/memory/notes/brain-rewiring.md`),
      broken
    );
    assertStringIncludes(
      await Deno.readTextFile(`${root}/cache/rewiring-notice`),
      'check failed'
    );
    assertEquals(
      (await git(['status', '--porcelain', '--', 'brain.ts'])).stdout,
      ''
    );
    assertEquals(
      (await git(['log', '-1', '--format=%s'])).stdout.trim(),
      'fix(brain): restore healthy wiring'
    );
    await Deno.writeTextFile(`${root}/brain.lock`, '99.0.0\n');
    await git(['add', 'brain.lock']);
    await git([
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'propose unavailable library',
    ]);
    await supervisor.tick();
    assertEquals(await Deno.readTextFile(`${root}/brain.lock`), '0.2.0\n');
    await supervisor.stop();
  } finally {
    await Deno.remove(root, { recursive: true });
  }
});

Deno.test('real Deno reload drains an in-flight turn while its control server stays available', async () => {
  const root = await Deno.makeTempDir({ prefix: 'brain-drain-' });
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
  let generations = 0;
  const streams = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const server = Deno.serve(
    { hostname: '127.0.0.1', port: 0, onListen() {} },
    async (request) => {
      const path = new URL(request.url).pathname;
      if (path === '/auth/user/me') {
        generations++;
        return Response.json({ user_id: 'brain-test' });
      }
      if (path === '/hold') {
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
              if (generations === 1)
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
  const portReservation = Deno.listen({ hostname: '127.0.0.1', port: 0 });
  const healthPort = portReservation.addr.port;
  portReservation.close();
  const env = {
    BRAIN_WORKSPACE: root,
    BRAIN_HEALTH_PORT: String(healthPort),
    MACRO_GATEWAY: `http://127.0.0.1:${server.addr.port}`,
    MACRO_API_KEY: 'fake',
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.addr.port}/anthropic`,
    ANTHROPIC_AUTH_TOKEN: 'fake',
  };
  const previous = new Map(
    Object.keys(env).map((name) => [name, Deno.env.get(name)])
  );
  let supervisor: Awaited<ReturnType<typeof workspaceSupervisor>> | undefined;
  try {
    for (const [name, value] of Object.entries(env)) Deno.env.set(name, value);
    const copy = await new Deno.Command('cp', {
      args: [
        '-r',
        `${new URL('../template/', import.meta.url).pathname}.`,
        root,
      ],
      clearEnv: true,
      env: { PATH: Deno.env.get('PATH') ?? '' },
    }).output();
    assertEquals(copy.code, 0);
    await Deno.writeTextFile(
      `${root}/brain.ts`,
      `import { Brain, type Composition } from '@macro-inc/brain';
const compose: Composition = (deps) => {
  if (deps.config.healthPort === 0) return new Brain(deps);
  const brain = new Brain({ ...deps, runner: { start() {
    return { events: (async function* () {})(), inject() {}, abort() { throw new Error('turn was aborted'); },
      done: fetch(deps.config.gateway + '/hold').then(() => ({ status: 'success' as const, result: 'finished', costUsd: 0, sessionId: null })) };
  } } });
  return { async run(signal) {
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
    await Deno.mkdir(`${root}/cache/wiring`, { recursive: true });
    await Deno.writeTextFile(`${root}/cache/wiring/last-good`, good);
    supervisor = await workspaceSupervisor(root);
    await supervisor.tick();
    await begun;
    await Deno.writeTextFile(
      `${root}/brain.ts`,
      `${await Deno.readTextFile(`${root}/brain.ts`)}\n// A new composition revision.\n`
    );
    await git(['add', 'brain.ts']);
    await git(['-c', 'commit.gpgsign=false', 'commit', '-qm', 'rewire']);
    const reload = supervisor.tick();
    await draining;
    assertEquals(generations, 1);
    const health = await fetch(`http://127.0.0.1:${healthPort}/health`);
    assertEquals(health.ok, true);
    assertEquals((await health.json()).turns.length, 1);
    finishTurn();
    await reload;
    await supervisor.stop();
    supervisor = undefined;
    assertStringIncludes(
      await Deno.readTextFile(`${root}/log/handled.jsonl`),
      '"status":"success"'
    );
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
    await server.shutdown();
    for (const [name, value] of previous) {
      if (value === undefined) Deno.env.delete(name);
      else Deno.env.set(name, value);
    }
    await Deno.remove(root, { recursive: true });
  }
});
