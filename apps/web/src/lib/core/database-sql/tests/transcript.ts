/**
 * The engine's transcripts from `crates/database_sql/fixtures/transcripts`:
 * every step it took answering a statement and what was fed back. A replay
 * stands in for the wasm engine, and refuses any page or bins other than
 * the recorded ones, so a test proves the TypeScript side feeds
 * the engine exactly what the Rust side recorded.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import type { OpenEngine } from '../driver';
import type {
  Bin,
  Catalog,
  OpResult,
  Outcome,
  Page,
  Step,
} from '../generated/types';

export type Exchange = { step: Exclude<Step, { step: 'done' }> } & (
  | { page: Page }
  | { bins: Bin[] }
  | { results: OpResult[] }
);

export interface Transcript {
  catalog: Catalog;
  sql: string;
  exchanges: Exchange[];
  outcome: Outcome;
}

export function readTranscript(name: string): Transcript {
  return JSON.parse(
    readFileSync(
      resolve(
        import.meta.dirname,
        `../../../../../../../crates/database_sql/fixtures/transcripts/${name}.json`
      ),
      'utf8'
    )
  );
}

/** An engine that takes exactly the recorded steps. */
export function replay(transcript: Transcript): OpenEngine {
  return async (catalog, sql) => {
    if (
      !isDeepStrictEqual(catalog, transcript.catalog) ||
      sql !== transcript.sql
    )
      throw 'the replayed statement differs from the recorded one';
    let position = 0;
    const next = (): Step =>
      position < transcript.exchanges.length
        ? transcript.exchanges[position].step
        : { step: 'done', ...transcript.outcome };
    const expect = (requestId: number, fed: Page | Bin[]) => {
      const exchange = transcript.exchanges[position];
      const recorded =
        'page' in exchange
          ? exchange.page
          : 'bins' in exchange
            ? exchange.bins
            : exchange.results;
      if (exchange.step.id !== requestId || !isDeepStrictEqual(fed, recorded))
        throw `fed ${JSON.stringify(fed)} for request ${requestId}, recorded ${JSON.stringify(recorded)} for request ${exchange.step.id}`;
      position += 1;
      return next();
    };
    return {
      start: next,
      feed_page: expect,
      feed_bins: expect,
      free: () => {},
    };
  };
}
