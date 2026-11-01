import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { manualSigningProject, signingProfiles } from './ios-signing.mjs';

const identifiers = [
  'com.macro.app.prod',
  'com.macro.app.prod.ShareExtension',
  'com.macro.app.prod.NotificationServiceExtension',
];
const bundles = identifiers.map((identifier, index) => ({
  id: `bundle-${index}`,
  attributes: { identifier },
}));
const profiles = bundles.map((bundle, index) => ({
  id: `profile-${index}`,
  attributes: {
    profileState: 'ACTIVE',
    expirationDate: '2099-01-01T00:00:00Z',
    uuid: `uuid-${index}`,
    profileContent: Buffer.from(`signed profile ${index}`).toString('base64'),
  },
  relationships: {
    bundleId: { data: { id: bundle.id } },
    certificates: { data: [{ id: 'distribution-cert' }] },
  },
}));

test('reuses all three profiles and matches exact identifiers across API pages', async () => {
  const api = vi.fn(async (url: string) => {
    if (url.startsWith('/v1/profiles?')) {
      return {
        data: profiles.slice(0, 1),
        links: { next: 'https://api.appstoreconnect.apple.com/v1/profiles-page-2' },
      };
    }
    if (url === '/v1/profiles-page-2') return { data: profiles.slice(1) };
    if (url.startsWith('/v1/bundleIds?')) {
      // Root identifier lookup includes both extensions, before the root.
      return { data: [...bundles].reverse() };
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  const result = await signingProfiles(api, identifiers, 'distribution-cert');
  expect(Object.keys(result)).toEqual(identifiers);
  expect(identifiers.map((identifier) => result[identifier].uuid)).toEqual([
    'uuid-0', 'uuid-1', 'uuid-2',
  ]);
  expect(api.mock.calls.some(([url]) => url === '/v1/profiles')).toBe(false);
});

test.each(['expired', 'invalid', 'wrong-certificate', 'missing'])(
  'creates a replacement for a %s profile with the supplied certificate',
  async (reason) => {
    const existing = structuredClone(profiles[0]);
    if (reason === 'expired') existing.attributes.expirationDate = '2000-01-01';
    if (reason === 'invalid') existing.attributes.profileState = 'INVALID';
    if (reason === 'wrong-certificate') {
      existing.relationships.certificates.data = [{ id: 'other-cert' }];
    }
    const api = vi.fn(async (url: string) => {
      if (url.startsWith('/v1/profiles?')) {
        return { data: reason === 'missing' ? [] : [existing] };
      }
      if (url.startsWith('/v1/bundleIds?')) return { data: bundles };
      if (url === '/v1/profiles') return { data: profiles[0] };
      throw new Error(`Unexpected request: ${url}`);
    });
    await signingProfiles(api, [identifiers[0]], 'distribution-cert');
    expect(api).toHaveBeenCalledWith('/v1/profiles', {
      method: 'POST',
      body: {
        data: {
          type: 'profiles',
          attributes: {
            name: expect.stringContaining(identifiers[0]),
            profileType: 'IOS_APP_STORE',
          },
          relationships: {
            bundleId: { data: { type: 'bundleIds', id: 'bundle-0' } },
            certificates: { data: [{ type: 'certificates', id: 'distribution-cert' }] },
          },
        },
      },
    });
  }
);

test('does not provision a prefix match when the exact bundle is missing', async () => {
  const api = vi.fn(async (url: string) => ({
    data: url.startsWith('/v1/profiles?') ? [] : bundles.slice(1),
  }));
  await expect(signingProfiles(api, [identifiers[0]], 'distribution-cert'))
    .rejects.toThrow('No registered Apple bundle ID');
  expect(api.mock.calls.some(([url]) => url === '/v1/profiles')).toBe(false);
});

test('switches every checked-in target to manual so Tauri cannot override the export style', () => {
  const project = readFileSync(new URL(
    '../tauri/src-tauri/gen/apple/app.xcodeproj/project.pbxproj', import.meta.url
  ), 'utf8');
  const manual = manualSigningProject(project);
  expect(manual).not.toContain('CODE_SIGN_STYLE = Automatic;');
  expect(manual.match(/CODE_SIGN_STYLE = Manual;/g)).toHaveLength(6);
  expect(manual.replaceAll('CODE_SIGN_STYLE = Manual;', 'CODE_SIGN_STYLE = Automatic;'))
    .toBe(project);
  expect(manualSigningProject(manual)).toBe(manual);
});
