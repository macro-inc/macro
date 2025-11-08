import {
  getDocumentKeyParts,
  makeDocumentKey,
} from '../../src/documentProcessing/documentKey';

describe('getDocumentKeyParts', () => {
  it('should correctly parse the document key', () => {
    const documentKey = 'owner123/doc456/789.pdf';
    const result = getDocumentKeyParts(documentKey);
    expect(result).toEqual({
      owner: 'owner123',
      documentId: 'doc456',
      documentVersionId: '789',
      fileType: 'pdf',
    });
  });

  it('should correctly parse a document key with a different file type', () => {
    const documentKey = 'owner123/doc456/789.docx';
    const result = getDocumentKeyParts(documentKey);
    expect(result).toEqual({
      owner: 'owner123',
      documentId: 'doc456',
      documentVersionId: '789',
      fileType: 'docx',
    });
  });

  it('should throw an error for an invalid document key', () => {
    const documentKey = 'invalidkey';
    expect(() => getDocumentKeyParts(documentKey)).toThrowError(
      'Invalid document key: invalidkey'
    );
  });
});

describe('makeDocumentKey', () => {
  it('should correctly create the document key', () => {
    const result = makeDocumentKey({
      owner: 'owner123',
      documentId: 'doc456',
      documentVersionId: '789',
      fileType: 'pdf',
    });
    expect(result).toBe('owner123/doc456/789.pdf');
  });

  it('should correctly create the document key with a different file type', () => {
    const result = makeDocumentKey({
      owner: 'owner123',
      documentId: 'doc456',
      documentVersionId: '789',
      fileType: 'docx',
    });
    expect(result).toBe('owner123/doc456/789.docx');
  });
});
