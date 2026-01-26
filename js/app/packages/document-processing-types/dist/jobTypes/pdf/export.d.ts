import { z } from 'zod';
declare const Export: z.ZodObject<{
    documentId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    documentId: string;
}, {
    documentId: string;
}>;
export declare function export_validate(data: {
    [name: string]: any;
}): {
    documentId: string;
};
/**
 * Given a DSS document, this job will apply the modification data to the pdf and
 * return a presigned url you can use to download the modified pdf.
 * @returns the s3 presigned url to get the converted document.
 */
export type Export = z.infer<typeof Export>;
declare const ExportResponseDataSchema: z.ZodObject<{
    resultUrl: z.ZodString;
}, "strip", z.ZodTypeAny, {
    resultUrl: string;
}, {
    resultUrl: string;
}>;
export type ExportResponseData = z.infer<typeof ExportResponseDataSchema>;
declare const ExportResponse: z.ZodObject<z.objectUtil.extendShape<{
    jobId: z.ZodString;
    jobType: z.ZodString;
    error: z.ZodOptional<z.ZodBoolean>;
    message: z.ZodOptional<z.ZodString>;
}, {
    data: z.ZodOptional<z.ZodObject<{
        resultUrl: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        resultUrl: string;
    }, {
        resultUrl: string;
    }>>;
}>, "strip", z.ZodTypeAny, {
    jobId: string;
    jobType: string;
    error?: boolean | undefined;
    message?: string | undefined;
    data?: {
        resultUrl: string;
    } | undefined;
}, {
    jobId: string;
    jobType: string;
    error?: boolean | undefined;
    message?: string | undefined;
    data?: {
        resultUrl: string;
    } | undefined;
}>;
export declare function export_response_validate(data: {
    [name: string]: any;
}): {
    jobId: string;
    jobType: string;
    error?: boolean | undefined;
    message?: string | undefined;
    data?: {
        resultUrl: string;
    } | undefined;
};
export declare function export_response_data_validate(data: any): data is ExportResponseData;
export type ExportResponse = z.infer<typeof ExportResponse>;
export {};
