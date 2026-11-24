import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  completeEmailSearchOperator,
  emailSearchCompletionText,
  isUnfinishedEmailSearchOperator,
  readsAsEmailSearchOperator,
} from './email-search-operators';

type TypedOperator = { typed: string; operator: boolean };

// The search service's tests read the same cases, so the field draws exactly
// the terms the service reads as operators.
const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../../..'
);
const TYPED_OPERATORS: TypedOperator[] = JSON.parse(
  readFileSync(
    resolve(
      repositoryRoot,
      'crates/search_service/src/api/search/email_operators/typed_operators.json'
    ),
    'utf8'
  )
);

describe('readsAsEmailSearchOperator', () => {
  it.each(TYPED_OPERATORS)('$typed: $operator', ({ typed, operator }) => {
    expect(readsAsEmailSearchOperator(typed)).toBe(operator);
  });
});

describe('isUnfinishedEmailSearchOperator', () => {
  it('holds an operator with no value yet, or part of one', () => {
    for (const typed of [
      'subject:',
      '-from:',
      'is:',
      'is:un',
      'has:att',
      'after:',
      'after:2026',
      'after:2026/',
      'after:2026/0',
      'before:2026/06',
      'before:2026/06/',
      'before:2026/12/0',
      'newer_than:3',
      '-in:',
      '-in:se',
    ]) {
      expect(isUnfinishedEmailSearchOperator(typed), typed).toBe(true);
    }
  });

  it('lets a finished operator, a value that can no longer be one, or a word through', () => {
    for (const typed of [
      'subject:lunch',
      'is:unread',
      'is:important',
      'newer_than:3x',
      'after:2026/06/01',
      'after:2026/13/01',
      'after:2026/02/30',
      'after:2026/13/',
      'after:2026/0/',
      'after:2026/01-05',
      '-in:sent',
      '-in:berlin',
      'lunch',
      're:',
    ]) {
      expect(isUnfinishedEmailSearchOperator(typed), typed).toBe(false);
    }
  });
});

describe('completeEmailSearchOperator', () => {
  const texts = (token: string) =>
    completeEmailSearchOperator(token).map(emailSearchCompletionText);

  it('offers the operators whose names start with two or more letters typed', () => {
    expect(texts('s')).toEqual([]);
    expect(texts('su')).toEqual(['subject:']);
    expect(texts('Ne')).toEqual(['newer_than:']);
    expect(texts('-fr')).toEqual(['-from:']);
    expect(texts('budget')).toEqual([]);
  });

  it('offers the values that finish is: and has:', () => {
    expect(texts('is:')).toEqual([
      'is:unread ',
      'is:read ',
      'is:starred ',
      'is:shared ',
    ]);
    expect(texts('is:s')).toEqual(['is:starred ', 'is:shared ']);
    expect(texts('-has:')).toEqual(['-has:attachment ']);
    expect(texts('subject:')).toEqual([]);
  });

  it('offers nothing inside a quoted phrase', () => {
    expect(texts('"su')).toEqual([]);
  });
});
