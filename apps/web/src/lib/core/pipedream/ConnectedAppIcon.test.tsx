import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectedAppIcon } from './ConnectedAppIcon';

const iconUrl = 'https://connect.example/v1/catalog/airtable/icon.svg?v=abc';

const catalog = vi.hoisted(() => ({ pending: false }));

vi.mock('@queries/pipedream-connectors', () => ({
  usePipedreamCatalogIconsQuery: () => ({
    get isPending() {
      return catalog.pending;
    },
    get data() {
      if (catalog.pending) throw new Error('reading data would suspend');
      return new Map([
        ['airtable', iconUrl],
        ['no_logo', null],
      ]);
    },
  }),
}));

afterEach(() => {
  cleanup();
  catalog.pending = false;
});

describe('ConnectedAppIcon', () => {
  it('shows the catalog logo for a connected app', () => {
    const { container } = render(() => <ConnectedAppIcon appSlug="airtable" />);
    expect(container.querySelector('img')?.getAttribute('src')).toContain(
      encodeURIComponent(iconUrl)
    );
  });

  it('keeps the fallback, without suspending, while the catalog loads', () => {
    catalog.pending = true;
    const { container } = render(() => <ConnectedAppIcon appSlug="airtable" />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it.each(['no_logo', 'not_in_catalog'])('falls back for %s', (appSlug) => {
    const { container } = render(() => <ConnectedAppIcon appSlug={appSlug} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
