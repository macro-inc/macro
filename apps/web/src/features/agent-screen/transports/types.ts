/**
 * The contract the screen transport (vnc) implements, and the
 * JSON control messages of the harness screen socket
 * (`GET /computers/{harness_id}/screen/ws`). The viewer only talks to a
 * `ScreenSession`, so a transport changes the media path and nothing else.
 *
 * The wire shapes mirror the agent harness service; replace them with the
 * generated OpenAPI types once its screen routes are published.
 */

export type ScreenTransportKind = 'vnc';

/** View needs `View` on the computer; drive needs `Manage`. */
export type ScreenMode = 'view' | 'drive';

/**
 * Input in guest pixel coordinates, already mapped from the viewport by the
 * client. `buttons` is the RFB button mask (bit 0 left, 1 middle, 2 right).
 */
export type ScreenInputEvent =
  | { kind: 'pointer'; x: number; y: number; buttons: number }
  | { kind: 'key'; keysym: number; down: boolean }
  | { kind: 'text'; text: string }
  | { kind: 'scroll'; x: number; y: number; dx: number; dy: number }
  | { kind: 'clipboard'; text: string };

/** `name` is null for a user without a profile name; resolve one from `userId`. */
export type ScreenDriver = { userId: string; name: string | null };

/** The `state` message: who drives, whether the agent is held, what is shown. */
export type ScreenState = {
  driver: ScreenDriver | null;
  agentHeld: boolean;
  /**
   * The computer was hibernated and is being woken: no frames yet. Sent only
   * when waking takes over 300 ms, then `false` before media starts.
   */
  waking: boolean;
  /**
   * The lease accepts input from this socket. `false` while the same user
   * drives from another tab or an older connection; absent from harnesses
   * that predate it (then `driver` alone says who drives).
   */
  drivingHere?: boolean;
  transport: ScreenTransportKind;
  viewers: number;
};

/** Text frames the client sends. */
export type ScreenClientMessage =
  | { type: 'takeOver' }
  | { type: 'handBack'; note: string | null }
  | { type: 'input'; event: ScreenInputEvent }
  | { type: 'stop' }
  /** Whether this tab is shown: the server ends a socket nobody looks at. */
  | { type: 'visibility'; visible: boolean };

/** Why the server ended the session; `shutdown` means reconnect with a new ticket. */
export type ScreenEndReason =
  | 'stopped'
  | 'computerOff'
  | 'accessRevoked'
  | 'shutdown'
  /**
   * Nobody looked: no shown tab and no input for a while, or hidden for a
   * couple of minutes. A drive ends with it, as a hand-back with no note.
   */
  | 'idle'
  | 'error';

/** Errors that leave the socket open. */
export type ScreenErrorCode =
  | 'driveNotAllowed'
  | 'driverBusy'
  | 'notDriver'
  /**
   * The computer's display closed. The socket then ends with `error`.
   */
  | 'sourceUnavailable'
  /** The computer runs but its screen couldn't be reached; the socket then ends with `error`. */
  | 'tunnelFailed'
  /** Too many screen sockets for this computer; the socket then ends with `error`. */
  | 'tooManySockets'
  | 'badMessage'
  | 'inputFailed'
  /**
   * Take over refused: the agent couldn't be paused on that computer. This
   * viewer still watches; another attempt may work.
   */
  | 'agentNotPausable'
  /** A code this client doesn't know (a newer harness). */
  | 'unknown'
  /** The viewer's own: a paste the guest's clipboard can't take. */
  | 'pasteUnsupported';

export type ScreenError = { code: ScreenErrorCode; message: string };

/** Text frames the server sends. */
export type ScreenServerMessage =
  | ({ type: 'state' } & ScreenState)
  | ({ type: 'error' } & ScreenError)
  | { type: 'ended'; reason: ScreenEndReason };

/** A minted ticket, resolved to the socket URL that redeems it. */
export type ScreenTicketGrant = {
  /** Absolute `wss://…/screen/ws?ticket=…` URL; single use. */
  socketUrl: string;
  expiresAt: string;
};

/**
 * The client gave up on the session without the server ending it: the socket
 * closed with no `ended` message (the viewer retries).
 */
export type ScreenClientEndReason = 'connectionLost';

/** What the transport reports back to the viewer while a session runs. */
export type ScreenSessionHandlers = {
  onState: (state: ScreenState) => void;
  /** The guest framebuffer size, for coordinate mapping; called on every resize. */
  onFrameSize: (size: ScreenFrameSize) => void;
  onError: (error: ScreenError) => void;
  /**
   * The session is over: the `ended` message's reason, or the client's own
   * (`ScreenClientEndReason`).
   */
  onEnded: (reason: ScreenEndReason | ScreenClientEndReason) => void;
};

export type ScreenFrameSize = { width: number; height: number };

export interface ScreenSession {
  sendInput(event: ScreenInputEvent): void;
  takeOver(): void;
  handBack(note: string | null): void;
  /**
   * Stop watching (`stop`): the harness ends this viewer's socket with
   * `stopped`. v1 has no share session to end for anyone else.
   */
  stop(): void;
  close(): void;
  /**
   * A copy of a guest-pixel region, for the loupe. Only for transports whose
   * picture the app can't read from its own DOM (vnc draws in a sandboxed
   * frame); the others leave it out and the loupe reads their canvas or video.
   */
  snapshot?(rect: ScreenRect): Promise<ImageBitmap | undefined>;
}

export type ScreenRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export interface ScreenTransport {
  readonly kind: ScreenTransportKind;
  /**
   * Opens the socket and renders media into `element` (a canvas, video or
   * iframe the transport creates inside it). Resolves once media flows;
   * rejects when the socket never opens. `signal` abandons a connect that
   * hasn't resolved: the transport closes everything it opened and rejects.
   */
  connect(
    element: HTMLElement,
    ticket: ScreenTicketGrant,
    handlers: ScreenSessionHandlers,
    signal: AbortSignal
  ): Promise<ScreenSession>;
}
