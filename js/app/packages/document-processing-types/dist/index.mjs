// ESM wrapper - use namespace import for CommonJS interop
import * as cjs from './index.js';

export const JobTypeEnum = cjs.JobTypeEnum;
export const JobStatus = cjs.JobStatus;
export const JobValidation = cjs.JobValidation;
export const JobResponseValidation = cjs.JobResponseValidation;
export const JobResponseDataValidation = cjs.JobResponseDataValidation;
export const is_preprocess_invoke = cjs.is_preprocess_invoke;
export const is_preprocess_upload = cjs.is_preprocess_upload;
export const PreprocessInvokeSchema = cjs.PreprocessInvokeSchema;
export const makeDocumentKey = cjs.makeDocumentKey;
export const getDocumentKeyParts = cjs.getDocumentKeyParts;
export const isDocumentProcessResponse = cjs.isDocumentProcessResponse;
export const isDocumentProcessResponseError = cjs.isDocumentProcessResponseError;
export const isDocumentProcessResponseSuccess = cjs.isDocumentProcessResponseSuccess;
export const isDocumentMetadataForFileType = cjs.isDocumentMetadataForFileType;
export const FileType = cjs.FileType;
export const PdfDocumentMetadataSchema = cjs.PdfDocumentMetadataSchema;
export const DocxDocumentMetadataSchema = cjs.DocxDocumentMetadataSchema;
export const DocumentMetadataSchema = cjs.DocumentMetadataSchema;
