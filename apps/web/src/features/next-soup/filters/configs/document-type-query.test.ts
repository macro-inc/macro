import { describe, expect, it } from 'vitest';
import {
  buildDocumentTypeQuery,
  getActiveDocumentTypeFilterIds,
  isDocumentTypeFilterId,
} from './document-type-query';

describe('document type query helpers', () => {
  it('groups selected document type chips into one OR documentWhere query', () => {
    expect(buildDocumentTypeQuery(['file-pdf', 'doc-snippet'])).toEqual({
      documentWhere: {
        op: 'or',
        clauses: [
          { include: { fileType: ['pdf'] } },
          {
            op: 'and',
            clauses: [
              { include: { fileType: ['md'] } },
              { include: { subType: ['snippet'] } },
            ],
          },
        ],
      },
    });
  });

  it('filters active ids to supported document type chips in stable order', () => {
    const active = new Set(['doc-snippet', 'file-pdf', 'email-attachments']);

    expect(getActiveDocumentTypeFilterIds((id) => active.has(id))).toEqual([
      'file-pdf',
      'doc-snippet',
    ]);
  });

  it('identifies document type chip ids', () => {
    expect(isDocumentTypeFilterId('file-pdf')).toBe(true);
    expect(isDocumentTypeFilterId('email-attachments')).toBe(false);
  });
});
