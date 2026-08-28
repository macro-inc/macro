/**
 * @vitest-environment jsdom
 */

import { openExternalUrl } from '@core/util/url';
import type { ApiMessage } from '@service-email/generated/schemas';
import { render } from '@solidjs/testing-library';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EmailMessageBody } from './EmailMessageBody';

vi.mock('@core/context/user', () => ({
  useEmail: () => () => 'alice@example.com',
}));

vi.mock('@core/util/url', () => ({
  openExternalUrl: vi.fn(),
}));

vi.mock(
  '@core/component/LexicalMarkdown/component/core/StaticMarkdown',
  () => ({
    StaticMarkdown: () => null,
  })
);

const openExternalUrlMock = vi.mocked(openExternalUrl);

function htmlMessage(html: string): ApiMessage {
  return {
    attachments: [],
    attachments_draft: [],
    attachments_forwarded: [],
    bcc: [],
    cc: [],
    to: [],
    labels: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    db_id: 'msg-1',
    thread_db_id: 'thread-1',
    link_id: 'link-1',
    has_attachments: false,
    is_draft: false,
    is_read: true,
    is_sent: false,
    is_starred: false,
    body_html_sanitized: html,
    body_replyless: html,
    from: { email: 'news@example.com', name: 'News' },
  } as ApiMessage;
}

function messageShadow(container: HTMLElement): ShadowRoot {
  const host = [...container.querySelectorAll('div')].find(
    (el) => el.shadowRoot
  );
  if (!host?.shadowRoot) {
    throw new Error('expected EmailMessageBody to attach a shadow root');
  }
  return host.shadowRoot;
}

function click(el: Element) {
  el.dispatchEvent(
    new MouseEvent('click', { bubbles: true, cancelable: true })
  );
}

describe('EmailMessageBody HTML links', () => {
  beforeEach(() => {
    openExternalUrlMock.mockClear();
    if (!globalThis.ResizeObserver) {
      globalThis.ResizeObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
    }
  });

  it('opens an https body link through openExternalUrl', () => {
    const { container } = render(() => (
      <EmailMessageBody
        message={htmlMessage(
          '<p>Open <a href="https://example.com/email-link-test">example.com</a></p>'
        )}
        personalSenders={() => new Set()}
        isBodyExpanded={() => true}
        setExpandedMessageBody={() => {}}
        setFocusedMessageId={() => {}}
        isFirstMessageInThread
        isFocused
      />
    ));

    const anchor = messageShadow(container).querySelector('a');
    expect(anchor?.textContent).toBe('example.com');
    click(anchor!);

    expect(openExternalUrlMock).toHaveBeenCalledTimes(1);
    expect(openExternalUrlMock).toHaveBeenCalledWith(
      'https://example.com/email-link-test'
    );
  });

  it('does not intercept an in-page hash link in the same body', () => {
    const { container } = render(() => (
      <EmailMessageBody
        message={htmlMessage(
          '<p><a href="#footer">skip</a> <a href="https://example.com/x">go</a></p>'
        )}
        personalSenders={() => new Set()}
        isBodyExpanded={() => true}
        setExpandedMessageBody={() => {}}
        setFocusedMessageId={() => {}}
        isFirstMessageInThread
        isFocused
      />
    ));

    const shadow = messageShadow(container);
    click(shadow.querySelector('a[href="#footer"]')!);
    expect(openExternalUrlMock).not.toHaveBeenCalled();

    click(shadow.querySelector('a[href="https://example.com/x"]')!);
    expect(openExternalUrlMock).toHaveBeenCalledWith('https://example.com/x');
  });
});
