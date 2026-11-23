import { describe, expect, it } from 'vitest';
import { parseDomain } from './domain';

describe('parseDomain', () => {
  it('lowercases a bare domain', () => {
    expect(parseDomain('  Acme.COM ')).toBe('acme.com');
    expect(parseDomain('mail.acme.co.uk')).toBe('mail.acme.co.uk');
  });

  it('takes the domain of an address', () => {
    expect(parseDomain('Person@Example.COM')).toBe('example.com');
    expect(parseDomain('@example.com')).toBe('example.com');
  });

  it('takes the host of a website without www', () => {
    expect(parseDomain('https://www.acme.com/about?x=1')).toBe('acme.com');
    expect(parseDomain('www.acme.com')).toBe('acme.com');
    expect(parseDomain('acme.com/pricing')).toBe('acme.com');
  });

  it('rejects text that names no domain', () => {
    expect(parseDomain('acme')).toBeUndefined();
    expect(parseDomain('acme .com')).toBeUndefined();
    expect(parseDomain('person@')).toBeUndefined();
    expect(parseDomain('')).toBeUndefined();
    expect(parseDomain(`${'a'.repeat(250)}.com`)).toBeUndefined();
  });
});
