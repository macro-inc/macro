import { z } from 'zod';
declare const CreateTempFile: z.ZodObject<{
    sha: z.ZodString;
    extension: z.ZodString;
}, "strip", z.ZodTypeAny, {
    sha: string;
    extension: string;
}, {
    sha: string;
    extension: string;
}>;
export declare function create_temp_file_validate(data: {
    [name: string]: any;
}): {
    sha: string;
    extension: string;
};
/**
 * Used to create a temporary file. This is useful for jobs like `pdf_preprocess`
 * or `pdf_ocr_perform` where the user might be making edits to the document
 * and need to have the jobs run against the updated, unsaved document.
 * @returns The presigned PUT url you can use to upload the file.
 * Note: All temp files are automatically disposed of in s3 after 1 day.
 */
export type CreateTempFile = z.infer<typeof CreateTempFile>;
declare const CreateTempFileResponseDataSchema: z.ZodObject<{
    resultUrl: z.ZodString;
    resultKey: z.ZodString;
}, "strip", z.ZodTypeAny, {
    resultUrl: string;
    resultKey: string;
}, {
    resultUrl: string;
    resultKey: string;
}>;
export type CreateTempFileResponseData = z.infer<typeof CreateTempFileResponseDataSchema>;
declare const CreateTempFileResponse: z.ZodObject<z.objectUtil.extendShape<{
    jobId: z.ZodString;
    jobType: z.ZodString;
    error: z.ZodOptional<z.ZodBoolean>;
    message: z.ZodOptional<z.ZodString>; /**
     * Used to create a temporary file. This is useful for jobs like `pdf_preprocess`
     * or `pdf_ocr_perform` where the user might be making edits to the document
     * and need to have the jobs run against the updated, unsaved document.
     * @returns The presigned PUT url you can use to upload the file.
     * Note: All temp files are automatically disposed of in s3 after 1 day.
     */
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
export declare function create_temp_file_response_validate(data: {
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
export declare function create_temp_file_response_data_validate(data: any): data is CreateTempFileResponseData;
export type CreateTempFileResponse = z.infer<typeof CreateTempFileResponse>;
export {};
