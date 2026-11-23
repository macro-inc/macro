import { expect, test } from 'bun:test';
import { basename, dirname, resolve, segments, within } from '../path.ts';

test('basename', () => {
  expect(basename('/usr/bin/git')).toBe('git');
  expect(basename('git')).toBe('git');
  expect(basename('~/agent/bin/agent')).toBe('agent');
  expect(basename('/a/b/')).toBe('b');
  expect(basename('')).toBe('');
  expect(basename('/')).toBe('');
});

test('dirname', () => {
  expect(dirname('/a/b/c')).toBe('/a/b');
  expect(dirname('/a/b/')).toBe('/a');
  expect(dirname('/a')).toBe('/');
  expect(dirname('/')).toBe('/');
  expect(dirname('a')).toBe('.');
  expect(dirname('a/b')).toBe('a');
  expect(dirname(dirname('/r/.git/config'))).toBe('/r');
});

test('resolve', () => {
  expect(resolve('/a/b', 'c')).toBe('/a/b/c');
  expect(resolve('/a/b', '../c')).toBe('/a/c');
  expect(resolve('/a/b', './c/./d/')).toBe('/a/b/c/d');
  expect(resolve('/a/b', '/c')).toBe('/c');
  expect(resolve('/a', '/b', 'c')).toBe('/b/c');
  expect(resolve('/a//b/')).toBe('/a/b');
  expect(resolve('/a', '../../..')).toBe('/');
  expect(resolve('/')).toBe('/');
  expect(resolve('/a/b', '.')).toBe('/a/b');
  expect(resolve('/a/b', '')).toBe('/a/b');
  // Nothing absolute to start from: it stays relative.
  expect(resolve('a', '../b')).toBe('b');
  expect(resolve('a', '../../b')).toBe('../b');
  expect(resolve('')).toBe('.');
  expect(resolve('', 'Code/macro')).toBe('Code/macro');
  expect(resolve('/w', '~/x')).toBe('/w/~/x');
});

test('within', () => {
  expect(within('/home/owner/agent', '/home/owner/agent')).toBe(true);
  expect(within('/home/owner/agent/behavior', '/home/owner/agent')).toBe(true);
  expect(within('/home/owner/agent-notes', '/home/owner/agent')).toBe(false);
  expect(within('/home/owner', '/home/owner/agent')).toBe(false);
  expect(within('/a', '/')).toBe(true);
});

test('segments', () => {
  expect(segments('/a//b/')).toEqual(['a', 'b']);
  expect(segments('/')).toEqual([]);
});
