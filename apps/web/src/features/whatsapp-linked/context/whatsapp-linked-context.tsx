import type { ResultAsync } from 'neverthrow';
import {
  type Accessor,
  createContext,
  type ParentProps,
  useContext,
} from 'solid-js';
import type { WhatsAppAccount } from '../core/account';
import type { AdoptFailure } from '../core/adopt';
import type { WhatsAppGroup } from '../core/group';
import type { PairingStep, PasskeyChallenge } from '../core/pairing';

/** A server read as the WhatsApp page needs it; `data` is set once loaded. */
export type SourceRead<Value> = {
  readonly isPending: boolean;
  readonly isError: boolean;
  readonly data: Value | undefined;
  refetch: () => void;
};

/** A pairing to show; a resumed one learns its deadline from the poll. */
export type StartedPairing = { pairingId: string; expiresAt?: string };

/** One polled read of a pairing. */
export type PairingRead = { step: PairingStep; expiresAt: string };

/** What the desktop authenticator asks the dialog to show. */
export type PasskeyEvent =
  | { type: 'qr'; value: string }
  | { type: 'touch' }
  | { type: 'processing' }
  | { type: 'dismiss' };

/** The desktop authenticator's progress on WhatsApp's passkey challenge. */
export type PasskeyCeremony =
  | { kind: 'idle' }
  | { kind: 'running'; event: PasskeyEvent | undefined }
  | { kind: 'failed'; message: string };

/** Why the passkey step did not finish, in words for the person. */
export type PasskeyFailure = { kind: 'passkey-failed'; message: string };

/**
 * Answering WhatsApp's passkey challenge. Only Macro desktop can; a browser
 * hands the pairing off to it by id.
 */
export type PasskeyCapability =
  | {
      kind: 'native';
      /** Signs the challenge on this device, then sends the assertion to DSS. */
      authenticate: (
        pairingId: string,
        challenge: PasskeyChallenge,
        onEvent: (event: PasskeyEvent) => void
      ) => ResultAsync<void, PasskeyFailure>;
    }
  | {
      kind: 'handoff';
      /** Opens this pairing in Macro desktop; carries only the pairing id. */
      desktopUrl: (pairingId: string) => string;
    }
  | { kind: 'unsupported' };

/** A request that did not reach a result; the page shows its own message. */
export type RequestFailure = { kind: 'request-failed' };

/**
 * Everything the WhatsApp page reads and does. Production builds it from the
 * shared `whatsapp-linked` queries; tests pass fakes.
 */
export type WhatsAppLinkedCapabilities = {
  /** The backend switches; pairing or adoption may be turned off. */
  features: SourceRead<{ pairing: boolean; adoption: boolean }>;
  /** The person's own account, `null` when they never connected one. */
  account: SourceRead<WhatsAppAccount | null>;
  /** Groups of the connected account; read only while `enabled`. */
  groups: (enabled: Accessor<boolean>) => SourceRead<WhatsAppGroup[]>;
  /** The live step of one pairing, polled while it is open. */
  pairing: (pairingId: Accessor<string>) => SourceRead<PairingRead>;
  passkey: PasskeyCapability;
  /** `replace` retires the current identity for a different WhatsApp account. */
  connect: (replace: boolean) => ResultAsync<StartedPairing, RequestFailure>;
  cancelPairing: (pairingId: string) => ResultAsync<void, RequestFailure>;
  /** Pairing finished: refresh the account and its groups. */
  pairingFinished: () => Promise<unknown>;
  disconnect: (
    generation: number
  ) => ResultAsync<{ remoteUnlinkRequested: boolean }, RequestFailure>;
  /** One click: the Macro group takes the WhatsApp group's name and follows it. */
  adopt: (groupJid: string) => ResultAsync<{ groupId: string }, AdoptFailure>;
  isConnecting: Accessor<boolean>;
  isDisconnecting: Accessor<boolean>;
  /** Host action: open a group in Macro. */
  openGroup: (groupId: string) => void;
};

const Context = createContext<WhatsAppLinkedCapabilities>();

export function WhatsAppLinkedProvider(
  props: ParentProps<{ value: WhatsAppLinkedCapabilities }>
) {
  return (
    <Context.Provider value={props.value}>{props.children}</Context.Provider>
  );
}

export function useWhatsAppLinked() {
  const value = useContext(Context);
  if (!value) throw new Error('WhatsAppLinkedProvider is required');
  return value;
}
