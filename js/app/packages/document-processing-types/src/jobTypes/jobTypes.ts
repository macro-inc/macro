type PdfJobTypes =
  | 'pdf_preprocess'
  | 'pdf_modify'
  | 'pdf_password_encrypt'
  | 'pdf_remove_metadata'
  | 'pdf_export';

type DocxJobTypes = 'docx_upload' | 'docx_simple_compare' | 'docx_consolidate';

type GenericJobTypes = 'ping' | 'create_temp_file';

export type JobTypes = PdfJobTypes | DocxJobTypes | GenericJobTypes;

export enum JobTypeEnum {
  Ping = 'ping',
  CreateTempFile = 'create_temp_file',
  PdfExport = 'pdf_export',
  PdfPreprocess = 'pdf_preprocess',
  PdfModify = 'pdf_modify',
  PdfPasswordEncrypt = 'pdf_password_encrypt',
  PdfRemoveMetadata = 'pdf_remove_metadata',
  DocxSimpleCompare = 'docx_simple_compare',
  DocxConsolidate = 'docx_consolidate',
  DocxUpload = 'docx_upload',
}
