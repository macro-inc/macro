import { cleanup, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  type EmailBodyShown,
  type EmailRenderingContextValue,
  EmailRenderingProvider,
} from '../context/email-rendering-context';
import type { EmailMessage } from '../core/email-message';
import { message } from '../tests/messages';
import { EmailMessageBody } from './email-message-body';

// Markdown bodies are out of scope; the real renderer opens a socket in jsdom.
vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdown: () => null,
  })
);
vi.mock('@core/component/LexicalMarkdown/theme', () => ({ channelTheme: {} }));

const theme = {
  inkL: 0.2,
  inkC: 0,
  inkH: 0,
  panelL: 1,
  accentL: 0.6,
  accentC: 0.1,
  accentH: 50,
};

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(
  cachedBodies: () => boolean,
  current: () => EmailMessage,
  trackBodyOpen?: EmailRenderingContextValue['trackBodyOpen']
) {
  const shown: EmailBodyShown[] = [];
  const context: EmailRenderingContextValue = {
    cachedBodies,
    trackBodyOpen,
    reportBodyShown: (sample) => shown.push(sample),
    theme: () => theme,
    resolveImages: async () => {},
  };
  const { container, unmount } = render(() => (
    <EmailRenderingProvider value={context}>
      <EmailMessageBody
        message={current()}
        isPersonal
        isBodyExpanded={() => true}
        setExpandedMessageBody={() => {}}
        setFocusedMessageId={() => {}}
        isFocused={false}
      />
    </EmailRenderingProvider>
  ));
  const host = () =>
    [...container.querySelectorAll('div')].find(
      (element) => element.shadowRoot
    );
  return { shown, host, unmount };
}

it('renders the direct body outside the rollout and reports its first display once', () => {
  const [current, setCurrent] = createSignal(message('m1'));
  const { shown, host } = mount(() => false, current);
  expect(host()?.shadowRoot?.textContent).toContain('Hello');
  expect(shown).toEqual([
    expect.objectContaining({
      messageId: 'm1',
      path: 'direct',
      source: 'direct',
      htmlLength: '<p>Hello</p>'.length,
    }),
  ]);
  const first = host();
  // The direct body rebuilds on a rendering-input change, as it always has.
  setCurrent(
    message('m1', {
      attachments: [
        {
          db_id: 'a',
          content_id: '<logo>',
          sfs_id: 'file',
          mime_type: 'image/png',
          filename: 'logo.png',
          size_bytes: 1,
        } as EmailMessage['attachments'][number],
      ],
    })
  );
  expect(host()).not.toBe(first);
  expect(shown).toHaveLength(1);
});

it('keeps a body on the path it opened with when the rollout changes', () => {
  const [cached, setCached] = createSignal(true);
  const { shown, host } = mount(cached, () => message('m2'));
  expect(shown).toEqual([
    expect.objectContaining({ messageId: 'm2', path: 'cache' }),
  ]);
  const first = host();
  setCached(false);
  expect(host()).toBe(first);
  expect(shown).toHaveLength(1);
});

it('registers only bodies that show HTML with the thread open', () => {
  const release = vi.fn();
  const track = vi.fn(() => release);
  const html = mount(
    () => false,
    () => message('html'),
    track
  );
  expect(track).toHaveBeenCalledExactlyOnceWith('html');
  html.unmount();
  expect(release).toHaveBeenCalledOnce();
  track.mockClear();
  mount(
    () => false,
    () => message('markdown', { body_macro: 'Macro **markdown**' }),
    track
  );
  mount(
    () => false,
    () => message('text', { body_html_sanitized: null, body_text: 'Plain' }),
    track
  );
  expect(track).not.toHaveBeenCalled();
});
