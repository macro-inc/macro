import type { ResultAsync } from 'neverthrow';
import { type Accessor, createContext, useContext } from 'solid-js';
import type { ContractDatabase } from '../core/database';
import type { DraftInput, PacketError, SigningInput } from '../core/lifecycle';
import type {
  Packet,
  PacketDocument,
  PacketField,
  PacketOwner,
  Recipient,
} from '../core/packet';

/** A PDF open for display. Pages are zero-based. */
export type PdfDocument = {
  pageCount: number;
  /** Width divided by height of a page, for laying it out before it paints. */
  pageAspectRatio(page: number): Promise<number>;
  /**
   * Paint a page into a canvas at this CSS width. Paints of one document run
   * one at a time, and one that is no longer `wanted` when its turn comes is
   * skipped without touching the canvas.
   */
  renderPage(
    page: number,
    canvas: HTMLCanvasElement,
    cssWidth: number,
    wanted: () => boolean
  ): Promise<void>;
  /** The words on a page in reading order, for people who cannot see it. */
  pageText(page: number): Promise<string>;
};

export type DocumentError =
  | { kind: 'not_pdf' }
  | { kind: 'unreadable' }
  | { kind: 'missing' }
  | { kind: 'storage_failed' };

export type ContractsError =
  | PacketError
  | { kind: 'not_found' }
  | { kind: 'storage_failed' };

export type Viewer = PacketOwner & { email: string };

/** What the Contracts workspace needs from its host. */
export type ContractsContext = {
  viewer: Accessor<Viewer>;
  /** The current time, advancing so statuses such as Expired stay true. */
  now: Accessor<string>;
  /**
   * The stored packets could not be read. Nothing is shown and every change
   * is refused, so whatever is stored is not replaced.
   */
  loadFailed: Accessor<boolean>;
  databases: Accessor<readonly ContractDatabase[]>;
  packets: Accessor<readonly Packet[]>;

  createDatabase(name: string): ResultAsync<ContractDatabase, ContractsError>;
  /** Store a PDF and describe it. Other formats are refused. */
  importDocument(file: File): ResultAsync<PacketDocument, DocumentError>;
  openDocument(documentId: string): ResultAsync<PdfDocument, DocumentError>;
  /** Forget an imported document that no packet ended up using. */
  discardDocument(documentId: string): ResultAsync<void, never>;

  createDraft(input: DraftInput): ResultAsync<Packet, ContractsError>;
  saveFields(
    packetId: string,
    fields: PacketField[]
  ): ResultAsync<Packet, ContractsError>;
  send(packetId: string): ResultAsync<Packet, ContractsError>;
  remind(packetId: string): ResultAsync<Packet, ContractsError>;
  voidPacket(
    packetId: string,
    reason: string
  ): ResultAsync<Packet, ContractsError>;
  markSignedOffline(packetId: string): ResultAsync<Packet, ContractsError>;
  replaceDocument(
    packetId: string,
    documentId: string,
    replacement: PacketDocument
  ): ResultAsync<Packet, ContractsError>;
  /**
   * Fold one packet into another and remove the one folded in. The target
   * keeps both packets' documents, recipients, fields, and databases.
   */
  mergePackets(
    targetId: string,
    sourceId: string
  ): ResultAsync<Packet, ContractsError>;
  /** Remove a packet that was never sent, and its documents. */
  deleteDraft(packetId: string): ResultAsync<void, ContractsError>;
  /** Whether every entry of the packet's audit log follows from the last. */
  verifyLog(packet: Packet): Promise<boolean>;

  /** The link a recipient opens to sign. */
  signingUrl(token: string): string;

  /** Put text on the clipboard; resolves `false` when the browser refuses. */
  copyText(text: string): Promise<boolean>;
  /** Show a signing link to the viewer, who is one of its signers. */
  openSigning(token: string): void;
};

/** The packets and documents themselves, without the host's capabilities. */
export type ContractsData = Omit<ContractsContext, 'copyText' | 'openSigning'>;

const Context = createContext<ContractsContext>();
export const ContractsProvider = Context.Provider;

export function useContractsContext(): ContractsContext {
  const context = useContext(Context);
  if (!context) throw new Error('ContractsProvider is required');
  return context;
}

/** The signing link's state as its holder sees it. */
export type SigningSession =
  | { t: 'loading' }
  /** The link is unknown, used, voided, expired, or not yet this signer's turn. */
  | { t: 'unavailable' }
  | { t: 'ready'; packet: Packet; recipient: Recipient };

/** What the public signing page needs. It never requires a Macro account. */
export type SigningContext = {
  session: Accessor<SigningSession>;
  openDocument(documentId: string): ResultAsync<PdfDocument, DocumentError>;
  recordView(userAgent: string): ResultAsync<void, ContractsError>;
  acceptDisclosure(): ResultAsync<void, ContractsError>;
  sign(input: SigningInput): ResultAsync<Packet, ContractsError>;
  decline(reason: string): ResultAsync<void, ContractsError>;
};

const SigningContextValue = createContext<SigningContext>();
export const SigningProvider = SigningContextValue.Provider;

export function useSigningContext(): SigningContext {
  const context = useContext(SigningContextValue);
  if (!context) throw new Error('SigningProvider is required');
  return context;
}
