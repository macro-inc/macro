import { describe, expect, it, vi } from 'vitest';
import {
  liveProblem,
  PUBLISHED,
  readTracks,
  stamp,
  versionCodeStatus,
} from './android-play-status.mjs';

const hash = 'a'.repeat(40);
const live = {
  status: 'completed',
  versionCodes: ['3'],
  releaseNotes: [{ language: 'en-US', text: stamp(hash, 42) }],
};
const production = { track: 'production', releases: [live] };
const internal = {
  track: 'internal',
  releases: [{ status: 'completed', versionCodes: ['4'], releaseNotes: [{ language: 'en-US', text: stamp('b'.repeat(40), 43) }] }],
};
const published = {
  releases: [
    { releaseName: '2', track: 'production', activeArtifacts: [{ versionCode: 2 }], releaseLifecycleState: PUBLISHED },
    { releaseName: '3', track: 'production', activeArtifacts: [{ versionCode: 3 }], releaseLifecycleState: PUBLISHED },
  ],
};
const withLifecycle = (state) => ({
  releases: [{ releaseName: '3', track: 'production', activeArtifacts: [{ versionCode: 3 }], releaseLifecycleState: state }],
});

describe('versionCodeStatus', () => {
  it('reads the published production release and its provenance stamp', () => {
    expect(versionCodeStatus(production, internal, 3, published)).toEqual({
      versionCode: '3',
      promoted: true,
      live: true,
      productionStatus: 'completed',
      lifecycle: PUBLISHED,
      internalStatus: null,
      stamp: { tree: hash, pr: '42' },
    });
  });

  it('reports a version that is only in internal testing', () => {
    const status = versionCodeStatus(production, internal, '4', published);
    expect(status.live).toBe(false);
    expect(status.promoted).toBe(false);
    expect(status.internalStatus).toBe('completed');
    expect(liveProblem(status)).toMatch(/only on the internal track/);
  });

  it('reports an unknown version', () => {
    expect(liveProblem(versionCodeStatus(production, internal, '9', published))).toMatch(/neither/);
    expect(liveProblem(versionCodeStatus({ track: 'production' }, undefined, '9', undefined))).toMatch(/neither/);
  });

  it('treats a non-completed production release as not live', () => {
    const staged = { track: 'production', releases: [{ ...live, status: 'inProgress' }] };
    const status = versionCodeStatus(staged, internal, '3', published);
    expect(status.promoted).toBe(true);
    expect(liveProblem(status)).toMatch(/inProgress/);
  });

  it('is promoted but not live until Google publishes the release', () => {
    const cases: Array<[string, RegExp]> = [
      ['RELEASE_LIFECYCLE_STATE_IN_REVIEW', /still in Google Play review/],
      ['RELEASE_LIFECYCLE_STATE_APPROVED_NOT_PUBLISHED', /not been published/],
      ['RELEASE_LIFECYCLE_STATE_NOT_APPROVED', /rejected/],
      ['RELEASE_LIFECYCLE_STATE_DRAFT', /review state is RELEASE_LIFECYCLE_STATE_DRAFT/],
    ];
    for (const [state, message] of cases) {
      const status = versionCodeStatus(production, internal, '3', withLifecycle(state));
      expect(status.promoted).toBe(true);
      expect(status.live).toBe(false);
      expect(status.lifecycle).toBe(state);
      expect(liveProblem(status, { nativeHash: hash })).toMatch(message);
    }
  });

  it('fails closed when the release list does not know the version code', () => {
    const status = versionCodeStatus(production, internal, '3', { releases: [] });
    expect(status.live).toBe(false);
    expect(liveProblem(status)).toMatch(/missing from the production release list/);
  });
});

describe('liveProblem', () => {
  const status = versionCodeStatus(production, internal, '3', published);
  it('passes when the stamp matches', () => {
    expect(liveProblem(status, { nativeHash: hash, pr: 42 })).toBeNull();
    expect(liveProblem(status)).toBeNull();
  });
  it('fails on a different native tree or PR', () => {
    expect(liveProblem(status, { nativeHash: 'c'.repeat(40) })).toMatch(/native code changed/);
    expect(liveProblem(status, { pr: 7 })).toMatch(/released for PR #42, not #7/);
  });
  it('names a missing stamp', () => {
    const unstamped = { track: 'production', releases: [{ status: 'completed', versionCodes: ['3'] }] };
    expect(liveProblem(versionCodeStatus(unstamped, internal, '3', published), { nativeHash: hash })).toMatch(/no provenance stamp/);
  });
});

describe('readTracks', () => {
  it('lists production releases, then reads both tracks through a discarded edit', async () => {
    const calls: string[] = [];
    const request = vi.fn(async (url: string, init: RequestInit) => {
      const path = url.split('/applications/com.macro.workspace.mobile')[1];
      calls.push(`${init.method} ${path}`);
      const body = path === '/tracks/production/releases'
        ? published
        : path === '/edits'
          ? { id: 'edit-1' }
          : path.endsWith('/tracks/production')
            ? production
            : path.endsWith('/tracks/internal')
              ? internal
              : undefined;
      return { ok: true, status: body === undefined ? 204 : 200, json: async () => body };
    });
    await expect(readTracks({ token: 't', request })).resolves.toEqual({
      production,
      internal,
      summaries: published,
    });
    expect(calls).toEqual([
      'GET /tracks/production/releases',
      'POST /edits',
      'GET /edits/edit-1/tracks/production',
      'GET /edits/edit-1/tracks/internal',
      'DELETE /edits/edit-1',
    ]);
  });

  it('rejects without a token', async () => {
    await expect(readTracks({ token: '' })).rejects.toThrow(/access token/);
  });
});
