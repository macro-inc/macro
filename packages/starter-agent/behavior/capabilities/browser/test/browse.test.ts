import { expect, test } from 'bun:test';
import type { Trace } from '../../../agent/claude.ts';
import { hostOf, mostText, type Step, step, type Tab } from '../browse.ts';

/** A tab that records what was done to it. */
const fakeTab = (page = 'Hello') => {
  const done: string[] = [];
  let at = 'about:blank';
  const tab: Tab = {
    goto: async (url) => {
      done.push(`goto ${url}`);
      at = url;
    },
    url: () => at,
    title: async () => 'A title',
    text: async (selector) => {
      done.push(`text ${selector ?? 'body'}`);
      return page;
    },
    click: async (target) => {
      done.push(`click ${JSON.stringify(target)}`);
    },
    fill: async (selector, text) => {
      done.push(`fill ${selector} ${text}`);
    },
    paste: async (selector) => {
      done.push(`paste ${selector}`);
    },
    press: async (key) => {
      done.push(`press ${key}`);
    },
    screenshot: async (path) => {
      done.push(`screenshot ${path}`);
    },
  };
  return { tab, done };
};

/** A trace that keeps each span's name and fields. */
const recording = () => {
  const spans: { name: string; fields: Record<string, unknown> }[] = [];
  const trace: Trace = (name, run) => {
    const fields: Record<string, unknown> = {};
    spans.push({ name, fields });
    return run({
      set: (key, value) => {
        fields[key] = value;
      },
      traceparent: () => undefined,
    });
  };
  return { spans, trace };
};

test('a login: open, type the user, paste the password, click; each a span with only kind, host and outcome', async () => {
  const { tab, done } = fakeTab();
  const { spans, trace } = recording();
  const steps: Step[] = [
    { kind: 'open', url: 'https://example.com/login?token=secret' },
    { kind: 'type', selector: '#user', text: 'agent@example.com' },
    { kind: 'paste', selector: '#password' },
    { kind: 'click', text: 'Sign in' },
  ];
  for (const action of steps) await step({ tab, trace }, action);
  expect(done).toEqual([
    'goto https://example.com/login?token=secret',
    'fill #user agent@example.com',
    'paste #password',
    'click {"kind":"click","text":"Sign in"}',
  ]);
  expect(spans.map(({ name }) => name)).toEqual([
    'browser.step',
    'browser.step',
    'browser.step',
    'browser.step',
  ]);
  expect(spans[0]?.fields).toEqual({
    'browser.step': 'open',
    'browser.host': 'example.com',
    'browser.outcome': 'ok',
  });
  // Nothing typed, no path or query, no page text.
  expect(JSON.stringify(spans)).not.toContain('agent@example.com');
  expect(JSON.stringify(spans)).not.toContain('token');
});

test('a read is wrapped as untrusted data and capped', async () => {
  const { tab } = fakeTab('x'.repeat(mostText + 100));
  const { trace } = recording();
  const read = await step({ tab, trace }, { kind: 'read' });
  expect(read.text).toStartWith('<untrusted_page_content>');
  expect(read.text).toContain('x'.repeat(mostText));
  expect(read.text).not.toContain('x'.repeat(mostText + 1));
  expect(read.title).toBe('A title');
});

test('only web pages open, and a failed step is a failed span', async () => {
  const { tab, done } = fakeTab();
  const { spans, trace } = recording();
  for (const url of ['file:///etc/passwd', 'chrome://settings', 'javascript:1'])
    await expect(step({ tab, trace }, { kind: 'open', url })).rejects.toThrow(
      'only http and https'
    );
  expect(done).toEqual([]);
  expect(
    spans.every(({ fields }) => fields['browser.outcome'] === 'failed')
  ).toBe(true);
});

test("a span's host is only the host", () => {
  expect(hostOf('https://user:pw@mail.example.com:8443/a?b#c')).toBe(
    'mail.example.com:8443'
  );
  expect(hostOf('not a url')).toBe('');
});
