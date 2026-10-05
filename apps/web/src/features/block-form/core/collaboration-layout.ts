/**
 * A form's layout as a Loro document, so several editors can change it at
 * once and merge without losing each other's edits. The Rust codec in
 * `crates/forms/src/domain/collaboration.rs` reads and writes the same
 * schema; production documents are seeded there.
 *
 * Order lists hold position only: membership in the `sections` and
 * `questions` maps decides what exists, and a question's `sectionId`
 * decides where it lives. An id an order repeats counts once, at its first
 * place; one it lacks comes last, by id. A question whose section is gone
 * is left out.
 */
import { LoroDoc, LoroMap, LoroMovableList, LoroText } from 'loro-crdt';

/** The schema format this module reads and writes. */
export const FORMAT_VERSION = 1;

/** The document's top-level containers. */
export const LAYOUT_CONTAINERS = {
  /** A map holding `format`. */
  metadata: 'metadata',
  /** A movable list of section ids, in order. */
  sectionOrder: 'sectionOrder',
  /** A map from section id to a map of the section's fields. */
  sections: 'sections',
  /** A map from section id to a movable list of its question ids. */
  questionOrders: 'questionOrders',
  /** A map from question id to a map of the question's fields. */
  questions: 'questions',
} as const;

/** The schema format's key in the metadata map. */
export const FORMAT_KEY = 'format';
/** A section's kind, a plain string. */
export const KIND = 'kind';
/**
 * The section fields held as text; every other field but the kind is a
 * JSON string.
 */
export const SECTION_TEXT_FIELDS: readonly string[] = [
  'title',
  'description',
  'message',
];
/** A question's section, a plain string; the one source of its parent. */
export const SECTION_ID = 'sectionId';
/** The question field held as text; the others are plain values. */
export const HELP_TEXT = 'helpText';

const ID = 'id';
const QUESTIONS_FIELD = 'questions';

/** A question of the wire layout. */
export type CollaborativeQuestion = {
  id: string;
  column: string;
  helpText: string;
  required: boolean;
  widget: string | null;
};

/**
 * A section of the wire layout, by its fields: decoding a kind's fields is
 * the wire adapter's, so a kind this module does not know still round-trips.
 */
export type CollaborativeSection = {
  id: string;
  kind: string;
  questions?: readonly CollaborativeQuestion[];
  [field: string]: unknown;
};

/** The wire layout, every section in order. */
export type CollaborativeLayout = {
  sections: readonly CollaborativeSection[];
};

/** What is wrong with a layout document, or with a layout written into one. */
export type LayoutDocumentProblem =
  | { kind: 'missing-format' }
  | { kind: 'unsupported-format'; format: string }
  | { kind: 'malformed'; location: string; expected: string }
  | { kind: 'invalid-json'; location: string }
  | { kind: 'duplicate-section'; id: string }
  | { kind: 'duplicate-question'; id: string };

export class LayoutDocumentError extends Error {
  readonly problem: LayoutDocumentProblem;

  constructor(problem: LayoutDocumentProblem) {
    super(`Form layout document: ${JSON.stringify(problem)}`);
    this.name = 'LayoutDocumentError';
    this.problem = problem;
  }
}

/** A section as the document stores it: its kind, its other fields, its questions. */
type SectionRecord = {
  id: string;
  kind: string;
  fields: Map<string, unknown>;
  questions: readonly CollaborativeQuestion[] | null;
};

/** A new document holding `layout`, as a snapshot. Production seeds in Rust. */
export function seedLayout(layout: CollaborativeLayout): Uint8Array {
  const document = new LoroDoc();
  document.getMap(LAYOUT_CONTAINERS.metadata).set(FORMAT_KEY, FORMAT_VERSION);
  applyLayout(document, { sections: [] }, layout);
  document.commit();
  return document.export({ mode: 'snapshot' });
}

/** The layout `document` holds. Throws a {@link LayoutDocumentError}. */
export function readLayout(document: LoroDoc): CollaborativeLayout {
  checkFormat(document);
  const sections = document.getMap(LAYOUT_CONTAINERS.sections);
  const questionOrders = document.getMap(LAYOUT_CONTAINERS.questionOrders);
  const questions = document.getMap(LAYOUT_CONTAINERS.questions);

  const questionsBySection = new Map<
    string,
    Map<string, CollaborativeQuestion>
  >();
  for (const id of questions.keys()) {
    const location = `${LAYOUT_CONTAINERS.questions}.${id}`;
    const map = childMap(questions, id, location);
    if (!map) continue;
    const { sectionId, question } = readQuestion(map, id, location);
    const members = questionsBySection.get(sectionId) ?? new Map();
    members.set(id, question);
    questionsBySection.set(sectionId, members);
  }

  const sectionIds = orderedIds(
    document.getMovableList(LAYOUT_CONTAINERS.sectionOrder),
    LAYOUT_CONTAINERS.sectionOrder,
    'a section id',
    new Set(sections.keys())
  );
  return {
    sections: sectionIds.map((id) => {
      const location = `${LAYOUT_CONTAINERS.sections}.${id}`;
      const map = childMap(sections, id, location);
      if (!map) throw malformed(location, 'a map');
      const section = readSection(map, id, location);
      const orderLocation = `${LAYOUT_CONTAINERS.questionOrders}.${id}`;
      const order = childMovableList(questionOrders, id, orderLocation);
      if (!order) return section;
      const members = questionsBySection.get(id) ?? new Map();
      const questionIds = orderedIds(
        order,
        orderLocation,
        'a question id',
        new Set(members.keys())
      );
      return {
        ...section,
        questions: questionIds.flatMap((questionId) => {
          const question = members.get(questionId);
          return question ? [question] : [];
        }),
      };
    }),
  };
}

/**
 * Writes the edits from `previous` to `next` into `document`, leaving
 * whatever the two agree on alone so concurrent edits to it survive. An edit
 * to a section or question since deleted is dropped rather than recreating
 * it. The caller commits. Throws a {@link LayoutDocumentError}.
 */
export function applyLayout(
  document: LoroDoc,
  previous: CollaborativeLayout,
  next: CollaborativeLayout
): void {
  checkFormat(document);
  const previousRecords = sectionRecords(previous);
  const nextRecords = sectionRecords(next);
  const sections = document.getMap(LAYOUT_CONTAINERS.sections);
  const questionOrders = document.getMap(LAYOUT_CONTAINERS.questionOrders);
  const questions = document.getMap(LAYOUT_CONTAINERS.questions);
  const previousSections = new Map(
    previousRecords.map((section) => [section.id, section])
  );
  const nextSections = new Map(
    nextRecords.map((section) => [section.id, section])
  );

  for (const section of previousRecords) {
    if (nextSections.has(section.id)) continue;
    sections.delete(section.id);
    questionOrders.delete(section.id);
  }
  for (const section of nextRecords) {
    const location = `${LAYOUT_CONTAINERS.sections}.${section.id}`;
    const before = previousSections.get(section.id);
    if (!before) {
      const map = sections.setContainer(section.id, new LoroMap());
      map.set(KIND, section.kind);
      for (const [key, value] of section.fields) {
        writeSectionField(map, key, value, location);
      }
      if (section.questions) {
        questionOrders.setContainer(section.id, new LoroMovableList());
      }
      continue;
    }
    const map = childMap(sections, section.id, location);
    if (!map) continue;
    if (before.kind !== section.kind) map.set(KIND, section.kind);
    for (const [key, value] of section.fields) {
      if (
        !before.fields.has(key) ||
        !sameField(key, before.fields.get(key), value, location)
      ) {
        writeSectionField(map, key, value, location);
      }
    }
    for (const key of before.fields.keys()) {
      if (!section.fields.has(key)) map.delete(key);
    }
    if (!before.questions && section.questions) {
      questionOrders.setContainer(section.id, new LoroMovableList());
    }
    if (before.questions && !section.questions) {
      questionOrders.delete(section.id);
    }
  }
  reorder(
    document.getMovableList(LAYOUT_CONTAINERS.sectionOrder),
    previousRecords.map((section) => section.id),
    nextRecords.map((section) => section.id)
  );

  const previousQuestions = questionPlacements(previousRecords);
  const nextQuestions = questionPlacements(nextRecords);
  for (const id of previousQuestions.keys()) {
    if (!nextQuestions.has(id)) questions.delete(id);
  }
  for (const [id, { sectionId, question }] of nextQuestions) {
    const location = `${LAYOUT_CONTAINERS.questions}.${id}`;
    const before = previousQuestions.get(id);
    if (!before) {
      const map = questions.setContainer(id, new LoroMap());
      map.set(SECTION_ID, sectionId);
      writeText(map, HELP_TEXT, question.helpText, location);
      map.set('column', question.column);
      map.set('required', question.required);
      map.set('widget', question.widget);
      continue;
    }
    const map = childMap(questions, id, location);
    if (!map) continue;
    if (before.sectionId !== sectionId) map.set(SECTION_ID, sectionId);
    if (before.question.helpText !== question.helpText) {
      writeText(map, HELP_TEXT, question.helpText, location);
    }
    if (before.question.column !== question.column) {
      map.set('column', question.column);
    }
    if (before.question.required !== question.required) {
      map.set('required', question.required);
    }
    if (before.question.widget !== question.widget) {
      map.set('widget', question.widget);
    }
  }
  for (const section of nextRecords) {
    if (!section.questions) continue;
    const location = `${LAYOUT_CONTAINERS.questionOrders}.${section.id}`;
    const order = childMovableList(questionOrders, section.id, location);
    if (!order) continue;
    const previousOrder = previousSections.get(section.id)?.questions ?? [];
    reorder(
      order,
      previousOrder.map((question) => question.id),
      section.questions.map((question) => question.id)
    );
  }
}

function checkFormat(document: LoroDoc) {
  const format = document.getMap(LAYOUT_CONTAINERS.metadata).get(FORMAT_KEY);
  if (format === undefined) {
    throw new LayoutDocumentError({ kind: 'missing-format' });
  }
  if (typeof format !== 'number') {
    throw malformed(`${LAYOUT_CONTAINERS.metadata}.${FORMAT_KEY}`, 'a number');
  }
  if (format !== FORMAT_VERSION) {
    throw new LayoutDocumentError({
      kind: 'unsupported-format',
      format: String(format),
    });
  }
}

function sectionRecords(layout: CollaborativeLayout): SectionRecord[] {
  const sectionIds = new Set<string>();
  const questionIds = new Set<string>();
  return layout.sections.map((section) => {
    if (sectionIds.has(section.id)) {
      throw new LayoutDocumentError({
        kind: 'duplicate-section',
        id: section.id,
      });
    }
    sectionIds.add(section.id);
    for (const question of section.questions ?? []) {
      if (questionIds.has(question.id)) {
        throw new LayoutDocumentError({
          kind: 'duplicate-question',
          id: question.id,
        });
      }
      questionIds.add(question.id);
    }
    const fields = new Map<string, unknown>();
    for (const [key, value] of Object.entries(section)) {
      if (key === ID || key === KIND || key === QUESTIONS_FIELD) continue;
      if (value === undefined) continue;
      fields.set(key, value);
    }
    return {
      id: section.id,
      kind: section.kind,
      fields,
      questions: section.questions ?? null,
    };
  });
}

function questionPlacements(sections: readonly SectionRecord[]) {
  const placements = new Map<
    string,
    { sectionId: string; question: CollaborativeQuestion }
  >();
  for (const section of sections) {
    for (const question of section.questions ?? []) {
      placements.set(question.id, { sectionId: section.id, question });
    }
  }
  return placements;
}

function readSection(
  map: LoroMap,
  id: string,
  location: string
): CollaborativeSection {
  const kind = map.get(KIND);
  if (typeof kind !== 'string')
    throw malformed(`${location}.${KIND}`, 'a string');
  const section: CollaborativeSection = { id, kind };
  for (const key of map.keys()) {
    if (key === KIND) continue;
    const fieldLocation = `${location}.${key}`;
    const value = map.get(key);
    if (SECTION_TEXT_FIELDS.includes(key)) {
      if (!(value instanceof LoroText)) throw malformed(fieldLocation, 'text');
      section[key] = value.toString();
      continue;
    }
    if (typeof value !== 'string') {
      throw malformed(fieldLocation, 'a JSON string');
    }
    section[key] = parseJson(value, fieldLocation);
  }
  return section;
}

function readQuestion(map: LoroMap, id: string, location: string) {
  const sectionId = map.get(SECTION_ID);
  if (typeof sectionId !== 'string') {
    throw malformed(`${location}.${SECTION_ID}`, 'a section id');
  }
  const helpText = map.get(HELP_TEXT);
  if (!(helpText instanceof LoroText)) {
    throw malformed(`${location}.${HELP_TEXT}`, 'text');
  }
  const column = map.get('column');
  if (typeof column !== 'string') {
    throw malformed(`${location}.column`, 'a string');
  }
  const required = map.get('required');
  if (typeof required !== 'boolean') {
    throw malformed(`${location}.required`, 'a boolean');
  }
  const widget = map.get('widget');
  if (widget !== null && typeof widget !== 'string') {
    throw malformed(`${location}.widget`, 'a string or null');
  }
  const question: CollaborativeQuestion = {
    id,
    column,
    helpText: helpText.toString(),
    required,
    widget,
  };
  return { sectionId, question };
}

/** The ids `order` lists that are `members`, first places first, then the members it lacks by id. */
function orderedIds(
  order: LoroMovableList,
  location: string,
  expected: string,
  members: ReadonlySet<string>
): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (let index = 0; index < order.length; index++) {
    const id = order.get(index);
    if (typeof id !== 'string')
      throw malformed(`${location}.${index}`, expected);
    if (members.has(id) && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  const unordered = [...members].filter((id) => !seen.has(id)).sort();
  return [...ids, ...unordered];
}

/**
 * Turns `order` from `previous` into `next`: ids that left are deleted, ids
 * both hold are moved (the fewest, keeping the longest run already in
 * order), and new ids are inserted after their nearest predecessor. Ids
 * neither names, such as a collaborator's concurrent insert, stay put.
 */
function reorder(
  order: LoroMovableList,
  previous: readonly string[],
  next: readonly string[]
) {
  const previousRanks = new Map(previous.map((id, rank) => [id, rank]));
  const nextIds = new Set(next);

  for (let index = order.length - 1; index >= 0; index--) {
    const id = order.get(index);
    if (typeof id === 'string' && previousRanks.has(id) && !nextIds.has(id)) {
      order.delete(index, 1);
    }
  }

  const kept = next.filter(
    (id) => previousRanks.has(id) && position(order, id) !== undefined
  );
  const ranks = kept.map((id) => previousRanks.get(id) ?? 0);
  const stable = new Set(
    longestIncreasingRun(ranks).map((index) => kept[index])
  );
  const firstStable = kept.find((id) => stable.has(id));
  kept.forEach((id, index) => {
    if (stable.has(id)) return;
    const from = position(order, id);
    if (from === undefined) return;
    const predecessor = index > 0 ? kept[index - 1] : undefined;
    const anchorId = predecessor ?? firstStable;
    if (anchorId === undefined) return;
    const anchor = position(order, anchorId);
    if (anchor === undefined) return;
    const to = predecessor
      ? from < anchor
        ? anchor
        : anchor + 1
      : from < anchor
        ? anchor - 1
        : anchor;
    if (from !== to) order.move(from, to);
  });

  next.forEach((id, index) => {
    if (previousRanks.has(id)) return;
    let at = 0;
    for (let before = index - 1; before >= 0; before--) {
      const beforeId = next[before];
      const anchor =
        beforeId === undefined ? undefined : position(order, beforeId);
      if (anchor !== undefined) {
        at = anchor + 1;
        break;
      }
    }
    order.insert(at, id);
  });
}

/** The indexes of one longest strictly increasing subsequence of `ranks`. */
function longestIncreasingRun(ranks: readonly number[]): number[] {
  const lengths = ranks.map(() => 1);
  const predecessors: (number | undefined)[] = ranks.map(() => undefined);
  ranks.forEach((rank, index) => {
    for (let earlier = 0; earlier < index; earlier++) {
      const earlierRank = ranks[earlier] ?? 0;
      const earlierLength = lengths[earlier] ?? 1;
      if (earlierRank < rank && earlierLength + 1 > (lengths[index] ?? 1)) {
        lengths[index] = earlierLength + 1;
        predecessors[index] = earlier;
      }
    }
  });
  let cursor: number | undefined;
  lengths.forEach((length, index) => {
    if (cursor === undefined || length > (lengths[cursor] ?? 0)) cursor = index;
  });
  const run: number[] = [];
  while (cursor !== undefined) {
    run.push(cursor);
    cursor = predecessors[cursor];
  }
  return run.reverse();
}

function position(order: LoroMovableList, id: string): number | undefined {
  for (let index = 0; index < order.length; index++) {
    if (order.get(index) === id) return index;
  }
  return undefined;
}

function sameField(
  key: string,
  before: unknown,
  after: unknown,
  location: string
): boolean {
  if (SECTION_TEXT_FIELDS.includes(key)) return before === after;
  return (
    canonicalJson(before, `${location}.${key}`) ===
    canonicalJson(after, `${location}.${key}`)
  );
}

function writeSectionField(
  map: LoroMap,
  key: string,
  value: unknown,
  location: string
) {
  const fieldLocation = `${location}.${key}`;
  if (SECTION_TEXT_FIELDS.includes(key)) {
    if (typeof value !== 'string') throw malformed(fieldLocation, 'a string');
    writeText(map, key, value, location);
    return;
  }
  map.set(key, canonicalJson(value, fieldLocation));
}

/** Diffs `value` into the text under `key`, so concurrent edits to it merge. */
function writeText(map: LoroMap, key: string, value: string, location: string) {
  const existing = map.get(key);
  if (existing === undefined) {
    map.setContainer(key, new LoroText()).update(value);
    return;
  }
  if (!(existing instanceof LoroText)) {
    throw malformed(`${location}.${key}`, 'text');
  }
  existing.update(value);
}

function childMap(
  parent: LoroMap,
  key: string,
  location: string
): LoroMap | undefined {
  const child = parent.get(key);
  if (child === undefined) return undefined;
  if (!(child instanceof LoroMap)) throw malformed(location, 'a map');
  return child;
}

function childMovableList(
  parent: LoroMap,
  key: string,
  location: string
): LoroMovableList | undefined {
  const child = parent.get(key);
  if (child === undefined) return undefined;
  if (!(child instanceof LoroMovableList)) {
    throw malformed(location, 'a movable list');
  }
  return child;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `value` as JSON with every object's keys sorted, so equal values compare equal. */
function canonicalJson(value: unknown, location: string): string {
  const json = JSON.stringify(value, (_key, inner: unknown) =>
    isRecord(inner)
      ? Object.fromEntries(
          Object.entries(inner).sort(([left], [right]) =>
            left < right ? -1 : left > right ? 1 : 0
          )
        )
      : inner
  );
  if (json === undefined) throw malformed(location, 'a JSON value');
  return json;
}

function parseJson(json: string, location: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    throw new LayoutDocumentError({ kind: 'invalid-json', location });
  }
}

function malformed(location: string, expected: string) {
  return new LayoutDocumentError({ kind: 'malformed', location, expected });
}
