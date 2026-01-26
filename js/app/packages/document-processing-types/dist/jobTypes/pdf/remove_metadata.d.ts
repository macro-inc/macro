import { z } from 'zod';
declare const RemoveMetadata: z.ZodObject<{
    documentKey: z.ZodString;
    sha: z.ZodString;
}, "strip", z.ZodTypeAny, {
    documentKey: string;
    sha: string;
}, {
    documentKey: string;
    sha: string;
}>;
export declare function remove_metadata_validate(data: {
    [name: string]: any;
}): {
    documentKey: string;
    sha: string;
};
/**
 * Removes all metadata from the provided pdf.
 * @returns the presigned url to download the stripped pdf.
 */
export type RemoveMetadata = z.infer<typeof RemoveMetadata>;
declare const RemoveMetadataResponse: z.ZodObject<z.objectUtil.extendShape<{
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
export declare function remove_metadata_response_validate(data: {
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
export type RemoveMetadataResponse = z.infer<typeof RemoveMetadataResponse>;
export {};
