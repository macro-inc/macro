// The part of noVNC's RFB client the vnc transport uses. noVNC ships no types
// for its package entry (`@novnc/novnc` → `core/rfb.js`).
declare module '@novnc/novnc' {
  export type RfbOptions = { shared?: boolean };

  /** The WebSocket-shaped object noVNC accepts in place of a URL. */
  export type RfbChannel = {
    binaryType: BinaryType;
    readonly protocol: string;
    readonly readyState: number;
    onopen: ((event: Event) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
    onclose: ((event: CloseEvent) => void) | null;
    onerror: ((event: Event) => void) | null;
    send(data: ArrayBufferLike | ArrayBufferView): void;
    close(): void;
  };

  export default class RFB extends EventTarget {
    constructor(target: Element, channel: RfbChannel, options?: RfbOptions);
    viewOnly: boolean;
    focusOnClick: boolean;
    clipViewport: boolean;
    scaleViewport: boolean;
    resizeSession: boolean;
    showDotCursor: boolean;
    qualityLevel: number;
    compressionLevel: number;
    disconnect(): void;
  }
}

// A module bundled into one inline script by `scripts/sandboxed-frame-bundle.ts`.
declare module 'virtual:sandboxed-frame/*' {
  const code: string;
  export default code;
}
