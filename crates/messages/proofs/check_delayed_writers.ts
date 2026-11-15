#!/usr/bin/env bun
// Verify synthetic-delay writers preserve their old/current Rust source bodies.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { isSpace } from './proof_support';
import { unifiedDiff } from './token_diff';

const ROOT = join(import.meta.dir, '../../..');
const REPO_PATH = 'crates/messages/src/outbound/pg_message_repo.rs';
const BASELINE_PATH =
  'crates/messages/src/outbound/pg_message_repo/test/baseline.rs';
const DELAYED_PATH =
  'crates/messages/src/outbound/pg_message_repo/test/benchmark/delayed.rs';
const BASE_COMMIT = '354da677b5';

/** A writer differs beyond the explicitly permitted benchmark additions. */
class AuditError extends Error {}

/** The arguments, return type and body tokens of one Rust method. */
type Method = [string[], string[], string[]];

const RAW_STRING_START = /r(#{0,255})"/y;
const WORD = /[A-Za-z_][A-Za-z_0-9]*|[0-9][A-Za-z_0-9]*/y;

function matchAt(pattern: RegExp, source: string, position: number) {
  pattern.lastIndex = position;
  return pattern.exec(source);
}

/** Discard Rust trivia while preserving literal contents and punctuation. */
function tokens(source: string): string[] {
  const result: string[] = [];
  let position = 0;

  while (position < source.length) {
    const character = String.fromCodePoint(source.codePointAt(position) ?? 0);

    if (isSpace(character)) {
      position += 1;
      continue;
    }

    if (source.startsWith('//', position)) {
      const newline = source.indexOf('\n', position);
      position = newline < 0 ? source.length : newline + 1;
      continue;
    }

    if (source.startsWith('/*', position)) {
      position = blockCommentEnd(source, position);
      continue;
    }

    const raw = matchAt(RAW_STRING_START, source, position);
    if (raw) {
      const endMarker = `"${raw[1]}`;
      const end = source.indexOf(endMarker, position + raw[0].length);
      if (end < 0) {
        throw new AuditError('unterminated Rust raw string');
      }

      result.push(source.slice(position, end + endMarker.length));
      position = end + endMarker.length;
      continue;
    }

    if (character === '"') {
      const end = stringEnd(source, position);
      result.push(source.slice(position, end));
      position = end;
      continue;
    }

    const word = matchAt(WORD, source, position);
    if (word) {
      result.push(word[0]);
      position += word[0].length;
      continue;
    }

    result.push(character);
    position += character.length;
  }

  return result;
}

// Rust block comments nest, so count openings until the outermost one closes.
function blockCommentEnd(source: string, start: number): number {
  let depth = 1;
  let position = start + 2;

  while (depth > 0 && position < source.length) {
    if (source.startsWith('/*', position)) {
      depth += 1;
      position += 2;
    } else if (source.startsWith('*/', position)) {
      depth -= 1;
      position += 2;
    } else {
      position += 1;
    }
  }

  if (depth > 0) {
    throw new AuditError('unterminated Rust comment');
  }

  return position;
}

// The index just past the closing quote of the string opening at `start`.
function stringEnd(source: string, start: number): number {
  let end = start + 1;

  while (end < source.length) {
    if (source[end] === '\\') {
      end += 2;
    } else if (source[end] === '"') {
      return end + 1;
    } else {
      end += 1;
    }
  }

  throw new AuditError('unterminated Rust string');
}

function matching(
  items: string[],
  start: number,
  opening: string,
  closing: string
): number {
  let depth = 0;

  for (let index = start; index < items.length; index += 1) {
    if (items[index] === opening) {
      depth += 1;
    } else if (items[index] === closing) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  throw new AuditError(`unmatched ${opening}`);
}

function indexFrom(items: string[], item: string, start: number): number {
  const index = items.indexOf(item, start);
  if (index < 0) {
    throw new Error(`${JSON.stringify(item)} is not in the token list`);
  }

  return index;
}

function method(source: string, name: string): Method {
  const items = tokens(source);

  for (let index = 0; index < items.length - 2; index += 1) {
    if (items[index] !== 'fn' || items[index + 1] !== name) {
      continue;
    }

    const argumentStart = indexFrom(items, '(', index + 2);
    const argumentEnd = matching(items, argumentStart, '(', ')');
    const bodyStart = indexFrom(items, '{', argumentEnd + 1);
    const bodyEnd = matching(items, bodyStart, '{', '}');
    let parameters = items.slice(argumentStart + 1, argumentEnd);
    if (parameters.at(-1) === ',') {
      parameters = parameters.slice(0, -1);
    }

    return [
      parameters,
      items.slice(argumentEnd + 1, bodyStart),
      items.slice(bodyStart + 1, bodyEnd),
    ];
  }

  throw new AuditError(`missing method ${name}`);
}

function same(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

function equal(label: string, expected: string[], actual: string[]): void {
  if (same(expected, actual)) {
    return;
  }

  const difference = unifiedDiff(expected, actual, 'expected', 'actual');
  throw new AuditError(`${label}\n${difference.slice(0, 60).join('\n')}`);
}

function equalMethods(label: string, expected: Method, actual: Method): void {
  equal(`${label} arguments`, expected[0], actual[0]);
  equal(`${label} return`, expected[1], actual[1]);
  equal(`${label} body`, expected[2], actual[2]);
}

// Every index at which `sequence` occurs in `items`.
function occurrences(items: string[], sequence: string[]): number[] {
  const positions: number[] = [];

  for (let index = 0; index < items.length; index += 1) {
    if (same(items.slice(index, index + sequence.length), sequence)) {
      positions.push(index);
    }
  }

  return positions;
}

function removeOnce(
  items: string[],
  sequence: string[],
  label: string
): string[] {
  const positions = occurrences(items, sequence);
  const index = positions[0];
  if (index === undefined || positions.length !== 1) {
    throw new AuditError(
      `${label}: expected one allowed addition, found ${positions.length}`
    );
  }

  return [...items.slice(0, index), ...items.slice(index + sequence.length)];
}

// Removes the permitted benchmark additions from a delayed copy: the trailing
// `delay` parameter, the measured sleep before COMMIT, and the duration that
// is returned alongside the original Ok value.
function normalizeDelayed(delayedMethod: Method, label: string): Method {
  const [delayedArguments, delayedReturns, delayedBody] = delayedMethod;
  const addition = [',', 'delay', ':', 'Duration'];
  if (!same(delayedArguments.slice(-addition.length), addition)) {
    throw new AuditError(
      `${label}: delay must be the sole additional last parameter`
    );
  }
  const parameters = delayedArguments.slice(0, -addition.length);

  // The old result is retained unchanged, with the measured delay alongside it.
  const returnStart = ['-', '>', 'Result', '<', '('];
  const returnEnd = [',', 'Duration', ')', ',', 'MessageError', '>'];
  const delayedReturn =
    same(delayedReturns.slice(0, 5), returnStart) &&
    same(delayedReturns.slice(-6), returnEnd);
  if (!delayedReturn) {
    throw new AuditError(`${label}: unexpected delayed return type`);
  }
  const returns = [
    '-',
    '>',
    'Result',
    '<',
    ...delayedReturns.slice(5, -6),
    ',',
    'MessageError',
    '>',
  ];

  const delay = tokens(
    'let hold_started = Instant::now(); tokio::time::sleep(delay).await; let observed_delay = hold_started.elapsed();'
  );
  const commit = tokens('tx.commit().await.map_err(database_error)?;');
  const combined = [...delay, ...commit];
  const bodyWithout = removeOnce(delayedBody, combined, label);
  const insertion = occurrences(delayedBody, combined)[0] ?? 0;
  const body = [
    ...bodyWithout.slice(0, insertion),
    ...commit,
    ...bodyWithout.slice(insertion),
  ];

  const finalOk = body.lastIndexOf('Ok');
  if (finalOk < 0) {
    throw new Error(`${label}: the body has no Ok value`);
  }

  let result = body.slice(finalOk);
  if (same(result.slice(-3), [',', ')', ')'])) {
    result = [...result.slice(0, -3), ')', ')'];
  }
  const delayedOk =
    same(result.slice(0, 3), ['Ok', '(', '(']) &&
    same(result.slice(-4), [',', 'observed_delay', ')', ')']);
  if (!delayedOk) {
    throw new AuditError(
      `${label}: expected only the measured delay alongside the original Ok value`
    );
  }

  return [
    parameters,
    returns,
    [...body.slice(0, finalOk), 'Ok', '(', ...result.slice(3, -4), ')'],
  ];
}

function readText(path: string): string {
  return readFileSync(join(ROOT, path), 'utf8').replace(/\r\n?/g, '\n');
}

function renamed(items: string[], from: string, to: string): string[] {
  return items.map((token) => (token === from ? to : token));
}

function pinnedSource(): string {
  const command = ['git', '-C', ROOT, 'show', `${BASE_COMMIT}:${REPO_PATH}`];
  const shown = spawnSync('git', command.slice(1), {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  if (shown.error) {
    throw new AuditError(shown.error.message);
  }

  if (shown.status !== 0) {
    const quoted = command.map((part) => `'${part}'`).join(', ');
    throw new AuditError(
      `Command '[${quoted}]' returned non-zero exit status ${shown.status}.`
    );
  }

  return shown.stdout.replace(/\r\n?/g, '\n');
}

function main(): void {
  const original = pinnedSource();
  const baseline = readText(BASELINE_PATH);
  const current = readText(REPO_PATH);
  const delayed = readText(DELAYED_PATH);

  for (const operation of ['create', 'edit', 'react', 'delete']) {
    const [oldArguments, oldReturns, oldBody] = method(original, operation);
    const before = method(baseline, `${operation}_before_sequences`);
    let beforeBody = renamed(
      before[2],
      'require_message_before_sequences_in',
      'require_message_in'
    );
    if (operation === 'react') {
      beforeBody = removeOnce(
        beforeBody,
        ['seq', ':', 'None', ','],
        'baseline reaction metadata'
      );
    }
    equal(`${operation} pinned baseline arguments`, oldArguments, before[0]);
    equal(`${operation} pinned baseline return`, oldReturns, before[1]);
    equal(`${operation} pinned baseline body`, oldBody, beforeBody);

    for (const previous of [true, false]) {
      const label = `${operation}${previous ? '_before_commit_delay' : '_after_commit_delay'}`;
      const expected = previous
        ? method(baseline, `${operation}_before_sequences`)
        : method(current, operation);
      const normalized = normalizeDelayed(method(delayed, label), label);
      if (previous) {
        normalized[2] = renamed(
          normalized[2],
          'require_message_delayed_before_in',
          'require_message_before_sequences_in'
        );
      }

      equalMethods(label, expected, normalized);
      console.log(
        `PASS ${label}: identical source tokens except measured delay and its return value`
      );
    }
  }

  const oldHelper = method(original, 'require_message_in');
  for (const [source, name] of [
    [baseline, 'require_message_before_sequences_in'],
    [delayed, 'require_message_delayed_before_in'],
  ] as const) {
    const actualHelper = method(source, name);
    equalMethods(name, oldHelper, actualHelper);
    console.log(`PASS ${name}: pinned original hydration lookup`);
  }

  console.log(
    `PASS pinned baseline bodies match ${BASE_COMMIT}; SQL literals are compared byte-for-byte`
  );
}

try {
  main();
} catch (error) {
  const reportable =
    error instanceof AuditError ||
    (error instanceof Error && 'syscall' in error);
  if (!reportable) {
    throw error;
  }

  process.stderr.write(`FAIL ${error.message}\n`);
  process.exit(1);
}
