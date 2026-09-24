import {
  createRoutesManifest,
  decodeRoute,
  encodeRoute,
  getRouteClaim,
  getRouteSearchNamespaces,
  routeParams,
} from '@app/lib/split-router';
import { describe, expect, it } from 'vitest';
import { callDetailSearchCodec } from './call-route';
import { callDetailRoute } from './route';

const routes = createRoutesManifest({ definitions: [callDetailRoute] });

describe('call detail route', () => {
  it('round-trips the call id and claims the legacy call block', () => {
    const entry = decodeRoute(routes, ['call', 'call-1']);
    expect(entry).toBeDefined();
    expect(routeParams(entry!.location.route)).toEqual({ callId: 'call-1' });
    expect(encodeRoute(routes, entry!)).toEqual(['call', 'call-1']);
    expect(getRouteClaim(routes, entry!.location.route)).toEqual({
      namespace: 'block',
      id: 'call:call-1',
    });
    expect(getRouteSearchNamespaces(routes, entry!.location.route)).toEqual(
      new Set(['call-detail'])
    );
  });

  it('serializes a transcript deep link in the call detail namespace', () => {
    expect(
      callDetailSearchCodec.serialize({ transcriptId: 'segment-1', seek: '' })
    ).toEqual({
      transcriptId: ['segment-1'],
    });
  });

  it('keeps a new seek token for repeated transcript navigation', () => {
    expect(
      callDetailSearchCodec.serialize({
        transcriptId: 'segment-1',
        seek: 'repeat-2',
      })
    ).toEqual({ transcriptId: ['segment-1'], seek: ['repeat-2'] });
  });

  it('rejects a missing call id', () => {
    expect(decodeRoute(routes, ['call'])).toBeUndefined();
  });
});
