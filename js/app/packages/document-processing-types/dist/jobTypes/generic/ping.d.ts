import { z } from 'zod';
declare const Ping: z.ZodAny;
export declare function ping_validate(data: {
    [name: string]: any;
}): any;
/**
 * Simple job that will hit the consumer and re-log the data you provide.
 * Meant to test things working E2E.
 */
export type Ping = z.infer<typeof Ping>;
declare const PingResponseDataSchema: z.ZodObject<{
    pong: z.ZodLiteral<true>;
}, "strip", z.ZodTypeAny, {
    pong: true;
}, {
    pong: true;
}>;
declare const PingResponse: z.ZodObject<z.objectUtil.extendShape<{
    jobId: z.ZodString;
    jobType: z.ZodString;
    error: z.ZodOptional<z.ZodBoolean>;
    message: z.ZodOptional<z.ZodString>;
}, {
    data: z.ZodOptional<z.ZodObject<{
        pong: z.ZodLiteral<true>;
    }, "strip", z.ZodTypeAny, {
        pong: true;
    }, {
        pong: true;
    }>>;
}>, "strip", z.ZodTypeAny, {
    jobId: string;
    jobType: string;
    error?: boolean | undefined;
    message?: string | undefined;
    data?: {
        pong: true;
    } | undefined;
}, {
    jobId: string;
    jobType: string;
    error?: boolean | undefined;
    message?: string | undefined;
    data?: {
        pong: true;
    } | undefined;
}>;
export type PingResponseData = z.infer<typeof PingResponseDataSchema>;
export declare function ping_response_validate(data: {
    [name: string]: any;
}): {
    jobId: string;
    jobType: string;
    error?: boolean | undefined;
    message?: string | undefined;
    data?: {
        pong: true;
    } | undefined;
};
export type PingResponse = z.infer<typeof PingResponse>;
export declare function ping_response_data_validate(data: any): data is PingResponseData;
export {};
