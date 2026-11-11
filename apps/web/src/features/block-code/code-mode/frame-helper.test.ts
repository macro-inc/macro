import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  composeProgramDocument,
  frameHelperScript,
  PROGRAM_DOCUMENT_CSP,
  readRunRequest,
  readSubscriptionMessage,
} from './frame-helper';

const THEME = ':root{color-scheme:dark;--color-ink:#eee}';

const parse = (html: string) =>
  new DOMParser().parseFromString(html, 'text/html');

describe('composeProgramDocument', () => {
  it('installs the helper before the document’s own scripts', () => {
    const composed = composeProgramDocument(
      '<html><head><script>first()</script></head><body>Hi</body></html>',
      'token',
      THEME
    );
    const scripts = [...parse(composed).head.querySelectorAll('script')];
    expect(scripts).toHaveLength(2);
    expect(scripts[0]?.textContent).toContain("'macro'");
    expect(scripts[0]?.textContent).toContain('"token"');
    expect(scripts[1]?.textContent).toBe('first()');
  });

  it('puts the content security policy first, before every script', () => {
    const composed = composeProgramDocument(
      '<html><head><meta charset="utf-8"><script>first()</script></head><body><script type="module">run()</script></body></html>',
      'token',
      THEME
    );
    const document = parse(composed);
    const policy = document.head.firstElementChild;
    expect(policy?.tagName).toBe('META');
    expect(policy?.getAttribute('http-equiv')).toBe('Content-Security-Policy');
    expect(policy?.getAttribute('content')).toBe(PROGRAM_DOCUMENT_CSP);
    expect(PROGRAM_DOCUMENT_CSP).toContain("default-src 'none'");
    expect(PROGRAM_DOCUMENT_CSP).toContain("connect-src 'none'");

    const scripts = [...document.querySelectorAll('script')];
    expect(scripts).toHaveLength(3);
    for (const script of scripts) {
      const position = policy?.compareDocumentPosition(script) ?? 0;
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('keeps the built page’s body and bundled client script', () => {
    const composed = composeProgramDocument(
      '<p>Hello</p><script type="module">run("tasks")</script>',
      't',
      THEME
    );
    const document = parse(composed);
    expect(document.body.querySelector('p')?.textContent).toBe('Hello');
    expect(
      document.body.querySelector('script[type="module"]')?.textContent
    ).toBe('run("tasks")');
    expect(composed.startsWith('<!doctype html>')).toBe(true);
  });

  it('replaces a macro:styles link with the theme and stylesheet, after the policy', () => {
    const composed = composeProgramDocument(
      '<html><head><link rel="stylesheet" href="macro:styles"><link rel="stylesheet" href="macro:styles"><style>.mine{}</style></head><body></body></html>',
      'token',
      THEME
    );
    const document = parse(composed);
    expect(document.querySelector('link')).toBeNull();
    const styles = [...document.head.querySelectorAll('style')];
    expect(
      styles.map((style) => style.hasAttribute('data-macro-theme'))
    ).toEqual([true, false, false]);
    expect(styles[0]?.textContent).toBe(THEME);
    expect(styles[1]?.textContent).toContain('.card');
    expect(styles[2]?.textContent).toBe('.mine{}');
    const policy = document.head.firstElementChild;
    expect(policy?.getAttribute('http-equiv')).toBe('Content-Security-Policy');
  });

  it('adds no theme to a page that doesn’t link macro:styles', () => {
    const composed = composeProgramDocument('<p>Hi</p>', 'token', THEME);
    expect(composed).not.toContain(THEME);
  });
});

describe('readRunRequest', () => {
  it('accepts a run request carrying the frame token', () => {
    expect(
      readRunRequest(
        {
          type: 'macro:run',
          token: 'secret',
          id: 3,
          program: 'tasks',
          arguments: { limit: 5 },
        },
        'secret'
      )
    ).toEqual({
      type: 'macro:run',
      token: 'secret',
      id: 3,
      program: 'tasks',
      arguments: { limit: 5 },
    });
  });

  it('defaults non-object arguments to an empty object', () => {
    const request = readRunRequest(
      { type: 'macro:run', token: 't', id: 1, program: 'p', arguments: [1] },
      't'
    );
    expect(request?.arguments).toEqual({});
  });

  it('ignores messages with another token, type or shape', () => {
    expect(
      readRunRequest(
        { type: 'macro:run', token: 'other', id: 1, program: 'p' },
        't'
      )
    ).toBeUndefined();
    expect(
      readRunRequest({ type: 'macro:result', token: 't', id: 1 }, 't')
    ).toBeUndefined();
    expect(
      readRunRequest(
        { type: 'macro:run', token: 't', id: '1', program: 'p' },
        't'
      )
    ).toBeUndefined();
    // A frame can no longer send code to run.
    expect(
      readRunRequest(
        { type: 'macro:run', token: 't', id: 1, source: 'export {}' },
        't'
      )
    ).toBeUndefined();
    expect(readRunRequest(null, 't')).toBeUndefined();
    expect(readRunRequest('macro:run', 't')).toBeUndefined();
  });
});

describe('readSubscriptionMessage', () => {
  it('reads subscribe messages with optional ids', () => {
    expect(
      readSubscriptionMessage(
        {
          type: 'macro:subscribe',
          token: 't',
          subscription: 2,
          events: ['document.updated'],
          ids: ['d1'],
        },
        't'
      )
    ).toEqual({
      type: 'macro:subscribe',
      token: 't',
      subscription: 2,
      events: ['document.updated'],
      ids: ['d1'],
    });
    expect(
      readSubscriptionMessage(
        {
          type: 'macro:subscribe',
          token: 't',
          subscription: 2,
          events: ['document.updated'],
          ids: 'd1',
        },
        't'
      )
    ).toEqual({
      type: 'macro:subscribe',
      token: 't',
      subscription: 2,
      events: ['document.updated'],
    });
  });

  it('reads unsubscribe messages', () => {
    expect(
      readSubscriptionMessage(
        { type: 'macro:unsubscribe', token: 't', subscription: 4 },
        't'
      )
    ).toEqual({ type: 'macro:unsubscribe', token: 't', subscription: 4 });
  });

  it('ignores other tokens, types and malformed events', () => {
    const subscribe = {
      type: 'macro:subscribe',
      token: 't',
      subscription: 1,
      events: ['document.updated'],
    };
    expect(
      readSubscriptionMessage({ ...subscribe, token: 'x' }, 't')
    ).toBeUndefined();
    expect(
      readSubscriptionMessage({ ...subscribe, type: 'macro:run' }, 't')
    ).toBeUndefined();
    expect(
      readSubscriptionMessage({ ...subscribe, events: [1] }, 't')
    ).toBeUndefined();
    expect(
      readSubscriptionMessage({ ...subscribe, subscription: '1' }, 't')
    ).toBeUndefined();
    expect(readSubscriptionMessage(null, 't')).toBeUndefined();
  });
});

describe('frameHelperScript', () => {
  const scrolled = vi.fn();
  beforeAll(() => {
    // jsdom has no layout; record what the helper scrolls to.
    Element.prototype.scrollIntoView = scrolled;
    // jsdom has no WebRTC; stand in for the browser's.
    Object.assign(window, { RTCPeerConnection: class {} });
    // The script is the page's first; run it as the frame would.
    new Function(frameHelperScript('token'))();
  });

  const click = (html: string) => {
    document.body.innerHTML = html;
    const link = document.querySelector('a, area');
    if (!link) throw new Error('no link');
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    return event;
  };

  it('scrolls a fragment link to its target instead of following it', () => {
    scrolled.mockClear();
    const event = click('<a href="#second">Second</a><h2 id="second">Two</h2>');

    expect(event.defaultPrevented).toBe(true);
    expect(scrolled).toHaveBeenCalledOnce();
    expect(scrolled.mock.contexts[0]).toBe(document.getElementById('second'));
  });

  it('refuses links that would leave the page', () => {
    for (const html of [
      '<a href="https://example.com/?d=secret">Out</a>',
      '<a href="#second" download>Save</a>',
      '<a href="https://example.com" ping="https://example.com/ping"><span>In</span></a>',
    ]) {
      expect(click(html).defaultPrevented).toBe(true);
    }
  });

  it('removes WebRTC, which the policy cannot stop', () => {
    expect(
      (window as unknown as Record<string, unknown>).RTCPeerConnection
    ).toBeUndefined();
  });

  it('removes nested frames and connection hints the page adds', async () => {
    document.body.innerHTML = '<p>kept</p>';
    const frame = document.createElement('iframe');
    frame.srcdoc = '<p>fresh globals</p>';
    const hint = document.createElement('link');
    hint.rel = 'preconnect';
    hint.href = 'https://example.com';
    const wrapper = document.createElement('div');
    wrapper.innerHTML = '<object data="x"></object>';
    document.body.append(frame, wrapper);
    document.head.append(hint);
    await Promise.resolve();

    expect(
      document.querySelector('iframe, object, link[rel=preconnect]')
    ).toBeNull();
    expect(document.body.textContent).toContain('kept');
  });
});
