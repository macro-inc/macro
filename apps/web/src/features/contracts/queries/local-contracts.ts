import { makePersistedState } from '@app/lib/persistence';
import { fireAndForget } from '@core/util/fireAndForget';
import { err, errAsync, ok, type Result, ResultAsync } from 'neverthrow';
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
import { type Digest, sealEvents } from '../core/audit';
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

/** Where the browser-local snapshot is kept. */
export const LOCAL_CONTRACTS_STORAGE_KEY = 'macro:contracts:local:v1';
const CLOCK_INTERVAL_MS = 30_000;
const PDF_MAGIC = '%PDF-';
const TOKEN_ID_LENGTH = 12;

export type LocalContractsDeps = {
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  blobs: DocumentBlobs;
  changes: ChangeFeed;
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

function starterSnapshot(): ContractsSnapshot {
  return {
    databases: STARTER_DATABASES.map((database) => ({
      ...database,
      id: database.name.toLowerCase().replaceAll(' ', '-'),
    })),
    packets: [],
  };
}

function readSnapshot(
  storage: LocalContractsDeps['storage']
): ContractsSnapshot | undefined {
  const raw = storage.getItem(LOCAL_CONTRACTS_STORAGE_KEY);
  if (!raw) return undefined;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return undefined;
  }
  const parsed = contractsSnapshotSchema.safeParse(json);
  return parsed.success ? parsed.data : undefined;
}

function storageFailed(): ContractsError {
  return { kind: 'storage_failed' };
}

/** The store has no bytes for a document a packet refers to. */
class MissingDocument extends Error {}

/** Wait for work to finish either way, so the next write can start. */
async function settled(work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch {
    // The caller of the failed write reports it.
  }
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
  const state = createSignal<ContractsSnapshot>(starterSnapshot());
  const reload = state[1];
  const [snapshot, persist] = makePersistedState(state, {
    storages: {
      restore: () => readSnapshot(deps.storage),
      write: (value) =>
        deps.storage.setItem(
          LOCAL_CONTRACTS_STORAGE_KEY,
          JSON.stringify(value)
        ),
    },
  });

  const [now, setNow] = createSignal(deps.clock());
  const pdfs = new Map<string, Promise<PdfDocument>>();

  const lifecycle = (): LifecycleContext => ({
    now: deps.clock(),
    newId: deps.newId,
    newAccess: () => ({
      token: deps.newToken(),
      tokenId: `tok_${deps.newToken().slice(0, TOKEN_ID_LENGTH)}`,
    }),
  });

  // Writes run one at a time. Each starts from what storage holds, so a
  // change made by another tab while this one was idle is never overwritten.
  let queue: Promise<void> = Promise.resolve();
  function enqueue<T>(work: () => Promise<T>): Promise<T> {
    const previous = queue;
    const next = (async () => {
      await previous;
      return work();
    })();
    queue = settled(next);
    return next;
  }

  function commit(next: ContractsSnapshot) {
    persist(next);
    deps.changes.publish();
  }

  function latest(): ContractsSnapshot {
    return readSnapshot(deps.storage) ?? snapshot();
  }

  /** Apply a change to one packet, seal its new events, and store it. */
  async function writePacket(
    packetId: string | undefined,
    apply: (
      packet: Packet | undefined,
      context: LifecycleContext
    ) => Result<Packet, ContractsError>
  ): Promise<Result<Packet, ContractsError>> {
    const current = latest();
    const existing = current.packets.find((packet) => packet.id === packetId);
    const applied = apply(existing, lifecycle());
    if (applied.isErr()) return err(applied.error);

    const sealed = await sealEvents(applied.value, deps.digestText);
    const others = current.packets.filter((packet) => packet.id !== sealed.id);
    commit({ ...current, packets: [...others, sealed] });
    return ok(sealed);
  }

  function transition(
    packetId: string,
    apply: Transition
  ): ResultAsync<Packet, ContractsError> {
    const work = enqueue(() =>
      writePacket(packetId, (packet, context) => {
        if (!packet) return err({ kind: 'not_found' });
        return apply(packet, context);
      })
    );
    return ResultAsync.fromPromise(work, storageFailed).andThen(
      (result) => result
    );
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
  const unsubscribe = deps.changes.subscribe(() => {
    const stored = readSnapshot(deps.storage);
    if (stored) reload(stored);
  });
  onCleanup(() => {
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

  async function importPdf(
    file: File
  ): Promise<Result<PacketDocument, DocumentError>> {
    const bytes = await file.arrayBuffer();
    const header = new TextDecoder().decode(bytes.slice(0, PDF_MAGIC.length));
    if (header !== PDF_MAGIC) return err({ kind: 'not_pdf' });

    let pdf: PdfDocument;
    try {
      pdf = await deps.openPdf(bytes);
    } catch {
      return err({ kind: 'unreadable' });
    }

    const id = deps.newId();
    try {
      await deps.blobs.put(id, bytes);
    } catch {
      return err({ kind: 'storage_failed' });
    }
    pdfs.set(id, Promise.resolve(pdf));

    return ok({
      id,
      name: file.name.replace(/\.pdf$/i, ''),
      pageCount: pdf.pageCount,
      source: 'upload',
      sha256: await deps.digestBytes(bytes),
    });
  }

  function context(viewer: Accessor<Viewer>): ContractsData {
    return {
      viewer,
      now,
      databases: () => snapshot().databases,
      packets: () => snapshot().packets,

      createDatabase(name) {
        const work = enqueue(async () => {
          const current = latest();
          const database: ContractDatabase = {
            id: deps.newId(),
            name,
            color: nextDatabaseColor(current.databases),
          };
          commit({ ...current, databases: [...current.databases, database] });
          return database;
        });
        return ResultAsync.fromPromise(work, storageFailed);
      },

      importDocument: (file) =>
        ResultAsync.fromPromise(
          importPdf(file),
          (): DocumentError => ({ kind: 'unreadable' })
        ).andThen((result) => result),
      openDocument,

      createDraft(input) {
        const work = enqueue(() =>
          writePacket(undefined, (_, lifecycleContext) =>
            createDraft(input, lifecycleContext)
          )
        );
        return ResultAsync.fromPromise(work, storageFailed).andThen(
          (result) => result
        );
      },
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
        ),

      deleteDraft(packetId) {
        const work = enqueue(async () => {
          const current = latest();
          commit({
            ...current,
            packets: current.packets.filter((packet) => packet.id !== packetId),
          });
        });
        return ResultAsync.fromPromise(work, storageFailed);
      },

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

    function act(apply: Transition): ResultAsync<Packet, ContractsError> {
      const current = session();
      if (current.t !== 'ready') return errAsync({ kind: 'not_in_flight' });
      return transition(current.packet.id, apply);
    }

    return {
      session,
      openDocument,
      recordView: (userAgent) =>
        act((packet, lifecycleContext) =>
          recordView(packet, token(), userAgent, lifecycleContext)
        ).map(() => undefined),
      acceptDisclosure: () =>
        act((packet, lifecycleContext) =>
          acceptDisclosure(packet, token(), lifecycleContext)
        ).map(() => undefined),
      sign: (input) =>
        act((packet, lifecycleContext) =>
          signPacket(packet, token(), input, lifecycleContext)
        ),
      decline: (reason) =>
        act((packet, lifecycleContext) =>
          declinePacket(packet, token(), reason, lifecycleContext)
        ).map(() => undefined),
    };
  }

  return { context, signing };
}
