/**
 * The sync service, played by the test process: one Loro document every peer's
 * updates are imported into, relayed to the other peers through per-peer
 * queues. In `auto` mode each queue drains after a random delay (FIFO per
 * link, as a websocket is); `hold(peer)` stops a peer's links in both
 * directions until `release(peer)`, which models a peer going offline.
 */

import type { Page } from '@playwright/test';
import { LoroDoc, VersionVector } from 'loro-crdt';
import type { Random } from './rng';

type WireEvent = { type: 'update' | 'awareness'; bytes: string };

type Link = {
  name: string;
  page: Page;
  /** Updates this peer pushed that the server has not imported yet. */
  up: string[];
  /** Messages for this peer that it has not received yet. */
  down: WireEvent[];
  held: boolean;
  pumping: boolean;
};

export class Relay {
  readonly doc = new LoroDoc();
  private readonly links: Link[] = [];
  private connected!: Promise<string>;
  private resolveConnected!: (snapshot: string) => void;
  /** Messages delivered, for the report. */
  delivered = 0;

  constructor(
    private readonly random: Random,
    private readonly maxLatencyMs: number
  ) {
    this.doc.setPeerId(99n);
    this.connected = new Promise((resolve) => {
      this.resolveConnected = resolve;
    });
  }

  initialize(snapshot: string): void {
    this.doc.import(Buffer.from(snapshot, 'base64'));
    this.resolveConnected(snapshot);
  }

  async attach(name: string, page: Page): Promise<void> {
    const link: Link = {
      name,
      page,
      up: [],
      down: [],
      held: false,
      pumping: false,
    };
    this.links.push(link);
    await page.exposeFunction('fuzzConnect', async () => {
      await this.connected;
      return Buffer.from(this.doc.export({ mode: 'snapshot' })).toString(
        'base64'
      );
    });
    await page.exposeFunction('fuzzPush', async (bytes: string) => {
      link.up.push(bytes);
      this.schedule(link);
      return true;
    });
    await page.exposeFunction('fuzzAwareness', async (bytes: string) => {
      for (const other of this.links)
        if (other !== link) {
          other.down.push({ type: 'awareness', bytes });
          this.schedule(other);
        }
    });
    await page.exposeFunction('fuzzSince', async (version: string) => {
      const from = VersionVector.decode(Buffer.from(version, 'base64'));
      return Buffer.from(this.doc.export({ mode: 'update', from })).toString(
        'base64'
      );
    });
  }

  hold(name: string): void {
    this.link(name).held = true;
  }

  release(name: string): void {
    const link = this.link(name);
    link.held = false;
    this.schedule(link);
  }

  /** Nothing queued anywhere and no link mid-delivery. */
  idle(): boolean {
    return this.links.every(
      (l) => l.up.length === 0 && l.down.length === 0 && !l.pumping
    );
  }

  private link(name: string): Link {
    const link = this.links.find((l) => l.name === name);
    if (!link) throw new Error(`no peer ${name}`);
    return link;
  }

  private schedule(link: Link): void {
    if (link.pumping || link.held) return;
    link.pumping = true;
    const delay = this.random.int(this.maxLatencyMs + 1);
    setTimeout(async () => {
      try {
        await this.pump(link);
      } finally {
        link.pumping = false;
        if (!link.held && (link.up.length > 0 || link.down.length > 0))
          this.schedule(link);
      }
    }, delay);
  }

  private async pump(link: Link): Promise<void> {
    if (link.held) return;
    // Upstream first: import into the server, then fan out.
    const up = link.up.splice(0, 1 + this.random.int(link.up.length));
    for (const bytes of up) {
      this.doc.import(Buffer.from(bytes, 'base64'));
      for (const other of this.links)
        if (other !== link) {
          other.down.push({ type: 'update', bytes });
          this.schedule(other);
        }
    }
    const down = link.down.splice(0, 1 + this.random.int(link.down.length));
    for (const event of down) {
      this.delivered++;
      await link.page
        .evaluate((e) => window.fuzzDeliver(e), event)
        .catch(() => undefined);
    }
  }
}
