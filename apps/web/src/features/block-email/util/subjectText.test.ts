import type { ApiMessage } from '@service-email/generated/schemas';
import { describe, expect, it } from 'vitest';
import { displaySubject, getSubjectText } from './subjectText';

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

describe('getSubjectText', () => {
  const messageWithSubject = (subject: string): ApiMessage =>
    ({ subject }) as ApiMessage;

  it('preserves an existing reply prefix regardless of case', () => {
    expect(getSubjectText(messageWithSubject('Re: Q3 contract'), 'reply')).toBe(
      'Re: Q3 contract'
    );
    expect(getSubjectText(messageWithSubject('RE: Q3 contract'), 'reply')).toBe(
      'RE: Q3 contract'
    );
  });

  it('prepends a reply prefix when Re: only appears later in the subject', () => {
    expect(
      getSubjectText(messageWithSubject('Project Re: timeline'), 'reply')
    ).toBe('Re: Project Re: timeline');
  });
});
