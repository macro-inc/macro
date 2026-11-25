/**
 * Messages between the vnc transport and the sandboxed frame that runs noVNC,
 * over the MessagePort the transport hands the frame. The frame has no network
 * and an opaque origin: the transport keeps the socket and relays RFB bytes.
 */

/** The transport to the frame. */
export type ToVncFrame =
  /** RFB bytes from the server. */
  | { type: 'received'; data: ArrayBuffer }
  | { type: 'close' }
  /** Copy a region of the picture, for the loupe. */
  | {
      type: 'snapshot';
      id: number;
      x: number;
      y: number;
      width: number;
      height: number;
    };

/** The frame to the transport. */
export type FromVncFrame =
  /** RFB bytes noVNC sends to the server. */
  | { type: 'send'; data: ArrayBuffer }
  /** The RFB handshake finished; the picture follows. */
  | { type: 'connected' }
  | { type: 'disconnected'; clean: boolean }
  | { type: 'size'; width: number; height: number }
  | { type: 'snapshot'; id: number; bitmap: ImageBitmap | null };

/** The frame's first message to its parent, on `window`, asking for the port. */
export const VNC_FRAME_READY = 'macro-vnc-frame-ready';
