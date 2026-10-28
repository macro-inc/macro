import { describe, expect, it } from 'vitest';
import { getFirstName } from './name';

describe('getFirstName', () => {
  it('returns the first name from a standard "FirstName LastName" format', () => {
    expect(getFirstName('John Doe')).toBe('John');
    expect(getFirstName('Jane Smith')).toBe('Jane');
  });

  it('returns the first name from "LastName, FirstName" format (Outlook style)', () => {
    expect(getFirstName('Sexton, Firstname')).toBe('Firstname');
    expect(getFirstName('Doe, John')).toBe('John');
    expect(getFirstName('Smith, Jane')).toBe('Jane');
  });

  it('returns the first name from "LastName, FirstName MiddleInitial" format', () => {
    expect(getFirstName('Doe, John A')).toBe('John');
    expect(getFirstName('Doe, John A.')).toBe('John');
    expect(getFirstName('Smith, Jane M')).toBe('Jane');
  });

  it('preserves names starting with "the"', () => {
    expect(getFirstName('The Company')).toBe('The Company');
    expect(getFirstName('the team,')).toBe('the team');
  });

  it('strips trailing commas', () => {
    expect(getFirstName('John,')).toBe('John');
  });

  it('handles empty or null input', () => {
    expect(getFirstName('')).toBe('');
    expect(getFirstName(null)).toBe('');
    expect(getFirstName(undefined)).toBe('');
  });

  it('handles single word names', () => {
    expect(getFirstName('John')).toBe('John');
    expect(getFirstName('Madonna')).toBe('Madonna');
  });
});
