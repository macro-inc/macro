import { describe, expect, test } from 'bun:test';
import { resolveRelease } from '../scripts/release';

const published = ['0.0.1', '0.0.2', '0.1.0'];

describe('resolveRelease', () => {
  test('releases a version above everything published', () => {
    expect(resolveRelease('0.1.1', published)).toEqual({
      kind: 'release',
      version: '0.1.1',
      tag: 'sdk-v0.1.1',
      distTag: 'latest',
    });
  });

  test('treats an already published version as a no-op', () => {
    expect(resolveRelease('0.0.2', published).kind).toBe('published');
  });

  test('rejects a downgrade', () => {
    const resolution = resolveRelease('0.0.3', published);
    expect(resolution.kind).toBe('rejected');
    expect(resolution).toHaveProperty(
      'reason',
      '0.0.3 is below the published 0.1.0',
    );
  });

  test('rejects a version that is not semver', () => {
    expect(resolveRelease('0.1', published).kind).toBe('rejected');
  });

  test('keeps a prerelease off the latest dist-tag', () => {
    expect(resolveRelease('0.2.0-rc.1', published)).toMatchObject({
      kind: 'release',
      distTag: 'next',
    });
  });

  test('releases the first version when nothing is published', () => {
    expect(resolveRelease('0.0.1', []).kind).toBe('release');
  });

  test('compares numerically, not lexically', () => {
    expect(resolveRelease('0.10.0', ['0.9.0']).kind).toBe('release');
    expect(resolveRelease('0.9.0', ['0.10.0']).kind).toBe('rejected');
  });
});
