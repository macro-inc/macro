import { afterAll, afterEach, beforeEach, expect } from 'vitest';
import { isOracleFrame } from './attribution';
import { moduleEntropy, moduleReads } from './bootstrap';
import { SourceCoverage } from './coverage';
import { Entropy } from './entropy';
import { captureEvents } from './events';
import { fixture as makeFixture } from './fixture';
import { activate, current, modules, Recorder } from './membrane';
import { replay } from './replay-js';

let recorder: Recorder;
let entropy: Entropy;
let restoreEvents: () => void;
// The import is resolved by the upstream alias, keeping the key counter shared.
const resetModule =
  process.env.LEXICAL_UPSTREAM + '/packages/lexical/src/LexicalUtils.ts';
modules.set(
  'lexical',
  await import(
    /* @vite-ignore */ process.env.LEXICAL_UPSTREAM +
      '/packages/lexical/src/index.ts'
  )
);
const utils = await import(/* @vite-ignore */ resetModule);
modules.set('lexical/LexicalUtils', utils);
const { resetRandomKey } = utils;
const coverage =
  process.env.LEXICAL_ORACLE === 'development' &&
  process.env.LEXICAL_MEMBRANE !== 'off'
    ? new SourceCoverage()
    : undefined;
await coverage?.start();
afterAll(async () => {
  await coverage?.close();
});
const disabled = process.env.LEXICAL_MEMBRANE === 'off';

beforeEach(async (context) => {
  moduleEntropy.dispose();
  await coverage?.reset();
  resetRandomKey();
  recorder = new Recorder(
    context.task.file.filepath.endsWith('/LexicalMarkdown.test.ts') &&
      /^(can import|can export|should not select when importing)/.test(
        context.task.name
      )
  );
  recorder.trace.push(...moduleReads);
  if (!disabled) activate(recorder);
  entropy = new Entropy(
    (op) => recorder.trace.push(op),
    undefined,
    () => !recorder.projectingView && isOracleFrame()
  );
  entropy.install();
  restoreEvents = captureEvents(
    (op) => recorder.trace.push(op),
    (reason) => recorder.reasons.add(reason)
  );
});

afterEach(async (context) => {
  try {
    for (let turn = 0; turn < 100; turn++) {
      const pending = [...recorder.editors.keys()].some((editor) => {
        const raw = editor as {
          _pendingEditorState: unknown;
          _updates: unknown[];
        };
        return raw._pendingEditorState !== null || raw._updates.length > 0;
      });
      if (!pending) break;
      recorder.trace.push({ op: 'tick', n: turn, reason: 'microtask' });
      await Promise.resolve();
      if (turn === 99)
        recorder.reasons.add('B-only:pending-updates-did-not-drain');
    }
    const covered = await coverage?.take();
    const fixture = makeFixture(recorder, {
      repo: context.task.file.filepath.includes('/lexical-core/')
        ? 'macro'
        : 'lexical',
      version: '0.45.0',
      file: context.task.file.filepath.replace(
        `${process.env.LEXICAL_UPSTREAM}/`,
        ''
      ),
      test: [context.task.name],
      recordedWith: `lexical-conformance@${process.env.LEXICAL_RECORDER_REV ?? 'development'}`,
    });
    if (fixture.source.repo === 'macro')
      fixture.normalize.push('listIndent: 2');
    entropy.dispose();
    restoreEvents();
    activate();
    if (!disabled && recorder.trace.length && !recorder.reasons.size) {
      try {
        await replay(JSON.parse(JSON.stringify(fixture)), resetRandomKey);
      } catch (error) {
        recorder.reasons.add(String(error));
      }
    }
    Object.assign(context.task.meta, {
      lexical: {
        fixture: JSON.parse(JSON.stringify(fixture)),
        reasons: [...recorder.reasons],
        assertions: expect.getState().assertionCalls,
        s2Hits: covered?.s2Hits ?? [],
        transformersFired: [...recorder.transformersFired].sort(),
        lines: covered?.lines ?? {},
        calls: recorder.trace.length,
      },
    });
  } finally {
    restoreEvents();
    if (current) {
      entropy.dispose();
      activate();
    }
  }
});
