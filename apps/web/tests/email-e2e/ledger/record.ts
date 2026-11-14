// What a test did, written down while it runs: the manifest rows it
// performed or saw, the requests that reached the front, the provider and
// the layout it ran on, and which bytes of the app's scripts ran.

import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import type { Page, TestInfo } from '@playwright/test';
import type { RecordedRequest } from '../harness/front';
import { type ActionId, isActionId, isStateId, type StateId } from './manifest';
import type { Provider, Viewport } from './manifest/types';
import { currentRun, runPaths } from './paths';

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
  /** The requests that reached the front, each kind once with its count. */
  requests: (RecordedRequest & { count: number })[];
};

type Recording = { rows: Set<string>; requests: RecordedRequest[][] };

// A worker runs one test at a time.
let recording: Recording | undefined;

function row(id: string): void {
  if (!recording) throw new Error(`${id}: no test is running`);
  recording.rows.add(id);
}

/**
 * The test performs these actions of the coverage manifest here, as a user
 * would. Call it where the action is done: the row counts when the line ran
 * in a test that passed.
 */
export function did(...ids: ActionId[]): void {
  for (const id of ids) {
    if (!isActionId(id))
      throw new Error(`${id} is not an action in the manifest`);
    row(id);
  }
}

/** The test asserts these states of the coverage manifest here. */
export function saw(...ids: StateId[]): void {
  for (const id of ids) {
    if (!isStateId(id)) throw new Error(`${id} is not a state in the manifest`);
    row(id);
  }
}

/** The app decides its phone layout at this width (`isMobileWidth`). */
const PHONE_WIDTH = 640;

// The bytes of each script that ran in this worker's tests so far: one byte
// per character of the script, 1 when it ran.
const ran = new Map<string, Uint8Array>();

const LINES = process.env.EMAIL_E2E_LINE_COVERAGE !== '0';

type ScriptCoverage = Awaited<
  ReturnType<Page['coverage']['stopJSCoverage']>
>[number];

/** Marks what a script's coverage says ran. Inner ranges decide over outer ones. */
export function markRan(
  into: Uint8Array,
  functions: ScriptCoverage['functions']
): void {
  const ranges = functions.flatMap((fn) => fn.ranges);
  ranges.sort(
    (a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset
  );
  const scratch = new Uint8Array(into.length);
  for (const range of ranges) {
    scratch.fill(range.count > 0 ? 1 : 0, range.startOffset, range.endOffset);
  }
  for (let i = 0; i < into.length; i++) into[i] |= scratch[i];
}

function keepScripts(scripts: ScriptCoverage[], testInfo: TestInfo): void {
  for (const script of scripts) {
    let path: string;
    try {
      path = new URL(script.url).pathname;
    } catch {
      continue;
    }
    if (!path.endsWith('.js') || script.source === undefined) continue;
    let bytes = ran.get(path);
    if (bytes?.length !== script.source.length) {
      bytes = new Uint8Array(script.source.length);
      ran.set(path, bytes);
    }
    markRan(bytes, script.functions);
  }
  // Written after every test: a worker that is killed loses nothing.
  const { scripts: dir } = runPaths(currentRun());
  mkdirSync(dir, { recursive: true });
  const out: Record<string, string> = {};
  for (const [path, bytes] of ran) {
    out[path] = gzipSync(bytes).toString('base64');
  }
  writeFileSync(
    `${dir}/worker-${testInfo.parallelIndex}-${process.pid}.json`,
    JSON.stringify(out)
  );
}

/**
 * Records a test: call before it starts, and what it returns when it is
 * over. `provider` is the mailbox's.
 */
export async function record(
  page: Page,
  testInfo: TestInfo,
  provider: 'GMAIL' | 'OUTLOOK',
  touch: boolean
): Promise<{
  /** A front whose requests are part of the test. */
  requests(of: RecordedRequest[]): void;
  finish(): Promise<void>;
}> {
  const mine: Recording = { rows: new Set(), requests: [] };
  recording = mine;
  const lines = LINES && testInfo.project.use.browserName !== 'firefox';
  if (lines) {
    await page.coverage.startJSCoverage({ resetOnNavigation: false });
  }

  return {
    requests: (of) => {
      mine.requests.push(of);
    },
    finish: async () => {
      recording = undefined;
      if (lines) {
        const scripts = await page.coverage.stopJSCoverage().catch(() => []);
        // What ran in a test that failed is not what the suite covers.
        if (testInfo.status === 'passed') keepScripts(scripts, testInfo);
      }

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
