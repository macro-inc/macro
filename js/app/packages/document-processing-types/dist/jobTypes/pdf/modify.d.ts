import { z } from 'zod';
declare const Modify: z.ZodObject<{
    documentKey: z.ZodString;
    sha: z.ZodString;
    modificationData: z.ZodAny;
    shouldSaveBookmarks: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    documentKey: string;
    sha: string;
    shouldSaveBookmarks: boolean;
    modificationData?: any;
}, {
    documentKey: string;
    sha: string;
    shouldSaveBookmarks: boolean;
    modificationData?: any;
}>;
export declare function modify_validate(data: {
    [name: string]: any;
}): {
    documentKey: string;
    sha: string;
    shouldSaveBookmarks: boolean;
    modificationData?: any;
};
/**
 * @deprecated
 * A job used to test a portion of the save functionality for pdfs.
 * Not to be used in actual app.
 */
export type Modify = z.infer<typeof Modify>;
declare const ModifyResponseDataSchema: z.ZodObject<{
    resultUrl: z.ZodString;
}, "strip", z.ZodTypeAny, {
    resultUrl: string;
}, {
    resultUrl: string;
}>;
export type ModifyResponseData = z.infer<typeof ModifyResponseDataSchema>;
declare const ModifyResponse: z.ZodObject<z.objectUtil.extendShape<{
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
export declare function modify_response_validate(data: {
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
export type ModifyResponse = z.infer<typeof ModifyResponse>;
export declare function modify_response_data_validate(data: any): data is ModifyResponseData;
export {};
