import { z } from 'zod';
declare const PasswordInput: z.ZodObject<{
    documentId: z.ZodString;
    documentVersionId: z.ZodNumber;
    password: z.ZodString;
}, "strip", z.ZodTypeAny, {
    documentId: string;
    documentVersionId: number;
    password: string;
}, {
    documentId: string;
    documentVersionId: number;
    password: string;
}>;
export declare function password_validate(data: {
    [name: string]: any;
}): {
    documentId: string;
    documentVersionId: number;
    password: string;
};
/**
 * Used to encrypt the provided document key with the given password.
 * @returns the s3 presigned url to get the encrypted document.
 */
export type PasswordInput = z.infer<typeof PasswordInput>;
declare const PasswordResponseDataSchema: z.ZodObject<{
    resultUrl: z.ZodString;
}, "strip", z.ZodTypeAny, {
    resultUrl: string;
}, {
    resultUrl: string;
}>;
export type PasswordResponseData = z.infer<typeof PasswordResponseDataSchema>;
export declare function password_response_data_validate(data: any): data is PasswordResponseData;
declare const PasswordResponse: z.ZodObject<z.objectUtil.extendShape<{
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
export declare function password_response_validate(data: {
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
export type PasswordResponse = z.infer<typeof PasswordResponse>;
export {};
