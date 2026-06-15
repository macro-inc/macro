/**
 * seed-history.ts — Seed a Macro markdown document with a long, realistic Loro
 * CRDT edit history for stress-testing the history-scrubber feature.
 *
 * It builds a "kitchen-sink" markdown document (exercising every node type),
 * then applies tens/hundreds of thousands of small, incremental edits attributed
 * to multiple fake users and spread (with forged commit timestamps) over a
 * configurable number of days. Every edit is encoded schema-correctly by driving
 * the loro-mirror `Mirror` (not by hand-mutating Loro containers).
 *
 * --------------------------------------------------------------------------
 * HOW IT WORKS
 * --------------------------------------------------------------------------
 *  1. One `LoroDoc` + `Mirror` over `MARKDOWN_LORO_SCHEMA`. `setRecordTimestamp(true)`.
 *  2. ONE working Lexical state object (SerializedEditorState with node ids) is
 *     mutated incrementally. Node ids stay stable across edits so the mirror's
 *     id-keyed diff produces minimal ops (no whole-doc rewrites).
 *  3. For each edit:
 *       - At session boundaries `doc.setPeerId(personaPeerId)` attributes
 *         subsequent commits to a different fake user.
 *       - `doc.setNextCommitOptions({ timestamp })` forges the commit time
 *         (Loro timestamps are in SECONDS). This is the supported hook.
 *       - We mutate the working state, then `mirror.setState(structuredClone(state))`.
 *         A fresh object reference is REQUIRED — the mirror diffs old vs. new and
 *         skips work if handed the same reference it already holds.
 *       - One `setState` == one `doc.commit({ origin: 'to-loro' })` == one change
 *         == one timestamp/peer.
 *  4. Export a snapshot and POST it to the local sync-service `/initialize`, then
 *     connect once per persona over WebSocket and register that persona's peer id
 *     so the server's peer->user map (and thus the scrubber legend) shows names.
 *     Personas are synthesized with faker — they live only in the sync-service
 *     peer map (no Postgres row), so any identity works.
 *
 * The script targets the LOCAL running stack only — there is no offline mode.
 *
 * --------------------------------------------------------------------------
 * PREREQUISITES
 * --------------------------------------------------------------------------
 *  - Local sync-service running on http://localhost:8787 (i.e. `cd rust/sync-service && just dev`).
 *    Its internal auth key + JWT secret are both "local" in local dev.
 *  - For the document to appear/owned in the app sidebar it ALSO needs a
 *    cloud-storage record (Postgres + LocalStack S3). On a network run this
 *    script creates it for you by shelling out to the seed CLI (equivalent to
 *    `cd rust/cloud-storage/seed_cli && just seed document create ...`, with the
 *    local env set inline so no prior `just get_environment` is required). The
 *    record is created PUBLICLY EDITABLE, so ownership isn't the access path —
 *    just open the printed app url from any local account. The owner is still a
 *    FOREIGN KEY into the local "User" table so it must be a real local user;
 *    when --owner is omitted the script takes the first one (the edit personas
 *    live only in the sync-service and need no Postgres row). Pass --owner (a
 *    user id or bare email) to choose, --doc-name to rename, or
 *    --no-create-record to skip. If Postgres / LocalStack aren't up the step is
 *    reported as failed but the snapshot is still live in the sync-service.
 *
 * --------------------------------------------------------------------------
 * USAGE
 * --------------------------------------------------------------------------
 *  Quick local doc (a few hundred edits):
 *      cd js && bun run scripts/seed-history.ts --edits 400
 *
 *  Full stress run:
 *      cd js && bun run scripts/seed-history.ts --edits 200000 --users 6 --days 30
 *
 *  Run with --help for the full, yargs-generated flag list. Key flags:
 *      --edits <n>         total number of edits/versions  (default 50000)
 *      --users <n>         number of faker-generated editors (default 4)
 *      --days <n>          calendar span of the history     (default 30)
 *      --shape bursty|steady  activity distribution         (default bursty)
 *      --doc-id <uuid>     document id, must be a UUID       (default random UUID)
 *      --seed <n>          deterministic faker seed
 *      --owner <id|email>  storage-record owner             (default: first local user)
 *      --doc-name <name>   document name                    (default history-scrubber-stress)
 *      --sync-url <u>      local sync-service base url       (default http://localhost:8787)
 *      --no-create-record  skip creating the cloud-storage record
 */

import { resolve } from 'node:path';
import { SQL } from 'bun';
import { faker } from '@faker-js/faker';
import jwt from 'jsonwebtoken';
import { LoroDoc } from 'loro-crdt';
import { nanoid } from 'nanoid';
import yargs from 'yargs';
import {
  FromPeer,
  FromRemote,
  InitializeFromSnapshotRequest,
} from '../../rust/sync-service/bebop/generated/schema';
import { MARKDOWN_LORO_SCHEMA } from '../lexical-core/markdown-loro-schema';
import { markdownToSerializedEditorState } from '../lexical-core/markdown-loro-snapshot';
import { Mirror } from '../loro-mirror/packages/core/src';

// --------------------------------------------------------------------------
// Types describing the (loosely-typed) serialized Lexical state we mutate.
// We keep this deliberately loose: the mirror only cares about ids + shape.
// --------------------------------------------------------------------------
type LexNode = {
  type: string;
  $?: { id: string };
  children?: LexNode[];
  text?: string;
  [key: string]: unknown;
};
type LexState = { root: LexNode };

// Local-dev secret shared by the sync-service for both the internal auth key
// and the JWT signing/verification key (see rust/sync-service/src/auth.rs).
const LOCAL_SECRET = 'local';

type Persona = {
  userId: string;
  name: string;
  peerId: bigint;
};

// --------------------------------------------------------------------------
// CLI parsing
// --------------------------------------------------------------------------
type Args = {
  edits: number;
  users: number;
  days: number;
  shape: 'bursty' | 'steady';
  docId: string;
  seed?: number;
  syncUrl: string;
  /** Also create the cloud-storage record via the seed CLI (needs Postgres +
   * LocalStack) so the doc shows in the sidebar. --no-create-record opts out. */
  createRecord: boolean;
  /** Owner for that storage record; defaults to the first persona (Bob). */
  owner?: string;
  /** Document name (no extension) for the storage record. */
  docName: string;
};

function parseArgs(argv: string[]): Args {
  const a = yargs(argv)
    .scriptName('seed-history')
    .usage(
      '$0 [options]\n\nSeed a long, multi-user document history into the local running stack (sync-service + cloud-storage) so it can be opened and scrubbed in the local app.'
    )
    .option('edits', {
      type: 'number',
      default: 50000,
      describe: 'total number of edits/versions',
    })
    .option('users', {
      type: 'number',
      default: 4,
      describe: 'number of fake editors (faker-generated identities)',
    })
    .option('days', {
      type: 'number',
      default: 30,
      describe: 'calendar span of the history',
    })
    .option('shape', {
      choices: ['bursty', 'steady'] as const,
      default: 'bursty' as const,
      describe: 'activity distribution (bursty = quiet gaps + dense bursts)',
    })
    .option('seed', {
      type: 'number',
      describe: 'deterministic faker seed (personas + content)',
    })
    .option('doc-id', {
      type: 'string',
      describe: 'document id — must be a UUID (random UUID by default)',
    })
    .option('owner', {
      type: 'string',
      describe:
        'storage-record owner — user id or bare email (default: first local user)',
    })
    .option('doc-name', {
      type: 'string',
      default: 'history-scrubber-stress',
      describe: 'document name (no extension)',
    })
    .option('sync-url', {
      type: 'string',
      default: 'http://localhost:8787',
      describe: 'local sync-service base url',
    })
    .option('create-record', {
      type: 'boolean',
      default: true,
      describe: 'create the cloud-storage record so the doc shows in sidebar',
    })
    .strict()
    .help()
    .parseSync();

  return {
    edits: Math.max(1, a.edits),
    users: Math.max(1, Math.min(50, a.users)),
    days: Math.max(1, a.days),
    shape: a.shape === 'steady' ? 'steady' : 'bursty',
    docId: a.docId ?? crypto.randomUUID(),
    seed: a.seed,
    syncUrl: a.syncUrl,
    createRecord: a.createRecord,
    owner: a.owner,
    docName: a.docName,
  };
}

// --------------------------------------------------------------------------
// Node helpers — all node ids use nanoid(8) to match the editor's durable ids.
// --------------------------------------------------------------------------
function newId(): string {
  return nanoid(8);
}

function withId<T extends Omit<LexNode, '$'>>(node: T): LexNode {
  return { ...node, $: { id: newId() } } as unknown as LexNode;
}

function textNode(text: string, format = 0): LexNode {
  return withId({
    detail: 0,
    format,
    mode: 'normal',
    style: '',
    text,
    type: 'text',
    version: 1,
  });
}

function paragraphNode(text: string): LexNode {
  return withId({
    children: [textNode(text)],
    direction: null,
    format: '',
    indent: 0,
    type: 'paragraph',
    version: 1,
    textFormat: 0,
    textStyle: '',
  });
}

function headingNode(text: string, tag: 'h1' | 'h2' | 'h3'): LexNode {
  return withId({
    children: [textNode(text)],
    direction: null,
    format: '',
    indent: 0,
    type: 'heading',
    version: 1,
    tag,
  });
}

function quoteNode(text: string): LexNode {
  return withId({
    children: [textNode(text)],
    direction: null,
    format: '',
    indent: 0,
    type: 'quote',
    version: 1,
  });
}

function listItemNode(text: string, value: number): LexNode {
  return withId({
    children: [textNode(text)],
    direction: null,
    format: '',
    indent: 0,
    type: 'listitem',
    version: 1,
    value,
  });
}

function listNode(items: string[]): LexNode {
  return withId({
    children: items.map((t, i) => listItemNode(t, i + 1)),
    direction: null,
    format: '',
    indent: 0,
    type: 'list',
    version: 1,
    listType: 'bullet',
    start: 1,
    tag: 'ul',
  });
}

function horizontalRuleNode(): LexNode {
  // HorizontalRuleNode serializes as a bare SerializedLexicalNode (no extra
  // fields beyond type/version), see lexical-core/nodes/HorizontalRuleNode.ts.
  return withId({ type: 'horizontalrule', version: 1 });
}

/**
 * A properly-typed but intentionally NON-NAVIGABLE document mention. The
 * documentId is fake, so clicking it goes nowhere, but it is a real
 * DocumentMentionNode (type 'document-mention') with the exact serialized shape
 * from lexical-core/nodes/DocumentMentionNode.ts. It is an INLINE node and must
 * live inside a block's children (we splice it into a paragraph).
 */
function documentMentionNode(): LexNode {
  const documentName = faker.commerce.productName();
  return withId({
    type: 'document-mention',
    version: 2,
    documentId: faker.string.uuid(),
    documentName,
    blockName: 'document',
    blockParams: {},
    mentionUuid: faker.string.uuid(),
    collapsed: false,
    channelType: undefined,
    createdAt: faker.date.recent().getTime(),
  });
}

// --------------------------------------------------------------------------
// Tree utilities
// --------------------------------------------------------------------------
function* walk(
  node: LexNode
): Generator<{ node: LexNode; parent: LexNode | null }> {
  const stack: { node: LexNode; parent: LexNode | null }[] = [
    { node, parent: null },
  ];
  while (stack.length) {
    const cur = stack.pop()!;
    yield cur;
    for (const child of cur.node.children ?? []) {
      stack.push({ node: child, parent: cur.node });
    }
  }
}

function collectTextNodes(root: LexNode): LexNode[] {
  const out: LexNode[] = [];
  for (const { node } of walk(root)) {
    if (node.type === 'text' && typeof node.text === 'string') out.push(node);
  }
  return out;
}

/** Top-level blocks (direct children of root). */
function topBlocks(root: LexNode): LexNode[] {
  return root.children ?? [];
}

/** Deep-clone a subtree and assign fresh ids to every node (for cloneComplex). */
function cloneWithFreshIds(node: LexNode): LexNode {
  const copy: LexNode = structuredClone(node);
  for (const { node: n } of walk(copy)) {
    if (n.$) n.$ = { id: newId() };
  }
  return copy;
}

// --------------------------------------------------------------------------
// Kitchen-sink seed document (every node type present from edit #1).
// --------------------------------------------------------------------------
function kitchenSinkMarkdown(): string {
  return [
    `# ${faker.company.catchPhrase()}`,
    '',
    `${faker.lorem.paragraph()} **${faker.lorem.words(2)}** and *${faker.lorem.words(2)}* with a [link](https://example.com).`,
    '',
    '## ' + faker.commerce.department(),
    '',
    `> ${faker.lorem.sentence()}`,
    '',
    `- ${faker.lorem.words(3)}`,
    `- ${faker.lorem.words(4)}`,
    `- ${faker.lorem.words(2)}`,
    '',
    '1. ' + faker.lorem.words(3),
    '2. ' + faker.lorem.words(3),
    '',
    '```python',
    'def greet(name):',
    '    return f"hello {name}"',
    '```',
    '',
    '| Name | Role | Notes |',
    '|------|------|-------|',
    `| ${faker.person.firstName()} | ${faker.person.jobTitle()} | ${faker.lorem.words(2)} |`,
    `| ${faker.person.firstName()} | ${faker.person.jobTitle()} | ${faker.lorem.words(2)} |`,
    '',
    '---',
    '',
    faker.lorem.paragraph(),
    '',
  ].join('\n');
}

// --------------------------------------------------------------------------
// Mutators. Each mutates the working `state` IN PLACE (preserving untouched
// node ids) and returns true if it changed anything.
// --------------------------------------------------------------------------
type Mutator = (state: LexState) => boolean;

const editText: Mutator = (state) => {
  const texts = collectTextNodes(state.root);
  if (texts.length === 0) return false;
  const node = faker.helpers.arrayElement(texts);
  const mode = faker.helpers.weightedArrayElement([
    { weight: 5, value: 'append' },
    { weight: 3, value: 'replace' },
    { weight: 2, value: 'truncate' },
  ]);
  const current = node.text ?? '';
  if (mode === 'append') {
    node.text = `${current} ${faker.lorem.words({ min: 1, max: 4 })}`;
  } else if (mode === 'replace') {
    node.text = faker.lorem.sentence();
  } else {
    // truncate / delete-within: keep a random prefix (favours shrinking).
    const keep = Math.floor(
      current.length * faker.number.float({ min: 0, max: 0.7 })
    );
    node.text = current.slice(0, keep) || faker.lorem.word();
  }
  return true;
};

const deleteNode: Mutator = (state) => {
  const blocks = topBlocks(state.root);
  // Keep the doc from collapsing — always leave at least a few blocks.
  if (blocks.length <= 4) {
    // Fall back to deleting an inline node from inside a block.
    for (const block of blocks) {
      const kids = block.children ?? [];
      if (kids.length > 1) {
        kids.splice(faker.number.int({ min: 0, max: kids.length - 1 }), 1);
        return true;
      }
    }
    return false;
  }
  blocks.splice(faker.number.int({ min: 0, max: blocks.length - 1 }), 1);
  return true;
};

const insertParagraph: Mutator = (state) => {
  const blocks = topBlocks(state.root);
  const at = faker.number.int({ min: 0, max: blocks.length });
  blocks.splice(at, 0, paragraphNode(faker.lorem.paragraph()));
  return true;
};

const insertHeading: Mutator = (state) => {
  const blocks = topBlocks(state.root);
  const at = faker.number.int({ min: 0, max: blocks.length });
  const tag = faker.helpers.arrayElement(['h1', 'h2', 'h3'] as const);
  blocks.splice(at, 0, headingNode(faker.company.catchPhrase(), tag));
  return true;
};

const insertQuote: Mutator = (state) => {
  const blocks = topBlocks(state.root);
  const at = faker.number.int({ min: 0, max: blocks.length });
  blocks.splice(at, 0, quoteNode(faker.lorem.sentence()));
  return true;
};

const insertList: Mutator = (state) => {
  const blocks = topBlocks(state.root);
  const at = faker.number.int({ min: 0, max: blocks.length });
  const items = Array.from(
    { length: faker.number.int({ min: 2, max: 4 }) },
    () => faker.lorem.words({ min: 2, max: 5 })
  );
  blocks.splice(at, 0, listNode(items));
  return true;
};

const insertHr: Mutator = (state) => {
  const blocks = topBlocks(state.root);
  const at = faker.number.int({ min: 0, max: blocks.length });
  blocks.splice(at, 0, horizontalRuleNode());
  return true;
};

const insertMention: Mutator = (state) => {
  // Inline node: place it inside an existing paragraph's children.
  const paragraphs = topBlocks(state.root).filter(
    (b) => b.type === 'paragraph'
  );
  if (paragraphs.length === 0) return false;
  const para = faker.helpers.arrayElement(paragraphs);
  if (!para.children) para.children = [];
  const kids = para.children;
  const at = faker.number.int({ min: 0, max: kids.length });
  kids.splice(at, 0, documentMentionNode());
  return true;
};

const cloneComplex: Mutator = (state) => {
  // Deep-clone an existing table or code block (with fresh ids) and splice it
  // in — a safe way to churn complex node types without hand-authoring them.
  const complex = topBlocks(state.root).filter(
    (b) => b.type === 'table' || b.type === 'custom-code'
  );
  if (complex.length === 0) return false;
  const source = faker.helpers.arrayElement(complex);
  const clone = cloneWithFreshIds(source);
  const blocks = topBlocks(state.root);
  blocks.splice(faker.number.int({ min: 0, max: blocks.length }), 0, clone);
  return true;
};

// Weighted mutator selection (per the design: editText high; deleteNode/
// insertParagraph medium; the rest low; cloneComplex rare).
// NOTE: deleteNode weight (~30) is balanced against the sum of all insert
// weights (insertParagraph 12 + heading 3 + list 3 + quote 3 + hr 2 + mention 4
// + cloneComplex 2 = 29) so the document size stays roughly stable over a long
// run rather than growing unbounded (keeping late-history diffs cheap).
const WEIGHTED_MUTATORS: { weight: number; value: Mutator }[] = [
  { weight: 55, value: editText },
  { weight: 30, value: deleteNode },
  { weight: 12, value: insertParagraph },
  { weight: 3, value: insertHeading },
  { weight: 3, value: insertList },
  { weight: 3, value: insertQuote },
  { weight: 2, value: insertHr },
  { weight: 4, value: insertMention },
  { weight: 2, value: cloneComplex },
];

// Mutators grouped by their effect on document size, used to keep the block
// count within a target band so the doc neither collapses nor grows unbounded.
const INSERT_MUTATORS: Mutator[] = [
  insertParagraph,
  insertHeading,
  insertList,
  insertQuote,
  insertHr,
  cloneComplex,
];

/**
 * Pick the next mutator. Within a target block band [min,max] we use the normal
 * weighted distribution; outside it we bias hard toward shrinking (when too
 * large) or growing (when too small) so the document stays a realistic size.
 */
function pickMutator(blockCount: number): Mutator {
  const TARGET_MIN = 18;
  const TARGET_MAX = 45;
  if (blockCount > TARGET_MAX) {
    // Too big: edit or delete only.
    return faker.helpers.weightedArrayElement([
      { weight: 4, value: editText },
      { weight: 6, value: deleteNode },
    ]);
  }
  if (blockCount < TARGET_MIN) {
    // Too small: edit or insert only.
    return faker.helpers.weightedArrayElement([
      { weight: 4, value: editText },
      { weight: 5, value: faker.helpers.arrayElement(INSERT_MUTATORS) },
      { weight: 2, value: insertMention },
    ]);
  }
  return faker.helpers.weightedArrayElement(WEIGHTED_MUTATORS);
}

// --------------------------------------------------------------------------
// Fake clock — advances over the requested span with bursts/gaps.
// Returns commit timestamps in SECONDS.
// --------------------------------------------------------------------------
function makeClock(args: Args) {
  const spanSeconds = args.days * 24 * 60 * 60;
  // Start `days` ago, end ~now.
  const startSec = Math.floor(Date.now() / 1000) - spanSeconds;
  const endCeiling = startSec + spanSeconds;
  let cursor = startSec;

  // The clock is *schedule-targeted*: each session is nudged toward where its
  // edits "should" sit if the whole budget were spread evenly across the span
  // (startSec + span * editsDone/total). On top of that schedule we add random
  // idle slack and, with low probability, a long quiet stretch of days. The
  // result alternates dead air with dense bursts — and because dense bursts run
  // *ahead* of schedule, the following sessions start nearly back-to-back until
  // progress catches up, which clusters them. The schedule pull guarantees we
  // still consume ~the full span and never overshoot "now".
  // `setChangeMergeInterval(0)` keeps every commit a distinct change ONLY when
  // timestamps differ, so we also guarantee strictly-increasing timestamps.
  const avgPerEdit = Math.max(2, Math.floor(spanSeconds / args.edits));
  // Within a burst: seconds-to-minutes, capped so even a big burst stays dense
  // (lands within hours, not smeared across a day).
  const burstStepMax = Math.min(120, Math.max(2, Math.floor(avgPerEdit * 0.4)));
  // Probability a given session is preceded by a long idle stretch.
  const longQuietProb = args.shape === 'steady' ? 0.04 : 0.14;

  const bump = (by: number) => {
    // Advance by `by`, but clamp at the ceiling. Always move forward by at
    // least 1s so timestamps stay strictly increasing and changes never merge
    // (even once the cursor has reached the ceiling near the end of the run).
    cursor = Math.max(
      cursor + 1,
      Math.min(cursor + Math.max(1, by), endCeiling)
    );
    return cursor;
  };

  return {
    /** Advance within a burst (small step). */
    tick(): number {
      return bump(faker.number.int({ min: 1, max: burstStepMax }));
    },
    /**
     * Start the next session. `editsDone` is the count emitted so far; we pull
     * the cursor toward the scheduled position for that progress, then add idle
     * slack — usually modest, occasionally a multi-day quiet stretch (gated out
     * of the final 15% so the run doesn't pile its tail against "now").
     */
    jump(editsDone: number): number {
      const progress = Math.min(1, editsDone / args.edits);
      const scheduled = startSec + spanSeconds * progress;
      // Catch up to schedule if a dense burst pushed us ahead; never go back.
      const base = Math.max(cursor + 1, Math.floor(scheduled));
      const longQuiet =
        progress < 0.85 && faker.number.float() < longQuietProb;
      const slack = longQuiet
        ? faker.number.int({
            min: Math.floor(spanSeconds * 0.03),
            max: Math.floor(spanSeconds * 0.1),
          })
        : faker.number.int({ min: 0, max: Math.max(1, avgPerEdit * 8) });
      // Strictly-increasing guard: like `bump`, never collide or go backward,
      // even once `tick` has stepped the cursor past the ceiling near the end
      // (otherwise clamping to endCeiling would rewind time and merge changes).
      cursor = Math.max(cursor + 1, Math.min(base + slack, endCeiling));
      return cursor;
    },
  };
}

// --------------------------------------------------------------------------
// Generation: produce the LoroDoc with the full forged history.
// --------------------------------------------------------------------------
function buildPersonas(args: Args): Persona[] {
  // The edit personas exist only in the sync-service peer→user map (no Postgres
  // FK), so their identities can be anything — we synthesize them with faker.
  // The scrubber legend renders their name from the `macro|<email>` user id.
  // (The document *owner* is resolved separately against the real "User" table.)
  // Deterministic when --seed is set, since faker is seeded before this runs.
  return Array.from({ length: args.users }, (_, i) => {
    const first = faker.person.firstName();
    const last = faker.person.lastName();
    const email = faker.internet
      .email({ firstName: first, lastName: last })
      .toLowerCase();
    return {
      userId: `macro|${email}`,
      name: `${first} ${last}`,
      // Deterministic-ish peer ids derived from index; large to avoid collisions.
      peerId: BigInt(1000 + i * 7919 + 1),
    };
  });
}

function generate(args: Args, personas: Persona[]): LoroDoc {
  const doc = new LoroDoc();
  doc.setRecordTimestamp(true);
  // Disable change merging. By default Loro merges two continuous same-peer
  // commits whose timestamps are within 1000s into a SINGLE change. Our intra-
  // burst edits are only 1-5s apart, so without this every burst would collapse
  // to one change and the scrubber would see almost no history. With interval 0
  // each `mirror.setState` => `commit` becomes its own distinct change with its
  // own forged timestamp + peer attribution.
  doc.setChangeMergeInterval(0);
  const mirror = new Mirror({ doc, schema: MARKDOWN_LORO_SCHEMA });

  // Commit one edit: hand the mirror a FRESH structural clone of the working
  // state (a new reference is required — the mirror skips work if given the same
  // object it already holds) and let it diff+commit once.
  const commitState = (s: LexState) => {
    mirror.setState(
      structuredClone(s) as unknown as Parameters<typeof mirror.setState>[0]
    );
  };

  const clock = makeClock(args);

  // Working state, seeded from the rich kitchen-sink markdown WITH ids.
  const state = markdownToSerializedEditorState(
    kitchenSinkMarkdown()
  ) as unknown as LexState;

  // Edit #0: initial commit attributed to the first persona at the start time.
  let persona = personas[0];
  doc.setPeerId(persona.peerId);
  doc.setNextCommitOptions({ timestamp: clock.tick() });
  commitState(state);

  // Sessions: each persona works in a burst of edits, then we jump time and
  // (usually) switch persona for the next session.
  let edits = 1;
  const total = args.edits;
  const reportEvery = Math.max(1000, Math.floor(total / 50));
  const t0 = Date.now();

  while (edits < total) {
    // New session: pick a persona and forge its peer id.
    persona = faker.helpers.arrayElement(personas);
    doc.setPeerId(persona.peerId);

    // Cap a single session so that even small runs span several sessions
    // (and thus several personas) — otherwise one user could grab every edit.
    const burstCap = Math.max(2, Math.floor(total / (args.users * 2)));
    // Heavy-tailed: most sessions are short, but ~20% (bursty) are dense
    // mega-bursts reaching toward the cap — that's the "lots happened at once"
    // contrast the quiet gaps play against.
    const dense =
      args.shape !== 'steady' && faker.number.float() < 0.2;
    const burstMax =
      args.shape === 'steady'
        ? Math.min(12, burstCap)
        : Math.min(dense ? burstCap : 40, burstCap);
    const burstMin = Math.min(args.shape === 'steady' ? 3 : 4, burstMax);
    const burstLen = faker.number.int({ min: burstMin, max: burstMax });

    // First edit of a session jumps the clock (idle gap, sometimes a long one).
    let ts = clock.jump(edits);

    for (let i = 0; i < burstLen && edits < total; i++) {
      if (i > 0) ts = clock.tick();
      const mutate = pickMutator(topBlocks(state.root).length);
      const changed = mutate(state);
      if (!changed) {
        // Guaranteed-progress fallback so we always emit an op.
        editText(state);
      }
      doc.setNextCommitOptions({ timestamp: ts });
      commitState(state);
      edits++;

      if (edits % reportEvery === 0) {
        const pct = ((edits / total) * 100).toFixed(1);
        const rate = Math.round(edits / ((Date.now() - t0) / 1000));
        process.stdout.write(
          `  ${edits}/${total} edits (${pct}%) — ${rate}/s — blocks=${topBlocks(state.root).length}\n`
        );
      }
    }
  }

  return doc;
}

// --------------------------------------------------------------------------
// Networking: initialize the doc on the sync-service + register peer->user.
// --------------------------------------------------------------------------
function signToken(docId: string, userId: string): string {
  return jwt.sign(
    {
      user_id: userId,
      document_id: docId,
      access_level: 'owner',
      exp: Math.floor(Date.now() / 1000) + 5 * 60,
    },
    LOCAL_SECRET
  );
}

async function initializeDocument(
  syncUrl: string,
  docId: string,
  snapshot: Uint8Array
): Promise<void> {
  const body = InitializeFromSnapshotRequest.encode({ snapshot });
  const res = await fetch(`${syncUrl}/document/${docId}/initialize`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      // Internal auth key grants Admin on the durable object (no JWT needed).
      'x-internal-auth-key': LOCAL_SECRET,
    },
    // Send the raw bytes; copy into a standalone ArrayBuffer so the typed-array
    // is unambiguously a valid BodyInit regardless of the surrounding lib types.
    body: body.slice().buffer,
  });
  if (res.status !== 200) {
    throw new Error(
      `/initialize failed: HTTP ${res.status} — ${await res.text()}`
    );
  }
}

/**
 * Connect once per persona over WebSocket, wait for the initial sync, then send
 * a PeerRegisterId for that persona's peer id. The server records the
 * connecting JWT's user_id against that peer id (peer->user map), which is what
 * the scrubber legend reads to show human names per lane.
 */
async function registerPeer(
  syncUrl: string,
  docId: string,
  persona: Persona
): Promise<void> {
  const wsUrl = syncUrl.replace(/^http/, 'ws');
  const token = signToken(docId, persona.userId);
  const ws = new WebSocket(`${wsUrl}/document/${docId}/connect?token=${token}`);
  ws.binaryType = 'arraybuffer';

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`peer register timeout for ${persona.userId}`)),
      10000
    );
    ws.onerror = (e) => {
      clearTimeout(timeout);
      reject(new Error(`ws error for ${persona.userId}: ${JSON.stringify(e)}`));
    };
    ws.onmessage = (ev) => {
      // First server message is the initial sync; once we have it we can
      // register. We send the register frame then close shortly after to let
      // the server persist the mapping.
      try {
        FromRemote.decode(new Uint8Array(ev.data as ArrayBuffer));
      } catch {
        // ignore non-decodable frames; we only need any server message first
      }
      ws.send(FromPeer.fromPeerRegisterId({ peerid: persona.peerId }).encode());
      setTimeout(() => {
        clearTimeout(timeout);
        ws.close();
        resolve();
      }, 400);
    };
  });
}

// --------------------------------------------------------------------------
// Cloud-storage record: shell out to the seed CLI so the doc is discoverable
// and owned in the app sidebar (the snapshot itself already lives in the
// sync-service). Mirrors `just seed document create`, but sets the local env
// inline (same values as the seed_cli `local-e2e-smoke` recipe) so it works
// without a prior `just get_environment`.
// --------------------------------------------------------------------------
const LOCAL_SEED_ENV: Record<string, string> = {
  DATABASE_URL: 'postgres://user:password@localhost:5432/macrodb',
  LOCAL_AWS_URL: 'http://localhost:4566',
  DOCUMENT_STORAGE_BUCKET: 'doc-storage',
  AWS_ACCESS_KEY_ID: 'test',
  AWS_SECRET_ACCESS_KEY: 'test',
  SQLX_OFFLINE: 'true',
  ENVIRONMENT: 'local',
  FUSIONAUTH_BASE_URL: 'http://localhost:9011',
  FUSIONAUTH_API_KEY_SECRET_KEY: 'local',
  FUSIONAUTH_TENANT_ID: 'local',
  FUSIONAUTH_CLIENT_ID: 'local',
  FUSIONAUTH_CLIENT_SECRET_KEY: 'local',
  FUSIONAUTH_OAUTH_REDIRECT_URI: 'http://localhost:8080/oauth/redirect',
};

/**
 * Resolve the document owner against the local `"User"` table. The owner is a
 * FOREIGN KEY into that table, so it must be a real local user. Because the doc
 * is created publicly editable (see createStorageRecord), the owner is NOT the
 * access path — it just has to be valid — so when none is given we simply take
 * the first user. `--owner` accepts either a user id (`macro|email`) or a bare
 * email, matched case-insensitively. (Independent of the peer→user personas,
 * which live only in the sync-service and need no Postgres row.)
 */
async function resolveOwner(
  requested: string | undefined
): Promise<{ owner: string } | { error: string }> {
  const dbUrl = process.env.DATABASE_URL ?? LOCAL_SEED_ENV.DATABASE_URL;
  const sql = new SQL(dbUrl);
  let users: { id: string; email: string }[];
  try {
    users = await sql`SELECT id, email FROM "User" ORDER BY email`;
  } catch {
    // DB unreachable — can't validate. Proceed with what we have and let the
    // seed CLI surface the failure (Postgres is part of the same local stack).
    await sql.end();
    return requested
      ? { owner: requested }
      : { error: 'no --owner given and the local Postgres is unreachable' };
  }
  await sql.end();

  if (users.length === 0) {
    return {
      error:
        'the local "User" table is empty — log into the local app once so your' +
        '\n  account exists before a doc can be owned',
    };
  }
  if (requested) {
    const needle = requested.toLowerCase();
    // Match a full user id, a bare email, or email-without-the-macro-prefix.
    const hit = users.find(
      (u) =>
        u.id.toLowerCase() === needle || u.email.toLowerCase() === needle
    );
    if (hit) return { owner: hit.id };
    const list = users
      .map((u) => `${u.id}  (${u.email})`)
      .join('\n    ');
    return {
      error: `--owner '${requested}' is not a local user. Available:\n    ${list}`,
    };
  }
  // Public doc → owner identity doesn't gate access; just take the first user.
  return { owner: users[0].id };
}

async function createStorageRecord(
  docId: string,
  owner: string,
  docName: string
): Promise<boolean> {
  // <repo>/js/scripts/seed-history.ts → <repo>/rust/cloud-storage/seed_cli
  const seedCliDir = resolve(
    import.meta.dir,
    '../../rust/cloud-storage/seed_cli'
  );
  // The uploaded file is just the stored blob; the live content comes from the
  // sync-service snapshot. Reuse the CLI's bundled sample markdown.
  const filePath = 'seed/documents/files/md.md';
  const cmd = [
    'cargo',
    'run',
    '--quiet',
    '--',
    'document',
    'create',
    '--owner',
    owner,
    '--document-name',
    docName,
    '--id',
    docId,
    '--file-path',
    filePath,
    // Publicly editable so the doc can be opened + edited from any local account
    // (ownership isn't the access path); just open the printed app url.
    // `--is-public` is a bare flag (clap SetTrue), not a value-taking option.
    '--is-public',
    '--public-access-level',
    'edit',
  ];
  console.log(`  $ (cd ${seedCliDir} && ${cmd.join(' ')})`);
  const proc = Bun.spawn(cmd, {
    cwd: seedCliDir,
    env: { ...process.env, ...LOCAL_SEED_ENV },
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  return code === 0;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(s: string): boolean {
  return UUID_RE.test(s);
}

function printDone(args: Args) {
  console.log('\nDone.');
  console.log(`  document id : ${args.docId}`);
  console.log(`  app url     : http://localhost:3000/app/md/${args.docId}`);
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.seed !== undefined) faker.seed(args.seed);

  const personas = buildPersonas(args);

  console.log('Seeding history with:');
  console.log(`  edits   : ${args.edits}`);
  console.log(
    `  users   : ${args.users} (${personas.map((p) => p.name).join(', ')})`
  );
  console.log(`  days    : ${args.days}`);
  console.log(`  shape   : ${args.shape}`);
  console.log(`  doc-id  : ${args.docId}`);
  console.log(`  target  : ${args.syncUrl}`);
  console.log('');

  const tGen = Date.now();
  const doc = generate(args, personas);
  const genSecs = ((Date.now() - tGen) / 1000).toFixed(1);

  const snapshot = doc.export({ mode: 'snapshot' });

  // Summarise the forged history.
  let changeCount = 0;
  let minTs = Number.POSITIVE_INFINITY;
  let maxTs = 0;
  const perPeer = new Map<string, number>();
  for (const [peer, arr] of doc.getAllChanges().entries()) {
    for (const ch of arr) {
      changeCount++;
      if (ch.timestamp) {
        minTs = Math.min(minTs, ch.timestamp);
        maxTs = Math.max(maxTs, ch.timestamp);
      }
    }
    perPeer.set(
      peer.toString(),
      (perPeer.get(peer.toString()) ?? 0) + arr.length
    );
  }

  console.log('');
  console.log(`Generated in ${genSecs}s`);
  console.log(`  loro changes : ${changeCount}`);
  console.log(`  snapshot     : ${(snapshot.length / 1024).toFixed(1)} KiB`);
  console.log(
    `  time span    : ${new Date(minTs * 1000).toISOString()} -> ${new Date(maxTs * 1000).toISOString()}`
  );
  for (const p of personas) {
    console.log(
      `  ${p.name.padEnd(16)} peer=${p.peerId} changes=${perPeer.get(p.peerId.toString()) ?? 0}`
    );
  }

  console.log('\nInitializing document on sync-service...');
  try {
    await initializeDocument(args.syncUrl, args.docId, snapshot);
    console.log('  /initialize OK');
  } catch (e) {
    console.error('  /initialize FAILED:', (e as Error).message);
    console.error(
      `  Is the local sync-service running on ${args.syncUrl}? ` +
        '(cd rust/sync-service && just dev)'
    );
    process.exitCode = 1;
    return;
  }

  console.log('Registering peer->user mappings...');
  for (const p of personas) {
    try {
      await registerPeer(args.syncUrl, args.docId, p);
      console.log(`  registered ${p.userId} (peer ${p.peerId})`);
    } catch (e) {
      console.error(`  register FAILED for ${p.userId}:`, (e as Error).message);
    }
  }

  if (args.createRecord) {
    // The "Document" table parses the id as a UUID (string_to_uuid().unwrap()),
    // so a non-UUID doc-id panics the seed CLI. The sync-service accepts any
    // string, but for a usable record the id must be a UUID.
    if (!isUuid(args.docId)) {
      console.error(
        `\nSkipping cloud-storage record: --doc-id '${args.docId}' is not a UUID` +
          '\n  (the "Document" table requires one). Omit --doc-id to get a random' +
          '\n  UUID, or pass a UUID explicitly.'
      );
      printDone(args);
      return;
    }
    const resolved = await resolveOwner(args.owner);
    if ('error' in resolved) {
      console.error(`\nSkipping cloud-storage record: ${resolved.error}`);
      console.error(
        '  The snapshot is still live in the sync-service; pass --owner <id>' +
          '\n  and re-run with the same --doc-id to create the record later.'
      );
    } else {
      const { owner } = resolved;
      console.log(
        `\nCreating cloud-storage record via seed CLI (owner ${owner})...`
      );
      let ok = false;
      try {
        ok = await createStorageRecord(args.docId, owner, args.docName);
      } catch (e) {
        console.error('  seed CLI spawn failed:', (e as Error).message);
      }
      if (ok) {
        console.log('  storage record created (public, editable)');
      } else {
        console.error(
          '  Could not create the storage record. The snapshot is still live in' +
            "\n  the sync-service, but the doc won't show as owned in the sidebar." +
            '\n  This step needs Postgres + LocalStack up (the local app stack).' +
            '\n  Re-run later with the same --doc-id, or pass --no-create-record to' +
            '\n  skip it.'
        );
      }
    }
  }

  printDone(args);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
