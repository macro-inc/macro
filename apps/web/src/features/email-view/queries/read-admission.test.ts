import type { EmailEntity } from '@entity';
import { describe, expect, it } from 'vitest';
import { emailAdmissionBatches, mergeEmailAdmission } from './read-admission';

const email = (id: string, isRead = false): EmailEntity => ({
  type: 'email',
  id,
  name: id,
  ownerId: 'viewer',
  isRead,
  isDraft: false,
  isImportant: true,
  done: false,
});
const ids = (emails: EmailEntity[]) => emails.map((email) => email.id);

describe('email read admission order', () => {
  it('keeps missing consecutive read rows between their discovery neighbors', () => {
    const previous = ['a', 'b', 'c', 'd'].map((id) => email(id));
    expect(
      ids(mergeEmailAdmission(previous, [email('a'), email('d')]))
    ).toEqual(['a', 'b', 'c', 'd']);
    expect(ids(previous)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('accepts newer discoveries and later pages without duplicating retained rows', () => {
    const previous = ['a', 'b', 'c'].map((id) => email(id));
    const result = mergeEmailAdmission(previous, [
      email('new'),
      email('a', true),
      email('c'),
      email('older'),
      email('older'),
    ]);
    expect(ids(result)).toEqual(['new', 'a', 'b', 'c', 'older']);
    expect(result[1].isRead).toBe(true);
  });
  it('keeps boundary rows when only one neighbor survives', () => {
    expect(
      ids(
        mergeEmailAdmission(
          ['a', 'b', 'c'].map((id) => email(id)),
          [email('b')]
        )
      )
    ).toEqual(['a', 'b', 'c']);
  });
  it('bounds every admission lookup to its complete ID page', () => {
    const rows = Array.from({ length: 205 }, (_, i) => email(String(i)));
    const batches = emailAdmissionBatches(rows);
    expect(batches.map((batch) => batch.length)).toEqual([100, 100, 5]);
    expect(batches.flat()).toEqual(ids(rows));
  });
});
