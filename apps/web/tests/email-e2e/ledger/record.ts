// What a test did, written down while it runs: the manifest rows it
// performed or saw, the functions those belong to and whether their result
// was checked, the requests that reached the front, and the provider and the
// layout it ran on.

import { mkdirSync, writeFileSync } from 'node:fs';
import type { Page, TestInfo } from '@playwright/test';
import type { RecordedRequest } from '../harness/front';
import {
  type ActionId,
  type FunctionId,
  functionsOf,
  isActionId,
  isFunctionId,
  isStateId,
  type StateId,
} from './manifest';
import type { Provider, Viewport } from './manifest/types';
import { currentRun, runPaths } from './paths';

/** What a test showed of one function. */
export type FunctionEvidence = {
  id: string;
  /** Done through the UI: an action row of it was performed. */
  performed: boolean;
  /** Its result was asserted on the screen: a state row of it was seen. */
  seen: boolean;
  /** Its result was asserted at the provider, or in the service. */
  confirmed: boolean;
};

/** What one result of one test left, as `evidence.ts` reads it. */
export type Evidence = {
  testId: string;
  retry: number;
  title: string;
  file: string;
  tags: string[];
  status: string | undefined;
  expectedStatus: string;
  provider: Provider;
  viewport: Viewport;
  width: number | undefined;
  touch: boolean;
  /** The manifest rows it performed or saw. */
  rows: string[];
  functions: FunctionEvidence[];
  /** The requests that reached the front, each kind once with its count. */
  requests: (RecordedRequest & { count: number })[];
};

type Recording = {
  rows: Set<string>;
  functions: Map<string, FunctionEvidence>;
  requests: RecordedRequest[][];
};

// A worker runs one test at a time.
let recording: Recording | undefined;

function running(what: string): Recording {
  if (!recording) throw new Error(`${what}: no test is running`);
  return recording;
}

function mark(
  fn: string,
  piece: 'performed' | 'seen' | 'confirmed',
  what: string
): void {
  const { functions } = running(what);
  const evidence = functions.get(fn) ?? {
    id: fn,
    performed: false,
    seen: false,
    confirmed: false,
  };
  evidence[piece] = true;
  functions.set(fn, evidence);
}

/** The function a mark on a row is for: the one named, or the row's only one. */
function functionOf(
  row: string,
  named: string | undefined
): string | undefined {
  const of = functionsOf(row);
  if (named !== undefined) {
    if (!of.includes(named))
      throw new Error(`${row} is not a row of ${named} in the manifest`);
    return named;
  }
  if (of.length > 1)
    throw new Error(
      `${row} belongs to ${of.join(', ')}: say which the test does`
    );
  return of[0];
}

/**
 * The test performs this action of the coverage manifest here, as a user
 * would. Call it where the action is done: the row counts when the line ran
 * in a test that passed. It also counts as doing the function the row is a
 * variant of; a row of several functions needs the one meant.
 */
export function did(id: ActionId, fn?: FunctionId): void {
  if (!isActionId(id))
    throw new Error(`${id} is not an action in the manifest`);
  running(id).rows.add(id);
  const of = functionOf(id, fn);
  if (of) mark(of, 'performed', id);
}

/**
 * The test asserts this state of the coverage manifest here, on the screen.
 * It also counts as checking the result of the state's function in the UI.
 */
export function saw(id: StateId, fn?: FunctionId): void {
  if (!isStateId(id)) throw new Error(`${id} is not a state in the manifest`);
  running(id).rows.add(id);
  const of = functionOf(id, fn);
  if (of) mark(of, 'seen', id);
}

/**
 * The test asserts the result of this function here where `functions.tsv`
 * says it is checked: in the provider's mailbox, or in the service when the
 * provider sees nothing of it.
 */
export function confirmed(fn: FunctionId): void {
  if (!isFunctionId(fn)) throw new Error(`${fn} is not in functions.tsv`);
  mark(fn, 'confirmed', fn);
}

/** The app decides its phone layout at this width (`isMobileWidth`). */
const PHONE_WIDTH = 640;

/**
 * Records a test: call before it starts, and what it returns when it is
 * over. `provider` is the mailbox's.
 */
export function record(
  page: Page,
  testInfo: TestInfo,
  provider: 'GMAIL' | 'OUTLOOK',
  touch: boolean
): {
  /** A front whose requests are part of the test. */
  requests(of: RecordedRequest[]): void;
  finish(): void;
} {
  const mine: Recording = {
    rows: new Set(),
    functions: new Map(),
    requests: [],
  };
  recording = mine;

  return {
    requests: (of) => {
      mine.requests.push(of);
    },
    finish: () => {
      recording = undefined;
      const counted = new Map<string, RecordedRequest & { count: number }>();
      for (const request of mine.requests.flat()) {
        const key = JSON.stringify(request);
        const seen = counted.get(key);
        if (seen) seen.count += 1;
        else counted.set(key, { ...request, count: 1 });
      }
      const width = page.viewportSize()?.width;
      const evidence: Evidence = {
        testId: testInfo.testId,
        retry: testInfo.retry,
        title: testInfo.titlePath.slice(1).join(' › '),
        file: testInfo.titlePath[0],
        tags: testInfo.tags,
        status: testInfo.status,
        expectedStatus: testInfo.expectedStatus,
        provider: provider === 'GMAIL' ? 'gmail' : 'outlook',
        viewport:
          width !== undefined && width < PHONE_WIDTH ? 'phone' : 'desktop',
        width,
        touch,
        rows: [...mine.rows].sort(),
        functions: [...mine.functions.values()].sort((a, b) =>
          a.id.localeCompare(b.id)
        ),
        requests: [...counted.values()],
      };
      const { evidence: dir } = runPaths(currentRun());
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        `${dir}/${testInfo.testId}-${testInfo.retry}.json`,
        JSON.stringify(evidence)
      );
    },
  };
}
