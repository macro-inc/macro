import { describe, expect, it } from 'vitest';
import { parseProjectRoute, projectRouteId } from './route';

const id = '01992d2f-8444-7000-8000-000000000001';

describe('project navigation', () => {
  it.each(['overview', 'tasks'] as const)(
    'restores project identity and the %s section independently of component params',
    (section) => {
      const route = { id, section };
      expect(projectRouteId(route)).toBe(`initiative-view~${id}~${section}`);
      expect(parseProjectRoute(projectRouteId(route))).toEqual(route);
    }
  );

  it('restores legacy activity links as Overview', () => {
    expect(parseProjectRoute(`initiative-view~${id}~activity`)).toEqual({
      id,
      section: 'overview',
    });
  });

  it('rejects folder identities, invalid ids and unsupported sections', () => {
    for (const route of [
      'project~folder',
      'initiative-view~bad-id',
      `initiative-view~${id}~board`,
      `initiative-view~${id}~tasks~extra`,
    ]) {
      expect(parseProjectRoute(route)).toBeUndefined();
    }
  });
});

it('restores exact discussions on Overview, including legacy Activity links', () => {
  const discussionId = '01992d2f-8444-7000-8000-000000000002';
  const route = { id, section: 'overview' as const, discussionId };
  expect(projectRouteId(route)).toBe(
    `initiative-view~${id}~overview~${discussionId}`
  );
  expect(parseProjectRoute(projectRouteId(route))).toEqual(route);
  expect(
    parseProjectRoute(`initiative-view~${id}~activity~${discussionId}`)
  ).toEqual(route);
  expect(
    parseProjectRoute(`initiative-view~${id}~tasks~${discussionId}`)
  ).toBeUndefined();
  expect(
    parseProjectRoute(`initiative-view~${id}~activity~${discussionId}~extra`)
  ).toBeUndefined();
  expect(
    parseProjectRoute(`initiative-view~${id}~overview~invalid`)
  ).toBeUndefined();
  expect(parseProjectRoute(`initiative-view~${id}~overview~`)).toBeUndefined();
});
