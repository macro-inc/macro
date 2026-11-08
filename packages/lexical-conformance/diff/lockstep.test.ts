import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { $getRoot, $setSelection } from 'lexical';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Command, Snapshot } from './commands';
import { Comparison } from './compare';
import { generateCommand, type Step, stepArbitrary } from './generator';
import { RustCore } from './loader';
import { Upstream } from './upstream';

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation((...args) => {
    throw new Error(`upstream console.error: ${args.join(' ')}`);
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});
async function replay(commands: Command[]) {
  const u = new Upstream();
  const r = new RustCore('upstream');
  const comparison = new Comparison();
  try {
    comparison.compare(u.snapshot(), JSON.parse(r.snapshot()));
    for (const command of commands)
      comparison.compare(
        await u.apply(command),
        JSON.parse(r.apply(JSON.stringify(command), 0))
      );
  } finally {
    u.dispose();
    r.free();
  }
}
test('literal text, paragraph, format and DOM-input transactions', async () => {
  await replay([
    { kind: 'InsertText', text: 'hello' },
    {
      kind: 'Select',
      anchor: { path: [0, 0], offset: 1, type: 'text' },
      focus: { path: [0, 0], offset: 4, type: 'text' },
    },
    { kind: 'FormatText', format: 'bold' },
    { kind: 'InsertParagraph' },
    { kind: 'InsertText', text: 'world' },
    {
      kind: 'SelectionFromView',
      anchor: { path: [0, 0], offset: 0, type: 'text' },
      focus: { path: [0, 0], offset: 1, type: 'text' },
    },
    {
      kind: 'TextFromView',
      path: [0, 0],
      text: 'Hello',
      anchor: 2,
      focus: 2,
      compositionEnd: true,
    },
  ]);
});
const seeds = process.env.DIFF_SEED
  ? [Number(process.env.DIFF_SEED)]
  : [73129, 19088743, 1592639710];
const length = Number(process.env.STEPS ?? 10000);
for (const seed of seeds)
  test(`upstream text/paragraph lockstep seed ${seed}, ${length} steps`, async () => {
    let lastCommands: Command[] = [];
    let lastExpected: Snapshot[] = [];
    let lastActual: Snapshot | null = null;
    const execute = async (steps: Step[]) => {
      const u = new Upstream();
      const r = new RustCore('upstream');
      const comparison = new Comparison();
      const commands: Command[] = [];
      const coverage = new Map<Command['kind'], number>();
      const expected: Snapshot[] = [];
      let actualSnapshot: Snapshot | null = null;
      try {
        comparison.compare(u.snapshot(), JSON.parse(r.snapshot()));
        await fc.asyncModelRun(
          () => ({ model: {}, real: {} }),
          steps.map((step) => ({
            check: () => true,
            toString: () => JSON.stringify(step),
            run: async () => {
              const command = generateCommand(step, u.snapshot());
              commands.push(command);
              coverage.set(command.kind, (coverage.get(command.kind) ?? 0) + 1);
              const wanted = await u.apply(command);
              expected.push(wanted);
              const actual = JSON.parse(
                r.apply(JSON.stringify(command), 0)
              ) as Snapshot;
              actualSnapshot = actual;
              comparison.compare(wanted, actual);
            },
          }))
        );
        expect(commands.length).toBe(steps.length);
        if (steps.length >= 1000) {
          for (const kind of [
            'Select',
            'SelectionFromView',
            'TextFromView',
            'InsertText',
            'InsertRawText',
            'InsertParagraph',
            'InsertLineBreak',
            'InsertTab',
            'RemoveText',
            'FormatText',
          ] as const) {
            expect(
              coverage.get(kind) ?? 0,
              `executed ${kind} coverage`
            ).toBeGreaterThanOrEqual(steps.length * 0.005);
          }
        }
      } catch (error) {
        lastCommands = commands;
        lastExpected = expected;
        lastActual = actualSnapshot;
        throw error;
      } finally {
        u.dispose();
        r.free();
      }
    };
    const property = fc.asyncProperty(
      fc.array(stepArbitrary, { maxLength: length }),
      execute
    );
    const inputs = fc.sample(
      fc.array(stepArbitrary, { minLength: length, maxLength: length }),
      { seed, numRuns: 1 }
    )[0];
    const result = await fc.check(property, {
      seed,
      numRuns: 1,
      examples: [[inputs]],
      path: process.env.DIFF_PATH,
      endOnFailure: true,
    });
    if (result.failed) {
      const category = (error: unknown) =>
        [
          'JSON structure',
          'selection:',
          'root text:',
          'outcome:',
          'commit presence:',
          'commit:',
          'surrogate pair',
        ].find((label) => String(error).includes(label)) ??
        String(error).split('\n')[0];
      const originalCategory = category(result.errorInstance);
      // Examples have no generation context. Delta-debug their command list before recording.
      let minimal = result.counterexample?.[0] ?? inputs;
      let best = {
        commands: lastCommands,
        expected: lastExpected,
        actual: lastActual,
      };
      for (
        let chunk = Math.ceil(minimal.length / 2);
        chunk >= 1;
        chunk = Math.floor(chunk / 2)
      ) {
        for (let start = 0; start < minimal.length; ) {
          const reduced = [
            ...minimal.slice(0, start),
            ...minimal.slice(start + chunk),
          ];
          try {
            await execute(reduced);
            start += chunk;
          } catch (error) {
            if (category(error) === originalCategory) {
              minimal = reduced;
              best = {
                commands: lastCommands,
                expected: lastExpected,
                actual: lastActual,
              };
            } else start += chunk;
          }
        }
      }
      lastCommands = best.commands;
      lastExpected = best.expected;
      lastActual = best.actual;

      const directory = path.resolve(import.meta.dirname, '../fixtures/fuzz');
      mkdirSync(directory, { recursive: true });
      const fixture = {
        schema: 1,
        source: {
          repo: 'fuzz',
          seed,
          path: result.counterexamplePath,
          profile: 'upstream',
        },
        commands: lastCommands,
        expected: lastExpected,
        actual: lastActual,
      };
      const data = JSON.stringify(fixture, null, 2) + '\n';
      const id = createHash('sha256').update(data).digest('hex').slice(0, 8);
      writeFileSync(path.join(directory, `${id}.json`), data);
      throw new Error(
        `Lockstep failed, saved fixtures/fuzz/${id}.json; seed=${seed} path=${result.counterexamplePath}`,
        { cause: result.errorInstance }
      );
    }
    expect(result.numRuns).toBeGreaterThanOrEqual(1);
  }, 300000);
const directory = path.resolve(import.meta.dirname, '../fixtures/fuzz');
if ((await import('node:fs')).existsSync(directory))
  for (const name of readdirSync(directory).filter((n) =>
    n.endsWith('.json')
  )) {
    test(`replay shrunk fuzz regression ${name}`, async () => {
      const fixture: { commands: Command[]; policy?: { outcome: string } } =
        JSON.parse(readFileSync(path.join(directory, name), 'utf8'));
      if (fixture.policy?.outcome === 'reject-surrogate-splitting-edit') {
        const u = new Upstream();
        const r = new RustCore('upstream');
        const comparison = new Comparison();
        try {
          for (const command of fixture.commands.slice(0, -1))
            comparison.compare(
              await u.apply(command),
              JSON.parse(r.apply(JSON.stringify(command), 0))
            );
          const before = JSON.parse(r.snapshot());
          const actual = JSON.parse(
            r.apply(JSON.stringify(fixture.commands.at(-1)), 0)
          );
          expect(actual.error).toContain('splits a surrogate pair');
          expect(actual.commit).toBeNull();
          expect(actual.state).toEqual(before.state);
          expect(actual.selection).toEqual(before.selection);
          expect(actual.keys).toEqual(before.keys);
        } finally {
          u.dispose();
          r.free();
        }
      } else await replay(fixture.commands);
    });
  }

test('literal caret range ending before the next paragraph text', async () => {
  await replay([
    { kind: 'InsertText', text: 'first' },
    { kind: 'InsertParagraph' },
    { kind: 'InsertText', text: 'second' },
    {
      kind: 'Select',
      anchor: { path: [0, 0], offset: 2, type: 'text' },
      focus: { path: [1], offset: 0, type: 'element' },
    },
    { kind: 'RemoveText' },
  ]);
});

test('empty root hydration preserves root metadata', async () => {
  const u = new Upstream();
  try {
    u.editor.update(
      () => {
        $getRoot().clear().setFormat('right').setIndent(2).setDirection('rtl');
        $setSelection(null);
      },
      { discrete: true }
    );
    const before = u.snapshot().state;
    const actual = await u.apply({
      kind: 'SelectionFromView',
      anchor: { path: [], offset: 0, type: 'element' },
      focus: { path: [], offset: 0, type: 'element' },
    });
    expect(actual.state).toEqual(before);
    expect(u.snapshot().state).toEqual(before);
  } finally {
    u.dispose();
  }
});

test('cross-block tab replacement retains direction cached by child removal', async () => {
  await replay([
    { kind: 'InsertRawText', text: '\nabc' },
    { kind: 'InsertParagraph' },
    { kind: 'InsertText', text: 'defgh' },
    {
      kind: 'Select',
      anchor: { path: [0], offset: 1, type: 'element' },
      focus: { path: [1, 0], offset: 4, type: 'text' },
    },
    { kind: 'InsertTab' },
  ]);
});

test('identical selected-text replacement still publishes write metadata', async () => {
  await replay([
    { kind: 'InsertText', text: 'eא́\u2028א' },
    {
      kind: 'Select',
      anchor: { path: [], offset: 1, type: 'element' },
      focus: { path: [0, 0], offset: 4, type: 'text' },
    },
    { kind: 'InsertText', text: 'א' },
  ]);
});

test('D-11 stale text offset rejects and rolls back the complete transaction', async () => {
  await replay([
    { kind: 'InsertParagraph' },
    { kind: 'InsertParagraph' },
    { kind: 'InsertText', text: 'ahttps://example.com' },
    { kind: 'FormatText', format: 'bold' },
    { kind: 'InsertText', text: 'a' },
    {
      kind: 'Select',
      anchor: { path: [0], offset: 0, type: 'element' },
      focus: { path: [2, 0], offset: 18, type: 'text' },
    },
    { kind: 'RemoveText' },
  ]);
});
