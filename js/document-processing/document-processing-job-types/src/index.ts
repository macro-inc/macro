export type { JobTypes } from './jobTypes/jobTypes';

export { JobTypeEnum } from './jobTypes/jobTypes';

export { JobStatus } from './jobTypes/jobStatus';

export {
  JobValidation,
  JobResponseValidation,
  JobResponseDataValidation,
} from './jobTypes';

// Generic job types
export type {
  CreateTempFile,
  CreateTempFileResponse,
  CreateTempFileResponseData,
} from './jobTypes/generic/create_temp_file';

export type { Ping, PingResponse } from './jobTypes/generic/ping';

// PDF job types
export type {
  Export,
  ExportResponse,
  ExportResponseData,
} from './jobTypes/pdf/export';
export type {
  Convert,
  ConvertResponse,
  ConvertResponseData,
} from './jobTypes/pdf/convert';

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
  PreprocessUpload,
  PreprocessUploadComplete,
  PreprocessResponse,
  PreprocessResponseData,
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

export type {
  DocxUpload,
  DocxUploadResponse,
  DocxUploadResponseData,
  DocxUploadResponseDataUploadComplete,
  DocxUploadResponseDataUploadUnzipped,
} from './jobTypes/docx/docx_upload';

export type { ComparisionUpload } from './jobTypes/docx';

export type {
  SimpleCompare,
  SimpleCompareResponse,
  SimpleCompareResponseData,
  SimpleCompareResponseDataUploadComplete,
  SimpleCompareResponseDataUploadUnzipped,
} from './jobTypes/docx/simple_compare';

export type {
  Consolidate,
  ConsolidateResponse,
  ConsolidateResponseData,
  ConsolidateResponseDataUploadComplete,
  ConsolidateResponseDataUploadUnzipped,
} from './jobTypes/docx/consolidate';

export {
  makeDocumentKey,
  getDocumentKeyParts,
} from './documentProcessing/documentKey';

export {
  type DocumentProcessResponse,
  type ErrorResponse as DocumentProcessErrorResponse,
  type SuccessResponse as DocumentProcessSuccessResponse,
  isDocumentProcessResponse,
  isError as isDocumentProcessResponseError,
  isSuccess as isDocumentProcessResponseSuccess,
} from './documentProcessing/response';

export {
  type PdfDocumentMetadata,
  type DocxDocumentMetadata,
  type DocumentMetadata,
  isDocumentMetadataForFileType,
  FileType,
  PdfDocumentMetadataSchema,
  DocxDocumentMetadataSchema,
  DocumentMetadataSchema,
} from './jobTypes/documentMetadata';
