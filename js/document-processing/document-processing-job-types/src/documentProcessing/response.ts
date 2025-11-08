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

const DocumentProcessingResponseSchema =
  SuccessResponseSchema.or(ErrorResponseSchema);

export type DocumentProcessResponse = z.infer<
  typeof DocumentProcessingResponseSchema
>;

export const isError = (response: any): response is ErrorResponse => {
  return isDocumentProcessResponse(response) && response.error;
};

export const isSuccess = (response: any): response is SuccessResponse => {
  return isDocumentProcessResponse(response) && !response.error;
};

export const isDocumentProcessResponse = (
  data: any
): data is DocumentProcessResponse => {
  const result = DocumentProcessingResponseSchema.safeParse(data);
  return result.success;
};
