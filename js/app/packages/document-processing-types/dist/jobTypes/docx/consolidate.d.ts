import { z } from 'zod';
declare const Consolidate: z.ZodObject<{
    sourceUpload: z.ZodObject<{
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
    revisedUploads: z.ZodArray<z.ZodObject<{
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
    }>, "many">;
    isPdfCompare: z.ZodBoolean;
}, "strip", z.ZodTypeAny, {
    sourceUpload: {
        documentId: string;
        documentVersionId: number;
        fileName: string;
        author?: string | undefined;
        color?: string | undefined;
    };
    isPdfCompare: boolean;
    revisedUploads: {
        documentId: string;
        documentVersionId: number;
        fileName: string;
        author?: string | undefined;
        color?: string | undefined;
    }[];
}, {
    sourceUpload: {
        documentId: string;
        documentVersionId: number;
        fileName: string;
        author?: string | undefined;
        color?: string | undefined;
    };
    isPdfCompare: boolean;
    revisedUploads: {
        documentId: string;
        documentVersionId: number;
        fileName: string;
        author?: string | undefined;
        color?: string | undefined;
    }[];
}>;
export declare function consolidate_validate(data: {
    [name: string]: any;
}): {
    sourceUpload: {
        documentId: string;
        documentVersionId: number;
        fileName: string;
        author?: string | undefined;
        color?: string | undefined;
    };
    isPdfCompare: boolean;
    revisedUploads: {
        documentId: string;
        documentVersionId: number;
        fileName: string;
        author?: string | undefined;
        color?: string | undefined;
    }[];
};
/**
 * Consolidates the provided source upload against the revised uploads. It also
 * saves the resulting docx document to the users macro cloud via DSS.
 * @returns the consolidated documents documentMetadata as well as the revision
 * count.
 */
export type Consolidate = z.infer<typeof Consolidate>;
declare const ConsolidateResponseDataUploadCompleteSchema: z.ZodObject<{
    documentMetadata: z.ZodObject<z.objectUtil.extendShape<{
        documentId: z.ZodString;
        documentVersionId: z.ZodNumber;
        documentName: z.ZodString;
        owner: z.ZodString;
        fileType: z.ZodUnion<[z.ZodLiteral<import("../documentMetadata").FileType.Pdf>, z.ZodLiteral<import("../documentMetadata").FileType.Docx>]>;
        documentFamilyId: z.ZodOptional<z.ZodNumber>;
        branchedFromId: z.ZodOptional<z.ZodString>;
        branchedFromVersionId: z.ZodOptional<z.ZodNumber>;
    }, {
        fileType: z.ZodLiteral<import("../documentMetadata").FileType.Docx>;
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
        fileType: import("../documentMetadata").FileType.Docx;
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
        fileType: import("../documentMetadata").FileType.Docx;
        documentFamilyId?: number | undefined;
        branchedFromId?: string | undefined;
        branchedFromVersionId?: number | undefined;
        documentBom?: {
            path: string;
            sha: string;
            id: string;
        }[] | undefined;
    }>;
    insertions: z.ZodNumber;
    deletions: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    documentMetadata: {
        documentId: string;
        documentVersionId: number;
        documentName: string;
        owner: string;
        fileType: import("../documentMetadata").FileType.Docx;
        documentFamilyId?: number | undefined;
        branchedFromId?: string | undefined;
        branchedFromVersionId?: number | undefined;
        documentBom?: {
            path: string;
            sha: string;
            id: string;
        }[] | undefined;
    };
    insertions: number;
    deletions: number;
}, {
    documentMetadata: {
        documentId: string;
        documentVersionId: number;
        documentName: string;
        owner: string;
        fileType: import("../documentMetadata").FileType.Docx;
        documentFamilyId?: number | undefined;
        branchedFromId?: string | undefined;
        branchedFromVersionId?: number | undefined;
        documentBom?: {
            path: string;
            sha: string;
            id: string;
        }[] | undefined;
    };
    insertions: number;
    deletions: number;
}>;
declare const ConsolidateResponseDataUploadUnzippedSchema: z.ZodObject<{
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
export type ConsolidateResponseDataUploadComplete = z.infer<typeof ConsolidateResponseDataUploadCompleteSchema>;
export type ConsolidateResponseDataUploadUnzipped = z.infer<typeof ConsolidateResponseDataUploadUnzippedSchema>;
declare const ConsolidateResponseData: z.ZodUnion<[z.ZodObject<{
    documentMetadata: z.ZodObject<z.objectUtil.extendShape<{
        documentId: z.ZodString;
        documentVersionId: z.ZodNumber;
        documentName: z.ZodString;
        owner: z.ZodString;
        fileType: z.ZodUnion<[z.ZodLiteral<import("../documentMetadata").FileType.Pdf>, z.ZodLiteral<import("../documentMetadata").FileType.Docx>]>;
        documentFamilyId: z.ZodOptional<z.ZodNumber>;
        branchedFromId: z.ZodOptional<z.ZodString>;
        branchedFromVersionId: z.ZodOptional<z.ZodNumber>;
    }, {
        fileType: z.ZodLiteral<import("../documentMetadata").FileType.Docx>;
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
        fileType: import("../documentMetadata").FileType.Docx;
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
        fileType: import("../documentMetadata").FileType.Docx;
        documentFamilyId?: number | undefined;
        branchedFromId?: string | undefined;
        branchedFromVersionId?: number | undefined;
        documentBom?: {
            path: string;
            sha: string;
            id: string;
        }[] | undefined;
    }>;
    insertions: z.ZodNumber;
    deletions: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    documentMetadata: {
        documentId: string;
        documentVersionId: number;
        documentName: string;
        owner: string;
        fileType: import("../documentMetadata").FileType.Docx;
        documentFamilyId?: number | undefined;
        branchedFromId?: string | undefined;
        branchedFromVersionId?: number | undefined;
        documentBom?: {
            path: string;
            sha: string;
            id: string;
        }[] | undefined;
    };
    insertions: number;
    deletions: number;
}, {
    documentMetadata: {
        documentId: string;
        documentVersionId: number;
        documentName: string;
        owner: string;
        fileType: import("../documentMetadata").FileType.Docx;
        documentFamilyId?: number | undefined;
        branchedFromId?: string | undefined;
        branchedFromVersionId?: number | undefined;
        documentBom?: {
            path: string;
            sha: string;
            id: string;
        }[] | undefined;
    };
    insertions: number;
    deletions: number;
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
export declare function consolidate_upload_response(data: any): data is ConsolidateResponseDataUploadComplete;
export declare function consolidate_unzip_response(data: any): data is ConsolidateResponseDataUploadUnzipped;
export declare function consolidate_response_data_validate(data: any): data is ConsolidateResponseData;
export type ConsolidateResponseData = z.infer<typeof ConsolidateResponseData>;
declare const ConsolidateResponse: z.ZodObject<z.objectUtil.extendShape<{
    jobId: z.ZodString;
    jobType: z.ZodString;
    error: z.ZodOptional<z.ZodBoolean>;
    message: z.ZodOptional<z.ZodString>;
}, {
    data: z.ZodOptional<z.ZodUnion<[z.ZodObject<{
        documentMetadata: z.ZodObject<z.objectUtil.extendShape<{
            documentId: z.ZodString;
            documentVersionId: z.ZodNumber;
            documentName: z.ZodString;
            owner: z.ZodString;
            fileType: z.ZodUnion<[z.ZodLiteral<import("../documentMetadata").FileType.Pdf>, z.ZodLiteral<import("../documentMetadata").FileType.Docx>]>;
            documentFamilyId: z.ZodOptional<z.ZodNumber>;
            branchedFromId: z.ZodOptional<z.ZodString>;
            branchedFromVersionId: z.ZodOptional<z.ZodNumber>;
        }, {
            fileType: z.ZodLiteral<import("../documentMetadata").FileType.Docx>;
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
            fileType: import("../documentMetadata").FileType.Docx;
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
            fileType: import("../documentMetadata").FileType.Docx;
            documentFamilyId?: number | undefined;
            branchedFromId?: string | undefined;
            branchedFromVersionId?: number | undefined;
            documentBom?: {
                path: string;
                sha: string;
                id: string;
            }[] | undefined;
        }>;
        insertions: z.ZodNumber;
        deletions: z.ZodNumber;
    }, "strip", z.ZodTypeAny, {
        documentMetadata: {
            documentId: string;
            documentVersionId: number;
            documentName: string;
            owner: string;
            fileType: import("../documentMetadata").FileType.Docx;
            documentFamilyId?: number | undefined;
            branchedFromId?: string | undefined;
            branchedFromVersionId?: number | undefined;
            documentBom?: {
                path: string;
                sha: string;
                id: string;
            }[] | undefined;
        };
        insertions: number;
        deletions: number;
    }, {
        documentMetadata: {
            documentId: string;
            documentVersionId: number;
            documentName: string;
            owner: string;
            fileType: import("../documentMetadata").FileType.Docx;
            documentFamilyId?: number | undefined;
            branchedFromId?: string | undefined;
            branchedFromVersionId?: number | undefined;
            documentBom?: {
                path: string;
                sha: string;
                id: string;
            }[] | undefined;
        };
        insertions: number;
        deletions: number;
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
        documentMetadata: {
            documentId: string;
            documentVersionId: number;
            documentName: string;
            owner: string;
            fileType: import("../documentMetadata").FileType.Docx;
            documentFamilyId?: number | undefined;
            branchedFromId?: string | undefined;
            branchedFromVersionId?: number | undefined;
            documentBom?: {
                path: string;
                sha: string;
                id: string;
            }[] | undefined;
        };
        insertions: number;
        deletions: number;
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
        documentMetadata: {
            documentId: string;
            documentVersionId: number;
            documentName: string;
            owner: string;
            fileType: import("../documentMetadata").FileType.Docx;
            documentFamilyId?: number | undefined;
            branchedFromId?: string | undefined;
            branchedFromVersionId?: number | undefined;
            documentBom?: {
                path: string;
                sha: string;
                id: string;
            }[] | undefined;
        };
        insertions: number;
        deletions: number;
    } | {
        bomParts: {
            path: string;
            sha: string;
            id: string;
        }[];
    } | undefined;
}>;
export declare function consolidate_response_validate(data: {
    [name: string]: any;
}): {
    jobId: string;
    jobType: string;
    error?: boolean | undefined;
    message?: string | undefined;
    data?: {
        documentMetadata: {
            documentId: string;
            documentVersionId: number;
            documentName: string;
            owner: string;
            fileType: import("../documentMetadata").FileType.Docx;
            documentFamilyId?: number | undefined;
            branchedFromId?: string | undefined;
            branchedFromVersionId?: number | undefined;
            documentBom?: {
                path: string;
                sha: string;
                id: string;
            }[] | undefined;
        };
        insertions: number;
        deletions: number;
    } | {
        bomParts: {
            path: string;
            sha: string;
            id: string;
        }[];
    } | undefined;
};
export type ConsolidateResponse = z.infer<typeof ConsolidateResponse>;
export {};
