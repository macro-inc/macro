import {
  consolidate_response_validate,
  consolidate_unzip_response,
  consolidate_upload_response,
  consolidate_validate,
} from './docx/consolidate';
import {
  docx_upload_ready_response,
  docx_upload_response_validate,
  docx_upload_unzip_response,
  docx_upload_validate,
} from './docx/docx_upload';
import {
  simple_compare_response_validate,
  simple_compare_unzip_response,
  simple_compare_upload_response,
  simple_compare_validate,
} from './docx/simple_compare';
import {
  create_temp_file_response_data_validate,
  create_temp_file_response_validate,
  create_temp_file_validate,
} from './generic/create_temp_file';
import {
  ping_response_data_validate,
  ping_response_validate,
  ping_validate,
} from './generic/ping';
import {
  export_response_data_validate,
  export_response_validate,
  export_validate,
} from './pdf/export';
import {
  modify_response_data_validate,
  modify_response_validate,
  modify_validate,
} from './pdf/modify';
import {
  password_response_data_validate,
  password_response_validate,
  password_validate,
} from './pdf/password';
import {
  preprocess_response_data_validate,
  preprocess_response_validate,
  preprocess_upload_response_validate,
  preprocess_validate,
} from './pdf/preprocess';
import {
  remove_metadata_response_validate,
  remove_metadata_validate,
} from './pdf/remove_metadata';

// TODO: ensure each job type has a corresponding validation function
export const JobValidation = {
  ping: ping_validate,
  create_temp_file: create_temp_file_validate,
  pdf_preprocess: preprocess_validate,
  pdf_modify: modify_validate,
  // pdf_convert: convert_validate,
  pdf_password_encrypt: password_validate,
  pdf_remove_metadata: remove_metadata_validate,
  docx_simple_compare: simple_compare_validate,
  docx_consolidate: consolidate_validate,
  docx_upload: docx_upload_validate,
  pdf_export: export_validate,
};

export const JobResponseValidation = {
  ping: ping_response_validate,
  create_temp_file: create_temp_file_response_validate,
  pdf_preprocess: preprocess_response_validate,
  pdf_modify: modify_response_validate,
  // pdf_convert: convert_response_validate,
  pdf_password_encrypt: password_response_validate,
  pdf_remove_metadata: remove_metadata_response_validate,
  docx_simple_compare: simple_compare_response_validate,
  docx_consolidate: consolidate_response_validate,
  docx_upload: docx_upload_response_validate,
  pdf_export: export_response_validate,
};

export const JobResponseDataValidation = {
  ping: ping_response_data_validate,
  create_temp_file: create_temp_file_response_data_validate,
  pdf_preprocess: {
    upload: preprocess_upload_response_validate,
    response_data: preprocess_response_data_validate,
  },
  pdf_modify: modify_response_data_validate,
  // pdf_convert: convert_response_data_validate,
  pdf_password_encrypt: password_response_data_validate,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  pdf_remove_metadata: (_data: any) => {
    throw new Error('Not implemented');
  },
  docx_simple_compare: {
    upload: simple_compare_upload_response,
    unzip: simple_compare_unzip_response,
  },
  docx_consolidate: {
    upload: consolidate_upload_response,
    unzip: consolidate_unzip_response,
  },
  docx_upload: {
    upload: docx_upload_ready_response,
    unzip: docx_upload_unzip_response,
  },
  pdf_export: export_response_data_validate,
};
