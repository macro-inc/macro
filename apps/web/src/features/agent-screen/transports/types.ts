/**
 * The contract every screen transport (vnc, stream, webrtc) implements, and the
 * JSON control messages of the harness screen socket
 * (`GET /computers/{harness_id}/screen/ws`). The viewer only talks to a
 * `ScreenSession`, so a transport changes the media path and nothing else.
 *
 * The wire shapes mirror the agent harness service; replace them with the
 * generated OpenAPI types once its screen routes are published.
 */

export type ScreenTransportKind = 'vnc' | 'stream' | 'webrtc';

export type ScreenSurface = 'desktop' | 'tab';

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

export type ScreenDriver = { userId: string; name: string };

/** The `state` message: who drives, whether the agent is held, what is shown. */
export type ScreenState = {
  driver: ScreenDriver | null;
  agentHeld: boolean;
  surface: ScreenSurface;
  transport: ScreenTransportKind;
  viewers: number;
};

export type ScreenSignal = {
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

/** Text frames the client sends. */
export type ScreenClientMessage =
  | { type: 'takeOver' }
  | { type: 'handBack'; note: string | null }
  | { type: 'input'; event: ScreenInputEvent }
  | ({ type: 'signal' } & ScreenSignal)
  | { type: 'switchSurface'; surface: ScreenSurface }
  | { type: 'stop' };

/** Why the server ended the session; `shutdown` means reconnect with a new ticket. */
export type ScreenEndReason =
  | 'stopped'
  | 'computerOff'
  | 'accessRevoked'
  | 'shutdown'
  | 'error';

/** Errors that leave the socket open. */
export type ScreenErrorCode =
  | 'driveNotAllowed'
  | 'driverBusy'
  | 'notDriver'
  | 'surfaceUnavailable'
  | 'badMessage'
  | 'inputFailed';

export type ScreenError = { code: ScreenErrorCode; message: string };

/** Text frames the server sends. */
export type ScreenServerMessage =
  | ({ type: 'state' } & ScreenState)
  | ({ type: 'signal' } & ScreenSignal)
  | ({ type: 'error' } & ScreenError)
  | { type: 'ended'; reason: ScreenEndReason };

/** A minted ticket, resolved to the socket URL that redeems it. */
export type ScreenTicketGrant = {
  /** Absolute `wss://…/screen/ws?ticket=…` URL; single use. */
  socketUrl: string;
  expiresAt: string;
};

/** What the transport reports back to the viewer while a session runs. */
export type ScreenSessionHandlers = {
  onState: (state: ScreenState) => void;
  /** The guest framebuffer size, for coordinate mapping; called on every resize. */
  onFrameSize: (size: ScreenFrameSize) => void;
  onError: (error: ScreenError) => void;
  /**
   * The session is over: the `ended` message's reason, or `connectionLost`
   * when the socket closed without one (the viewer retries with a new ticket).
   */
  onEnded: (reason: ScreenEndReason | 'connectionLost') => void;
};

export type ScreenFrameSize = { width: number; height: number };

/** Rolling numbers for the stats overlay; `undefined` when a transport can't measure one. */
export type ScreenStats = {
  fps: number | undefined;
  kbps: number;
  rttMs: number | undefined;
  decodeMs: number | undefined;
};

export interface ScreenSession {
  sendInput(event: ScreenInputEvent): void;
  takeOver(): void;
  handBack(note: string | null): void;
  switchSurface(surface: ScreenSurface): void;
  /** Ends the share for everyone (`stop`), unlike `close`, which only leaves. */
  stop(): void;
  close(): void;
  stats(): ScreenStats;
}

export interface ScreenTransport {
  readonly kind: ScreenTransportKind;
  /**
   * Opens the socket and renders media into `element` (a canvas, video or
   * iframe the transport creates inside it). Resolves once media flows;
   * rejects when the socket never opens.
   */
  connect(
    element: HTMLElement,
    ticket: ScreenTicketGrant,
    handlers: ScreenSessionHandlers
  ): Promise<ScreenSession>;
}
