import {
  type Client,
  makeOperation,
  type Operation,
  type OperationResult,
} from '@urql/core';
import { vi } from 'vitest';
import { makeSubject, pipe, type Source, subscribe } from 'wonka';
import { normalizedCacheExchange } from '../exchange/normalized-cache-exchange';
import type { OptimisticLinkPatchWire } from '../protocol';
import type { CacheHost } from './types';

export function exchangeHarness(
  host: CacheHost,
  operation: Operation,
  onResult?: (result: OperationResult) => void,
  onForward?: () => void
) {
  const operations = makeSubject<Operation>();
  const network = makeSubject<OperationResult>();
  const forwarded: Operation[] = [];
  const results: OperationResult[] = [];
  const client = { reexecuteOperation: vi.fn() } as unknown as Client;
  const forward = (source: Source<Operation>): Source<OperationResult> => {
    pipe(
      source,
      subscribe((forwardedOperation) => {
        forwarded.push(forwardedOperation);
        onForward?.();
      })
    );
    return network.source;
  };
  pipe(
    normalizedCacheExchange(host)({
      forward,
      client,
      dispatchDebug: () => undefined,
    })(operations.source),
    subscribe((result) => {
      results.push(result);
      onResult?.(result);
    })
  );
  operations.next(operation);
  return { forwarded, results };
}

export function optimisticMutation(
  key: number,
  query: Operation['query'],
  linkPatches?: OptimisticLinkPatchWire[]
): Operation {
  return makeOperation('mutation', { key, query, variables: {} }, {
    requestPolicy: 'cache-first',
    url: 'http://integration.test',
    suspense: false,
    normalizedCacheOptimistic: {
      uuid: '00000000-0000-4000-8000-000000000001',
      optimisticResponse: { held: true },
      linkPatches,
    },
  } as never);
}

export class LinkedMessagePort extends EventTarget {
  peer: LinkedMessagePort | undefined;
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  closed = false;

  postMessage(
    message: unknown,
    transfer: Transferable[] | StructuredSerializeOptions = []
  ): void {
    const peer = this.peer;
    if (this.closed || !peer || peer.closed) return;
    const ports = (
      Array.isArray(transfer) ? transfer : (transfer.transfer ?? [])
    ) as MessagePort[];
    queueMicrotask(() => {
      if (peer.closed) return;
      peer.onmessage?.({ data: message, ports } as unknown as MessageEvent);
      peer.dispatchEvent(new MessageEvent('message', { data: message, ports }));
    });
  }

  start(): void {}
  close(): void {
    this.closed = true;
  }
}

export class LinkedMessageChannel {
  readonly port1 = new LinkedMessagePort();
  readonly port2 = new LinkedMessagePort();

  constructor() {
    this.port1.peer = this.port2;
    this.port2.peer = this.port1;
  }
}
