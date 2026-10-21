/**
 * Several people type into one collaborative markdown document at once, each
 * in a separate browser, through the real editor and sync engine. Each person
 * types only into their own region, so a model of their keystrokes predicts
 * exactly what that region should hold; after everything is delivered every
 * copy of the document must agree and match the models.
 *
 * FUZZ_SEED=<n> replays one run; FUZZ_RUNS, FUZZ_PEERS, FUZZ_STEPS,
 * FUZZ_LATENCY_MS size it.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import type { FuzzBlock, FuzzCaret } from './fixture';
import { END_MARKER, openPeers, type Peer, perform } from './harness';
import type { Action, Block } from './model';
import { Relay } from './relay';
import { seededRandom } from './rng';

const env = (name: string, fallback: number) =>
  process.env[name] === undefined ? fallback : Number(process.env[name]);

const RUNS = env('FUZZ_RUNS', 1);
const STEPS = env('FUZZ_STEPS', 60);
const LATENCY_MS = env('FUZZ_LATENCY_MS', 30);
const FIRST_SEED = env('FUZZ_SEED', Math.floor(Math.random() * 2 ** 31));
/** A report (or `{ logs }`) whose action logs to replay instead of generating. */
const SCRIPT: Record<string, Action[]> | undefined = process.env.FUZZ_SCRIPT
  ? JSON.parse(readFileSync(process.env.FUZZ_SCRIPT, 'utf8')).logs
  : undefined;
const PEERS = SCRIPT ? Object.keys(SCRIPT).length : env('FUZZ_PEERS', 3);
/** Undo everything everyone did, check, then redo it all and check again. */
const UNDO = process.env.FUZZ_UNDO;
/** Keep typing after a caret finding (the model is wrong from then on). */
const CONTINUE = process.env.FUZZ_CONTINUE === '1';
const REPORTS = fileURLToPath(new URL('./reports/', import.meta.url));

type Finding = {
  kind: string;
  peer?: string;
  phase?: string;
  detail: unknown;
};

/** The blocks between this peer's marker and the next marker. */
function region(blocks: FuzzBlock[], marker: string): FuzzBlock[] {
  const start = blocks.findIndex((b) => b.text.startsWith(marker));
  if (start === -1) return [];
  const rest = blocks.slice(start + 1);
  const end = rest.findIndex(
    (b) => /^Peer [A-H]:/.test(b.text) || b.text === END_MARKER
  );
  return [blocks[start], ...(end === -1 ? rest : rest.slice(0, end))];
}

const sameBlocks = (actual: FuzzBlock[], expected: Block[]) =>
  actual.length === expected.length &&
  actual.every(
    (b, i) =>
      b.type === expected[i].type && b.text === expected[i].text && !b.indent
  );

async function drive(
  peer: Peer,
  relay: Relay,
  seed: number,
  findings: Finding[],
  script?: Action[]
): Promise<void> {
  const random = seededRandom(seed);
  const steps = script?.length ?? STEPS;
  for (let step = 0; step < steps; step++) {
    if (findings.length > 0 && !CONTINUE) return;
    const action = script ? script[step] : peer.model.generate(random);
    peer.log.push(action);
    await perform(peer, relay, action);
    peer.model.apply(action);
    if (
      action.kind === 'offline' ||
      action.kind === 'online' ||
      action.kind === 'pause'
    )
      continue;
    const caret: FuzzCaret | null = await peer.page.evaluate(() =>
      window.lexFuzz!.selection()
    );
    const expected = peer.model.current;
    if (
      !caret ||
      !caret.collapsed ||
      caret.text !== expected.text ||
      caret.before !== expected.text ||
      caret.blockType !== expected.type
    ) {
      findings.push({
        kind: 'caret',
        peer: peer.name,
        detail: { step, action, caret, expected, region: peer.model.blocks },
      });
      if (!CONTINUE) return;
    }
  }
}

/** Presses `key` `times` times, slower than history's merge window. */
async function repeat(peer: Peer, key: string, times: number): Promise<void> {
  for (let i = 0; i < times; i++)
    await peer.page.keyboard.press(key, { delay: 5 });
}

/** The first place two JSON values differ, ignoring key order. */
function firstDifference(
  a: unknown,
  b: unknown,
  path: string
): { path: string; editor: unknown; loro: unknown } | null {
  if (a === b || (a ?? null) === (b ?? null)) return null;
  if (
    typeof a !== 'object' ||
    typeof b !== 'object' ||
    a === null ||
    b === null ||
    Array.isArray(a) !== Array.isArray(b)
  )
    return { path, editor: a, loro: b };
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    const difference = firstDifference(
      (a as Record<string, unknown>)[key],
      (b as Record<string, unknown>)[key],
      `${path}/${key}`
    );
    if (difference) return difference;
  }
  return null;
}

async function converge(peers: Peer[], relay: Relay): Promise<boolean> {
  for (const peer of peers) relay.release(peer.name);
  const serverJson = () => JSON.stringify(relay.doc.toJSON());
  try {
    await expect
      .poll(
        async () => {
          if (!relay.idle()) return false;
          const server = serverJson();
          const copies = await Promise.all(
            peers.map((p) => p.page.evaluate(() => window.lexFuzz!.loroJson()))
          );
          return copies.every((c) => c === server);
        },
        { timeout: 20_000, intervals: [100] }
      )
      .toBe(true);
    return true;
  } catch {
    return false;
  }
}

async function check(
  peers: Peer[],
  relay: Relay,
  phase: string,
  expected: (peer: Peer) => Block[]
): Promise<Finding[]> {
  const findings: Finding[] = [];
  if (!(await converge(peers, relay)))
    findings.push({
      kind: 'no-convergence',
      detail: 'loro docs differ from the server after delivery',
    });
  const serverMarkdown = await peers[0].page.evaluate(
    (json) => window.lexFuzz!.toMarkdown(json),
    JSON.stringify(relay.doc.toJSON())
  );
  const editorMarkdowns: string[] = [];
  for (const peer of peers) {
    const state = await peer.page.evaluate(() => {
      const f = window.lexFuzz!;
      const editorMarkdown = f.editorMarkdown();
      return {
        editorMarkdown,
        loroMarkdown: f.loroMarkdown(),
        roundTrip: f.roundTrip(editorMarkdown),
        blocks: f.blocks(),
        invariants: f.invariants(),
        errors: f.errors(),
        editorJson: f.editorJson(),
        loroJson: f.loroJson(),
      };
    });
    editorMarkdowns.push(state.editorMarkdown);
    for (const other of peers) {
      const actual = region(state.blocks, other.model.marker);
      if (!sameBlocks(actual, expected(other)))
        findings.push({
          kind: 'model',
          peer: peer.name,
          detail: {
            region: other.name,
            phase,
            expected: expected(other),
            actual,
            log: other.log,
          },
        });
    }
    if (state.editorMarkdown !== state.loroMarkdown)
      findings.push({
        kind: 'editor-vs-loro-markdown',
        peer: peer.name,
        detail: { editor: state.editorMarkdown, loro: state.loroMarkdown },
      });
    if (state.editorMarkdown !== serverMarkdown)
      findings.push({
        kind: 'editor-vs-server-markdown',
        peer: peer.name,
        detail: { editor: state.editorMarkdown, server: serverMarkdown },
      });
    if (state.roundTrip !== state.editorMarkdown)
      findings.push({
        kind: 'markdown-round-trip',
        peer: peer.name,
        detail: { before: state.editorMarkdown, after: state.roundTrip },
      });
    if (state.invariants.length > 0)
      findings.push({
        kind: 'invariants',
        peer: peer.name,
        detail: state.invariants,
      });
    // Lexical's cascade guard: it trips after ~100 keystrokes in a row
    // (see the README), so it is its own kind rather than noise in the rest.
    const cascade = state.errors.filter((e) =>
      e.includes('endlessly enqueueing')
    );
    if (cascade.length > 0)
      findings.push({
        kind: 'lexical-cascade-guard',
        peer: peer.name,
        detail: cascade.length,
      });
    const errors = state.errors.filter(
      (e) => !e.includes('endlessly enqueueing')
    );
    if (errors.length > 0)
      findings.push({
        kind: 'console-errors',
        peer: peer.name,
        detail: errors,
      });
    const jsonDifference = firstDifference(
      JSON.parse(state.editorJson),
      JSON.parse(state.loroJson),
      ''
    );
    if (jsonDifference)
      findings.push({
        kind: 'editor-vs-loro-json',
        peer: peer.name,
        detail: jsonDifference,
      });
  }
  if (new Set(editorMarkdowns).size > 1)
    findings.push({ kind: 'peers-disagree', detail: editorMarkdowns });
  return findings.map((f) => ({ ...f, phase }));
}

for (let run = 0; run < RUNS; run++) {
  const seed = FIRST_SEED + run;
  test(`fuzz seed ${seed}`, async ({ browser }) => {
    const relay = new Relay(seededRandom(seed ^ 0x5eed), LATENCY_MS);
    const peers = await openPeers(browser, relay, `fuzz-${seed}`, PEERS);
    const findings: Finding[] = [];
    await Promise.all(
      peers.map((peer, i) =>
        drive(peer, relay, seed * 31 + i, findings, SCRIPT?.[peer.name])
      )
    );
    findings.push(
      ...(await check(peers, relay, 'typed', (p) => p.model.blocks))
    );
    const structural = ['caret', 'model', 'no-convergence'];
    if (UNDO && !findings.some((f) => structural.includes(f.kind))) {
      // Loro's undo is per person: undoing everything you did leaves only
      // the seed, whatever the others did; redoing it all brings it back.
      if (UNDO === 'sequential')
        for (const p of peers) await repeat(p, 'Control+z', 3 * p.log.length);
      else
        await Promise.all(
          peers.map((p) => repeat(p, 'Control+z', 3 * p.log.length))
        );
      findings.push(
        ...(await check(peers, relay, 'undone', (p) => [
          { type: 'p', text: p.model.marker },
        ]))
      );
      await Promise.all(
        peers.map((p) => repeat(p, 'Control+Shift+z', 3 * p.log.length))
      );
      findings.push(
        ...(await check(peers, relay, 'redone', (p) => p.model.blocks))
      );
    }
    const report = {
      seed,
      peers: PEERS,
      steps: STEPS,
      latency: LATENCY_MS,
      delivered: relay.delivered,
      findings,
      logs: Object.fromEntries(peers.map((p) => [p.name, p.log])),
    };
    mkdirSync(REPORTS, { recursive: true });
    const file = `${REPORTS}fuzz-${seed}.json`;
    writeFileSync(file, JSON.stringify(report, null, 2));
    expect(findings, `report: ${file}`).toEqual([]);
  });
}
