import { z } from 'zod';
declare const SuccessResponseSchema: z.ZodObject<{
    error: z.ZodLiteral<false>;
    data: z.ZodRecord<z.ZodString, z.ZodAny>;
}, "strip", z.ZodTypeAny, {
    error: false;
    data: Record<string, any>;
}, {
    error: false;
    data: Record<string, any>;
}>;
export type SuccessResponse = z.infer<typeof SuccessResponseSchema>;
declare const ErrorResponseSchema: z.ZodObject<{
    error: z.ZodLiteral<true>;
    message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    error: true;
    message: string;
}, {
    error: true;
    message: string;
}>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
declare const DocumentProcessingResponseSchema: z.ZodUnion<[z.ZodObject<{
    error: z.ZodLiteral<false>;
    data: z.ZodRecord<z.ZodString, z.ZodAny>;
}, "strip", z.ZodTypeAny, {
    error: false;
    data: Record<string, any>;
}, {
    error: false;
    data: Record<string, any>;
}>, z.ZodObject<{
    error: z.ZodLiteral<true>;
    message: z.ZodString;
}, "strip", z.ZodTypeAny, {
    error: true;
    message: string;
}, {
    error: true;
    message: string;
}>]>;
export type DocumentProcessResponse = z.infer<typeof DocumentProcessingResponseSchema>;
export declare const isError: (response: any) => response is {
    error: true;
    message: string;
};
export declare const isSuccess: (response: any) => response is {
    error: false;
    data: Record<string, any>;
};
export declare const isDocumentProcessResponse: (data: any) => data is {
    error: false;
    data: Record<string, any>;
} | {
    error: true;
    message: string;
};
export {};
