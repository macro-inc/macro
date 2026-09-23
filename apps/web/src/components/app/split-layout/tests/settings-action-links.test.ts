import { settingsRoute } from '@app/features/settings/route';
import { createLocationSync } from '@app/lib/split-router/location-sync';
import {
  createRoutesManifest,
  decodeRoute,
} from '@app/lib/split-router/routes';
import { parseExternalLocation } from '@app/lib/split-router/url';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/lib/analytics', () => ({ analytics: {} }));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@core/context/user', () => ({
  useHasPermission: () => () => true,
}));

const routes = createRoutesManifest({
  definitions: [settingsRoute, { id: 'inbox', path: 'inbox' }],
});

function synchronize(from: string, to: string[]) {
  const commit = vi.fn();
  const location = createLocationSync({
    routes,
    location: {
      read: () => parseExternalLocation(from),
      commit,
      subscribe: () => () => {},
    },
  });
  location.commit([decodeRoute(routes, to)!], {
    history: 'replace',
    preserveHash: false,
  });
  return commit;
}

describe('settings action links in the split router', () => {
  it.each(['agents', 'runtimes', 'harness'])(
    'preserves pairing codes when synchronizing /settings/%s',
    (slug) => {
      expect(
        synchronize(`/settings/${slug}?pair=3GTM-FNJ9&discard=value`, [
          'settings',
          'agents',
        ])
      ).toHaveBeenCalledWith(
        {
          pathname: '/settings/agents',
          search: '?pair=3GTM-FNJ9',
          hash: '',
        },
        { history: 'replace' }
      );
    }
  );

  it.each(['agents', 'runtimes', 'harness'])(
    'continues synchronizing an empty pairing code at /settings/%s',
    (slug) => {
      expect(
        synchronize(`/settings/${slug}?pair=&discard=value`, [
          'settings',
          'agents',
        ])
      ).toHaveBeenCalledWith(
        { pathname: '/settings/agents', search: '?pair=', hash: '' },
        { history: 'replace' }
      );
    }
  );

  it('preserves agent creation links while normalizing the settings URL', () => {
    expect(
      synchronize('/settings/agents/?createAgent=true&discard=value', [
        'settings',
        'agents',
      ])
    ).toHaveBeenCalledWith(
      {
        pathname: '/settings/agents',
        search: '?createAgent=true',
        hash: '',
      },
      { history: 'replace' }
    );
  });

  it('drops settings actions when synchronizing a different route', () => {
    expect(
      synchronize('/settings/agents?pair=3GTM-FNJ9&createAgent=true', ['inbox'])
    ).toHaveBeenCalledWith(
      { pathname: '/inbox', search: '', hash: '' },
      { history: 'replace' }
    );
  });
});
