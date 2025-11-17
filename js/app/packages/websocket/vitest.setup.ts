import { WebSocket } from 'ws';

// Polyfill WebSocket for Node.js environment
if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = WebSocket as any;
}

// Polyfill CloseEvent for Node.js environment
if (typeof globalThis.CloseEvent === 'undefined') {
  globalThis.CloseEvent = class CloseEvent extends Event {
    code: number;
    reason: string;
    wasClean: boolean;

    constructor(
      type: string,
      eventInitDict?: { code?: number; reason?: string; wasClean?: boolean }
    ) {
      super(type);
      this.code = eventInitDict?.code ?? 1000;
      this.reason = eventInitDict?.reason ?? '';
      this.wasClean = eventInitDict?.wasClean ?? true;
    }
  } as any;
}
