import { getDocumentKeyParts } from '@macro-inc/document-processing-job-types';

/**
 * Note that this is only for DSS documents. Temp files have document keys of a different format, and will be handled in {@link documentOverrideInfoAtom}.
 * @returns The individual parts the make up a document key
 * @see {@link getDocumentKeyParts}
 */
export type DocumentKeyParts = ReturnType<typeof getDocumentKeyParts>;
