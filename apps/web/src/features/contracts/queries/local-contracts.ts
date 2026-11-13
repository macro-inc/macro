import { fireAndForget } from '@core/util/fireAndForget';
import { err, errAsync, ok, Result, ResultAsync } from 'neverthrow';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import type {
  ContractsData,
  ContractsError,
  DocumentError,
  PdfDocument,
  SigningContext,
  SigningSession,
  Viewer,
} from '../context/contracts-context';
import { type Digest, firstBrokenEvent, sealEvents } from '../core/audit';
import {
  type ContractDatabase,
  nextDatabaseColor,
  STARTER_DATABASES,
} from '../core/database';
import {
  acceptDisclosure,
  createDraft,
  declinePacket,
  expireIfDue,
  type LifecycleContext,
  markSignedOffline,
  type PacketError,
  recordView,
  remindPending,
  replaceDocument,
  sendPacket,
  setFields,
  signPacket,
  voidPacket,
} from '../core/lifecycle';
import {
  type Packet,
  type PacketDocument,
  recipientForToken,
} from '../core/packet';
import { isInFlight, packetStatus } from '../core/status';
import type { ChangeFeed } from './change-feed';
import type { DocumentBlobs } from './document-blobs';
import {
  type ContractsSnapshot,
  contractsSnapshotSchema,
} from './packet-schema';

/** Every account's snapshot is stored under this prefix plus its scope. */
const STORAGE_KEY_PREFIX = 'macro:contracts:local:v1:';
const CLOCK_INTERVAL_MS = 30_000;
const PDF_MAGIC = '%PDF-';
const TOKEN_ID_LENGTH = 12;

/** Where one account's snapshot is kept in this browser. */
export function localContractsStorageKey(scope: string): string {
  return `${STORAGE_KEY_PREFIX}${scope}`;
}

type SnapshotStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type LocalContractsDeps = {
  storage: SnapshotStorage;
  /** The key of this account's snapshot; see `localContractsStorageKey`. */
  storageKey: string;
  blobs: DocumentBlobs;
  changes: ChangeFeed;
  /**
   * Run `work` while no other store, in this tab or another, is inside its
   * own `exclusive` call. Every write reads, changes, and stores inside one.
   */
  exclusive<T>(work: () => Promise<T>): Promise<T>;
  openPdf(bytes: ArrayBuffer): Promise<PdfDocument>;
  digestText: Digest;
  digestBytes(bytes: ArrayBuffer): Promise<string>;
  clock(): string;
  newId(): string;
  newToken(): string;
  /** The link a recipient opens for a signing token. */
  signingUrl(token: string): string;
};

export type LocalContracts = {
  context(viewer: Accessor<Viewer>): ContractsData;
  signing(token: Accessor<string>): SigningContext;
};

type Transition = (
  packet: Packet,
  context: LifecycleContext
) => Result<Packet, PacketError>;

type Stored =
  | { t: 'empty' }
  | { t: 'ok'; snapshot: ContractsSnapshot }
  /** Something is stored that this version cannot read. It is left alone. */
  | { t: 'unreadable' };

type Change<T> = (
  current: ContractsSnapshot
) => Promise<Result<{ next: ContractsSnapshot; value: T }, ContractsError>>;

function starterSnapshot(): ContractsSnapshot {
  return {
    databases: STARTER_DATABASES.map((database) => ({
      ...database,
      id: database.name.toLowerCase().replaceAll(' ', '-'),
    })),
    packets: [],
  };
}

const parseJson = Result.fromThrowable(
  (raw: string): unknown => JSON.parse(raw),
  () => undefined
);

function readStored(storage: Pick<Storage, 'getItem'>, key: string): Stored {
  const raw = Result.fromThrowable(
    () => storage.getItem(key),
    () => undefined
  )();
  if (raw.isErr()) return { t: 'unreadable' };
  if (raw.value === null) return { t: 'empty' };

  const json = parseJson(raw.value);
  if (json.isErr()) return { t: 'unreadable' };
  const parsed = contractsSnapshotSchema.safeParse(json.value);
  return parsed.success
    ? { t: 'ok', snapshot: parsed.data }
    : { t: 'unreadable' };
}

/** Store the snapshot, reporting a full or blocked storage as a failure. */
function writeStored(
  storage: SnapshotStorage,
  key: string,
  snapshot: ContractsSnapshot
): Result<void, ContractsError> {
  return Result.fromThrowable(
    () => storage.setItem(key, JSON.stringify(snapshot)),
    storageFailed
  )();
}

/**
 * The scope of the account whose stored packets hold this signing token, so a
 * signing link opens without knowing who sent it.
 */
export function scopeForSigningToken(
  storage: Pick<Storage, 'length' | 'key' | 'getItem'>,
  token: string
): string | undefined {
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(STORAGE_KEY_PREFIX)) continue;

    const stored = readStored(storage, key);
    if (stored.t !== 'ok') continue;
    const held = stored.snapshot.packets.some((packet) =>
      recipientForToken(packet, token)
    );
    if (held) return key.slice(STORAGE_KEY_PREFIX.length);
  }
  return undefined;
}

function storageFailed(): ContractsError {
  return { kind: 'storage_failed' };
}

function unreadable(): DocumentError {
  return { kind: 'unreadable' };
}

/** The store has no bytes for a document a packet refers to. */
class MissingDocument extends Error {}

function referencedDocumentIds(snapshot: ContractsSnapshot): Set<string> {
  return new Set(
    snapshot.packets.flatMap((packet) =>
      packet.documents.map((document) => document.id)
    )
  );
}

/**
 * Contracts kept entirely in this browser: packets in `storage`, document
 * bytes in `blobs`. It runs the same lifecycle the server engine will, so the
 * workspace and the signing page work end to end before that engine exists.
 * Nothing leaves the browser: no email is sent and links open only here.
 *
 * Create it under a Solid owner; it stops its clock and change feed on cleanup.
 */
export function createLocalContracts(deps: LocalContractsDeps): LocalContracts {
  const initial = readStored(deps.storage, deps.storageKey);
  const [snapshot, setSnapshot] = createSignal<ContractsSnapshot>(
    initial.t === 'ok' ? initial.snapshot : starterSnapshot()
  );
  const [loadFailed, setLoadFailed] = createSignal(initial.t === 'unreadable');
  const [now, setNow] = createSignal(deps.clock());
  const pdfs = new Map<string, Promise<PdfDocument>>();
  // Set when the owner is disposed, as it is when the account signs out.
  let closed = false;

  const lifecycle = (): LifecycleContext => ({
    now: deps.clock(),
    newId: deps.newId,
    newAccess: () => ({
      token: deps.newToken(),
      tokenId: `tok_${deps.newToken().slice(0, TOKEN_ID_LENGTH)}`,
    }),
  });

  /** Take what storage holds now as this store's view of it. */
  function refresh(): Stored {
    const stored = readStored(deps.storage, deps.storageKey);
    setLoadFailed(stored.t === 'unreadable');
    if (stored.t === 'ok') setSnapshot(stored.snapshot);
    return stored;
  }

  /**
   * Change the stored snapshot. The change starts from what storage holds,
   * inside the exclusive section, so no store overwrites another's write. A
   * snapshot that cannot be read is never replaced, and a write the browser
   * refuses is an error: nothing is shown or announced as saved.
   */
  function mutate<T>(change: Change<T>): ResultAsync<T, ContractsError> {
    const work = deps.exclusive(
      async (): Promise<Result<T, ContractsError>> => {
        // A write still waiting when its store closed belongs to a session
        // that has ended; it is dropped rather than applied behind it.
        if (closed) return err(storageFailed());
        const stored = refresh();
        if (stored.t === 'unreadable') return err(storageFailed());

        const current = stored.t === 'ok' ? stored.snapshot : starterSnapshot();
        const changed = await change(current);
        if (changed.isErr()) return err(changed.error);
        if (changed.value.next === current) return ok(changed.value.value);

        const written = writeStored(
          deps.storage,
          deps.storageKey,
          changed.value.next
        );
        if (written.isErr()) return err(written.error);

        setSnapshot(changed.value.next);
        deps.changes.publish();
        return ok(changed.value.value);
      }
    );
    return ResultAsync.fromPromise(work, storageFailed).andThen(
      (result) => result
    );
  }

  /** Apply a change to one packet, seal its new events, and store it. */
  function writePacket(
    packetId: string | undefined,
    apply: (
      packet: Packet | undefined,
      context: LifecycleContext
    ) => Result<Packet, ContractsError>
  ): ResultAsync<Packet, ContractsError> {
    return mutate(async (current) => {
      const existing = current.packets.find((packet) => packet.id === packetId);
      const applied = apply(existing, lifecycle());
      if (applied.isErr()) return err(applied.error);
      if (applied.value === existing) {
        return ok({ next: current, value: existing });
      }

      const sealed = await sealEvents(applied.value, deps.digestText);
      const packets = existing
        ? current.packets.map((packet) =>
            packet.id === sealed.id ? sealed : packet
          )
        : [...current.packets, sealed];
      return ok({ next: { ...current, packets }, value: sealed });
    });
  }

  function transition(
    packetId: string,
    apply: Transition
  ): ResultAsync<Packet, ContractsError> {
    return writePacket(packetId, (packet, context) => {
      if (!packet) return err({ kind: 'not_found' });
      return apply(packet, context);
    });
  }

  /** Delete stored bytes that no stored packet refers to. */
  async function dropUnreferenced(
    documentIds: readonly string[]
  ): Promise<void> {
    const stored = readStored(deps.storage, deps.storageKey);
    // Without a readable list of packets, nothing is known to be unused.
    if (stored.t === 'unreadable') return;
    const referenced =
      stored.t === 'ok'
        ? referencedDocumentIds(stored.snapshot)
        : new Set<string>();
    for (const documentId of documentIds) {
      if (referenced.has(documentId)) continue;
      pdfs.delete(documentId);
      // Bytes left behind cost space, nothing else; the packet change stands.
      await ResultAsync.fromPromise(
        deps.blobs.delete(documentId),
        () => undefined
      );
    }
  }

  /** Record every signing window that closed since the last look. */
  function recordExpiries() {
    const due = snapshot().packets.filter(
      (packet) => expireIfDue(packet, lifecycle()) !== packet
    );
    for (const packet of due) {
      fireAndForget(
        transition(packet.id, (current, context) =>
          ok(expireIfDue(current, context))
        ),
        'contracts.expire'
      );
    }
  }

  const clock = setInterval(() => {
    setNow(deps.clock());
    recordExpiries();
  }, CLOCK_INTERVAL_MS);
  const unsubscribe = deps.changes.subscribe(refresh);
  onCleanup(() => {
    closed = true;
    clearInterval(clock);
    unsubscribe();
  });
  recordExpiries();

  async function loadPdf(documentId: string): Promise<PdfDocument> {
    const bytes = await deps.blobs.get(documentId);
    if (!bytes) throw new MissingDocument();
    return deps.openPdf(bytes);
  }

  function openDocument(
    documentId: string
  ): ResultAsync<PdfDocument, DocumentError> {
    const opening = pdfs.get(documentId) ?? loadPdf(documentId);
    pdfs.set(documentId, opening);

    return ResultAsync.fromPromise(opening, (error): DocumentError => {
      // A failed load is not cached, so opening again retries it.
      pdfs.delete(documentId);
      return {
        kind: error instanceof MissingDocument ? 'missing' : 'unreadable',
      };
    });
  }

  function storePdf(
    file: File,
    bytes: ArrayBuffer,
    pdf: PdfDocument
  ): ResultAsync<PacketDocument, DocumentError> {
    const id = deps.newId();
    return ResultAsync.fromPromise(deps.digestBytes(bytes), unreadable)
      .andThen((sha256) =>
        ResultAsync.fromPromise(
          deps.blobs.put(id, bytes),
          (): DocumentError => ({ kind: 'storage_failed' })
        ).map(() => sha256)
      )
      .map((sha256): PacketDocument => {
        pdfs.set(id, Promise.resolve(pdf));
        return {
          id,
          name: file.name.replace(/\.pdf$/i, ''),
          pageCount: pdf.pageCount,
          source: 'upload',
          sha256,
        };
      });
  }

  function importPdf(file: File): ResultAsync<PacketDocument, DocumentError> {
    return ResultAsync.fromPromise(file.arrayBuffer(), unreadable).andThen(
      (bytes) => {
        const header = new TextDecoder().decode(
          bytes.slice(0, PDF_MAGIC.length)
        );
        if (header !== PDF_MAGIC) {
          return errAsync<PacketDocument, DocumentError>({ kind: 'not_pdf' });
        }
        return ResultAsync.fromPromise(deps.openPdf(bytes), unreadable).andThen(
          (pdf) => storePdf(file, bytes, pdf)
        );
      }
    );
  }

  function context(viewer: Accessor<Viewer>): ContractsData {
    return {
      viewer,
      now,
      loadFailed,
      databases: () => snapshot().databases,
      packets: () => snapshot().packets,

      createDatabase: (name) =>
        mutate(async (current) => {
          const database: ContractDatabase = {
            id: deps.newId(),
            name,
            color: nextDatabaseColor(current.databases),
          };
          return ok({
            next: { ...current, databases: [...current.databases, database] },
            value: database,
          });
        }),

      importDocument: importPdf,
      openDocument,
      discardDocument: (documentId) =>
        ResultAsync.fromSafePromise(dropUnreferenced([documentId])),

      createDraft: (input) =>
        writePacket(undefined, (_, lifecycleContext) =>
          createDraft(input, lifecycleContext)
        ),
      saveFields: (packetId, fields) =>
        transition(packetId, (packet, lifecycleContext) =>
          setFields(packet, fields, lifecycleContext)
        ),
      send: (packetId) => transition(packetId, sendPacket),
      remind: (packetId) => transition(packetId, remindPending),
      voidPacket: (packetId, reason) =>
        transition(packetId, (packet, lifecycleContext) =>
          voidPacket(packet, reason, lifecycleContext)
        ),
      markSignedOffline: (packetId) =>
        transition(packetId, (packet, lifecycleContext) =>
          markSignedOffline(packet, viewer().name, lifecycleContext)
        ),

      replaceDocument: (packetId, documentId, replacement) =>
        transition(packetId, (packet, lifecycleContext) =>
          replaceDocument(packet, documentId, replacement, lifecycleContext)
        ).andThen((packet) =>
          ResultAsync.fromSafePromise(dropUnreferenced([documentId])).map(
            () => packet
          )
        ),

      deleteDraft: (packetId) =>
        mutate<PacketDocument[]>(async (current) => {
          const packet = current.packets.find((each) => each.id === packetId);
          if (!packet) return err({ kind: 'not_found' });
          if (packetStatus(packet, deps.clock()) !== 'draft') {
            return err({ kind: 'not_draft' });
          }
          const packets = current.packets.filter((each) => each !== packet);
          return ok({
            next: { ...current, packets },
            value: packet.documents,
          });
        }).andThen((documents) =>
          ResultAsync.fromSafePromise(
            dropUnreferenced(documents.map((document) => document.id))
          )
        ),

      verifyLog: async (packet) =>
        (await firstBrokenEvent(packet.events, deps.digestText)) === undefined,

      signingUrl: deps.signingUrl,
    };
  }

  function signing(token: Accessor<string>): SigningContext {
    const session = (): SigningSession => {
      for (const packet of snapshot().packets) {
        const recipient = recipientForToken(packet, token());
        if (!recipient) continue;
        if (!isInFlight(packetStatus(packet, now()))) break;
        return { t: 'ready', packet, recipient };
      }
      return { t: 'unavailable' };
    };

    /**
     * Apply a signer's action. The link is read once, here: the packet it
     * selects and the signer the write acts for are always the same link's.
     */
    function act(
      apply: (
        packet: Packet,
        signerToken: string,
        context: LifecycleContext
      ) => Result<Packet, PacketError>
    ): ResultAsync<Packet, ContractsError> {
      const signerToken = token();
      const current = session();
      if (current.t !== 'ready') return errAsync({ kind: 'not_in_flight' });
      return transition(current.packet.id, (packet, lifecycleContext) =>
        apply(packet, signerToken, lifecycleContext)
      );
    }

    return {
      session,
      openDocument,
      recordView: (userAgent) =>
        act((packet, signerToken, lifecycleContext) =>
          recordView(packet, signerToken, userAgent, lifecycleContext)
        ).map(() => undefined),
      acceptDisclosure: () =>
        act((packet, signerToken, lifecycleContext) =>
          acceptDisclosure(packet, signerToken, lifecycleContext)
        ).map(() => undefined),
      sign: (input) =>
        act((packet, signerToken, lifecycleContext) =>
          signPacket(packet, signerToken, input, lifecycleContext)
        ),
      decline: (reason) =>
        act((packet, signerToken, lifecycleContext) =>
          declinePacket(packet, signerToken, reason, lifecycleContext)
        ).map(() => undefined),
    };
  }

  return { context, signing };
}
