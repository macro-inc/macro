import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ABI_MAJOR,
  Access,
  SessionConfigMsg,
  SessionInputMsg,
  Transport,
} from '@macro-inc/collaboration/session/abi.generated';
import {
  COMPATIBILITY_PROTOCOL_MAJOR,
  COMPATIBILITY_SCHEMA_HASH,
  CompatAuditSnapshot,
  CompatBatchRequest,
  CompatBegin,
  CompatCaptureLeases,
  CompatConfig,
  CompatOperation,
  CompatReply,
  CompatRequest,
  CompatSnapshot,
  ForeignCallbackValue,
  type ICompatAuditSnapshot,
  type ICompatSnapshot,
  type IForeignRecordRef,
} from '@macro-inc/collaboration/session/compatibility.generated';
import { emptyInput } from '@macro-inc/collaboration/session/input';
import * as wasm from '@macro-inc/collaboration/session/wasm-compat';
import type {
  NodeHandleBackend,
  NodeHandleCache,
  NodeLifetime,
} from '../../src/backend';
import { CaptureLeases } from '../../src/backend/production/capture-leases';
import {
  VersionCollector,
  type VersionCollectorEvent,
} from '../../src/backend/production/version-collector';
import { NodeHandles } from '../../src/handles';
import { AuditRecorder, type CallRecord } from '../../src/measurement/metrics';
import { bindAuditRecorder } from '../../src/measurement/runtime';
import { validateTrace } from '../../src/measurement/validate';

interface Event {
  readonly id: number;
  readonly kind: string;
  readonly version?: bigint;
  readonly callIds?: readonly number[];
  readonly collector?: VersionCollectorEvent;
}
let initialized = false;
let nextEditorId = 1;

/** State-only lifecycle adapter over the actual production session, not ShimBackend. */
export class NativeFixture implements NodeHandleBackend {
  readonly recorder = new AuditRecorder();
  readonly events: Event[] = [];
  readonly collector: VersionCollector;
  readonly handles: NodeHandles<object>;
  readonly leases: CaptureLeases;
  readonly session: wasm.EditorSession;
  readonly initial: ICompatSnapshot;
  readonly initialRecord: IForeignRecordRef;
  readonly editorId = nextEditorId++;
  readonly issued = new Set<bigint>();
  readonly issuance: {
    readonly version: bigint;
    readonly callId: number;
    readonly captureIds: readonly bigint[];
  }[] = [];
  readonly jobs: (() => void)[] = [];
  readonly retired: bigint[] = [];
  current: bigint;
  pending = false;
  failNextFlush = false;
  afterRelease: ((version: bigint) => void) | undefined;
  onCollected: ((version: bigint) => void) | undefined;
  private cache: NodeHandleCache | undefined;
  private readonly graphOwners = new Map<bigint, number>();
  private readonly unbind: () => void;
  private initialOwner = true;
  private closed = false;

  constructor(private readonly scheduling: 'manual' | 'microtask' = 'manual') {
    this.unbind = bindAuditRecorder(
      this.recorder,
      (request) => CompatBatchRequest.decode(request).finalize
    );
    let created: wasm.EditorSession | undefined;
    try {
      const artifact = process.env.COLLECTOR_NATIVE_ARTIFACT_ROOT;
      if (!artifact) throw new Error('Missing actual collector artifact');
      if (!initialized) {
        wasm.initSync({
          module: new Uint8Array(
            readFileSync(resolve(artifact, 'document_session_wasm_bg.wasm'))
          ),
        });
        initialized = true;
      }
      if (
        wasm.compatibility_protocol_major() !== COMPATIBILITY_PROTOCOL_MAJOR ||
        wasm.compatibility_schema_hash() !== COMPATIBILITY_SCHEMA_HASH
      )
        throw new Error(
          'Actual native module and generated schema do not match'
        );
      this.leases = new CaptureLeases(this.editorId);
      const config = SessionConfigMsg.encode({
        doc: 'collector-lifetime-fixture',
        session: '00000000-0000-0000-0000-000000000001',
        user: 'fixture-user',
        peers: [71n, 72n, 73n],
        access: Access.Edit,
        transport: Transport.None,
        durable: false,
        chatter: false,
        headless: false,
        viewEngine: 1,
        viewOs: 0,
        token: '',
        traceparent: '',
        coalesce: 25,
        snapshotInterval: 0,
        observed: [],
      }).slice();
      created = this.call('EditorSession.createCompat', () =>
        wasm.EditorSession.createCompat(
          ABI_MAJOR,
          config,
          0,
          0,
          CompatConfig.encode({ editorId: this.editorId, classes: [] }).slice()
        )
      );
      this.session = created;
      this.collector = new VersionCollector(this, (event) =>
        this.event(
          'collector',
          event.kind === 'disposed' ? undefined : event.version,
          undefined,
          event
        )
      );
      this.handles = new NodeHandles(this, () => {
        throw new Error(
          'State-only fixture must not construct raw node wrappers'
        );
      });
      this.initial = this.snapshot(0n);
      const initial = this.initial.batch.records[0];
      if (!initial) throw new Error('Actual initial root capture is missing');
      this.initialRecord = initial.record;
      this.current = this.initial.version;
      this.leases.retain(this.initialRecord);
      this.flushLeases();
    } catch (error) {
      created?.free();
      this.unbind();
      throw error;
    }
  }

  ownNodeHandles(cache: NodeHandleCache): void {
    if (this.cache !== undefined)
      throw new Error('Fixture already owns its sole node cache');
    this.cache = cache;
  }
  nodeLifetime(_handle: number, _node: object): NodeLifetime {
    throw new Error(
      'State-only fixture cannot manufacture a raw capture lifetime'
    );
  }
  collectVersion(
    version: string,
    unowned: () => boolean,
    released: () => void
  ): void {
    const id = BigInt(version);
    this.event('actual-version-finalizer-enqueued', id);
    this.collector.collect(id, unowned, () => {
      released();
      this.releaseInitialOwner();
      this.onCollected?.(id);
    });
  }
  event(
    kind: string,
    version?: bigint,
    callIds?: readonly number[],
    collector?: VersionCollectorEvent
  ): void {
    this.events.push({
      id: this.events.length + 1,
      kind,
      version,
      callIds,
      collector,
    });
  }
  private call<T>(method: string, body: () => T): T {
    const before = this.recorder.snapshot().calls.length;
    try {
      const result = body();
      this.callEvent(method, before, true);
      return result;
    } catch (error) {
      this.callEvent(method, before, false);
      throw error;
    }
  }
  private callEvent(method: string, before: number, completed: boolean): void {
    const calls = this.recorder.snapshot().calls.slice(before);
    const api = calls.filter(
      (call) => call.layer === 'api' && call.method === method
    );
    if (api.length !== 1 || api[0].completed !== completed)
      throw new Error(`Missing actual measured API receipt: ${method}`);
    this.event(
      completed ? 'actual-native-return' : 'actual-native-failure',
      undefined,
      calls.map((call) => call.id)
    );
  }
  apiCalls(method: string): readonly CallRecord[] {
    return this.recorder
      .snapshot()
      .calls.filter((call) => call.layer === 'api' && call.method === method);
  }
  snapshot(version: bigint): ICompatSnapshot {
    const snapshot = CompatSnapshot.decode(
      this.call('EditorSession.compatSnapshot', () =>
        this.session.compatSnapshot(version)
      )
    );
    if (snapshot.version !== version)
      throw new Error('Native snapshot identity changed');
    this.issued.add(snapshot.version);
    const call = this.apiCalls('EditorSession.compatSnapshot').at(-1);
    if (!call?.completed)
      throw new Error('Missing actual issued-version receipt');
    this.issuance.push({
      version: snapshot.version,
      callId: call.id,
      captureIds: snapshot.batch.records.map(
        (record) => record.record.captureId
      ),
    });
    return snapshot;
  }
  startAndSeed(): void {
    for (const kind of [0, 1]) {
      this.call('EditorSession.input', () =>
        this.session.input(
          SessionInputMsg.encode(emptyInput(kind)).slice(),
          kind,
          kind
        )
      );
      this.call('EditorSession.takeOutput', () => this.session.takeOutput());
    }
    this.current = this.call('EditorSession.compatCurrentVersion', () =>
      this.session.compatCurrentVersion()
    );
    const current = this.snapshot(this.current).batch.records[0];
    if (!current || this.current === this.initial.version)
      throw new Error('Actual Seed did not publish a successor');
    this.leases.retain(current.record);
    this.flushLeases();
  }
  canCollect(version: bigint): boolean {
    return (
      !this.closed &&
      this.issued.has(version) &&
      version !== this.current &&
      !this.pending &&
      (this.graphOwners.get(version) ?? 0) === 0
    );
  }
  holdGraph(version: bigint): () => void {
    if (!this.issued.has(version))
      throw new Error('Cannot lease an unissued graph');
    this.graphOwners.set(version, (this.graphOwners.get(version) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) throw new Error('Graph owner released twice');
      released = true;
      this.graphOwners.set(version, (this.graphOwners.get(version) ?? 0) - 1);
    };
  }
  flushLeases(): void {
    if (this.failNextFlush) {
      this.failNextFlush = false;
      const pending = this.leases.beginDrain();
      try {
        this.call('EditorSession.compatCaptureLeases', () =>
          this.session.compatCaptureLeases(
            CompatCaptureLeases.encode({
              editorId: this.editorId,
              retain: [0xffffffffffffffffn],
              release: [],
            }).slice()
          )
        );
      } catch (error) {
        if (pending) this.leases.rollback(pending);
        throw error;
      }
      throw new Error('Invalid native lease request unexpectedly succeeded');
    }
    let drain = this.leases.beginDrain();
    if (drain === undefined) {
      this.call('EditorSession.compatCaptureLeases', () =>
        this.session.compatCaptureLeases(
          CompatCaptureLeases.encode({
            editorId: this.editorId,
            retain: [],
            release: [],
          }).slice()
        )
      );
      return;
    }
    while (drain !== undefined) {
      const batch = drain;
      try {
        this.call('EditorSession.compatCaptureLeases', () =>
          this.session.compatCaptureLeases(
            CompatCaptureLeases.encode(batch.leases).slice()
          )
        );
        this.leases.acknowledge(batch);
      } catch (error) {
        this.leases.rollback(batch);
        throw error;
      }
      drain = this.leases.beginDrain();
    }
  }
  releaseVersion(version: bigint): void {
    this.call('EditorSession.compatReleaseVersion', () =>
      this.session.compatReleaseVersion(version)
    );
    this.retired.push(version);
    this.afterRelease?.(version);
  }
  scheduleDrain(body: () => void): void {
    if (this.scheduling === 'microtask') queueMicrotask(body);
    else this.jobs.push(body);
  }
  releaseInitialOwner(): void {
    if (!this.initialOwner) return;
    this.initialOwner = false;
    this.leases.release(this.initialRecord);
  }
  audit(): ICompatAuditSnapshot {
    return CompatAuditSnapshot.decode(
      this.call('EditorSession.compatAuditSnapshot', () =>
        this.session.compatAuditSnapshot()
      )
    );
  }
  readInitialType(): string {
    const reply = CompatReply.decode(
      this.call('EditorSession.compatCall', () =>
        this.session.compatCall(
          CompatRequest.encode({
            operation: CompatOperation.GetNodeField,
            historical: true,
            stateVersion: this.initial.version,
            hasReceiver: true,
            receiver: this.initialRecord,
            args: [
              ForeignCallbackValue.fromForeignStringArgument({
                value: [95, 95, 116, 121, 112, 101],
              }),
            ],
          }).slice()
        )
      )
    );
    if (!reply.value.isForeignStringArgument())
      throw new Error('Native type read did not return a string');
    return String.fromCharCode(...reply.value.value.value);
  }
  beginPending(): void {
    this.call('EditorSession.compatBegin', () =>
      this.session.compatBegin(CompatBegin.encode({ tags: [] }).slice())
    );
    this.pending = true;
  }
  discardPending(): void {
    this.call('EditorSession.compatDiscard', () =>
      this.session.compatDiscard()
    );
    this.pending = false;
  }
  proof(name: string, observations: unknown): void {
    const directory = process.env.COLLECTOR_NATIVE_PROOF_DIR;
    if (!directory) throw new Error('Missing native proof directory');
    const trace = this.recorder.snapshot();
    const issues = validateTrace(trace);
    if (issues.length !== 0)
      throw new Error(`Invalid actual native trace: ${issues.join(',')}`);
    writeFileSync(
      resolve(directory, `${name}.json`),
      JSON.stringify(
        {
          classification: 'production-native-lifetime-boundary-only',
          fullMacroAcceptance: false,
          nativeSourceCommit: '3386e986871fe7bca32c3c0ca96d1e7de07a7fe2',
          bridgeCommit: '6054f87488',
          schemaHash: COMPATIBILITY_SCHEMA_HASH,
          editorId: this.editorId,
          issuedSnapshots: this.issuance,
          observations,
          events: this.events,
          trace,
        },
        (_key, value: unknown) =>
          typeof value === 'bigint' ? value.toString() : value,
        2
      )
    );
  }
  close(): void {
    if (this.closed) return;
    this.collector.dispose();
    this.jobs.length = 0;
    this.recorder.setPhase('diagnostic');
    try {
      this.session.free();
    } finally {
      this.closed = true;
      this.unbind();
    }
  }
}
