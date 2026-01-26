import { z } from 'zod';

const SuccessResponseSchema = z.object({
  error: z.literal(false),
  data: z.record(z.string(), z.any()),
});

export type SuccessResponse = z.infer<typeof SuccessResponseSchema>;

const ErrorResponseSchema = z.object({
  error: z.literal(true),
  message: z.string(),
});

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

const DocumentProcessingResponseSchema = z.union([
  SuccessResponseSchema,
  ErrorResponseSchema,
]);

export type DocumentProcessResponse = z.infer<
  typeof DocumentProcessingResponseSchema
>;

export const isError = (
  response: unknown
): response is { error: true; message: string } => {
  return ErrorResponseSchema.safeParse(response).success;
};

export const isSuccess = (
  response: unknown
): response is { error: false; data: Record<string, unknown> } => {
  return SuccessResponseSchema.safeParse(response).success;
};

export const isDocumentProcessResponse = (
  data: unknown
): data is DocumentProcessResponse => {
  return DocumentProcessingResponseSchema.safeParse(data).success;
};
