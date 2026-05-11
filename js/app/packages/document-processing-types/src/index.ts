export {
  JobResponseDataValidation,
  JobResponseValidation,
  JobValidation,
} from './jobTypes';
// Generic job types
export type {
  CreateTempFile,
  CreateTempFileResponse,
  CreateTempFileResponseData,
} from './jobTypes/generic/create_temp_file';
export type { Ping, PingResponse } from './jobTypes/generic/ping';
export { JobStatus } from './jobTypes/jobStatus';
export type { JobTypes } from './jobTypes/jobTypes';
export { JobTypeEnum } from './jobTypes/jobTypes';
export type {
  Convert,
  ConvertResponse,
  ConvertResponseData,
} from './jobTypes/pdf/convert';
// PDF job types
export type {
  Export,
  ExportResponse,
  ExportResponseData,
} from './jobTypes/pdf/export';

export type {
  Modify,
  ModifyResponse,
  ModifyResponseData,
} from './jobTypes/pdf/modify';

export type {
  PasswordInput,
  PasswordResponse,
  PasswordResponseData,
} from './jobTypes/pdf/password';

export type {
  Preprocess,
  PreprocessInvoke,
  PreprocessResponse,
  PreprocessResponseData,
  PreprocessUpload,
  PreprocessUploadComplete,
} from './jobTypes/pdf/preprocess';

export {
  is_preprocess_invoke,
  is_preprocess_upload,
  PreprocessInvokeSchema,
} from './jobTypes/pdf/preprocess';

export type {
  RemoveMetadata,
  RemoveMetadataResponse,
} from './jobTypes/pdf/remove_metadata';

// Docx job types

export {
  getDocumentKeyParts,
  makeDocumentKey,
} from './documentProcessing/documentKey';
export {
  type DocumentProcessResponse,
  type ErrorResponse as DocumentProcessErrorResponse,
  isDocumentProcessResponse,
  isError as isDocumentProcessResponseError,
  isSuccess as isDocumentProcessResponseSuccess,
  type SuccessResponse as DocumentProcessSuccessResponse,
} from './documentProcessing/response';
export {
  type DocumentMetadata,
  DocumentMetadataSchema,
  type DocxDocumentMetadata,
  DocxDocumentMetadataSchema,
  FileType,
  isDocumentMetadataForFileType,
  type PdfDocumentMetadata,
  PdfDocumentMetadataSchema,
} from './jobTypes/documentMetadata';
export type { ComparisionUpload } from './jobTypes/docx';
export type {
  Consolidate,
  ConsolidateResponse,
  ConsolidateResponseData,
  ConsolidateResponseDataUploadComplete,
  ConsolidateResponseDataUploadUnzipped,
} from './jobTypes/docx/consolidate';
export type {
  DocxUpload,
  DocxUploadResponse,
  DocxUploadResponseData,
  DocxUploadResponseDataUploadComplete,
  DocxUploadResponseDataUploadUnzipped,
} from './jobTypes/docx/docx_upload';
export type {
  SimpleCompare,
  SimpleCompareResponse,
  SimpleCompareResponseData,
  SimpleCompareResponseDataUploadComplete,
  SimpleCompareResponseDataUploadUnzipped,
} from './jobTypes/docx/simple_compare';
