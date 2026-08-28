// @vitest-environment jsdom

import { openExternalUrl } from '@core/util/url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { interceptExternalLinks } from './interceptExternalLinks';

vi.mock('@core/util/url', () => ({
  openExternalUrl: vi.fn(),
}));

const openExternalUrlMock = vi.mocked(openExternalUrl);

function makeAnchor(href: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.setAttribute('href', href);
  return a;
}

function clickAnchor(a: HTMLAnchorElement, init: MouseEventInit = {}): boolean {
  return a.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, ...init })
  );
}

describe('interceptExternalLinks', () => {
  beforeEach(() => {
    openExternalUrlMock.mockClear();
  });

  it('routes a plain left-click on a mailto anchor through openExternalUrl and prevents default', () => {
    const container = document.createElement('div');
    const anchor = makeAnchor('mailto:alice@example.com');
    container.append(anchor);

    interceptExternalLinks(container);
    const defaultPrevented = !clickAnchor(anchor);

    expect(openExternalUrlMock).toHaveBeenCalledTimes(1);
    expect(openExternalUrlMock).toHaveBeenCalledWith(
      'mailto:alice@example.com'
    );
    expect(defaultPrevented).toBe(true);
  });

  it('leaves modifier / non-primary clicks for the browser default', () => {
    const container = document.createElement('div');
    const anchor = makeAnchor('mailto:alice@example.com');
    container.append(anchor);
    anchor.addEventListener('click', (e) => e.preventDefault());
    interceptExternalLinks(container);

    for (const init of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ] satisfies MouseEventInit[]) {
      clickAnchor(anchor, init);
    }

    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });

  it('ignores hash-only anchors', () => {
    const container = document.createElement('div');
    const anchor = makeAnchor('#section');
    container.append(anchor);

    interceptExternalLinks(container);
    clickAnchor(anchor);

    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });

  it('routes a plain left-click on an https anchor through openExternalUrl and prevents default', () => {
    const container = document.createElement('div');
    const anchor = makeAnchor('https://example.com/path');
    container.append(anchor);

    interceptExternalLinks(container);
    const defaultPrevented = !clickAnchor(anchor);

    expect(openExternalUrlMock).toHaveBeenCalledTimes(1);
    expect(openExternalUrlMock).toHaveBeenCalledWith(
      'https://example.com/path'
    );
    expect(defaultPrevented).toBe(true);
  });

  it('routes a plain left-click on an http anchor through openExternalUrl', () => {
    const container = document.createElement('div');
    const anchor = makeAnchor('http://example.com');
    container.append(anchor);
    interceptExternalLinks(container);
    clickAnchor(anchor);
    expect(openExternalUrlMock).toHaveBeenCalledWith('http://example.com/');
  });

  it('does not intercept javascript hrefs', () => {
    const container = document.createElement('div');
    const anchor = makeAnchor('javascript:void(0)');
    container.append(anchor);
    anchor.addEventListener('click', (e) => e.preventDefault());
    interceptExternalLinks(container);
    clickAnchor(anchor);
    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });
});
