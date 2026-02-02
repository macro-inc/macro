/**
 * @param documentKey A string formatted to `${owner}/${documentId}/${documentVersionId}.${fileType}`
 * where fileType is one of pdf or docx.
 * NOTE: temp files are stored with a different key format
 * @returns the parts that make up the document key
 */
export const getDocumentKeyParts = (
  documentKey: string
): {
  owner: string;
  documentId: string;
  documentVersionId: string;
  fileType: 'pdf' | 'docx';
} => {
  const parts = documentKey.split('/');
  const owner = parts[0];
  const documentId = parts[1];
  const fileNameParts = parts[2].split('.');
  const documentVersionId = fileNameParts[0];
  const fileType = fileNameParts[1] as 'pdf' | 'docx';
  return { owner, documentId, documentVersionId, fileType };
};

/**
 * NOTE: temp files are stored with a different key format
 * @returns a unique formatted string document key from the owner, documentId, documentVersionId, and fileType
 */
export const makeDocumentKey = ({
  owner,
  documentId,
  documentVersionId,
  fileType,
}: {
  owner: string;
  documentId: string;
  documentVersionId: string;
  fileType: 'pdf' | 'docx';
}): string => {
  return `${owner}/${documentId}/${documentVersionId}.${fileType}`;
};
