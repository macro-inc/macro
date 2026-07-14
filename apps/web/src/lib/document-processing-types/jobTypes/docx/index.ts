import { z } from 'zod';

const _ComparisionUploadDss = z.object({
  fileName: z.string(),
  author: z.string().optional(),
  color: z.string().optional(),
  documentId: z.string(),
  documentVersionId: z.number(),
});

export const ComparisionUpload = z.object({
  fileName: z.string(),
  author: z.string().optional(),
  color: z.string().optional(),
  documentId: z.string(),
  documentVersionId: z.number(),
});

export type ComparisionUpload = z.infer<typeof ComparisionUpload>;
