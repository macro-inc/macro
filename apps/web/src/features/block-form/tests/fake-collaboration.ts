import { LoroDoc } from 'loro-crdt';
import { errAsync, okAsync, type ResultAsync } from 'neverthrow';
import { createSignal } from 'solid-js';
import type {
  FormEditorPeer,
  FormLayoutCollaboration,
  FormLayoutConnection,
  FormLayoutSave,
  FormLayoutStatus,
  FormWriteFailure,
} from '../context/form-context';
import {
  applyLayout,
  type CollaborativeLayout,
  readLayout,
  seedLayout,
} from '../core/collaboration-layout';
import type {
  FormBookingTarget,
  FormLayout,
  GateRules,
  QuestionWidget,
  SectionKind,
} from '../core/form-model';
import type { FormSelection } from '../core/form-presence';
import { toLayoutDocument } from '../queries/form-detail';

const SECTION_KINDS: readonly SectionKind[] = ['questions', 'gate', 'booking'];

const WIDGETS: readonly QuestionWidget[] = [
  'short',
  'paragraph',
  'datetime',
  'date',
  'url',
  'file',
  'choice',
  'dropdown',
  'checkboxes',
];

const text = (value: unknown) => (typeof value === 'string' ? value : '');

/** JSON with every object's keys sorted, as the documents store it. */
const canonical = (value: unknown) =>
  JSON.stringify(value, (_key, inner: unknown) =>
    typeof inner === 'object' && inner !== null && !Array.isArray(inner)
      ? Object.fromEntries(
          Object.entries(inner).sort(([left], [right]) =>
            left.localeCompare(right)
          )
        )
      : inner
  );

function bookingTargetOf(value: unknown): FormBookingTarget | null {
  if (typeof value !== 'object' || value === null) return null;
  if (!('profileId' in value) || !('eventTypeId' in value)) return null;
  const { profileId, eventTypeId } = value;
  return typeof profileId === 'string' && typeof eventTypeId === 'string'
    ? { profileId, eventTypeId }
    : null;
}

/**
 * The shared layout of one form as two editors hold it: this one, through
 * the port the builder gets, and another, through `remote`. Both are real
 * Loro documents written by the production codec, so concurrent edits merge
 * exactly as they do on the sync stack. Online, each edit reaches the other
 * copy at once; offline, edits wait on their own side until `reconnect`.
 */
export function createFakeCollaboration(
  initial: FormLayout,
  options: { status?: FormLayoutStatus } = {}
) {
  // The documents store rules as JSON; the copies written are read back as
  // the same objects so the layouts compare by value.
  const knownRules: GateRules[] = [];
  const remember = (layout: FormLayout) => {
    for (const section of layout.sections)
      if (section.gateRules) knownRules.push(section.gateRules);
  };
  const rulesOf = (value: unknown): GateRules | null => {
    const json = canonical(value);
    return knownRules.find((rules) => canonical(rules) === json) ?? null;
  };

  function decode(layout: CollaborativeLayout): FormLayout {
    return {
      sections: layout.sections.map((section) => {
        const kind =
          SECTION_KINDS.find((known) => known === section.kind) ?? 'questions';
        return {
          id: section.id,
          kind,
          title: text(section.title),
          description: text(section.description),
          gateRules: kind === 'gate' ? rulesOf(section.rules) : null,
          gateMessage: text(section.message),
          bookingTarget:
            kind === 'booking' ? bookingTargetOf(section.target) : null,
          questions: (section.questions ?? []).map((question) => ({
            id: question.id,
            columnId: question.column,
            helpText: question.helpText,
            required: question.required,
            widget:
              WIDGETS.find((widget) => widget === question.widget) ?? null,
          })),
        };
      }),
    };
  }

  remember(initial);
  const seed = seedLayout(toLayoutDocument(initial));
  const mine = LoroDoc.fromSnapshot(seed);
  const theirs = LoroDoc.fromSnapshot(seed);
  const read = (document: LoroDoc) => decode(readLayout(document));

  const [status, setStatus] = createSignal<FormLayoutStatus>(
    options.status ?? { kind: 'ready' }
  );
  const [layout, setLayout] = createSignal<FormLayout | undefined>(read(mine));
  const [online, setOnline] = createSignal(true);
  const [save, setSave] = createSignal<FormLayoutSave>('saved');
  const [publicationError, setPublicationError] = createSignal<string>();
  const [peers, setPeers] = createSignal<FormEditorPeer[]>([]);

  /** Every layout this editor wrote, as the shared document read after it. */
  const written: FormLayout[] = [];
  const selections: (FormSelection | undefined)[] = [];
  let flushes = 0;
  let answerFlush: (() => ResultAsync<void, FormWriteFailure>) | undefined;

  function exchange() {
    if (!online()) return;
    theirs.import(mine.export({ mode: 'update', from: theirs.oplogVersion() }));
    mine.import(theirs.export({ mode: 'update', from: mine.oplogVersion() }));
    setLayout(read(mine));
    setSave('saved');
  }

  const collaboration: FormLayoutCollaboration = {
    status,
    layout: () => (status().kind === 'loading' ? undefined : layout()),
    save,
    connection: (): FormLayoutConnection =>
      online() ? 'connected' : 'offline',
    apply: (previous, next) => {
      if (status().kind !== 'ready')
        throw new Error('The form layout is not open for editing.');
      remember(previous);
      remember(next);
      applyLayout(mine, toLayoutDocument(previous), toLayoutDocument(next));
      mine.commit();
      setLayout(read(mine));
      if (!online()) setSave('unsaved');
      exchange();
      written.push(read(mine));
    },
    flush: () => {
      flushes += 1;
      if (answerFlush) return answerFlush();
      return online()
        ? okAsync(undefined)
        : errAsync({ message: 'You’re offline.' });
    },
    publicationError,
    peers,
    select: (selection) => selections.push(selection),
  };

  return {
    collaboration,
    written,
    selections,
    flushes: () => flushes,
    /** Answer the next flushes this way instead. */
    answerFlushes: (answer: () => ResultAsync<void, FormWriteFailure>) => {
      answerFlush = answer;
    },
    /** The other editor's copy of the layout. */
    theirs: () => read(theirs),
    /** The other editor changes the layout, from what they hold. */
    remote: (edit: (current: FormLayout) => FormLayout) => {
      const before = read(theirs);
      const after = edit(before);
      remember(after);
      applyLayout(theirs, toLayoutDocument(before), toLayoutDocument(after));
      theirs.commit();
      exchange();
    },
    goOffline: () => setOnline(false),
    reconnect: () => {
      setOnline(true);
      exchange();
    },
    setStatus,
    setPublicationError,
    setPeers,
  };
}

export type FakeCollaboration = ReturnType<typeof createFakeCollaboration>;
