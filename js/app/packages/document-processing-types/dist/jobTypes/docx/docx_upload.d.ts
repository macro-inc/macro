import { z } from 'zod';
declare const DocxUpload: z.ZodObject<{}, "strip", z.ZodTypeAny, {}, {}>;
export declare function docx_upload_validate(data: {
    [name: string]: any;
}): {};
/**
 * DocxUpload initiates the docx upload process. It is used
 * to create a new docx upload job in the DocxUploadJob table. This job is
 * then used to track the progress of the docx upload process.
 * @returns success boolean indicating if the docx was successfully unzipped
 */
export type DocxUpload = z.infer<typeof DocxUpload>;
declare const DocxUploadResponseDataUploadCompleteSchema: z.ZodObject<{
    success: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    success: boolean;
}, {
    success: boolean;
}>;
declare const DocxUploadResponseDataUploadUnzippedSchema: z.ZodObject<{
    bomParts: z.ZodArray<z.ZodObject<{
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
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    bomParts: {
        path: string;
        sha: string;
        id: string;
    }[];
}, {
    bomParts: {
        path: string;
        sha: string;
        id: string;
    }[];
}>;
export type DocxUploadResponseDataUploadComplete = z.infer<typeof DocxUploadResponseDataUploadCompleteSchema>;
export type DocxUploadResponseDataUploadUnzipped = z.infer<typeof DocxUploadResponseDataUploadUnzippedSchema>;
declare const DocxUploadResponseData: z.ZodUnion<[z.ZodObject<{
    success: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    success: boolean;
}, {
    success: boolean;
}>, z.ZodObject<{
    bomParts: z.ZodArray<z.ZodObject<{
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
    }>, "many">;
}, "strip", z.ZodTypeAny, {
    bomParts: {
        path: string;
        sha: string;
        id: string;
    }[];
}, {
    bomParts: {
        path: string;
        sha: string;
        id: string;
    }[];
}>]>;
export declare function docx_upload_ready_response(data: any): data is DocxUploadResponseDataUploadComplete;
export declare function docx_upload_unzip_response(data: any): data is DocxUploadResponseDataUploadUnzipped;
export declare function docx_upload_response_data_validate(data: any): data is DocxUploadResponseData;
export type DocxUploadResponseData = z.infer<typeof DocxUploadResponseData>;
declare const DocxUploadResponse: z.ZodObject<z.objectUtil.extendShape<{
    jobId: z.ZodString;
    jobType: z.ZodString;
    error: z.ZodOptional<z.ZodBoolean>;
    message: z.ZodOptional<z.ZodString>;
}, {
    data: z.ZodOptional<z.ZodUnion<[z.ZodObject<{
        success: z.ZodBoolean;
    }, "strip", z.ZodTypeAny, {
        success: boolean;
    }, {
        success: boolean;
    }>, z.ZodObject<{
        bomParts: z.ZodArray<z.ZodObject<{
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
        }>, "many">;
    }, "strip", z.ZodTypeAny, {
        bomParts: {
            path: string;
            sha: string;
            id: string;
        }[];
    }, {
        bomParts: {
            path: string;
            sha: string;
            id: string;
        }[];
    }>]>>;
}>, "strip", z.ZodTypeAny, {
    jobId: string;
    jobType: string;
    error?: boolean | undefined;
    message?: string | undefined;
    data?: {
        success: boolean;
    } | {
        bomParts: {
            path: string;
            sha: string;
            id: string;
        }[];
    } | undefined;
}, {
    jobId: string;
    jobType: string;
    error?: boolean | undefined;
    message?: string | undefined;
    data?: {
        success: boolean;
    } | {
        bomParts: {
            path: string;
            sha: string;
            id: string;
        }[];
    } | undefined;
}>;
export declare function docx_upload_response_validate(data: {
    [name: string]: any;
}): {
    jobId: string;
    jobType: string;
    error?: boolean | undefined;
    message?: string | undefined;
    data?: {
        success: boolean;
    } | {
        bomParts: {
            path: string;
            sha: string;
            id: string;
        }[];
    } | undefined;
};
export type DocxUploadResponse = z.infer<typeof DocxUploadResponse>;
export {};
