/**
 * @vitest-environment jsdom
 */

import { render } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkPreviews } from '../LinkPreviews';
import {
  clearHiddenLinkPreviews,
  hideLinkPreview,
  isLinkPreviewHidden,
  setShowLinkPreviews,
  showLinkPreviews,
} from '../link-preview-visibility';
import {
  extractUnfurlableUrls,
  reservedPreviewImageSize,
  shouldRenderUnfurl,
} from '../link-previews';
import { Root } from '../Root';
import type { MessageData } from '../types';

type MockUnfurlData =
  | { type: 'loading' | 'error'; _createdAt: Date }
  | {
      type: 'success';
      data: {
        url: string;
        title: string;
        description?: string;
        image_url?: string;
        image_width?: number;
        image_height?: number;
        favicon_url?: string;
      };
      _createdAt: Date;
    };

const unfurlResults = new Map<string, MockUnfurlData>();
const suppressMutate = vi.fn();

vi.mock('@core/signal/unfurl', () => ({
  useUnfurl: (url: string) => [
    () => unfurlResults.get(url),
    { refetch: () => undefined },
  ],
}));

vi.mock('@service-unfurl/client', () => ({
  proxyResource: (url: string) => url,
}));

vi.mock('@core/context/user', () => ({
  useUserId: () => () => 'user-1',
}));

vi.mock('@queries/channel/message', () => ({
  useRemoveLinkPreviewMutation: () => ({ mutate: suppressMutate }),
}));

describe('extractUnfurlableUrls', () => {
  it('extracts bare URLs', () => {
    expect(extractUnfurlableUrls('check out https://example.com/post')).toEqual(
      ['https://example.com/post']
    );
  });

  it('extracts markdown link targets', () => {
    expect(
      extractUnfurlableUrls('see [the docs](https://example.com/docs)')
    ).toEqual(['https://example.com/docs']);
  });

  it('keeps balanced parens inside markdown link targets', () => {
    expect(
      extractUnfurlableUrls(
        'see [wiki](https://en.wikipedia.org/wiki/Foo_(bar)) too'
      )
    ).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)']);
  });

  it('caps in document order across link syntaxes', () => {
    const mLink =
      '<m-link>{"url":"https://example.com/last","text":"x","title":""}</m-link>';
    const content = `https://example.com/1 https://example.com/2 https://example.com/3 ${mLink}`;
    expect(extractUnfurlableUrls(content)).toEqual([
      'https://example.com/1',
      'https://example.com/2',
      'https://example.com/3',
    ]);
  });

  it('strips trailing punctuation from bare URLs but keeps balanced parens', () => {
    expect(extractUnfurlableUrls('read https://example.com/a.')).toEqual([
      'https://example.com/a',
    ]);
    expect(
      extractUnfurlableUrls('(see https://en.wikipedia.org/wiki/Foo_(bar))')
    ).toEqual(['https://en.wikipedia.org/wiki/Foo_(bar)']);
    expect(extractUnfurlableUrls('(see https://example.com/a)')).toEqual([
      'https://example.com/a',
    ]);
  });

  it('dedupes repeated URLs', () => {
    expect(
      extractUnfurlableUrls('https://example.com/a and https://example.com/a')
    ).toEqual(['https://example.com/a']);
  });

  it('ignores URLs inside code fences and inline code', () => {
    expect(
      extractUnfurlableUrls(
        'run `curl https://example.com/inline` and\n```\nfetch https://example.com/fenced\n```'
      )
    ).toEqual([]);
  });

  it('extracts URLs from m-link tags (the editor serialization)', () => {
    const mLink =
      '<m-link>{"url":"https://example.com/from-editor","text":"https://example.com/from-editor","title":""}</m-link>';
    expect(extractUnfurlableUrls(`check out ${mLink}`)).toEqual([
      'https://example.com/from-editor',
    ]);
  });

  it('skips m-links whose preview the sender removed', () => {
    const removed =
      '<m-link>{"url":"https://example.com/removed","text":"x","title":"","preview":false}</m-link>';
    const kept =
      '<m-link>{"url":"https://example.com/kept","text":"x","title":""}</m-link>';
    expect(extractUnfurlableUrls(`${removed} and ${kept}`)).toEqual([
      'https://example.com/kept',
    ]);
  });

  it('ignores URLs inside mention tag payloads', () => {
    const mention =
      '<m-document-mention>{"documentId":"abc","documentName":"https://example.com/doc"}</m-document-mention>';
    expect(extractUnfurlableUrls(`look at ${mention}`)).toEqual([]);
  });

  it('skips internal app links but keeps other macro.com pages', () => {
    expect(
      extractUnfurlableUrls(
        `${window.location.origin}/app/md/abc and https://macro.com/app/channel/xyz`
      )
    ).toEqual([]);
    expect(extractUnfurlableUrls('https://macro.com/pricing')).toEqual([
      'https://macro.com/pricing',
    ]);
    // Only the /app segment is internal, not every /app-prefixed path.
    expect(extractUnfurlableUrls('https://macro.com/apple-launch')).toEqual([
      'https://macro.com/apple-launch',
    ]);
  });
});

describe('shouldRenderUnfurl', () => {
  const url = 'https://example.com/a';

  it('rejects unfurls with no metadata beyond the echoed URL', () => {
    expect(shouldRenderUnfurl({ url, title: url })).toBe(false);
    expect(shouldRenderUnfurl({ url, title: '' })).toBe(false);
  });

  it('accepts unfurls with a real title, description, or image', () => {
    expect(shouldRenderUnfurl({ url, title: 'A Page' })).toBe(true);
    expect(shouldRenderUnfurl({ url, title: url, description: 'd' })).toBe(
      true
    );
    expect(
      shouldRenderUnfurl({ url, title: url, image_url: 'https://x/i.png' })
    ).toBe(true);
  });
});

describe('reservedPreviewImageSize', () => {
  const url = 'https://example.com/a';

  it('returns nothing without an image', () => {
    expect(
      reservedPreviewImageSize({ url, title: 'A', image_url: undefined })
    ).toBeUndefined();
  });

  it('scales known Open Graph dimensions into the preview cap', () => {
    const box = reservedPreviewImageSize({
      url,
      title: 'A',
      image_url: 'https://example.com/og.png',
      image_width: 1200,
      image_height: 630,
    });
    expect(box).toEqual({
      width: 448,
      height: 235,
      known: true,
    });
  });

  it('reserves a landscape box when the page omitted dimensions', () => {
    const box = reservedPreviewImageSize({
      url,
      title: 'A',
      image_url: 'https://example.com/og.png',
    });
    expect(box?.known).toBe(false);
    expect(box?.width).toBe(448);
    expect(box?.height).toBe(235);
  });
});

const baseMessage: MessageData = {
  id: 'message-1',
  content: 'hello',
  sender_id: 'user-2',
  created_at: '2026-02-25T00:00:00.000Z',
  updated_at: '2026-02-25T00:00:00.000Z',
  attachments: [],
  reactions: [],
};

function renderPreviews(
  content: string,
  message: Partial<MessageData> = {},
  channelId: string | undefined = 'channel-1'
) {
  return render(() => (
    <Root message={{ ...baseMessage, content, ...message }}>
      <LinkPreviews channelId={channelId} />
    </Root>
  ));
}

describe('LinkPreviews', () => {
  beforeEach(() => {
    suppressMutate.mockReset();
    unfurlResults.clear();
    clearHiddenLinkPreviews();
    setShowLinkPreviews(true);
  });

  it('renders a card once the unfurl succeeds', () => {
    const url = 'https://example.com/article';
    unfurlResults.set(url, {
      type: 'success',
      data: {
        url,
        title: 'An Article',
        description: 'Description here',
        favicon_url: 'https://example.com/favicon.ico',
      },
      _createdAt: new Date(),
    });

    const { container, getByText } = renderPreviews(`look: ${url}`);

    const card = container.querySelector('[data-link-preview]');
    expect(card).not.toBeNull();
    expect(getByText('An Article').closest('a')?.href).toBe(url);
    expect(getByText('Description here')).not.toBeNull();
    expect(getByText('example.com')).not.toBeNull();
  });

  it('renders no card while loading or after an error', () => {
    const loading = 'https://example.com/loading';
    const errored = 'https://example.com/errored';
    unfurlResults.set(loading, { type: 'loading', _createdAt: new Date() });
    unfurlResults.set(errored, { type: 'error', _createdAt: new Date() });

    const { container } = renderPreviews(`${loading} ${errored}`);

    expect(container.querySelector('[data-link-preview]')).toBeNull();
  });

  it('reserves the preview image box before the image loads', () => {
    const url = 'https://example.com/og-image';
    unfurlResults.set(url, {
      type: 'success',
      data: {
        url,
        title: 'Has Image',
        image_url: 'https://example.com/og.png',
        image_width: 1200,
        image_height: 630,
      },
      _createdAt: new Date(),
    });

    const { container } = renderPreviews(url);
    const slot = container.querySelector('[data-link-preview-image]');
    const placeholder = container.querySelector(
      '[data-link-preview-image-placeholder]'
    );
    expect(slot).not.toBeNull();
    expect((slot as HTMLElement).style.width).toBe('448px');
    expect(placeholder).not.toBeNull();
    expect((placeholder as HTMLElement).style.height).toBe('235px');
  });

  it('reserves a landscape image box when Open Graph omitted dimensions', () => {
    const url = 'https://example.com/og-no-dims';
    unfurlResults.set(url, {
      type: 'success',
      data: {
        url,
        title: 'No Dims',
        image_url: 'https://example.com/og.png',
      },
      _createdAt: new Date(),
    });

    const { container } = renderPreviews(url);
    const placeholder = container.querySelector(
      '[data-link-preview-image-placeholder]'
    );
    expect(placeholder).not.toBeNull();
    expect((placeholder as HTMLElement).style.width).toBe('448px');
    expect((placeholder as HTMLElement).style.height).toBe('235px');
  });

  it('renders no card for an unfurl with no usable metadata', () => {
    const url = 'https://example.com/bare';
    unfurlResults.set(url, {
      type: 'success',
      data: { url, title: url },
      _createdAt: new Date(),
    });

    const { container } = renderPreviews(url);

    expect(container.querySelector('[data-link-preview]')).toBeNull();
  });

  it('reveals the muted X after pointer hover on the preview', async () => {
    const user = userEvent.setup();
    const url = 'https://example.com/pointer-hover-x';
    unfurlResults.set(url, {
      type: 'success',
      data: { url, title: 'Pointer Hover X' },
      _createdAt: new Date(),
    });

    const { container, getByRole } = renderPreviews(url, {
      id: 'message-pointer-hover-x',
      sender_id: 'user-1',
    });

    const card = container.querySelector('[data-link-preview]');
    expect(card).not.toBeNull();
    const button = getByRole('button', { name: 'Remove link preview' });
    expect(button.className.split(/\s+/)).toContain('opacity-0');

    await user.hover(card!);
    expect(button.className.split(/\s+/)).toContain('opacity-100');
  });

  it('lets the sender remove a preview for everyone', async () => {
    const user = userEvent.setup({ skipHover: true });
    const url = 'https://example.com/hide-me';
    unfurlResults.set(url, {
      type: 'success',
      data: { url, title: 'Hide Me' },
      _createdAt: new Date(),
    });

    // Current user (user-1) is the sender.
    const first = renderPreviews(url, { sender_id: 'user-1' });
    expect(first.container.querySelector('[data-link-preview]')).not.toBeNull();

    await user.click(
      first.getByRole('button', { name: 'Remove link preview' })
    );
    // Hidden immediately (optimistic) while the server rewrites the content.
    expect(first.container.querySelector('[data-link-preview]')).toBeNull();
    expect(suppressMutate).toHaveBeenCalledTimes(1);
    expect(suppressMutate.mock.calls[0]?.[0]).toEqual({
      channelID: 'channel-1',
      messageID: 'message-1',
      url,
    });
    first.unmount();

    const second = renderPreviews(url, { sender_id: 'user-1' });
    expect(second.container.querySelector('[data-link-preview]')).toBeNull();
  });

  it('clears the optimistic hide once the rewritten content arrives', () => {
    const url = 'https://example.com/confirmed';
    unfurlResults.set(url, {
      type: 'success',
      data: { url, title: 'Confirmed' },
      _createdAt: new Date(),
    });
    hideLinkPreview('message-confirmed', url);

    const removed = `<m-link>{"url":"${url}","text":"${url}","title":"","preview":false}</m-link>`;
    const { container } = renderPreviews(removed, { id: 'message-confirmed' });

    expect(container.querySelector('[data-link-preview]')).toBeNull();
    expect(isLinkPreviewHidden('message-confirmed', url)).toBe(false);
  });

  it('offers no remove button on messages the user did not send', () => {
    const url = 'https://example.com/not-mine';
    unfurlResults.set(url, {
      type: 'success',
      data: { url, title: 'Not Mine' },
      _createdAt: new Date(),
    });

    const { container, queryByRole } = renderPreviews(url, {
      id: 'message-not-mine',
      sender_id: 'user-2',
    });

    expect(container.querySelector('[data-link-preview]')).not.toBeNull();
    expect(queryByRole('button', { name: 'Remove link preview' })).toBeNull();
  });

  it('renders nothing when the global preference is off', () => {
    const url = 'https://example.com/pref-off';
    unfurlResults.set(url, {
      type: 'success',
      data: { url, title: 'Pref Off' },
      _createdAt: new Date(),
    });

    setShowLinkPreviews(false);
    try {
      // Unique id: 'message-1' was locally hidden by the remove test above,
      // which would mask a regression in the preference gate.
      const { container } = renderPreviews(url, { id: 'message-pref-off' });
      expect(
        container.querySelector('[data-message-link-previews]')
      ).toBeNull();
    } finally {
      setShowLinkPreviews(true);
    }
    expect(showLinkPreviews()).toBe(true);
  });
});
