/**
 * The sync service, played by the test process: one Loro document every
 * peer's updates are imported into, relayed to the other peers. Each peer has
 * two FIFO queues, as a websocket does: `up` (its updates the server has not
 * imported) and `down` (messages it has not received). Every queued message
 * gets one task in fast-check's scheduler, and a task moves the head of its
 * queue, so the scheduler picks the interleaving across queues (shrinkable
 * with the rest of the input) while each queue stays in order. `hold(peer)`
 * stops both of a peer's queues until `release(peer)`, as going offline does.
 */

import type { JSHandle, Page } from '@playwright/test';
import type fc from 'fast-check';
import { LoroDoc, VersionVector } from 'loro-crdt';
import type { FuzzWire, LexFuzzApi, WireEvent } from './bridge';

type Direction = 'up' | 'down';

/** The part of fast-check's scheduler the relay uses. */
type DeliveryScheduler = Pick<fc.Scheduler, 'schedule' | 'count' | 'waitNext'>;

/** Delivers each message as soon as it is queued, for fixed scenarios. */
export const IMMEDIATE_DELIVERY: DeliveryScheduler = {
  schedule: (task) => task,
  count: () => 0,
  waitNext: async () => {},
};

/** A message for a peer, and the peer it came from. */
type Message = { from: string; event: WireEvent };

type Link = {
  name: string;
  api?: JSHandle<LexFuzzApi>;
  up: string[];
  down: Message[];
  /** Scheduler tasks per queue that have not run yet. */
  pending: Record<Direction, number>;
  held: boolean;
};

export class Relay {
  readonly doc = new LoroDoc();
  private readonly links: Link[] = [];
  private readonly connected: PromiseWithResolvers<void> =
    Promise.withResolvers();
  /** Scheduler tasks, picked or not. */
  private readonly turns = new Set<Promise<void>>();
  /** Deliveries the scheduler picked that have not finished. */
  private readonly running = new Set<Promise<void>>();
  private readonly failures: unknown[] = [];
  /** Messages delivered, for the report. */
  delivered = 0;

  constructor(private readonly scheduler: DeliveryScheduler) {
    this.doc.setPeerId(99n);
  }

  /** Seeds the server's document; peers that connected earlier get it now. */
  initialize(snapshot: string): void {
    this.doc.import(Buffer.from(snapshot, 'base64'));
    this.connected.resolve();
  }

  /** Exposes the server's end of the socket to a page, before it loads. */
  async attach(name: string, page: Page): Promise<void> {
    const link: Link = {
      name,
      up: [],
      down: [],
      pending: { up: 0, down: 0 },
      held: false,
    };
    this.links.push(link);
    const wire: FuzzWire = {
      fuzzConnect: async () => {
        await this.connected.promise;
        return Buffer.from(this.doc.export({ mode: 'snapshot' })).toString(
          'base64'
        );
      },
      fuzzPush: async (bytes) => {
        link.up.push(bytes);
        this.topUp(link);
        return true;
      },
      fuzzAwareness: async (bytes) => {
        this.fanOut(link, { type: 'awareness', bytes });
      },
      fuzzSince: async (version) => {
        const from = VersionVector.decode(Buffer.from(version, 'base64'));
        return Buffer.from(this.doc.export({ mode: 'update', from })).toString(
          'base64'
        );
      },
    };
    for (const [binding, implementation] of Object.entries(wire))
      await page.exposeFunction(binding, implementation);
  }

  /** Where `name`'s deliveries go, once its page has loaded. */
  connect(name: string, api: JSHandle<LexFuzzApi>): void {
    this.link(name).api = api;
  }

  hold(name: string): void {
    this.link(name).held = true;
  }

  release(name: string): void {
    const link = this.link(name);
    link.held = false;
    this.topUp(link);
  }

  /** Lets the scheduler run up to `count` queued deliveries, and waits for them. */
  async deliver(count: number): Promise<void> {
    const ready = Math.min(count, this.scheduler.count());
    if (ready > 0) await this.scheduler.waitNext(ready);
    await this.settled();
  }

  /** Brings everyone online and delivers everything, including what that sends. */
  async drain(): Promise<void> {
    for (const link of this.links) this.release(link.name);
    while (this.scheduler.count() > 0)
      await this.deliver(this.scheduler.count());
  }

  /** Nothing queued anywhere. */
  idle(): boolean {
    return this.links.every((l) => l.up.length === 0 && l.down.length === 0);
  }

  private link(name: string): Link {
    const link = this.links.find((l) => l.name === name);
    if (!link) throw new Error(`no peer ${name}`);
    return link;
  }

  /**
   * Queues `event` for every other peer. An awareness message replaces the
   * sender's undelivered one: only the latest presence matters, and keeping
   * them all would bury document updates under cursor moves.
   */
  private fanOut(from: Link, event: WireEvent): void {
    for (const other of this.links)
      if (other !== from) {
        const stale =
          event.type === 'awareness'
            ? other.down.findIndex(
                (queued) =>
                  queued.from === from.name && queued.event.type === 'awareness'
              )
            : -1;
        if (stale === -1) other.down.push({ from: from.name, event });
        else other.down.splice(stale, 1, { from: from.name, event });
        this.topUp(other);
      }
  }

  /** One scheduler task per queued message, unless the peer is offline. */
  private topUp(link: Link): void {
    if (link.held) return;
    for (const direction of ['up', 'down'] as const)
      while (link.pending[direction] < link[direction].length) {
        link.pending[direction]++;
        this.turns.add(this.takeTurn(link, direction));
      }
  }

  /** Waits for the scheduler to pick this task, then moves the head of the queue. */
  private async takeTurn(link: Link, direction: Direction): Promise<void> {
    await this.scheduler.schedule(
      Promise.resolve(),
      `${link.name} ${direction}`
    );
    link.pending[direction]--;
    // Going offline drops the task; `release` schedules a new one.
    if (link.held) return;
    const delivery = this.move(link, direction);
    this.running.add(delivery);
    await delivery;
    this.running.delete(delivery);
  }

  private async move(link: Link, direction: Direction): Promise<void> {
    try {
      await (direction === 'up' ? this.pushUp(link) : this.pushDown(link));
    } catch (error) {
      this.failures.push(error);
    }
  }

  /** Waits for every delivery the scheduler has let go. */
  private async settled(): Promise<void> {
    while (this.running.size > 0) await Promise.all(this.running);
    if (this.failures.length > 0)
      throw new AggregateError(this.failures, 'relay deliveries failed');
  }

  private async pushUp(link: Link): Promise<void> {
    const bytes = link.up.shift();
    if (bytes === undefined) throw new Error(`${link.name}: up queue empty`);
    this.doc.import(Buffer.from(bytes, 'base64'));
    this.fanOut(link, { type: 'update', bytes });
  }

  private async pushDown(link: Link): Promise<void> {
    const message = link.down.shift();
    if (message === undefined)
      throw new Error(`${link.name}: down queue empty`);
    if (!link.api) throw new Error(`${link.name} has not loaded`);
    this.delivered++;
    await link.api.evaluate((api, event) => api.deliver(event), message.event);
  }
}
