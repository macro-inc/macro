import { preprocess_response_data_validate, preprocess_response_validate, preprocess_upload_response_validate, preprocess_validate } from './pdf/preprocess';
import { modify_response_data_validate, modify_response_validate, modify_validate } from './pdf/modify';
import { password_validate, password_response_validate, password_response_data_validate } from './pdf/password';
import { remove_metadata_response_validate, remove_metadata_validate } from './pdf/remove_metadata';
import { simple_compare_response_validate, simple_compare_unzip_response, simple_compare_upload_response, simple_compare_validate } from './docx/simple_compare';
import { consolidate_response_validate, consolidate_unzip_response, consolidate_upload_response, consolidate_validate } from './docx/consolidate';
import { create_temp_file_response_data_validate, create_temp_file_response_validate, create_temp_file_validate } from './generic/create_temp_file';
import { ping_response_data_validate, ping_response_validate, ping_validate } from './generic/ping';
import { docx_upload_ready_response, docx_upload_response_validate, docx_upload_unzip_response, docx_upload_validate } from './docx/docx_upload';
import { export_response_validate, export_validate, export_response_data_validate } from './pdf/export';
export declare const JobValidation: {
    ping: typeof ping_validate;
    create_temp_file: typeof create_temp_file_validate;
    pdf_preprocess: typeof preprocess_validate;
    pdf_modify: typeof modify_validate;
    pdf_password_encrypt: typeof password_validate;
    pdf_remove_metadata: typeof remove_metadata_validate;
    docx_simple_compare: typeof simple_compare_validate;
    docx_consolidate: typeof consolidate_validate;
    docx_upload: typeof docx_upload_validate;
    pdf_export: typeof export_validate;
};
export declare const JobResponseValidation: {
    ping: typeof ping_response_validate;
    create_temp_file: typeof create_temp_file_response_validate;
    pdf_preprocess: typeof preprocess_response_validate;
    pdf_modify: typeof modify_response_validate;
    pdf_password_encrypt: typeof password_response_validate;
    pdf_remove_metadata: typeof remove_metadata_response_validate;
    docx_simple_compare: typeof simple_compare_response_validate;
    docx_consolidate: typeof consolidate_response_validate;
    docx_upload: typeof docx_upload_response_validate;
    pdf_export: typeof export_response_validate;
};
export declare const JobResponseDataValidation: {
    ping: typeof ping_response_data_validate;
    create_temp_file: typeof create_temp_file_response_data_validate;
    pdf_preprocess: {
        upload: typeof preprocess_upload_response_validate;
        response_data: typeof preprocess_response_data_validate;
    };
    pdf_modify: typeof modify_response_data_validate;
    pdf_password_encrypt: typeof password_response_data_validate;
    pdf_remove_metadata: (_data: any) => never;
    docx_simple_compare: {
        upload: typeof simple_compare_upload_response;
        unzip: typeof simple_compare_unzip_response;
    };
    docx_consolidate: {
        upload: typeof consolidate_upload_response;
        unzip: typeof consolidate_unzip_response;
    };
    docx_upload: {
        upload: typeof docx_upload_ready_response;
        unzip: typeof docx_upload_unzip_response;
    };
    pdf_export: typeof export_response_data_validate;
};
