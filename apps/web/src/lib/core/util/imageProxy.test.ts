import { describe, expect, it } from 'vitest';
import { SERVER_HOSTS } from '../constant/servers';
import {
  displayImageUrl,
  githubRawImageUrl,
  proxyImageUrl,
} from './imageProxy';

describe('githubRawImageUrl', () => {
  it('rewrites a blob link with ?raw=true to the raw file host', () => {
    expect(
      githubRawImageUrl(
        'https://github.com/macro-inc/macro/blob/pr-assets/time-range-timeline/typed-1-all-day.png?raw=true'
      )
    ).toBe(
      'https://raw.githubusercontent.com/macro-inc/macro/pr-assets/time-range-timeline/typed-1-all-day.png'
    );
  });

  it('strips refs/heads from a /raw/ redirect', () => {
    expect(
      githubRawImageUrl(
        'https://github.com/macro-inc/macro/raw/refs/heads/pr-assets/time-range-timeline/typed-1-all-day.png'
      )
    ).toBe(
      'https://raw.githubusercontent.com/macro-inc/macro/pr-assets/time-range-timeline/typed-1-all-day.png'
    );
  });

  it('leaves user-attachment and already-raw URLs alone', () => {
    const attachment =
      'https://github.com/user-attachments/assets/1ac88ed4-ef69-4b5f-847b-02bd105ffdd4';
    const raw =
      'https://raw.githubusercontent.com/macro-inc/macro/pr-assets/shot.png';
    expect(githubRawImageUrl(attachment)).toBe(attachment);
    expect(githubRawImageUrl(raw)).toBe(raw);
  });
});

describe('displayImageUrl', () => {
  it('proxies a rewritten GitHub blob image', () => {
    const src =
      'https://github.com/macro-inc/macro/blob/pr-assets/shot.png?raw=true';
    expect(displayImageUrl(src)).toBe(
      `${SERVER_HOSTS['image-proxy-service']}/proxy?url=${encodeURIComponent(
        'https://raw.githubusercontent.com/macro-inc/macro/pr-assets/shot.png'
      )}`
    );
  });

  it('loads a static file directly instead of through the proxy', () => {
    const src = `${SERVER_HOSTS['static-file']}/file/299c189c-df42-4a9a-b42b-7220264b607b`;
    expect(displayImageUrl(src)).toBe(src);
  });

  it('proxies a host that only begins like the static file host', () => {
    const src = `${SERVER_HOSTS['static-file']}.example.com/shot.png`;
    expect(displayImageUrl(src)).toBe(
      `${SERVER_HOSTS['image-proxy-service']}/proxy?url=${encodeURIComponent(src)}`
    );
  });

  it('leaves data URLs unchanged', () => {
    expect(proxyImageUrl('data:image/png;base64,AAAA')).toBe(
      'data:image/png;base64,AAAA'
    );
  });
});
