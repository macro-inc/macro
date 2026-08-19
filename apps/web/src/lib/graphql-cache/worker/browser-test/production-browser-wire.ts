import type { CacheRequest } from '../../protocol';

export type ProductionCacheRequestWithoutId = CacheRequest extends infer Request
  ? Request extends CacheRequest
    ? Omit<Request, 'id'>
    : never
  : never;

export type ProductionHarnessCommand =
  | { kind: 'write'; commandId: string; value: string }
  | { kind: 'read'; commandId: string }
  | { kind: 'slow-read'; commandId: string }
  | { kind: 'graceful-close'; commandId: string }
  | { kind: 'crash-worker'; commandId: string }
  | {
      kind: 'arm-mutation-block';
      commandId: string;
      requestKind: CacheRequest['kind'];
    }
  | {
      kind: 'request';
      commandId: string;
      request: ProductionCacheRequestWithoutId;
    }
  | { kind: 'terminate-worker'; commandId: string };

export type ProductionHarnessEnvelope =
  | {
      source: 'harness';
      targetTabId: string;
      command: ProductionHarnessCommand;
    }
  | {
      source: 'tab';
      tabId: string;
      event:
        | { kind: 'registered' }
        | { kind: 'worker-created'; ownerEpoch: number }
        | { kind: 'worker-terminated'; ownerEpoch: number; reason: string }
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
