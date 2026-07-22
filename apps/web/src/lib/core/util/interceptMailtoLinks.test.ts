// @vitest-environment jsdom

import { openExternalUrl } from '@core/util/url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { interceptMailtoLinks } from './interceptMailtoLinks';

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

describe('interceptMailtoLinks', () => {
  beforeEach(() => {
    openExternalUrlMock.mockClear();
  });

  it('routes a plain left-click on a mailto anchor through openExternalUrl and prevents default', () => {
    const container = document.createElement('div');
    const anchor = makeAnchor('mailto:alice@example.com');
    container.append(anchor);

    interceptMailtoLinks(container);
    const notPrevented = clickAnchor(anchor);

    expect(openExternalUrlMock).toHaveBeenCalledTimes(1);
    expect(openExternalUrlMock).toHaveBeenCalledWith(
      'mailto:alice@example.com'
    );
    // dispatchEvent returns false when the default was prevented — so the
    // browser won't also hand the mailto off to the OS mail client.
    expect(notPrevented).toBe(false);
  });

  it('leaves modifier / non-primary clicks for the browser default', () => {
    const container = document.createElement('div');
    const anchor = makeAnchor('mailto:alice@example.com');
    container.append(anchor);
    // Swallow the default so jsdom doesn't attempt (unimplemented) navigation.
    anchor.addEventListener('click', (e) => e.preventDefault());
    interceptMailtoLinks(container);

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

  it('ignores non-mailto anchors', () => {
    const container = document.createElement('div');
    // Hash href: a non-mailto link jsdom can "navigate" without complaining.
    const anchor = makeAnchor('#section');
    container.append(anchor);

    interceptMailtoLinks(container);
    clickAnchor(anchor);

    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });
});
