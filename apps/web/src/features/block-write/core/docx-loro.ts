import type {
  BlockRecord,
  Change,
  CollabState,
  DeltaOp,
  RemoteChange,
  V1State,
} from '@core/docx-engine/types';
import { type LoroDoc, type LoroEvent, LoroMap, LoroText } from 'loro-crdt';

/**
 * Root containers of a collaborative DOCX (see `crates/docx_engine` `collab`).
 *
 * Parts, relationships and content types are flat maps of strings. Each
 * block is a map (`k` kind, `p` parent, `o` position key, `a` attributes,
 * `x` properties) and each paragraph's text is a rich-text container whose
 * marks are its formatting, so concurrent typing in one paragraph merges
 * character by character. Comment marks keep their own map.
 */
export const DOCX_LORO_CONTAINERS = {
  meta: 'docxMeta',
  marks: 'docxMarks',
  parts: 'wordParts',
  types: 'wordTypes',
  rels: 'wordRels',
  blocks: 'wordBlocks',
} as const;

/** Containers of the first format, read once to migrate. */
export const LEGACY_CONTAINERS = {
  blocks: 'docxBlocks',
  order: 'docxOrder',
  parts: 'docxParts',
} as const;

export const DOCX_FORMAT_VERSION = 2;

/** Commit origins of writes that do not come from the editing engine. */
export const DOCX_ORIGINS = {
  /** Edits made by this peer's engine (already applied there). */
  local: 'docx-local',
  seed: 'docx-seed',
  migrate: 'docx-migrate',
  comment: 'docx-comment',
} as const;

const FLAT = [
  DOCX_LORO_CONTAINERS.parts,
  DOCX_LORO_CONTAINERS.types,
  DOCX_LORO_CONTAINERS.rels,
] as const;

/**
 * Every peer must read and write paragraph marks the same way: a mark never
 * grows over text typed next to it, because the engine states the full
 * formatting of every insertion.
 */
export function configureDocxText(doc: LoroDoc) {
  doc.configDefaultTextStyle({ expand: 'none' });
}

export function docxFormatVersion(doc: LoroDoc): number | undefined {
  const value = doc.getMap(DOCX_LORO_CONTAINERS.meta).get('formatVersion');
  return typeof value === 'number' ? value : undefined;
}

/** True once a peer has seeded the document. */
export function isDocxSeeded(doc: LoroDoc): boolean {
  return docxFormatVersion(doc) !== undefined;
}

function stringEntries(map: LoroMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of map.keys()) {
    const value = map.get(key);
    if (typeof value === 'string') out[key] = value;
  }
  return out;
}

function field(map: LoroMap, key: string): string {
  const value = map.get(key);
  return typeof value === 'string' ? value : '';
}

/** One block as stored, or null when it is not (or no longer) a block. */
export function readBlock(doc: LoroDoc, id: string): BlockRecord | null {
  const value = doc.getMap(DOCX_LORO_CONTAINERS.blocks).get(id);
  if (!(value instanceof LoroMap)) return null;
  const k = field(value, 'k');
  if (!k) return null;
  const record: BlockRecord = {
    id,
    k,
    p: field(value, 'p'),
    o: field(value, 'o'),
    a: field(value, 'a'),
    x: field(value, 'x'),
  };
  const text = value.get('t');
  if (text instanceof LoroText) record.t = text.toDelta() as DeltaOp[];
  else if (k === 'p') record.t = [];
  return record;
}

/** The whole shared state, for opening the document in the engine. */
export function readCollabState(doc: LoroDoc): CollabState {
  const blocks: BlockRecord[] = [];
  const map = doc.getMap(DOCX_LORO_CONTAINERS.blocks);
  for (const id of map.keys()) {
    const record = readBlock(doc, id);
    if (record) blocks.push(record);
  }
  return {
    parts: stringEntries(doc.getMap(DOCX_LORO_CONTAINERS.parts)),
    types: stringEntries(doc.getMap(DOCX_LORO_CONTAINERS.types)),
    rels: stringEntries(doc.getMap(DOCX_LORO_CONTAINERS.rels)),
    blocks,
  };
}

function writeBlock(doc: LoroDoc, record: BlockRecord) {
  const map = doc
    .getMap(DOCX_LORO_CONTAINERS.blocks)
    .setContainer(record.id, new LoroMap());
  map.set('k', record.k);
  map.set('p', record.p);
  map.set('o', record.o);
  map.set('a', record.a);
  map.set('x', record.x);
  if (record.t) {
    const text = map.setContainer('t', new LoroText());
    if (record.t.length) text.applyDelta(record.t);
  }
}

/** Writes a document's whole state (seeding or migrating) in one commit. */
export function writeCollabState(
  doc: LoroDoc,
  state: CollabState,
  origin: string = DOCX_ORIGINS.seed
) {
  configureDocxText(doc);
  for (const [container, entries] of [
    [DOCX_LORO_CONTAINERS.parts, state.parts],
    [DOCX_LORO_CONTAINERS.types, state.types],
    [DOCX_LORO_CONTAINERS.rels, state.rels],
  ] as const) {
    const map = doc.getMap(container);
    for (const [key, value] of Object.entries(entries)) map.set(key, value);
  }
  for (const record of state.blocks) writeBlock(doc, record);
  doc
    .getMap(DOCX_LORO_CONTAINERS.meta)
    .set('formatVersion', DOCX_FORMAT_VERSION);
  doc.commit({ origin });
}

/** The first format's state, for migrating it. */
export function readV1State(doc: LoroDoc): V1State {
  const blocks = stringEntries(doc.getMap(LEGACY_CONTAINERS.blocks));
  const keys = stringEntries(doc.getMap(LEGACY_CONTAINERS.order));
  const order = Object.entries(keys)
    .filter(([id]) => id in blocks)
    .sort(([ia, ka], [ib, kb]) =>
      ka < kb ? -1 : ka > kb ? 1 : ia < ib ? -1 : ia > ib ? 1 : 0
    )
    .map(([id]) => id);
  return {
    order,
    blocks,
    parts: stringEntries(doc.getMap(LEGACY_CONTAINERS.parts)),
  };
}

/** Empties the first format's containers once their content moved. */
export function clearV1(doc: LoroDoc) {
  for (const name of Object.values(LEGACY_CONTAINERS)) {
    const map = doc.getMap(name);
    for (const key of map.keys()) map.delete(key);
  }
}

/**
 * Writes the engine's changes into the shared containers (not committed).
 * `adjust` rewrites a text delta made against an older version of the text.
 */
export function writeChanges(
  doc: LoroDoc,
  changes: readonly Change[],
  adjust: (id: string, delta: DeltaOp[]) => DeltaOp[] = (_, d) => d
) {
  const blocks = doc.getMap(DOCX_LORO_CONTAINERS.blocks);
  for (const change of changes) {
    switch (change.t) {
      case 'block':
        writeBlock(doc, change.block);
        break;
      case 'fields': {
        const map = blocks.get(change.id);
        if (!(map instanceof LoroMap)) break;
        for (const [key, value] of Object.entries(change.fields))
          map.set(key, value);
        break;
      }
      case 'text': {
        const map = blocks.get(change.id);
        if (!(map instanceof LoroMap)) break;
        let text = map.get('t');
        if (!(text instanceof LoroText))
          text = map.setContainer('t', new LoroText());
        const delta = adjust(change.id, change.delta);
        if (delta.length) (text as LoroText).applyDelta(delta);
        break;
      }
      case 'remove':
        blocks.delete(change.id);
        break;
      case 'entry': {
        const map = doc.getMap(change.container);
        if (change.value === null) map.delete(change.key);
        else map.set(change.key, change.value);
        break;
      }
    }
  }
}

/** What other peers (or the shared undo history) changed, by event path. */
export type Touched = {
  blocks: Set<string>;
  /** `container\u0000key` of flat-map entries. */
  entries: Set<string>;
  /** Text deltas per block, in order. */
  text: Map<string, DeltaOp[][]>;
};

export function emptyTouched(): Touched {
  return { blocks: new Set(), entries: new Set(), text: new Map() };
}

const SEPARATOR = '\u0000';

/** Notes the blocks and entries a batch of events changed. */
export function collectTouched(
  events: ReadonlyArray<Pick<LoroEvent, 'path' | 'diff'>>,
  into: Touched
) {
  for (const event of events) {
    const [root, id, sub] = event.path;
    const diff = event.diff;
    if (root === DOCX_LORO_CONTAINERS.blocks) {
      if (id === undefined) {
        // Blocks added or removed.
        if (diff.type === 'map')
          for (const key of Object.keys(diff.updated)) into.blocks.add(key);
        continue;
      }
      into.blocks.add(String(id));
      if (sub === 't' && diff.type === 'text') {
        const list = into.text.get(String(id)) ?? [];
        list.push(diff.diff as DeltaOp[]);
        into.text.set(String(id), list);
      }
      continue;
    }
    if (
      typeof root === 'string' &&
      (FLAT as readonly string[]).includes(root) &&
      diff.type === 'map'
    ) {
      for (const key of Object.keys(diff.updated))
        into.entries.add(`${root}${SEPARATOR}${key}`);
    }
  }
}

/** The engine's view of what was touched: whole blocks and entries as they now are. */
export function remoteChanges(doc: LoroDoc, touched: Touched): RemoteChange[] {
  const out: RemoteChange[] = [];
  // Parents before children, so a new table's rows find it.
  const records: BlockRecord[] = [];
  for (const id of touched.blocks) {
    const record = readBlock(doc, id);
    if (record) records.push(record);
    else out.push({ t: 'remove', id });
  }
  const byId = new Map(records.map((r) => [r.id, r]));
  const depth = (r: BlockRecord) => {
    let d = 0;
    let parent = byId.get(r.p);
    while (parent && d < 64) {
      d++;
      parent = byId.get(parent.p);
    }
    return d;
  };
  records.sort((a, b) => depth(a) - depth(b));
  for (const block of records) out.push({ t: 'block', block });
  for (const entry of touched.entries) {
    const [container, key] = entry.split(SEPARATOR);
    const value = doc.getMap(container).get(key);
    out.push({
      t: 'entry',
      container,
      key,
      value: typeof value === 'string' ? value : null,
    });
  }
  return out;
}

/** Paragraph texts of the shared document in document order (tests, checks). */
export function sharedParagraphTexts(doc: LoroDoc): string[] {
  const { blocks } = readCollabState(doc);
  const children = new Map<string, BlockRecord[]>();
  for (const b of blocks) {
    const list = children.get(b.p) ?? [];
    list.push(b);
    children.set(b.p, list);
  }
  for (const list of children.values())
    list.sort((a, b) =>
      a.o < b.o ? -1 : a.o > b.o ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    );
  const out: string[] = [];
  const walk = (parent: string) => {
    for (const b of children.get(parent) ?? []) {
      if (b.k === 'p')
        out.push(
          (b.t ?? []).map((op) => ('insert' in op ? op.insert : '')).join('')
        );
      walk(b.id);
    }
  };
  walk('');
  return out;
}
