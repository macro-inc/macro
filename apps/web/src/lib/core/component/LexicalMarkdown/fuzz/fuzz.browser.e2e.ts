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
import { type Browser, expect, type Page, test } from '@playwright/test';
import { match } from 'ts-pattern';
import type { FuzzBlock, FuzzCaret } from './fixture';
import { type Action, type Block, PeerModel } from './model';
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
const NAMES = 'ABCDEFGH';
const END_MARKER = 'The end.';
const REPORTS = fileURLToPath(new URL('./reports/', import.meta.url));

type Peer = { name: string; page: Page; model: PeerModel; log: Action[] };

type Finding = { kind: string; peer?: string; detail: unknown };

async function openPeers(
  browser: Browser,
  relay: Relay,
  seed: number
): Promise<Peer[]> {
  const peers: Peer[] = [];
  for (let i = 0; i < PEERS; i++) {
    const name = NAMES[i];
    const context = await browser.newContext();
    const page = await context.newPage();
    if (process.env.FUZZ_DEBUG)
      page.on('console', (m) =>
        console.log(`[${name}] ${m.type()}: ${m.text()}`)
      );
    page.on('pageerror', (e) =>
      console.log(`[${name}] pageerror: ${e.message}`)
    );
    await relay.attach(name, page);
    peers.push({ name, page, model: new PeerModel(`Peer ${name}:`), log: [] });
  }
  // A last block nobody types into, so no region ends the document (where
  // trailingParagraphPlugin adds a paragraph after a code block).
  const markdown = [...peers.map((p) => p.model.marker), END_MARKER].join(
    '\n\n'
  );
  await Promise.all(peers.map((p) => p.page.goto(`/?doc=fuzz-${seed}`)));
  await peers[0].page.waitForFunction(
    () => window.lexFuzz !== undefined,
    undefined,
    { timeout: 120_000 }
  );
  if (process.env.FUZZ_DEBUG) console.log('fixture loaded');
  relay.initialize(
    await peers[0].page.evaluate((md) => window.lexFuzz!.seed(md), markdown)
  );
  if (process.env.FUZZ_DEBUG) console.log('server seeded');
  for (const peer of peers) {
    await peer.page.waitForFunction(
      () => window.lexFuzz?.ready() === true,
      undefined,
      { timeout: 30_000 }
    );
    const placed = await peer.page.evaluate(
      (m) => window.lexFuzz!.placeAtEnd(m),
      peer.model.marker
    );
    if (!placed) throw new Error(`${peer.name} could not find its marker`);
  }
  return peers;
}

async function perform(
  peer: Peer,
  relay: Relay,
  action: Action
): Promise<void> {
  const keyboard = peer.page.keyboard;
  await match(action)
    .with({ kind: 'type' }, ({ text, delay }) => keyboard.type(text, { delay }))
    .with({ kind: 'enter' }, () => keyboard.press('Enter'))
    .with({ kind: 'linebreak' }, () => keyboard.press('Shift+Enter'))
    .with({ kind: 'backspace' }, () => keyboard.press('Backspace'))
    .with({ kind: 'shortcut' }, ({ prefix }) => keyboard.type(prefix))
    .with({ kind: 'code' }, async () => {
      await keyboard.type('```');
      await keyboard.press('Enter');
    })
    .with({ kind: 'offline' }, async () => relay.hold(peer.name))
    .with({ kind: 'online' }, async () => relay.release(peer.name))
    .with({ kind: 'pause' }, ({ ms }) => peer.page.waitForTimeout(ms))
    .exhaustive();
}

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
    if (findings.length > 0) return;
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
      return;
    }
  }
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

async function check(peers: Peer[], relay: Relay): Promise<Finding[]> {
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
      if (!sameBlocks(actual, other.model.blocks))
        findings.push({
          kind: 'model',
          peer: peer.name,
          detail: {
            region: other.name,
            expected: other.model.blocks,
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
    if (state.errors.length > 0)
      findings.push({
        kind: 'console-errors',
        peer: peer.name,
        detail: state.errors,
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
  return findings;
}

for (let run = 0; run < RUNS; run++) {
  const seed = FIRST_SEED + run;
  test(`fuzz seed ${seed}`, async ({ browser }) => {
    const relay = new Relay(seededRandom(seed ^ 0x5eed), LATENCY_MS);
    const peers = await openPeers(browser, relay, seed);
    const findings: Finding[] = [];
    await Promise.all(
      peers.map((peer, i) =>
        drive(peer, relay, seed * 31 + i, findings, SCRIPT?.[peer.name])
      )
    );
    findings.push(...(await check(peers, relay)));
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
