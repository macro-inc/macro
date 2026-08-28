// @vitest-environment jsdom

import { openExternalUrl } from '@core/util/url';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  interceptExternalLinks,
  stampHtmlEmailAnchors,
  urlToOpenFromHref,
} from './interceptExternalLinks';

vi.mock('@core/util/url', () => ({
  openExternalUrl: vi.fn(),
}));

const openExternalUrlMock = vi.mocked(openExternalUrl);

function makeAnchor(href: string): HTMLAnchorElement {
  const a = document.createElement('a');
  a.setAttribute('href', href);
  return a;
}

function click(a: HTMLAnchorElement, init: MouseEventInit = {}): boolean {
  return a.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true, ...init })
  );
}

describe('urlToOpenFromHref', () => {
  it.each([
    ['https://example.com/path', 'https://example.com/path'],
    ['http://example.com', 'http://example.com/'],
    ['mailto:alice@example.com', 'mailto:alice@example.com'],
    ['tel:+15551212', 'tel:+15551212'],
    ['sms:+15551212', 'sms:+15551212'],
    ['//cdn.example.com/img.png', 'https://cdn.example.com/img.png'],
    ['  https://example.com/x  ', 'https://example.com/x'],
  ])('opens %s', (href, opened) => {
    expect(urlToOpenFromHref(href)).toBe(opened);
  });

  it.each([
    '#section',
    '',
    '   ',
    'javascript:void(0)',
    '/inbox/email/abc',
    './rel',
    '../up',
    'cid:inline-image@mail',
    'data:text/html,hi',
    'ftp://files.example.com/a',
    'www.example.com',
  ])('does not open %s', (href) => {
    expect(urlToOpenFromHref(href)).toBeUndefined();
  });

  it('does not treat a hash href as the page URL', () => {
    const a = makeAnchor('#section');
    expect(new URL(a.href).protocol).toMatch(/^https?:$/);
    expect(urlToOpenFromHref(a.getAttribute('href') ?? '')).toBeUndefined();
  });
});

describe('interceptExternalLinks', () => {
  beforeEach(() => {
    openExternalUrlMock.mockClear();
  });

  it('prevents default and opens protocol-relative hrefs as https', () => {
    const a = makeAnchor('//example.com/email-link-test');
    const root = document.createElement('div');
    root.append(a);
    interceptExternalLinks(root);

    const defaultPrevented = !click(a);

    expect(defaultPrevented).toBe(true);
    expect(openExternalUrlMock).toHaveBeenCalledTimes(1);
    expect(openExternalUrlMock).toHaveBeenCalledWith(
      'https://example.com/email-link-test'
    );
  });

  it('leaves modifier and non-primary clicks to the browser', () => {
    const a = makeAnchor('https://example.com');
    a.addEventListener('click', (e) => e.preventDefault());
    const root = document.createElement('div');
    root.append(a);
    interceptExternalLinks(root);

    for (const init of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
      { button: 1 },
    ] satisfies MouseEventInit[]) {
      click(a, init);
    }

    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });
});

describe('stampHtmlEmailAnchors', () => {
  beforeEach(() => {
    openExternalUrlMock.mockClear();
  });

  it('stamps new-tab attrs on every href, but only intercepts classified ones', () => {
    const root = document.createElement('div');
    const https = makeAnchor('https://example.com/x');
    const hash = makeAnchor('#section');
    root.append(https, hash);

    stampHtmlEmailAnchors(root);

    expect(https.getAttribute('target')).toBe('_blank');
    expect(https.getAttribute('rel')).toBe('noopener noreferrer');
    expect(hash.getAttribute('target')).toBe('_blank');

    expect(!click(https)).toBe(true);
    expect(openExternalUrlMock).toHaveBeenCalledWith('https://example.com/x');

    openExternalUrlMock.mockClear();
    click(hash);
    expect(openExternalUrlMock).not.toHaveBeenCalled();
  });
});
