import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { PipedreamConnectorIcon } from './ConnectorIcon';

afterEach(cleanup);

describe('Pipedream app logos', () => {
  it('prefers the proxied directory image, falls back on failure, and retries a new URL', () => {
    const url = 'https://pipedream.com/s.v0/app_example/logo/orig';
    const [iconUrl, setIconUrl] = createSignal(url);
    const { container } = render(() => (
      <PipedreamConnectorIcon appSlug="linear" iconUrl={iconUrl()} />
    ));
    const image = container.querySelector('img');
    expect(image?.getAttribute('src')).toContain(encodeURIComponent(url));
    expect(container.querySelector('svg')).toBeNull();
    fireEvent.error(image!);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('svg')).not.toBeNull();
    setIconUrl(`${url}?updated=1`);
    expect(container.querySelector('img')?.getAttribute('src')).toContain(
      encodeURIComponent(`${url}?updated=1`)
    );
  });
});
