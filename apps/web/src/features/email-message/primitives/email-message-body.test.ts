import type { ResourceLifetime } from '@macro-inc/email-renderer/browser';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { message } from '../tests/messages';
import {
  createEmailMessageBody,
  type EmailMessageBodyProps,
} from './email-message-body';

const theme = {
  inkL: 0.2,
  inkC: 0,
  inkH: 0,
  panelL: 1,
  accentL: 0.6,
  accentC: 0.1,
  accentH: 50,
};
const bodyOptions: Omit<EmailMessageBodyProps, 'message'> = {
  isPersonal: true,
  isBodyExpanded: () => true,
  setExpandedMessageBody() {},
  setFocusedMessageId() {},
  isFocused: false,
};
describe('independent email body', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('preserves the body and image resources across unchanged thread snapshots', async () => {
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect() {}
      }
    );
    const releaseImages = vi.fn();
    const resolveImages = vi.fn(
      async (_root, _attachments, lifetime: ResourceLifetime) => {
        lifetime.onDispose(releaseImages);
      }
    );
    const original = message('one', {
      body_html_sanitized: '<p>Hello</p><img src="cid:photo">',
      attachments: [{ db_id: 'photo', content_id: 'photo', sfs_id: 'file' }],
    });
    const root = createRoot((dispose) => {
      const [value, setValue] = createSignal(original);
      const body = createEmailMessageBody(
        {
          get message() {
            return value();
          },
          ...bodyOptions,
          // Production passes derived getters which also read the message.
          get isPersonal() {
            return value().from?.email === 'sender@example.com';
          },
          get showFullContent() {
            return value().db_id === 'one';
          },
        },
        { theme: () => theme, resolveImages }
      );
      return { dispose, body, setValue };
    });
    try {
      await Promise.resolve();
      const host = root.body.host();
      const image = host?.shadowRoot?.querySelector('img');
      for (let i = 0; i < 3; i++) {
        root.setValue({
          ...structuredClone(original),
          updated_at: `2026-09-0${i + 1}T00:00:00Z`,
          labels: [{ provider_label_id: 'UNREAD' }],
        });
        expect(root.body.host()).toBe(host);
        expect(root.body.host()?.shadowRoot?.querySelector('img')).toBe(image);
      }
      expect(resolveImages).toHaveBeenCalledTimes(1);
      expect(releaseImages).not.toHaveBeenCalled();

      root.setValue({
        ...original,
        attachments: [{ ...original.attachments[0], sfs_id: 'new-file' }],
      });
      await Promise.resolve();
      expect(root.body.host()).not.toBe(host);
      expect(releaseImages).toHaveBeenCalledTimes(1);
      expect(resolveImages).toHaveBeenCalledTimes(2);

      const updatedHost = root.body.host();
      root.setValue({ ...original, body_html_sanitized: '<p>Edited</p>' });
      expect(root.body.host()).not.toBe(updatedHost);
      expect(root.body.host()?.shadowRoot?.textContent).toContain('Edited');
    } finally {
      root.dispose();
    }
  });
  it('renders one message, rewires its DOM on source changes, and cleans image/resize resources on disposal', async () => {
    const disconnect = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe() {}
        disconnect = disconnect;
      }
    );
    const revoke = vi.fn();
    vi.stubGlobal('URL', { ...URL, revokeObjectURL: revoke });
    const resolveImages = vi.fn(
      async (_root, _attachments, lifetime: ResourceLifetime) => {
        lifetime.onDispose(() => URL.revokeObjectURL('blob:email'));
      }
    );
    const prepareLinks = vi.fn();
    const root = createRoot((dispose) => {
      const [value, setValue] = createSignal(
        message('one', {
          body_html_sanitized:
            '<p>Hello <a href="mailto:person@example.com">Person</a></p><div class="macro_quote">Quoted thread</div>',
          body_replyless: '<p>Hello Person</p>',
        })
      );
      const body = createEmailMessageBody(
        {
          get message() {
            return value();
          },
          ...bodyOptions,
        },
        { theme: () => theme, resolveImages, prepareLinks }
      );
      return { dispose, body, setValue };
    });
    try {
      await Promise.resolve();
      const host = root.body.host()!;
      expect(host.style.minWidth).toBe('0');
      expect(host.style.width).toBe('100%');
      expect(host.shadowRoot?.textContent).toContain('Hello Person');
      root.body.setShowFullHTML(true);
      await Promise.resolve();
      expect(root.body.host()!.shadowRoot?.textContent).toContain(
        'Quoted thread'
      );
      const link = root.body.host()!.shadowRoot?.querySelector('a');
      expect(link?.target).toBe('_blank');
      expect(link?.rel).toBe('noopener noreferrer');
      expect(prepareLinks).toHaveBeenCalled();
      const expandedHost = root.body.host();
      root.setValue(
        message('two', {
          body_html_sanitized: '<p>Second message</p>',
          body_replyless: '<p>Second message</p>',
        })
      );
      await Promise.resolve();
      expect(root.body.host()).not.toBe(expandedHost);
      expect(root.body.host()!.shadowRoot?.textContent).toContain(
        'Second message'
      );
    } finally {
      root.dispose();
    }
    expect(resolveImages).toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledWith('blob:email');
    expect(disconnect).toHaveBeenCalled();
  });
  it.each([
    { body_macro: 'A document mention' },
    {
      body_html_sanitized: null,
      body_text: '**Plaintext using the existing app renderer**',
    },
  ])(
    'keeps the app Markdown paths free of hidden HTML resources: %j',
    async (content) => {
      const resolveImages = vi.fn(async () => {});
      createRoot((dispose) => {
        const body = createEmailMessageBody(
          {
            message: message('markdown', content),
            ...bodyOptions,
          },
          { theme: () => theme, resolveImages }
        );
        expect(body.host()).toBeUndefined();
        dispose();
      });
      await Promise.resolve();
      expect(resolveImages).not.toHaveBeenCalled();
    }
  );
});
