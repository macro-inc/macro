import { z } from 'zod';

export enum FileType {
  Pdf = 'pdf',
  Docx = 'docx',
  Doc = 'doc',
  Xlsx = 'xlsx',
  Csv = 'csv',
  Zip = 'zip',
}

const DocumentMetadataBaseSchema = z.object({
  documentId: z.string(),
  documentVersionId: z.number(),
  documentName: z.string(),
  owner: z.string(),
  fileType: z.union([z.literal(FileType.Pdf), z.literal(FileType.Docx)]),
  documentFamilyId: z.number().optional(),
  branchedFromId: z.string().optional(),
  branchedFromVersionId: z.number().optional(),
});

export const PdfDocumentMetadataSchema = DocumentMetadataBaseSchema.extend({
  fileType: z.literal(FileType.Pdf),
  sha: z.string(),
});

export type PdfDocumentMetadata = z.infer<typeof PdfDocumentMetadataSchema>;

export const DocxBomPartSchema = z.object({
  id: z.string(),
  path: z.string(),
  sha: z.string(),
});

export type DocxBomPart = z.infer<typeof DocxBomPartSchema>;

export const DocxDocumentMetadataSchema = DocumentMetadataBaseSchema.extend({
  fileType: z.literal(FileType.Docx),
  documentBom: z.array(DocxBomPartSchema).optional(),
});

export type DocxDocumentMetadata = z.infer<typeof DocxDocumentMetadataSchema>;

export const DocumentMetadataSchema = z.discriminatedUnion('fileType', [
  PdfDocumentMetadataSchema,
  DocxDocumentMetadataSchema,
]);

export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;

type DocumentMetadataMap = {
  [FileType.Pdf]: PdfDocumentMetadata;
  [FileType.Docx]: DocxDocumentMetadata;
};

export const isDocumentMetadataForFileType = <
  T extends keyof DocumentMetadataMap,
>(
  input: DocumentMetadata,
  fileType: T
): input is DocumentMetadataMap[T] => {
  return input.fileType === fileType;
};
