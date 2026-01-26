import { z } from 'zod';
declare const PreprocessUploadSchema: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
export type PreprocessUpload = z.infer<typeof PreprocessUploadSchema>;
export declare const PreprocessInvokeSchema: z.ZodObject<{
    documentId: z.ZodString;
    documentVersionId: z.ZodNumber;
    retry: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    documentId: string;
    documentVersionId: number;
    retry?: boolean | undefined;
}, {
    documentId: string;
    documentVersionId: number;
    retry?: boolean | undefined;
}>;
export type PreprocessInvoke = z.infer<typeof PreprocessInvokeSchema>;
declare const Preprocess: z.ZodUnion<[z.ZodObject<{
    documentId: z.ZodString;
    documentVersionId: z.ZodNumber;
    retry: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    documentId: string;
    documentVersionId: number;
    retry?: boolean | undefined;
}, {
    documentId: string;
    documentVersionId: number;
    retry?: boolean | undefined;
}>, z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>]>;
export declare function is_preprocess_upload(data: any): data is PreprocessUpload;
export declare function is_preprocess_invoke(data: any): data is PreprocessInvoke;
export declare function preprocess_validate(data: {
    [name: string]: any;
}): {} | {
    documentId: string;
    documentVersionId: number;
    retry?: boolean | undefined;
};
/**
 * There are 2 types of Preprocess events.
 * PreprocessInit - used to initialize the upload job prior to creating a new pdf file
 * PreprocessInvoke - invokes preprocess and retrieves the preprocess results.
 * PreprocessInvoke takes a document id and document version id and runs the pdf service `/preprocess` call on the
 * document, storing the resulting preprocess json inside of MacroDB
 * `DocumentProcessResult` table. This also creates an entry in
 * `JobToDocumentProcessResult` table that allows the user to retrieve the
 * preprocess response using DSS.
 * @returns the document id as a indication that the job is complete.
 */
export type Preprocess = z.infer<typeof Preprocess>;
declare const PreprocessUploadCompleteSchema: z.ZodObject<{
    success: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    success: boolean;
}, {
    success: boolean;
}>;
export type PreprocessUploadComplete = z.infer<typeof PreprocessUploadCompleteSchema>;
declare const PreprocessResponseDataSchema: z.ZodUnion<[z.ZodObject<{
    documentId: z.ZodString;
}, "strip", z.ZodTypeAny, {
    documentId: string;
}, {
    documentId: string;
}>, z.ZodObject<{
    success: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    success: boolean;
}, {
    success: boolean;
}>]>;
export type PreprocessResponseData = z.infer<typeof PreprocessResponseDataSchema>;
declare const PreprocessResponseSchema: z.ZodObject<z.objectUtil.extendShape<{
    jobId: z.ZodString;
    jobType: z.ZodString;
    error: z.ZodOptional<z.ZodBoolean>;
    message: z.ZodOptional<z.ZodString>;
}, {
    data: z.ZodOptional<z.ZodUnion<[z.ZodObject<{
        documentId: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        documentId: string;
    }, {
        documentId: string;
    }>, z.ZodObject<{
        success: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        success: boolean;
    }, {
        success: boolean;
    }>]>>;
}>, "strip", z.ZodTypeAny, {
    jobId: string;
    jobType: string;
    error?: boolean | undefined;
    message?: string | undefined;
    data?: {
        success: boolean;
    } | {
        documentId: string;
    } | undefined;
}, {
    jobId: string;
    jobType: string;
    error?: boolean | undefined;
    message?: string | undefined;
    data?: {
        success: boolean;
    } | {
        documentId: string;
    } | undefined;
}>;
export type PreprocessResponse = z.infer<typeof PreprocessResponseSchema>;
export declare function preprocess_response_validate(data: {
    [name: string]: any;
}): {
    jobId: string;
    jobType: string;
    error?: boolean | undefined;
    message?: string | undefined;
    data?: {
        success: boolean;
    } | {
        documentId: string;
    } | undefined;
};
export declare function preprocess_response_data_validate(data: any): data is PreprocessResponseData;
export declare function preprocess_upload_response_validate(data: any): data is PreprocessUploadComplete;
export {};
