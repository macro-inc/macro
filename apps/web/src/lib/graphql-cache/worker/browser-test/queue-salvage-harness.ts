import { deepEqual } from '@core/util/compareUtils';
import type { CacheRequest, CacheResponse } from '../../protocol';
import { databaseOwnerLockName } from '../coordinator-protocol';
import type {
  QueueSalvageCommand,
  QueueSalvageEvent,
} from './queue-salvage.engine-worker';

const resultElement = document.querySelector<HTMLElement>('#result');
if (!resultElement) throw new Error('missing result element');

const MUTATION = `mutation SetEntityProperty($input: SetEntityPropertyInput!) {
  setEntityProperty(input: $input) { id displayName }
}`;
const PAGE = 'queue-salvage-page';
const LEASE_MS = 300_000;
const STEP_TIMEOUT_MS = 30_000;
const LOAD_ATTEMPTS = 10;
/** Markers of the attempts take 13 bytes each, a queue hundreds. */
const ATTEMPTS_MAX_BYTES = 200;

type RequestWithoutId = CacheRequest extends infer Request
  ? Request extends CacheRequest
    ? Omit<Request, 'id'>
    : never
  : never;

type Queued = { transactionId: string; uuid: string; variables: unknown };
/** A write in flight; `stamp` is the session generation it was made under. */
type Lease = { transactionId: string; generation: string; stamp: string };

/**
 * Where a kill found the files. Without a side file a wipe has not begun, or
 * the next database already holds the queue.
 */
type Landing = 'outside' | 'reading' | 'copied' | 'wiped';

type Report = {
  seed: number;
  kills: Landing[];
  wipes: number;
  accepted: number;
  settled: number;
  outcomes: string[];
  trace: string[];
  violations: string[];
};

/** Seeded, so that a failing schedule can be run again (mulberry32). */
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const pause = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** A worker whose script the dev server did not deliver is started again. */
async function loadedWorker(): Promise<Worker> {
  for (let attempt = 1; ; attempt += 1) {
    const worker = new Worker(
      new URL('./queue-salvage.engine-worker.ts', import.meta.url),
      { type: 'module' }
    );
    const loaded = Promise.withResolvers<boolean>();
    worker.onmessage = () => loaded.resolve(true);
    worker.onerror = () => loaded.resolve(false);
    if (await loaded.promise) return worker;
    worker.terminate();
    if (attempt === LOAD_ATTEMPTS) throw new Error('the worker never loaded');
  }
}

class Engine {
  private readonly waiting = new Map<
    number,
    (response: CacheResponse) => void
  >();
  private nextId = 1;
  readonly locked: Promise<void>;
  readonly opened: Promise<Extract<QueueSalvageEvent, { kind: 'opened' }>>;

  static async start(scope: string, recovery: boolean): Promise<Engine> {
    return new Engine(await loadedWorker(), scope, recovery);
  }

  private constructor(
    private readonly worker: Worker,
    private readonly scope: string,
    recovery: boolean
  ) {
    const locked = Promise.withResolvers<void>();
    const opened =
      Promise.withResolvers<Extract<QueueSalvageEvent, { kind: 'opened' }>>();
    this.locked = locked.promise;
    this.opened = opened.promise;
    // A terminated engine is never waited on again.
    this.opened.catch(() => undefined);
    this.worker.onerror = ({ message, filename }) =>
      opened.reject(new Error(`engine worker failed: ${message} ${filename}`));
    this.worker.onmessage = ({ data }: MessageEvent<QueueSalvageEvent>) => {
      if (data.kind === 'owner-lock') locked.resolve();
      if (data.kind === 'opened') opened.resolve(data);
      if (data.kind === 'open-failed') opened.reject(new Error(data.error));
      if (data.kind === 'response')
        this.waiting.get(data.response.id)?.(data.response);
    };
    this.send({ kind: 'open', scope, recovery });
  }

  private send(command: QueueSalvageCommand): void {
    this.worker.postMessage(command);
  }

  async request(request: RequestWithoutId): Promise<unknown> {
    const id = this.nextId++;
    const answer = Promise.withResolvers<CacheResponse>();
    this.waiting.set(id, answer.resolve);
    this.send({
      kind: 'request',
      request: { ...request, id } as CacheRequest,
    });
    const response = await Promise.race([
      answer.promise,
      pause(STEP_TIMEOUT_MS).then(() => undefined),
    ]);
    if (!response) throw new Error(`${request.kind} was never answered`);
    if (!response.ok) throw new Error(response.error);
    return response.result;
  }

  async stamp(): Promise<string> {
    const authority = (await this.request({
      kind: 'current-authority',
      identity: this.scope,
    })) as { generation: string };
    return authority.generation;
  }

  async queue(): Promise<Queued[]> {
    return (await this.request({ kind: 'inspect-mutations' })) as Queued[];
  }

  kill(): void {
    this.worker.terminate();
  }
}

const enqueueRequest = (
  uuid: string,
  stamp: string,
  now: number
): RequestWithoutId => ({
  kind: 'enqueue-optimistic-mutation',
  generation: stamp,
  uuid,
  query: MUTATION,
  operationName: 'SetEntityProperty',
  variables: variablesOf(uuid),
  data: { setEntityProperty: { id: `property-${uuid}`, displayName: uuid } },
  createdAtMs: now,
  owner: PAGE,
  nowMs: now,
  leaseExpiresAtMs: now + LEASE_MS,
});

const variablesOf = (uuid: string) => ({
  input: {
    entityType: 'DOCUMENT',
    entityId: `document-${uuid}`,
    propertyDefinitionId: `definition-${uuid}`,
    value: { string: uuid },
  },
});

const commitRequest = (lease: Lease, uuid: string): RequestWithoutId => ({
  kind: 'commit-optimistic-write',
  generation: lease.stamp,
  transactionId: lease.transactionId,
  leaseOwner: PAGE,
  leaseGeneration: lease.generation,
  query: MUTATION,
  operationName: 'SetEntityProperty',
  variables: variablesOf(uuid),
  data: { setEntityProperty: { id: `property-${uuid}`, displayName: uuid } },
});

async function filesOf(scope: string): Promise<Map<string, number>> {
  const root = await navigator.storage.getDirectory();
  const sizes = new Map<string, number>();
  for await (const [name, handle] of root.entries()) {
    if (!name.includes(scope) || handle.kind !== 'file') continue;
    const size = await sizeOf(handle as FileSystemFileHandle);
    if (size !== undefined) sizes.set(name, size);
  }
  return sizes;
}

/** Undefined once an engine has removed the file. */
async function sizeOf(
  handle: FileSystemFileHandle
): Promise<number | undefined> {
  try {
    return (await handle.getFile()).size;
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError')
      return undefined;
    throw error;
  }
}

/** Keeps the next schedules' listings short. */
async function removeFiles(scope: string): Promise<void> {
  const root = await navigator.storage.getDirectory();
  for (const name of (await filesOf(scope)).keys()) {
    await root.removeEntry(name).catch(() => undefined);
  }
}

async function landing(scope: string): Promise<Landing> {
  let side = 0;
  let database = 0;
  for (const [name, size] of await filesOf(scope)) {
    if (name.endsWith('-salvage')) side = size;
    else if (!name.endsWith('-wal')) database = size;
  }
  if (side === 0) return 'outside';
  if (database === 0) return 'wiped';
  return side > ATTEMPTS_MAX_BYTES ? 'copied' : 'reading';
}

/** Resolves once the side file holds the queue, or after `limitMs`. */
async function queueCopied(scope: string, limitMs: number): Promise<void> {
  const end = performance.now() + limitMs;
  while (performance.now() < end) {
    const at = await landing(scope);
    if (at === 'copied' || at === 'wiped') return;
  }
}

async function ownerLockFree(scope: string): Promise<void> {
  const name = databaseOwnerLockName(scope);
  await navigator.locks.request(name, async () => undefined);
}

const label = ({
  uuid,
  transactionId,
}: {
  uuid: string;
  transactionId: string;
}) => `${uuid.slice(0, 4)}=${transactionId}`;

/** What one schedule knows of the queue it built. */
class Model {
  /** In the order they were accepted. */
  readonly accepted: { uuid: string; transactionId: string }[] = [];
  readonly settled = new Set<string>();
  /** Asked for when the engine was killed: queued or not, settled or not. */
  readonly uncertain = new Set<string>();
  /** Commits refused though nothing took their lease. */
  readonly refused: string[] = [];
  lease: (Lease & { uuid: string }) | undefined;

  describe(): string {
    const writes = this.accepted.map(
      (write) =>
        `${label(write)}${this.settled.has(write.uuid) ? ' settled' : ''}`
    );
    const uncertain = [...this.uncertain].map((uuid) => uuid.slice(0, 4));
    return `writes: ${writes.join(', ')}; uncertain: ${uncertain.join(' ')}`;
  }

  get unsettled() {
    return this.accepted.filter(({ uuid }) => !this.settled.has(uuid));
  }

  violations(queue: Queued[], when: string): string[] {
    const found: string[] = [];
    const at = (what: string, uuid: string) => `${when}: ${what} ${uuid}`;
    const queued = new Map(queue.map((row) => [row.uuid, row]));
    for (const refusal of this.refused.splice(0))
      found.push(at('commit refused', refusal));
    if (queued.size !== queue.length) found.push(`${when}: a write came twice`);
    for (const { uuid, transactionId } of this.accepted) {
      const row = queued.get(uuid);
      if (this.settled.has(uuid)) {
        if (row && !this.uncertain.has(uuid))
          found.push(at('settled write came back', uuid));
        continue;
      }
      if (!row) {
        if (!this.uncertain.has(uuid))
          found.push(at('accepted write lost', uuid));
        continue;
      }
      if (row.transactionId !== transactionId)
        found.push(at('write under another id', uuid));
      if (!deepEqual(row.variables, variablesOf(uuid)))
        found.push(at('write with other variables', uuid));
    }
    const known = new Set(this.accepted.map(({ uuid }) => uuid));
    for (const { uuid } of queue)
      if (!known.has(uuid) && !this.uncertain.has(uuid))
        found.push(at('write nobody made', uuid));
    const order = queue
      .map(({ uuid }) => this.accepted.findIndex((row) => row.uuid === uuid))
      .filter((index) => index >= 0);
    if (order.some((index, place) => index < (order[place - 1] ?? -1)))
      found.push(`${when}: writes out of order`);
    return found;
  }

  /** Takes what the queue says of the writes nobody could be sure of. */
  settle(queue: Queued[]): void {
    for (const uuid of this.uncertain) {
      const row = queue.find((candidate) => candidate.uuid === uuid);
      const known = this.accepted.some((candidate) => candidate.uuid === uuid);
      if (row && !known)
        this.accepted.push({ uuid, transactionId: row.transactionId });
      if (!row && known) this.settled.add(uuid);
      if (row) this.settled.delete(uuid);
    }
    this.uncertain.clear();
    if (this.lease && this.settled.has(this.lease.uuid)) this.lease = undefined;
  }
}

type Claimed = { transactionId: string; leaseGeneration: string };
type EnqueueResult = {
  transactionId: string;
  initialClaim: { kind: 'claimed'; mutation: Claimed } | { kind: string };
};

async function enqueue(engine: Engine, model: Model): Promise<void> {
  const uuid = crypto.randomUUID();
  const stamp = await engine.stamp();
  const result = (await engine.request(
    enqueueRequest(uuid, stamp, Date.now())
  )) as EnqueueResult;
  const { transactionId, initialClaim } = result;
  model.accepted.push({ uuid, transactionId });
  if ('mutation' in initialClaim) hold(model, initialClaim.mutation, stamp);
}

/** The head of the queue, which the enqueue may have claimed for an older write. */
function hold(model: Model, claimed: Claimed, stamp: string): void {
  const { transactionId, leaseGeneration: generation } = claimed;
  // A wipe of an empty queue starts its IDs over.
  const row = model.unsettled.find(
    (row) => row.transactionId === transactionId
  );
  if (row) model.lease = { uuid: row.uuid, transactionId, generation, stamp };
}

async function claim(engine: Engine, model: Model, now: number): Promise<void> {
  const claimed = (await engine.request({
    kind: 'claim-next-mutation',
    owner: PAGE,
    nowMs: now,
    leaseExpiresAtMs: now + LEASE_MS,
  })) as Claimed | null | undefined;
  if (claimed) hold(model, claimed, await engine.stamp());
}

async function commit(
  engine: Engine,
  model: Model,
  now = Date.now()
): Promise<void> {
  if (!model.lease) await claim(engine, model, now);
  const { lease } = model;
  if (!lease) return;
  model.lease = undefined;
  const result = await outcomeOf(
    engine.request(commitRequest(lease, lease.uuid))
  );
  if (result === 'committed') model.settled.add(lease.uuid);
  else model.refused.push(`${lease.uuid} ${result}`);
}

async function outcomeOf(result: Promise<unknown>): Promise<string> {
  try {
    return ((await result) as { kind: string }).kind;
  } catch (error) {
    return String(error);
  }
}

/** Asks for a write nobody waits for: the engine dies with it. */
async function abandonRequest(
  engine: Engine,
  model: Model,
  commits: boolean
): Promise<void> {
  const { lease } = model;
  const stamp = await engine.stamp();
  if (commits && lease) {
    model.uncertain.add(lease.uuid);
    engine.request(commitRequest(lease, lease.uuid)).catch(() => undefined);
    return;
  }
  const uuid = crypto.randomUUID();
  model.uncertain.add(uuid);
  engine
    .request(enqueueRequest(uuid, stamp, Date.now()))
    .catch(() => undefined);
}

/**
 * One schedule: writes, then the engine ends in its page, engines that wipe
 * and recover are killed somewhere on the way, and one gets to the end. The
 * queue must then hold exactly the writes that were accepted and not settled.
 */
async function run(seed: number, recoveryMs: number): Promise<Report> {
  const scope = `queue-salvage-${crypto.randomUUID()}`;
  const next = random(seed);
  const upTo = (count: number) => Math.floor(next() * count);
  const model = new Model();
  const report: Report = {
    seed,
    kills: [],
    wipes: 0,
    accepted: 0,
    settled: 0,
    outcomes: [],
    trace: [],
    violations: [],
  };
  let engine = await Engine.start(scope, false);
  await engine.opened;
  const note = (what: string) => report.trace.push(what);
  // A page asks for the generation when it looks for a hydration checkpoint.
  if (next() < 0.5)
    await engine.request({ kind: 'current-storage-generation' });
  for (let round = 1; round <= 2; round += 1) {
    const writes = 1 + upTo(6);
    for (let write = 0; write < writes; write += 1) {
      if (next() < 0.3) await commit(engine, model);
      else await enqueue(engine, model);
    }
    if (next() < 0.5) {
      await abandonRequest(engine, model, next() < 0.5);
      await pause(next() * 6);
    }
    note(model.describe());
    engine.kill();
    for (let kills = upTo(3); kills > 0; kills -= 1) {
      const recovering = await Engine.start(scope, true);
      await recovering.locked;
      // Half of them anywhere, half from the copy on, which is the shorter part.
      const afterCopy = next() < 0.5;
      if (afterCopy) await queueCopied(scope, recoveryMs);
      await pause(next() * (afterCopy ? recoveryMs / 4 : recoveryMs));
      recovering.kill();
      await ownerLockFree(scope);
      const at = await landing(scope);
      report.kills.push(at);
      note(
        `killed: ${at} ${JSON.stringify([...(await filesOf(scope)).values()])}`
      );
    }
    engine = await Engine.start(scope, true);
    const opened = await engine.opened;
    report.wipes += 1;
    note(`opened: ${opened.outcome}, ${opened.queue}, ${opened.crossing}`);
    report.outcomes.push(`${opened.outcome}/${opened.queue}`);
    const queue = await engine.queue();
    report.violations.push(...model.violations(queue, `round ${round}`));
    if (
      opened.queue !== 'preserved' &&
      model.unsettled.some(({ uuid }) => !model.uncertain.has(uuid))
    )
      report.violations.push(`round ${round}: told the queue is gone`);
    note(`queued: ${queue.map(label).join(' ')}`);
    model.settle(queue);
  }
  // A lease taken before the wipes still settles its write.
  for (let write = model.unsettled.length; write > 0; write -= 1) {
    // A head an engine took with it stays claimed until its lease is over.
    await commit(engine, model, Date.now() + LEASE_MS + 1);
  }
  if (model.unsettled.length > 0)
    report.violations.push('end: writes that cannot be settled');
  report.violations.push(...model.violations(await engine.queue(), 'end'));
  report.accepted = model.accepted.length;
  report.settled = model.settled.size;
  engine.kill();
  await ownerLockFree(scope);
  await removeFiles(scope);
  return report;
}

/** How long a recovery open takes here, from its lock to its first answer. */
async function measureRecovery(): Promise<number> {
  const scope = `queue-salvage-${crypto.randomUUID()}`;
  const model = new Model();
  const first = await Engine.start(scope, false);
  await first.opened;
  for (let write = 0; write < 4; write += 1) await enqueue(first, model);
  first.kill();
  const recovering = await Engine.start(scope, true);
  await recovering.locked;
  const started = performance.now();
  await recovering.opened;
  const elapsed = performance.now() - started;
  recovering.kill();
  return elapsed;
}

const api = { run, measureRecovery };

declare global {
  interface Window {
    queueSalvageHarness: typeof api;
  }
}

window.queueSalvageHarness = api;
resultElement.dataset.status = 'ready';
