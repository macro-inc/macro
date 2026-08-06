import { describe, expect, it } from 'vitest';

import { displaySubject } from './subjectText';

describe('displaySubject', () => {
  it('returns the subject as-is when there is nothing to strip', () => {
    expect(displaySubject('Q3 contract')).toBe('Q3 contract');
  });

  it('strips a reply prefix, whatever its case', () => {
    expect(displaySubject('Re: Q3 contract')).toBe('Q3 contract');
    expect(displaySubject('re: Q3 contract')).toBe('Q3 contract');
    expect(displaySubject('RE: Q3 contract')).toBe('Q3 contract');
  });

  it('strips the whole run of prefixes a long thread accumulates', () => {
    expect(displaySubject('Re: RE: re: Q3 contract')).toBe('Q3 contract');
  });

  it('leaves a subject that merely starts with "re" alone', () => {
    expect(displaySubject('Renewal terms')).toBe('Renewal terms');
  });

  // Previously this path did `subject!.replace(...)` on a missing subject, which
  // threw rather than falling back.
  it('names a missing or blank subject', () => {
    expect(displaySubject(undefined)).toBe('[No subject]');
    expect(displaySubject(null)).toBe('[No subject]');
    expect(displaySubject('')).toBe('[No subject]');
    expect(displaySubject('   ')).toBe('[No subject]');
  });

  it('names a subject that is nothing but reply prefixes', () => {
    expect(displaySubject('Re: ')).toBe('[No subject]');
  });
});
