import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LoroDoc } from 'loro-crdt';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { MARKDOWN_LORO_SCHEMA } from '../../../lexical-core/markdown-loro-schema';
import { Mirror } from '../../../loro-mirror/src/index';
import { type Edit, Native, type Node, type Observation } from './native';
import { Upstream } from './upstream';

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../..'
);
beforeAll(() => {
  expect(
    JSON.parse(
      readFileSync(
        path.join(root, 'node_modules/loro-crdt/package.json'),
        'utf8'
      )
    ).version
  ).toBe('1.17.1');
  const result = spawnSync(
    'cargo',
    [
      'build',
      '-p',
      'document_session',
      '--example',
      'collab',
      '--features',
      'conformance',
      '-j2',
    ],
    {
      cwd: root,
      env: { ...process.env, TMPDIR: '/home/wolf/tmp' },
      encoding: 'utf8',
    }
  );
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function seed() {
  const doc = new LoroDoc();
  doc.setPeerId('7');
  doc.setRecordTimestamp(false);
  const mirror = new Mirror({ doc, schema: MARKDOWN_LORO_SCHEMA });
  mirror.setState({
    root: {
      type: 'root',
      version: 1,
      $: { id: 'root-node' },
      direction: null,
      format: '',
      indent: 0,
      children: [
        {
          type: 'paragraph',
          version: 1,
          direction: null,
          format: '',
          indent: 0,
          textFormat: 0,
          textStyle: '',
          $: { id: 'paragraph-a' },
          children: [
            {
              type: 'text',
              version: 1,
              text: 'start😀',
              format: 0,
              detail: 0,
              mode: 'normal',
              style: '',
              $: { id: 'text-a' },
            },
          ],
        },
        {
          type: 'paragraph',
          version: 1,
          direction: null,
          format: '',
          indent: 0,
          textFormat: 0,
          textStyle: '',
          $: { id: 'paragraph-b' },
          children: [
            {
              type: 'text',
              version: 1,
              text: 'second',
              format: 0,
              detail: 0,
              mode: 'normal',
              style: '',
              $: { id: 'text-b' },
            },
          ],
        },
      ],
    },
  } as never);
  for (let i = 0; i < 8; i++) await Promise.resolve();
  const snapshot = doc.export({ mode: 'snapshot' });
  mirror.dispose();
  return snapshot;
}
async function system() {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(0);
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    throw new Error(`console.error: ${args.map(String).join(' ')}`);
  });
  const initial = await seed();
  const native = new Native();
  const peers = [
    await Upstream.create(201, initial),
    await Upstream.create(202, initial),
  ];
  const states: Observation[] = [
    await native.request(0, { kind: 'init', snapshot: Array.from(initial) }),
    await native.request(1, { kind: 'init', snapshot: Array.from(initial) }),
    peers[0].observe(),
    peers[1].observe(),
  ];
  const server = new LoroDoc();
  server.setPeerId('99');
  server.setRecordTimestamp(false);
  server.import(initial);
  const pending: Array<{ from: number; to: number; bytes: number[] }> = [];
  function queue(from: number, bytes: number[]) {
    if (bytes.length) pending.push({ from, to: 4, bytes });
  }
  async function deliver(index: number, now: number) {
    const message = pending.splice(index, 1)[0];
    if (!message) throw new Error('missing delivery');
    if (message.to === 4) {
      const status = server.import(Uint8Array.from(message.bytes));
      if (status.pending) throw new Error('server upload lacks dependencies');
      for (let to = 0; to < 4; to++)
        if (to !== message.from)
          pending.push({ from: 4, to, bytes: message.bytes });
      return;
    }
    states[message.to] =
      message.to < 2
        ? await native.request(message.to, {
            kind: 'remote',
            bytes: message.bytes,
            now,
          })
        : await peers[message.to - 2].remote(message.bytes);
    queue(message.to, states[message.to].bytes);
    // Rust writes repairs immediately. Today's TS binding defers remote
    // normalization write-back (S11 §4.6); all four are checked after delivery.
    if (message.to < 2)
      expect(
        (states[message.to].value as { root: unknown }).root,
        `remote editor/doc peer ${message.to}`
      ).toEqual(states[message.to].editor.root);
  }
  async function drain(now: number) {
    let count = 0;
    while (pending.length) {
      if (++count > 100000) throw new Error('repair loop');
      await deliver(0, now);
    }
  }
  async function edit(peer: number, edit: Edit) {
    vi.setSystemTime(edit.now);
    states[peer] =
      peer < 2
        ? await native.request(peer, edit)
        : await peers[peer - 2].edit(edit);
    queue(peer, states[peer].bytes);
    if (peer < 2)
      expect(
        (states[peer].value as { root: unknown }).root,
        `local ${edit.kind} editor/doc peer ${peer}`
      ).toEqual(states[peer].editor.root);
  }
  function compare() {
    for (let peer = 1; peer < 4; peer++) {
      expect(states[peer].value, `Loro peer ${peer}`).toEqual(states[0].value);
      expect(states[peer].editor, `editor peer ${peer}`).toEqual(
        states[0].editor
      );
    }
    for (let peer = 0; peer < 4; peer++)
      expect(
        (states[peer].value as { root: unknown }).root,
        `editor/doc peer ${peer}`
      ).toEqual(states[peer].editor.root);
  }
  return {
    states,
    pending,
    deliver,
    drain,
    edit,
    compare,
    close() {
      for (const peer of peers) peer.close();
      native.close();
    },
  };
}
test('literal four-peer remote text and collaborative own undo use the current bindings', async () => {
  const s = await system();
  try {
    s.compare();
    await s.edit(0, {
      kind: 'insert',
      path: [0, 0],
      from: 7,
      to: 7,
      text: 'native',
      now: 1000,
    });
    await s.drain(1000);
    s.compare();
    await s.edit(2, {
      kind: 'insert',
      path: [1, 0],
      from: 6,
      to: 6,
      text: 'typescript',
      now: 2000,
    });
    await s.drain(2000);
    s.compare();
    await s.edit(0, {
      kind: 'undo',
      path: [],
      from: 0,
      to: 0,
      text: '',
      now: 3000,
    });
    await s.drain(3000);
    s.compare();
    expect(JSON.stringify(s.states[0].editor)).toContain('typescript');
    expect(JSON.stringify(s.states[0].editor)).not.toContain('start😀native');
    await s.edit(2, {
      kind: 'undo',
      path: [],
      from: 0,
      to: 0,
      text: '',
      now: 4000,
    });
    await s.drain(4000);
    s.compare();
    expect(JSON.stringify(s.states[0].editor)).not.toContain(
      'secondtypescript'
    );
    await s.edit(2, {
      kind: 'redo',
      path: [],
      from: 0,
      to: 0,
      text: '',
      now: 5000,
    });
    await s.drain(5000);
    s.compare();
    expect(JSON.stringify(s.states[0].editor)).toContain('typescript');
  } finally {
    s.close();
  }
});

// The browser fuzzer's command weighting, preconditions, held peers and scheduled
// FIFO relay are applied to the same four peers here without a browser transport.
import fc from 'fast-check';

function targets(
  node: Node,
  path: number[] = []
): Array<{ path: number[]; text: string; element: boolean; size: number }> {
  if (node.type === 'text')
    return [{ path, text: node.text ?? '', element: false, size: 0 }];
  const children = node.children ?? [];
  const found = children.flatMap((child, index) =>
    targets(child, [...path, index])
  );
  return found.length
    ? found
    : children.length === 0 && node.children
      ? [{ path, text: '', element: true, size: 0 }]
      : [];
}
function offsets(text: string) {
  const result = [0];
  let offset = 0;
  for (const char of text) {
    offset += char.length;
    result.push(offset);
  }
  return result;
}
for (const seed of [73129, 19088743, 1592639710])
  test(`collab fixed seed ${seed}: 2000 steps, exact Loro and editor equality`, async () => {
    const steps = Number(process.env.COLLAB_STEPS ?? 2000);
    const tape = fc.sample(
      fc.record({
        peer: fc.integer({ min: 0, max: 3 }),
        action: fc.integer({ min: 0, max: 99 }),
        position: fc.nat(),
        range: fc.nat(),
        relay: fc.integer({ min: 0, max: 4 }),
        delay: fc.constantFrom(10, 50, 500, 1000),
        hold: fc.integer({ min: 0, max: 99 }),
        text: fc.constantFrom('a', 'é', '😀', '👩‍💻', 'two', ' ', '\n'),
      }),
      { seed, numRuns: steps }
    );
    const scheduler = fc.sample(fc.scheduler(), { seed, numRuns: 1 })[0];
    const s = await system();
    const held = new Set<number>();
    const active = new Map<string, Promise<void>>();
    let clock = 1000;
    let step = 0;
    const coverage = new Map<string, number>();
    const schedule = () => {
      for (const message of s.pending) {
        const key = `${message.from}:${message.to}`;
        if (active.has(key) || held.has(message.from) || held.has(message.to))
          continue;
        const task = scheduler
          .schedule(Promise.resolve(), key)
          .then(async () => {
            if (!held.has(message.from) && !held.has(message.to)) {
              const index = s.pending.indexOf(message);
              if (index < 0) throw new Error('scheduled message disappeared');
              await s.deliver(index, clock);
            }
            active.delete(key);
          });
        active.set(key, task);
      }
    };
    const next = async () => {
      schedule();
      if (!active.size) return;
      const tasks = [...active.values()];
      await scheduler.waitNext(1);
      await Promise.race(tasks);
    };
    const drain = async () => {
      held.clear();
      let turns = 0;
      while (s.pending.length || active.size) {
        if (++turns > 100000) throw new Error('relay did not settle');
        await next();
      }
    };
    try {
      s.compare();
      for (step = 0; step < tape.length; step++) {
        const row = tape[step];
        clock += row.delay;
        vi.setSystemTime(clock);
        if (row.hold < 3) held.add(row.peer);
        if (row.hold >= 3 && row.hold < 10) held.delete(row.peer);
        const candidates = targets(s.states[row.peer].editor.root);
        const target = candidates[row.position % candidates.length] ?? {
          path: [],
          text: '',
          element: true,
          size: 0,
        };
        const boundaries = offsets(target.text);
        let from = boundaries[row.position % boundaries.length];
        let to = from;
        let kind: Edit['kind'] =
          row.action < 58
            ? 'insert'
            : row.action < 70
              ? 'remove'
              : row.action < 77
                ? 'format'
                : row.action < 84
                  ? 'paragraph'
                  : row.action < 89
                    ? 'linebreak'
                    : row.action < 93
                      ? 'tab'
                      : row.action < 97
                        ? 'undo'
                        : 'redo';
        if (kind === 'remove' || kind === 'format') {
          if (target.element) kind = 'insert';
          else {
            const end = boundaries[row.range % boundaries.length];
            to = Math.max(from, end);
            from = Math.min(from, end);
          }
        }
        if (target.text.length > 200 && kind === 'insert') {
          kind = 'remove';
          from = 0;
          to = boundaries[boundaries.length - 1];
        }
        coverage.set(kind, (coverage.get(kind) ?? 0) + 1);
        await s.edit(row.peer, {
          kind,
          path: target.path,
          from,
          to,
          text: row.text,
          now: clock,
        });
        for (let turn = 0; turn < row.relay; turn++) await next();
        if (step % 25 === 24) {
          await drain();
          s.compare();
        }
      }
      await drain();
      s.compare();
      if (steps >= 2000)
        for (const kind of [
          'insert',
          'remove',
          'format',
          'paragraph',
          'linebreak',
          'tab',
          'undo',
          'redo',
        ])
          expect(coverage.get(kind), kind).toBeGreaterThan(0);
    } catch (error) {
      const directory = path.join(root, 'target/lexical-collab-failures');
      mkdirSync(directory, { recursive: true });
      writeFileSync(
        path.join(directory, `${seed}.json`),
        JSON.stringify(
          {
            seed,
            step,
            clock,
            tape: tape.slice(0, step + 1),
            states: s.states,
            schedule: scheduler.report(),
          },
          null,
          2
        )
      );
      throw error;
    } finally {
      s.close();
    }
  });
