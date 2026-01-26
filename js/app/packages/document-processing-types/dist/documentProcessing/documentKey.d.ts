/**
 * @param documentKey A string formatted to `${owner}/${documentId}/${documentVersionId}.${fileType}`
 * where fileType is one of pdf or docx.
 * NOTE: temp files are stored with a different key format
 * @returns the parts that make up the document key
 */
export declare const getDocumentKeyParts: (documentKey: string) => {
    owner: string;
    documentId: string;
    documentVersionId: string;
    fileType: 'pdf' | 'docx';
};
/**
 * NOTE: temp files are stored with a different key format
 * @returns a unique formatted string document key from the owner, documentId, documentVersionId, and fileType
 */
export declare const makeDocumentKey: ({ owner, documentId, documentVersionId, fileType, }: {
    owner: string;
    documentId: string;
    documentVersionId: string;
    fileType: 'pdf' | 'docx';
}) => string;
