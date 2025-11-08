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
  const regex = /^([^/]+)\/([^/]+)\/([^/]+)\.(pdf|docx)$/;
  const match = documentKey.match(regex);

  if (!match) {
    throw new Error(`Invalid document key: ${documentKey}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [_, owner, documentId, documentVersionId, fileType] = match;
  const formattedFileType = fileType as 'pdf' | 'docx';

  return {
    owner,
    documentId,
    documentVersionId,
    fileType: formattedFileType,
  };
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
}) => `${owner}/${documentId}/${documentVersionId}.${fileType}`;
