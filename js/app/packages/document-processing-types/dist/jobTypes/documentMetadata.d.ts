import { z } from 'zod';
export declare enum FileType {
    Pdf = "pdf",
    Docx = "docx",
    Doc = "doc",
    Xlsx = "xlsx",
    Csv = "csv",
    Zip = "zip"
}
export declare const PdfDocumentMetadataSchema: z.ZodObject<z.objectUtil.extendShape<{
    documentId: z.ZodString;
    documentVersionId: z.ZodNumber;
    documentName: z.ZodString;
    owner: z.ZodString;
    fileType: z.ZodUnion<[z.ZodLiteral<FileType.Pdf>, z.ZodLiteral<FileType.Docx>]>;
    documentFamilyId: z.ZodOptional<z.ZodNumber>;
    branchedFromId: z.ZodOptional<z.ZodString>;
    branchedFromVersionId: z.ZodOptional<z.ZodNumber>;
}, {
    fileType: z.ZodLiteral<FileType.Pdf>;
    sha: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    documentId: string;
    documentVersionId: number;
    sha: string;
    documentName: string;
    owner: string;
    fileType: FileType.Pdf;
    documentFamilyId?: number | undefined;
    branchedFromId?: string | undefined;
    branchedFromVersionId?: number | undefined;
}, {
    documentId: string;
    documentVersionId: number;
    sha: string;
    documentName: string;
    owner: string;
    fileType: FileType.Pdf;
    documentFamilyId?: number | undefined;
    branchedFromId?: string | undefined;
    branchedFromVersionId?: number | undefined;
}>;
export type PdfDocumentMetadata = z.infer<typeof PdfDocumentMetadataSchema>;
export declare const DocxBomPartSchema: z.ZodObject<{
    id: z.ZodString;
    path: z.ZodString;
    sha: z.ZodString;
}, "strip", z.ZodTypeAny, {
    path: string;
    sha: string;
    id: string;
}, {
    path: string;
    sha: string;
    id: string;
}>;
export type DocxBomPart = z.infer<typeof DocxBomPartSchema>;
export declare const DocxDocumentMetadataSchema: z.ZodObject<z.objectUtil.extendShape<{
    documentId: z.ZodString;
    documentVersionId: z.ZodNumber;
    documentName: z.ZodString;
    owner: z.ZodString;
    fileType: z.ZodUnion<[z.ZodLiteral<FileType.Pdf>, z.ZodLiteral<FileType.Docx>]>;
    documentFamilyId: z.ZodOptional<z.ZodNumber>;
    branchedFromId: z.ZodOptional<z.ZodString>;
    branchedFromVersionId: z.ZodOptional<z.ZodNumber>;
}, {
    fileType: z.ZodLiteral<FileType.Docx>;
    documentBom: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        path: z.ZodString;
        sha: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        path: string;
        sha: string;
        id: string;
    }, {
        path: string;
        sha: string;
        id: string;
    }>, "many">>;
}>, "strip", z.ZodTypeAny, {
    documentId: string;
    documentVersionId: number;
    documentName: string;
    owner: string;
    fileType: FileType.Docx;
    documentFamilyId?: number | undefined;
    branchedFromId?: string | undefined;
    branchedFromVersionId?: number | undefined;
    documentBom?: {
        path: string;
        sha: string;
        id: string;
    }[] | undefined;
}, {
    documentId: string;
    documentVersionId: number;
    documentName: string;
    owner: string;
    fileType: FileType.Docx;
    documentFamilyId?: number | undefined;
    branchedFromId?: string | undefined;
    branchedFromVersionId?: number | undefined;
    documentBom?: {
        path: string;
        sha: string;
        id: string;
    }[] | undefined;
}>;
export type DocxDocumentMetadata = z.infer<typeof DocxDocumentMetadataSchema>;
export declare const DocumentMetadataSchema: z.ZodDiscriminatedUnion<"fileType", [z.ZodObject<z.objectUtil.extendShape<{
    documentId: z.ZodString;
    documentVersionId: z.ZodNumber;
    documentName: z.ZodString;
    owner: z.ZodString;
    fileType: z.ZodUnion<[z.ZodLiteral<FileType.Pdf>, z.ZodLiteral<FileType.Docx>]>;
    documentFamilyId: z.ZodOptional<z.ZodNumber>;
    branchedFromId: z.ZodOptional<z.ZodString>;
    branchedFromVersionId: z.ZodOptional<z.ZodNumber>;
}, {
    fileType: z.ZodLiteral<FileType.Pdf>;
    sha: z.ZodString;
}>, "strip", z.ZodTypeAny, {
    documentId: string;
    documentVersionId: number;
    sha: string;
    documentName: string;
    owner: string;
    fileType: FileType.Pdf;
    documentFamilyId?: number | undefined;
    branchedFromId?: string | undefined;
    branchedFromVersionId?: number | undefined;
}, {
    documentId: string;
    documentVersionId: number;
    sha: string;
    documentName: string;
    owner: string;
    fileType: FileType.Pdf;
    documentFamilyId?: number | undefined;
    branchedFromId?: string | undefined;
    branchedFromVersionId?: number | undefined;
}>, z.ZodObject<z.objectUtil.extendShape<{
    documentId: z.ZodString;
    documentVersionId: z.ZodNumber;
    documentName: z.ZodString;
    owner: z.ZodString;
    fileType: z.ZodUnion<[z.ZodLiteral<FileType.Pdf>, z.ZodLiteral<FileType.Docx>]>;
    documentFamilyId: z.ZodOptional<z.ZodNumber>;
    branchedFromId: z.ZodOptional<z.ZodString>;
    branchedFromVersionId: z.ZodOptional<z.ZodNumber>;
}, {
    fileType: z.ZodLiteral<FileType.Docx>;
    documentBom: z.ZodOptional<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        path: z.ZodString;
        sha: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        path: string;
        sha: string;
        id: string;
    }, {
        path: string;
        sha: string;
        id: string;
    }>, "many">>;
}>, "strip", z.ZodTypeAny, {
    documentId: string;
    documentVersionId: number;
    documentName: string;
    owner: string;
    fileType: FileType.Docx;
    documentFamilyId?: number | undefined;
    branchedFromId?: string | undefined;
    branchedFromVersionId?: number | undefined;
    documentBom?: {
        path: string;
        sha: string;
        id: string;
    }[] | undefined;
}, {
    documentId: string;
    documentVersionId: number;
    documentName: string;
    owner: string;
    fileType: FileType.Docx;
    documentFamilyId?: number | undefined;
    branchedFromId?: string | undefined;
    branchedFromVersionId?: number | undefined;
    documentBom?: {
        path: string;
        sha: string;
        id: string;
    }[] | undefined;
}>]>;
export type DocumentMetadata = z.infer<typeof DocumentMetadataSchema>;
type DocumentMetadataMap = {
    [FileType.Pdf]: PdfDocumentMetadata;
    [FileType.Docx]: DocxDocumentMetadata;
};
export declare const isDocumentMetadataForFileType: <T extends keyof DocumentMetadataMap>(input: DocumentMetadata, fileType: T) => input is DocumentMetadataMap[T];
export {};
