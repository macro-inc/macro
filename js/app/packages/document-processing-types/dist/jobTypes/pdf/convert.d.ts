import { z } from 'zod';
declare const Convert: z.ZodObject<{
    documentKey: z.ZodString;
    documentExtension: z.ZodEnum<["pdf", "docx"]>;
    sha: z.ZodString;
    toExtension: z.ZodEnum<["pdf", "docx"]>;
}, "strip", z.ZodTypeAny, {
    documentKey: string;
    sha: string;
    documentExtension: "pdf" | "docx";
    toExtension: "pdf" | "docx";
}, {
    documentKey: string;
    sha: string;
    documentExtension: "pdf" | "docx";
    toExtension: "pdf" | "docx";
}>;
export declare function convert_validate(data: {
    [name: string]: any;
}): {
    documentKey: string;
    sha: string;
    documentExtension: "pdf" | "docx";
    toExtension: "pdf" | "docx";
};
/**
 * Given a DSS document, this job will convert that document into the specified
 * format.
 * @returns the s3 presigned url to get the converted document.
 */
export type Convert = z.infer<typeof Convert>;
declare const ConvertResponseDataSchema: z.ZodObject<{
    resultUrl: z.ZodString;
    resultKey: z.ZodString;
}, "strip", z.ZodTypeAny, {
    resultUrl: string;
    resultKey: string;
}, {
    resultUrl: string;
    resultKey: string;
}>;
export type ConvertResponseData = z.infer<typeof ConvertResponseDataSchema>;
declare const ConvertResponse: z.ZodObject<z.objectUtil.extendShape<{
    jobId: z.ZodString;
    jobType: z.ZodString;
    error: z.ZodOptional<z.ZodBoolean>;
    message: z.ZodOptional<z.ZodString>;
}, {
    data: z.ZodOptional<z.ZodObject<{
        resultUrl: z.ZodString;
        resultKey: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        resultUrl: string;
        resultKey: string;
    }, {
        resultUrl: string;
        resultKey: string;
    }>>;
}>, "strip", z.ZodTypeAny, {
    jobId: string;
    jobType: string;
    error?: boolean | undefined;
    message?: string | undefined;
    data?: {
        resultUrl: string;
        resultKey: string;
    } | undefined;
}, {
    jobId: string;
    jobType: string;
    error?: boolean | undefined;
    message?: string | undefined;
    data?: {
        resultUrl: string;
        resultKey: string;
    } | undefined;
}>;
export declare function convert_response_validate(data: {
    [name: string]: any;
}): {
    jobId: string;
    jobType: string;
    error?: boolean | undefined;
    message?: string | undefined;
    data?: {
        resultUrl: string;
        resultKey: string;
    } | undefined;
};
export declare function convert_response_data_validate(data: any): data is ConvertResponseData;
export type ConvertResponse = z.infer<typeof ConvertResponse>;
export {};
