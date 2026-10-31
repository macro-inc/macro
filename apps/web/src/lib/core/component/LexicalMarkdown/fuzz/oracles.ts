/** What must hold once every message is delivered, on every peer. */

import { expect } from '@playwright/test';
import type { FuzzBlock } from './bridge';
import { END_MARKER, markerOf, type Peer } from './harness';
import type { Block } from './model';
import type { Relay } from './relay';

export type Finding = {
  kind: string;
  peer?: string;
  phase: string;
  detail: unknown;
};

/** Findings that end a run, for fast-check to shrink. */
export class FindingsError extends Error {
  constructor(readonly findings: Finding[]) {
    super(
      findings
        .map(
          (finding) =>
            `${finding.kind}${finding.peer ? ` on ${finding.peer}` : ''} (${finding.phase})`
        )
        .join(', ')
    );
  }
}

/** Kinds after which the models no longer describe the document. */
export const STRUCTURAL_KINDS = ['caret', 'model', 'no-convergence'];

/** Lexical's cascade guard; see the README. */
const CASCADE_ERROR = 'endlessly enqueueing';

/** The blocks between this peer's marker and the next marker. */
function region(blocks: FuzzBlock[], marker: string): FuzzBlock[] {
  const start = blocks.findIndex((block) => block.text.startsWith(marker));
  if (start === -1) return [];
  const rest = blocks.slice(start + 1);
  const end = rest.findIndex(
    (block) => /^Peer [A-H]:/.test(block.text) || block.text === END_MARKER
  );
  return [blocks[start], ...(end === -1 ? rest : rest.slice(0, end))];
}

const sameBlocks = (actual: FuzzBlock[], expected: Block[]) =>
  actual.length === expected.length &&
  actual.every(
    (block, i) =>
      block.type === expected[i].type &&
      block.text === expected[i].text &&
      block.indent === undefined
  );

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** The first place two JSON values differ, ignoring key order. */
function firstDifference(
  editor: unknown,
  loro: unknown,
  path: string
): { path: string; editor: unknown; loro: unknown } | null {
  if (editor === loro || (editor ?? null) === (loro ?? null)) return null;
  if (
    !isRecord(editor) ||
    !isRecord(loro) ||
    Array.isArray(editor) !== Array.isArray(loro)
  )
    return { path, editor, loro };
  for (const key of new Set([...Object.keys(editor), ...Object.keys(loro)])) {
    const difference = firstDifference(
      editor[key],
      loro[key],
      `${path}/${key}`
    );
    if (difference) return difference;
  }
  return null;
}

/** Delivers everything until every copy of the document equals the server's. */
async function converge(peers: Peer[], relay: Relay): Promise<boolean> {
  const server = () => JSON.stringify(relay.doc.toJSON());
  try {
    await expect
      .poll(
        async () => {
          // Delivering can make a peer push again (reconcile), so drain each time.
          await relay.drain();
          if (!relay.idle()) return false;
          const copies = await Promise.all(
            peers.map((peer) => peer.api.evaluate((api) => api.loroJson()))
          );
          return copies.every((copy) => copy === server());
        },
        { timeout: 20_000, intervals: [100] }
      )
      .toBe(true);
    return true;
  } catch {
    return false;
  }
}

/**
 * Delivers everything, then checks every peer: each region against
 * `expected(name)`, the markdown and JSON of editor, Loro, and server against
 * each other, tree invariants, and console errors.
 */
export async function check(
  peers: Peer[],
  relay: Relay,
  phase: string,
  expected: (name: string) => Block[]
): Promise<Finding[]> {
  const findings: Finding[] = [];
  const add = (finding: Omit<Finding, 'phase'>) =>
    findings.push({ ...finding, phase });
  if (!(await converge(peers, relay)))
    add({
      kind: 'no-convergence',
      detail: 'loro docs differ from the server after delivery',
    });
  const serverMarkdown = await peers[0].api.evaluate(
    (api, json) => api.toMarkdown(json),
    JSON.stringify(relay.doc.toJSON())
  );
  const editorMarkdowns = new Set<string>();
  for (const peer of peers) {
    const state = await peer.api.evaluate((api) => {
      const editorMarkdown = api.editorMarkdown();
      return {
        editorMarkdown,
        loroMarkdown: api.loroMarkdown(),
        roundTrip: api.roundTrip(editorMarkdown),
        blocks: api.blocks(),
        invariants: api.invariants(),
        errors: api.errors(),
        editorJson: api.editorJson(),
        loroJson: api.loroJson(),
      };
    });
    editorMarkdowns.add(state.editorMarkdown);
    for (const other of peers) {
      const actual = region(state.blocks, markerOf(other.name));
      if (!sameBlocks(actual, expected(other.name)))
        add({
          kind: 'model',
          peer: peer.name,
          detail: {
            region: other.name,
            expected: expected(other.name),
            actual,
          },
        });
    }
    if (state.editorMarkdown !== state.loroMarkdown)
      add({
        kind: 'editor-vs-loro-markdown',
        peer: peer.name,
        detail: { editor: state.editorMarkdown, loro: state.loroMarkdown },
      });
    if (state.editorMarkdown !== serverMarkdown)
      add({
        kind: 'editor-vs-server-markdown',
        peer: peer.name,
        detail: { editor: state.editorMarkdown, server: serverMarkdown },
      });
    if (state.roundTrip !== state.editorMarkdown)
      add({
        kind: 'markdown-round-trip',
        peer: peer.name,
        detail: { before: state.editorMarkdown, after: state.roundTrip },
      });
    if (state.invariants.length > 0)
      add({ kind: 'invariants', peer: peer.name, detail: state.invariants });
    const cascade = state.errors.filter((error) =>
      error.includes(CASCADE_ERROR)
    );
    if (cascade.length > 0)
      add({
        kind: 'lexical-cascade-guard',
        peer: peer.name,
        detail: cascade.length,
      });
    const errors = state.errors.filter(
      (error) => !error.includes(CASCADE_ERROR)
    );
    if (errors.length > 0)
      add({ kind: 'console-errors', peer: peer.name, detail: errors });
    const jsonDifference = firstDifference(
      JSON.parse(state.editorJson),
      JSON.parse(state.loroJson),
      ''
    );
    if (jsonDifference)
      add({
        kind: 'editor-vs-loro-json',
        peer: peer.name,
        detail: jsonDifference,
      });
  }
  if (editorMarkdowns.size > 1)
    add({ kind: 'peers-disagree', detail: [...editorMarkdowns] });
  return findings;
}
