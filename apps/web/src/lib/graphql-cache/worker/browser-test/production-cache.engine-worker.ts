/// <reference lib="webworker" />

import type { CacheRequest } from '../../protocol';
import {
  type CacheEngineRuntimeEvent,
  installCacheEngineWorker,
} from '../cache-engine-runtime';

const BLOCKABLE_MUTATION_KINDS = [
  'write',
  'enqueue-optimistic-mutation',
  'claim-next-mutation',
  'defer-optimistic-write',
  'commit-optimistic-write',
  'rollback-optimistic-write',
  'invalidate',
  'delete-records',
  'clear',
] as const satisfies readonly CacheRequest['kind'][];

type BlockableMutationKind = (typeof BLOCKABLE_MUTATION_KINDS)[number];

let telemetry: BroadcastChannel | undefined;
let activeScope: string | undefined;
let armedMutationKind: BlockableMutationKind | undefined;
const testChannel = (scope: string): BroadcastChannel => {
  telemetry ??= new BroadcastChannel(`graphql-cache-wp08-production:${scope}`);
  return telemetry;
};
const report = (event: CacheEngineRuntimeEvent): void => {
  activeScope = event.activation.scope;
  const workerPerformance = globalThis.performance as Performance & {
    memory?: unknown;
    measureUserAgentSpecificMemory?: unknown;
  };
  testChannel(event.activation.scope).postMessage({
    kind: event.kind,
    tabId: event.activation.tabId,
    ownerEpoch: event.activation.ownerEpoch,
    databaseAction: event.activation.databaseAction,
    requestId: event.kind === 'request-admitted' ? event.request.id : undefined,
    requestKind:
      event.kind === 'request-admitted' ? event.request.kind : undefined,
    slow:
      event.kind === 'request-admitted' &&
      event.request.kind === 'read' &&
      event.request.query.includes('Slow'),
    admissionBarrier:
      event.kind === 'request-admitted' &&
      event.request.kind === 'read' &&
      event.request.query.includes('CacheAdmissionBarrier'),
    reason: event.kind === 'fatal' ? event.reason : undefined,
    fatalCode: event.kind === 'fatal' ? event.fatalCode : undefined,
    performanceMemoryAvailable:
      event.kind === 'ready' && workerPerformance.memory !== undefined,
    userAgentSpecificMemoryAvailable:
      event.kind === 'ready' &&
      typeof workerPerformance.measureUserAgentSpecificMemory === 'function',
  });
};

const blockInjectedRequest = async (request: CacheRequest): Promise<void> => {
  if (request.kind === 'read' && request.query.includes('Slow')) {
    await new Promise<void>(() => {});
  }
  if (request.kind === armedMutationKind) {
    armedMutationKind = undefined;
    if (!activeScope) throw new Error('test hook has no active scope');
    testChannel(activeScope).postMessage({
      kind: 'request-blocked-before-core',
      requestId: request.id,
      requestKind: request.kind,
    });
    await new Promise<void>(() => {});
  }
};

installCacheEngineWorker({
  hooks: {
    beforeRequest: blockInjectedRequest,
    onEvent: report,
  },
});

const runtimeOnMessage = self.onmessage;
self.onmessage = (event: MessageEvent<unknown>) => {
  if (
    typeof event.data === 'object' &&
    event.data !== null &&
    'testKind' in event.data &&
    event.data.testKind === 'crash'
  ) {
    setTimeout(() => {
      throw new Error('production harness induced worker crash');
    });
    return;
  }
  if (
    typeof event.data === 'object' &&
    event.data !== null &&
    'testKind' in event.data &&
    event.data.testKind === 'arm-mutation-block' &&
    'requestKind' in event.data &&
    typeof event.data.requestKind === 'string' &&
    (BLOCKABLE_MUTATION_KINDS as readonly string[]).includes(
      event.data.requestKind
    )
  ) {
    armedMutationKind = event.data.requestKind as BlockableMutationKind;
    if (activeScope) {
      testChannel(activeScope).postMessage({
        kind: 'mutation-block-armed',
        requestKind: armedMutationKind,
      });
    }
    return;
  }
  runtimeOnMessage?.call(self, event);
};
