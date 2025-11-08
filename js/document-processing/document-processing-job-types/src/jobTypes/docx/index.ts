import { z } from 'zod';

export const ComparisionUploadDss = z.object({
  // The name of the file (without .docx extension)
  fileName: z.string(),
  // Optional author of the document to track changes (required on consolidate)
  author: z.string().optional(),
  // Optional color to make the consolidate changes for a user
  color: z.string().optional(),
  // The id of the document
  documentId: z.string(),
  // The version of the document
  documentVersionId: z.number(),
});

export const ComparisionUpload = ComparisionUploadDss;
