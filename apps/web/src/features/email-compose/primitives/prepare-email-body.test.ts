// @vitest-environment jsdom

import { staticFileReferenceEndpoint } from '@core/constant/servers';
import { $generateNodesFromDOM } from '@lexical/html';
import { DocumentMentionNode } from '@macro-inc/lexical-core';
import { $getRoot, $nodesOfType, createEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import { message } from '../../email-message/tests/messages';
import { decodeBase64Utf8 } from '../core/decode-base64';
import { createEmailEditor } from '../tests/editor';
import {
  prepareEmailBody,
  prepareEmailBodyFromHtml,
  registerToggleAppendedThread,
  TOGGLE_APPEND_EMAIL_THREAD_COMMAND,
} from './prepare-email-body';

const replyingTo = message('original', {
  from: { name: 'Ada Lovelace', email: 'ada@example.com' },
  to: [],
  cc: [],
  bcc: [],
  subject: 'Numbers',
  body_html_sanitized: null,
  body_text: 'original message text',
  internal_date_ts: '2026-08-01T12:00:00Z',
  attachments: [],
});

const inlineImageMessage = {
  ...replyingTo,
  body_html_sanitized:
    '<p>Chart</p><img src="cid:chart" alt="chart"><img src="cid:missing">',
  attachments: [
    {
      db_id: 'chart-attachment',
      content_id: '<chart>',
      sfs_id: 'chart-file',
      mime_type: 'image/png',
    },
  ],
};

function quotedImageSources(html: string) {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  return Array.from(body.querySelectorAll('.macro_quote img')).map((img) =>
    img.getAttribute('src')
  );
}

describe('prepareEmailBodyFromHtml', () => {
  it.each(['reply', 'forward'] as const)(
    'keeps quoted Macro document links re-importable as rich mentions in a %s',
    (replyType) => {
      const prepared = prepareEmailBodyFromHtml('<p>My reply</p>', {
        replyType,
        replyingTo: {
          ...replyingTo,
          body_html_sanitized:
            '<p>Read <a href="https://example.com/app/md/document-123" data-document-mention="true" data-document-id="document-123" data-document-name="Architecture" data-block-name="md">Architecture</a></p>',
        },
      });
      const dom = new DOMParser().parseFromString(
        decodeBase64Utf8(prepared.bodyHtml),
        'text/html'
      );
      const editor = createEditor({
        nodes: [DocumentMentionNode],
        onError(error) {
          throw error;
        },
      });
      editor.update(
        () => $getRoot().append(...$generateNodesFromDOM(editor, dom)),
        { discrete: true }
      );
      editor.read(() => {
        expect(
          $nodesOfType(DocumentMentionNode).map((node) => node.exportJSON())
        ).toMatchObject([
          {
            documentId: 'document-123',
            documentName: 'Architecture',
            blockName: 'md',
          },
        ]);
      });
    }
  );
  it.each(['reply', 'forward'] as const)(
    'preserves original theme rules and image-map links in an outgoing %s',
    (replyType) => {
      const prepared = prepareEmailBodyFromHtml('<p>My reply</p>', {
        replyType,
        replyingTo: {
          ...replyingTo,
          body_html_sanitized:
            '<style>@media(prefers-color-scheme:dark){.message{color:white}}.message{color:var(--tone,black)}</style><p class="message">Original message</p><map name="offer"><area href="https://example.com/accept"></map>',
        },
      });
      const decoded = decodeBase64Utf8(prepared.bodyHtml);
      expect(decoded).toContain('prefers-color-scheme');
      expect(decoded).toContain('var(--tone,black)');
      expect(decoded).toContain('href="https://example.com/accept"');
    }
  );
  it.each(['reply', 'forward'] as const)(
    'links inline cid images to their static-file copies in an outgoing %s',
    (replyType) => {
      const prepared = prepareEmailBodyFromHtml('<p>My reply</p>', {
        replyType,
        replyingTo: inlineImageMessage,
      });
      const images = quotedImageSources(decodeBase64Utf8(prepared.bodyHtml));
      expect(images).toEqual([
        staticFileReferenceEndpoint('chart-file'),
        'cid:missing',
      ]);
    }
  );
  it('links inline cid images in a forward quoted in the editor', () => {
    const editor = createEmailEditor('FYI');
    registerToggleAppendedThread(editor);
    editor.dispatchCommand(TOGGLE_APPEND_EMAIL_THREAD_COMMAND, {
      replyingTo: inlineImageMessage,
      replyType: 'forward',
      visible: true,
    });
    const prepared = prepareEmailBody(editor, {
      replyType: 'forward',
      replyingTo: inlineImageMessage,
    });
    const images = quotedImageSources(decodeBase64Utf8(prepared!.bodyHtml));
    expect(images).toEqual([
      staticFileReferenceEndpoint('chart-file'),
      'cid:missing',
    ]);
  });
  it('does not add a quote block without appendReply (undo-send restore)', () => {
    const prepared = prepareEmailBodyFromHtml('<p>hi there</p>');
    const decoded = decodeBase64Utf8(prepared.bodyHtml);
    expect(decoded).toContain('hi there');
    expect(decoded).not.toContain('macro_quote');
  });

  it('appends the replied-to message when appendReply is provided', () => {
    const prepared = prepareEmailBodyFromHtml('<p>hi there</p>', {
      replyType: 'reply',
      replyingTo,
    });
    const decoded = decodeBase64Utf8(prepared.bodyHtml);
    const body = new DOMParser().parseFromString(decoded, 'text/html').body;
    const quotes = body.querySelectorAll('.macro_quote');
    expect(quotes).toHaveLength(1);
    expect(quotes[0].textContent).toContain('original message text');
    expect(quotes[0].textContent).toContain('wrote:');
  });

  it('does not double-append when the quote is already in the body', () => {
    const prepared = prepareEmailBodyFromHtml(
      '<p>hi there</p><div class="macro_quote gmail_quote">already quoted</div>',
      { replyType: 'reply', replyingTo }
    );
    const decoded = decodeBase64Utf8(prepared.bodyHtml);
    const body = new DOMParser().parseFromString(decoded, 'text/html').body;
    const quotes = body.querySelectorAll('.macro_quote');
    expect(quotes).toHaveLength(1);
    expect(quotes[0].textContent).toContain('already quoted');
  });
});
