#!/usr/bin/env bun
// Refresh or verify the append proof's exact SQL without accessing a database.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parseCommandLine,
  ProofError,
  runProof,
  usageError,
} from './proof_support';

const HELP = `usage: sync_append_plan_sql.ts [-h] [--check]

Refresh or verify the append proof's exact SQL without accessing a database.

options:
  -h, --help  show this help message and exit
  --check     fail if the proof SQL is stale
`;

const ROOT = join(import.meta.dir, '../../..');
const SOURCE = join(ROOT, 'crates/channel_change_db_utils/src/append.rs');
const PROOF = join(import.meta.dir, 'channel_change_append_plans.sql');
const NAMES = ['append_scalar', 'append_activity'];

function readText(path: string): string {
  return readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
}

function sourceQueries(): string[] {
  const pattern = /sqlx::query(?:_scalar)?!\(\s*r#"(.*?)"#/gs;
  const queries = Array.from(
    readText(SOURCE).matchAll(pattern),
    (match) => match[1] ?? ''
  );

  if (queries.length !== NAMES.length) {
    throw new ProofError('expected the scalar and activity append queries');
  }

  return queries;
}

// Replaces the body of each `PREPARE <name> ... AS` block, up to the `;` that
// ends its line, with the query text from append.rs.
function synchronized(original: string): string {
  let proof = original;

  for (const [index, query] of sourceQueries().entries()) {
    const name = NAMES[index];
    const pattern = new RegExp(
      `(PREPARE ${name}(?: \\([^\\n]+\\))? AS).*?;(?=\\n)`,
      'gs'
    );
    const matches = [...proof.matchAll(pattern)];
    const match = matches[0];

    if (!match || matches.length !== 1) {
      throw new ProofError(`expected exactly one PREPARE ${name} block`);
    }

    const separator = query.startsWith('\n') ? '' : ' ';
    const before = proof.slice(0, match.index);
    const after = proof.slice(match.index + match[0].length);
    proof = `${before}${match[1]}${separator}${query};${after}`;
  }

  return proof;
}

function main(): void {
  const { values, positionals } = parseCommandLine(HELP, {
    check: { type: 'boolean', default: false },
  });
  if (positionals.length > 0) {
    usageError(HELP, `unrecognized arguments: ${positionals.join(' ')}`);
  }

  const original = readText(PROOF);
  const expected = synchronized(original);

  if (!values.check) {
    writeFileSync(PROOF, expected);
    console.log('Updated both append proof queries from append.rs');
    return;
  }

  if (original !== expected) {
    throw new ProofError(
      'append proof SQL differs from append.rs; run this script without --check'
    );
  }

  console.log(
    'PASS: both append proof queries match append.rs byte-for-byte'
  );
}

runProof(main);
