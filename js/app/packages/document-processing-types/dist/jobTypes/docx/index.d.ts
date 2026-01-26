import { z } from 'zod';
export declare const ComparisionUploadDss: z.ZodObject<{
    fileName: z.ZodString;
    author: z.ZodOptional<z.ZodString>;
    color: z.ZodOptional<z.ZodString>;
    documentId: z.ZodString;
    documentVersionId: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    documentId: string;
    documentVersionId: number;
    fileName: string;
    author?: string | undefined;
    color?: string | undefined;
}, {
    documentId: string;
    documentVersionId: number;
    fileName: string;
    author?: string | undefined;
    color?: string | undefined;
}>;
export declare const ComparisionUpload: z.ZodObject<{
    fileName: z.ZodString;
    author: z.ZodOptional<z.ZodString>;
    color: z.ZodOptional<z.ZodString>;
    documentId: z.ZodString;
    documentVersionId: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    documentId: string;
    documentVersionId: number;
    fileName: string;
    author?: string | undefined;
    color?: string | undefined;
}, {
    documentId: string;
    documentVersionId: number;
    fileName: string;
    author?: string | undefined;
    color?: string | undefined;
}>;
