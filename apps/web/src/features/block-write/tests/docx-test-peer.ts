import { readFileSync } from 'node:fs';
import {
  readDocxState,
  seedDocxState,
} from '@macro-inc/collaboration/docx/schema';
import { getWasmExports, initialize } from 'docxodus/core';
import { LoroDoc } from 'loro-crdt';
import { bridgeEngine, type DocxEngine } from '../core/docx-engine';
import { assemblePackage } from '../core/docx-package';
import { DocxSyncController } from '../core/docx-sync';

/** Session settings the collaborative editor opens every session with. */
export const SYNC_SESSION_SETTINGS = JSON.stringify({
  emitMarkdownPatch: false,
  validateRawOps: false,
});

export function fixture(name: string): Uint8Array {
  return new Uint8Array(
    readFileSync(new URL(`../core/fixtures/${name}`, import.meta.url))
  );
}

let ready: Promise<void> | undefined;
/** Boot the Node build of the Docxodus engine once per test file. */
export function loadEngine() {
  ready ??= initialize();
  return ready;
}

type Bridge = ReturnType<typeof getWasmExports>['DocxSessionBridge'];

export function bridge(): Bridge {
  return getWasmExports().DocxSessionBridge;
}

/**
 * One collaborator: a live engine session and a Loro replica. Updates are
 * queued rather than delivered so tests choose when peers see each other.
 */
export class TestPeer {
  readonly doc = new LoroDoc();
  handle: number;
  readonly engine: DocxEngine;
  readonly sync: DocxSyncController;
  rebuilds = 0;
  private readonly outbox: Uint8Array[] = [];

  constructor(bytes: Uint8Array, seed?: Uint8Array) {
    if (seed) this.doc.import(seed);
    this.doc.subscribeLocalUpdates((update) => this.outbox.push(update));
    const opening = seed ? assemblePackage(readDocxState(this.doc)) : bytes;
    this.handle = bridge().OpenSession(opening, SYNC_SESSION_SETTINGS);
    this.engine = bridgeEngine(bridge(), () => this.handle);
    if (!seed) seedDocxState(this.doc, this.engine.snapshot());
    this.sync = new DocxSyncController(this.doc, {
      engine: () => this.engine,
      refresh: () => {},
      rebuild: (next) => {
        this.rebuilds++;
        bridge().CloseSession(this.handle);
        this.handle = bridge().OpenSession(next, SYNC_SESSION_SETTINGS);
      },
    });
  }

  /** Hand every queued update to `others` and apply them there. */
  deliver(...others: TestPeer[]) {
    const updates = this.outbox.splice(0);
    for (const other of others) {
      for (const update of updates) other.doc.import(update);
      other.sync.applyRemote();
    }
  }

  bodyIds(): string[] {
    return (
      JSON.parse(bridge().ListBlocks!(this.handle)) as {
        body: Array<{ id: string }>;
      }
    ).body.map((unit) => unit.id);
  }

  /** The run text of every body block, in order. */
  text(): string[] {
    return this.bodyIds().map((id) => this.blockText(id));
  }

  blockText(anchor: string): string {
    return xmlText(bridge().RawGetXml(this.handle, anchor));
  }

  close() {
    bridge().CloseSession(this.handle);
  }
}

/** Concatenated `w:t` text of an element. */
export function xmlText(xml: string): string {
  return [...xml.matchAll(/<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)]
    .map((match) =>
      match[1]
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&quot;', '"')
        .replaceAll('&apos;', "'")
        .replaceAll('&amp;', '&')
    )
    .join('');
}
