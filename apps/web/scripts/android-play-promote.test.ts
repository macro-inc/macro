import { describe, expect, it, vi } from 'vitest';
import {
  productionPromotion,
  promoteToProduction,
  validateVersionCode,
} from './android-play-promote.mjs';

const testedRelease = {
  name: 'v2026.10.13',
  status: 'completed',
  versionCodes: ['7'],
  releaseNotes: [{ language: 'en-US', text: 'Tested release notes' }],
  inAppUpdatePriority: 2,
};
const internal = { track: 'internal', releases: [testedRelease] };
const production = {
  track: 'production',
  releases: [{ status: 'completed', versionCodes: ['6'] }],
};

describe('production promotion selection', () => {
  it('promotes only the selected version and preserves its release metadata', () => {
    expect(productionPromotion(internal, production, '7')).toEqual({
      track: 'production',
      releases: [testedRelease],
    });
  });

  it('supports the first production release', () => {
    expect(productionPromotion(internal, { track: 'production' }, '7')).toEqual(
      {
        track: 'production',
        releases: [testedRelease],
      }
    );
  });

  it.each(['', '0', '-1', '01', '7.0', '7\n', '2100000001', 'v2026.10.13'])(
    'rejects invalid version code %j',
    (version) => {
      expect(() => validateVersionCode(version)).toThrow(/version code/);
    }
  );

  it.each(['draft', 'inProgress', 'halted'])(
    'refuses an internal release with status %s',
    (status) => {
      const source = { ...internal, releases: [{ ...testedRelease, status }] };
      expect(() => productionPromotion(source, production, '7')).toThrow(
        /internal testing/
      );
    }
  );

  it('rejects versions that are no longer active in internal testing', () => {
    expect(() => productionPromotion(internal, production, '8')).toThrow(
      /internal testing/
    );
  });

  it('does not silently promote a subset of a multi-version release', () => {
    const source = {
      ...internal,
      releases: [{ ...testedRelease, versionCodes: ['7', '8'] }],
    };
    expect(() => productionPromotion(source, production, '7')).toThrow(
      /single-version/
    );
  });

  it.each(['draft', 'inProgress', 'halted'])(
    'preserves an existing %s production release',
    (status) => {
      const target = {
        ...production,
        releases: [{ status, versionCodes: ['6'] }],
      };
      expect(() => productionPromotion(internal, target, '7')).toThrow(
        /resolve it in Play Console/
      );
    }
  );

  it('rejects production downgrades', () => {
    const target = {
      ...production,
      releases: [{ status: 'completed', versionCodes: ['8'] }],
    };
    expect(() => productionPromotion(internal, target, '7')).toThrow(
      /newer version/
    );
  });

  it('treats a repeated completed promotion as a no-op', () => {
    expect(
      productionPromotion(
        internal,
        { ...production, releases: [testedRelease] },
        '7'
      )
    ).toBeNull();
  });

  it('fails closed on unexpected track responses', () => {
    expect(() => productionPromotion({}, production, '7')).toThrow(
      /track response/
    );
    expect(() =>
      productionPromotion(
        internal,
        { track: 'production', releases: [{}] },
        '7'
      )
    ).toThrow(/Missing version codes/);
  });
});

function mockPlay(options: { failure?: string; target?: unknown } = {}) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const request = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      const path = url.pathname.split('/edits')[1] + url.search;
      const method = init?.method ?? 'GET';
      calls.push({
        method,
        path,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      expect(new Headers(init?.headers).get('Authorization')).toBe(
        'Bearer test-token'
      );
      if (path === options.failure)
        return Response.json({ error: 'test failure' }, { status: 403 });
      if (method === 'DELETE') return new Response(null, { status: 204 });
      if (path === '/edit-1/tracks/internal') return Response.json(internal);
      if (path === '/edit-1/tracks/production')
        return Response.json(options.target ?? production);
      return Response.json({ id: 'edit-1' });
    }
  );
  return { calls, request };
}

describe('Google Play promotion transaction', () => {
  it('updates only production, validates, and commits without uploading a binary', async () => {
    const { request, calls } = mockPlay();
    await expect(
      promoteToProduction({ token: 'test-token', versionCode: '7', request })
    ).resolves.toBe('submitted');
    expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
      'POST ',
      'GET /edit-1/tracks/internal',
      'GET /edit-1/tracks/production',
      'PUT /edit-1/tracks/production',
      'POST /edit-1:validate',
      'POST /edit-1:commit?changesNotSentForReview=false',
    ]);
    expect(calls[3].body).toEqual({
      track: 'production',
      releases: [testedRelease],
    });
  });

  it('supports leaving review submission to Play Console', async () => {
    const { request, calls } = mockPlay();
    await promoteToProduction({
      token: 'test-token',
      versionCode: '7',
      changesNotSentForReview: true,
      request,
    });
    expect(calls.at(-1)?.path).toBe(
      '/edit-1:commit?changesNotSentForReview=true'
    );
  });

  it('discards the edit without writes when the version is already in production', async () => {
    const { request, calls } = mockPlay({
      target: { ...production, releases: [testedRelease] },
    });
    await expect(
      promoteToProduction({ token: 'test-token', versionCode: '7', request })
    ).resolves.toBe('already-production');
    expect(calls.map(({ method }) => method)).toEqual([
      'POST',
      'GET',
      'GET',
      'DELETE',
    ]);
  });

  it('discards the edit without writes when the requested version was not tested', async () => {
    const { request, calls } = mockPlay();
    await expect(
      promoteToProduction({ token: 'test-token', versionCode: '8', request })
    ).rejects.toThrow(/internal testing/);
    expect(calls.map(({ method }) => method)).toEqual([
      'POST',
      'GET',
      'GET',
      'DELETE',
    ]);
  });

  it.each([
    '/edit-1/tracks/internal',
    '/edit-1:validate',
    '/edit-1:commit?changesNotSentForReview=false',
  ])(
    'discards failed edit at %s without retrying the commit',
    async (failure) => {
      const { request, calls } = mockPlay({ failure });
      await expect(
        promoteToProduction({ token: 'test-token', versionCode: '7', request })
      ).rejects.toThrow(/HTTP 403/);
      expect(calls.at(-1)).toEqual({
        method: 'DELETE',
        path: '/edit-1',
        body: undefined,
      });
      expect(calls.filter(({ path }) => path.includes(':commit'))).toHaveLength(
        failure.includes(':commit') ? 1 : 0
      );
    }
  );

  it('rejects invalid input before creating an edit', async () => {
    const { request } = mockPlay();
    await expect(
      promoteToProduction({ token: 'test-token', versionCode: '0', request })
    ).rejects.toThrow(/version code/);
    await expect(
      promoteToProduction({ token: '', versionCode: '7', request })
    ).rejects.toThrow(/access token/);
    expect(request).not.toHaveBeenCalled();
  });
});
