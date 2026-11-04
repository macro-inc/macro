import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConnectedAppIcon } from './ConnectedAppIcon';

const iconUrl = 'https://connect.example/v1/catalog/airtable/icon.svg?v=abc';

vi.mock('@queries/pipedream-connectors', () => ({
  usePipedreamCatalogIconsQuery: () => ({
    data: new Map([
      ['airtable', iconUrl],
      ['no_logo', null],
    ]),
  }),
}));

afterEach(cleanup);

describe('ConnectedAppIcon', () => {
  it('shows the catalog logo for a connected app', () => {
    const { container } = render(() => <ConnectedAppIcon appSlug="airtable" />);
    expect(container.querySelector('img')?.getAttribute('src')).toContain(
      encodeURIComponent(iconUrl)
    );
  });

  it.each(['no_logo', 'not_in_catalog'])('falls back for %s', (appSlug) => {
    const { container } = render(() => <ConnectedAppIcon appSlug={appSlug} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
  });
});
