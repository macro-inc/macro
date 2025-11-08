import { z } from 'zod';
import { BaseResponse } from '../baseResponse';

const PreprocessUploadSchema = z.object({});

export type PreprocessUpload = z.infer<typeof PreprocessUploadSchema>;

export const PreprocessInvokeSchema = z.object({
  // The id of the document
  documentId: z.string(),
  // The version id of the document
  // Used in conjunction with the documentId to get the document key to send to
  // preprocess job
  documentVersionId: z.number(),
  // Whether to force a retry of the preprocess job or not
  retry: z.boolean().optional(),
});

export type PreprocessInvoke = z.infer<typeof PreprocessInvokeSchema>;

const Preprocess = PreprocessInvokeSchema.or(PreprocessUploadSchema);

export function is_preprocess_upload(data: any): data is PreprocessUpload {
  return PreprocessUploadSchema.safeParse(data).success;
}

export function is_preprocess_invoke(data: any): data is PreprocessInvoke {
  return PreprocessUploadSchema.safeParse(data).success;
}

export function preprocess_validate(data: { [name: string]: any }) {
  const result = Preprocess.safeParse(data);
  if (result.success) {
    return result.data;
  }
  throw result.error;
}

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

const PreprocessUploadCompleteSchema = z.object({
  success: z.boolean(),
});

export type PreprocessUploadComplete = z.infer<
  typeof PreprocessUploadCompleteSchema
>;

const PreprocessResponseDataSchema = z
  .object({
    // The documentId
    // This serves no real purpose other than to signify a successful response
    documentId: z.string(),
  })
  .or(PreprocessUploadCompleteSchema);

export type PreprocessResponseData = z.infer<
  typeof PreprocessResponseDataSchema
>;

const PreprocessResponseSchema = BaseResponse.extend({
  data: PreprocessResponseDataSchema.optional(),
});

export type PreprocessResponse = z.infer<typeof PreprocessResponseSchema>;

export function preprocess_response_validate(data: { [name: string]: any }) {
  const result = PreprocessResponseSchema.safeParse(data);
  if (result.success) {
    return result.data;
  }
  throw result.error;
}

export function preprocess_response_data_validate(
  data: any
): data is PreprocessResponseData {
  return PreprocessResponseDataSchema.safeParse(data).success;
}

export function preprocess_upload_response_validate(
  data: any
): data is PreprocessUploadComplete {
  return PreprocessUploadCompleteSchema.safeParse(data).success;
}
