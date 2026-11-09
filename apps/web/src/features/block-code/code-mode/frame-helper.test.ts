import { describe, expect, it } from 'vitest';
import {
  composeProgramDocument,
  PROGRAM_DOCUMENT_CSP,
  readRunRequest,
  readSubscriptionMessage,
} from './frame-helper';

const parse = (html: string) =>
  new DOMParser().parseFromString(html, 'text/html');

describe('composeProgramDocument', () => {
  it('installs the helper before the document’s own scripts', () => {
    const composed = composeProgramDocument(
      '<html><head><script>first()</script></head><body>Hi</body></html>',
      'token'
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
      'token'
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
      't'
    );
    const document = parse(composed);
    expect(document.body.querySelector('p')?.textContent).toBe('Hello');
    expect(
      document.body.querySelector('script[type="module"]')?.textContent
    ).toBe('run("tasks")');
    expect(composed.startsWith('<!doctype html>')).toBe(true);
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
