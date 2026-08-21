export type BrowserHarnessCommand =
  | { kind: 'write'; commandId: string; value: string }
  | { kind: 'read'; commandId: string }
  | { kind: 'slow-read'; commandId: string }
  | { kind: 'graceful-close'; commandId: string }
  | { kind: 'crash-worker'; commandId: string }
  | { kind: 'release-liveness-lock'; commandId: string }
  | {
      kind: 'stale-response';
      commandId: string;
      ownerEpoch: number;
      routeId: number;
    };

export type BrowserHarnessEnvelope =
  | {
      source: 'harness';
      targetTabId: string;
      command: BrowserHarnessCommand;
    }
  | {
      source: 'tab';
      tabId: string;
      event:
        | { kind: 'adapter-created' }
        | { kind: 'registered' }
        | { kind: 'worker-created'; ownerEpoch: number }
        | { kind: 'worker-terminated'; ownerEpoch: number; reason: string }
        | { kind: 'engine-replaced'; ownerEpoch: number }
        | { kind: 'cache-push'; pushKind: string }
        | {
            kind: 'command-result';
            commandId: string;
            ok: true;
            result?: unknown;
          }
        | {
            kind: 'command-result';
            commandId: string;
            ok: false;
            error: string;
          }
        | { kind: 'protocol-error'; error: string };
    };
