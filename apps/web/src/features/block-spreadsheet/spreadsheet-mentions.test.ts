import { createRoutesManifest, defineRoute } from '@app/lib/split-router';
import {
  createMacroMentionLinkResolver,
  uuidRouteReference,
} from '@components/app/split-layout/split-router/mention-links';
import { cellTextParts } from '@macro-inc/spreadsheet/cell-mentions';
import { describe, expect, it, vi } from 'vitest';
import { linkMentions } from './spreadsheet-mentions';

vi.mock(
  '@core/component/LexicalMarkdown/component/decorator/DocumentMention',
  () => ({})
);
vi.mock(
  '@core/component/LexicalMarkdown/component/decorator/UserMention',
  () => ({})
);
vi.mock(
  '@core/component/LexicalMarkdown/component/menu/MentionsMenu/MentionsMenu',
  () => ({})
);
vi.mock(
  '@core/component/LexicalMarkdown/component/menu/MentionsMenu/utils/entityUtils',
  () => ({})
);
vi.mock('./components/CellMentionEditor', () => ({}));
vi.mock('./spreadsheet-cell-links', () => ({}));
vi.mock('@core/internal/BlockLoader', () => ({}));
vi.mock('@core/component/LexicalMarkdown/utils', () => ({}));
vi.mock('@core/component/LexicalMarkdown/plugins/mentions', () => ({}));

const id = '019507e8-14a3-7bc1-8610-419f16bd03a8';
const resolver = createMacroMentionLinkResolver(
  createRoutesManifest({
    definitions: [
      defineRoute({
        id: 'drive',
        path: 'drive',
        externalSearch: ['comment_id'],
        children: [
          defineRoute({
            id: 'drive-document',
            path: ':documentType/:documentId',
            toReference: ({ documentId, documentType }) =>
              uuidRouteReference(documentId, documentType),
          }),
        ],
      }),
    ],
  })
);

describe('spreadsheet link mentions', () => {
  it('converts routed links to document mentions with an injected resolver', () => {
    const url = `${window.location.origin}/app/drive/md/${id}`;
    const parts = cellTextParts(linkMentions(url, resolver));
    expect(parts[0]?.mention).toMatchObject({
      type: 'document',
      documentId: id,
      blockName: 'md',
      blockParams: {},
    });
  });

  it('retains compatible routed comment targets', () => {
    const url = `${window.location.origin}/app/drive/md/${id}?comment_id=target&s0.drive.commentId=other`;
    const parts = cellTextParts(linkMentions(url, resolver));
    expect(parts[0]?.mention).toMatchObject({
      type: 'document',
      documentId: id,
      blockName: 'md',
      blockParams: { comment_id: 'target' },
    });
  });

  it('retains legacy links and their parameters without a resolver', () => {
    const url = `${window.location.origin}/app/md/${id}?comment_id=target`;
    const parts = cellTextParts(linkMentions(url));
    expect(parts[0]?.mention).toMatchObject({
      type: 'document',
      documentId: id,
      blockName: 'md',
      blockParams: { comment_id: 'target' },
    });
  });

  it('keeps unsupported links and formulas unchanged', () => {
    const url = `${window.location.origin}/app/settings`;
    expect(linkMentions(url, resolver)).toBe(url);
    expect(linkMentions(`=${url}`, resolver)).toBe(`=${url}`);
    expect(linkMentions(`${window.location.origin}/app/drive/md/${id}`)).toBe(
      `${window.location.origin}/app/drive/md/${id}`
    );
  });
});
