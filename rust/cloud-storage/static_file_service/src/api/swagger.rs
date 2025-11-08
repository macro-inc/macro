use crate::api::file;
use crate::model::api::*;
use utoipa::OpenApi;

#[utoipa::path(
  get,
  path = "/file/{file_id}",
  params(
      ("file_id" = String, Path, description = "Unique identifier of the file to retrieve")
  ),
  responses(
      (status = 200, description = "File contents retrieved successfully", body = Vec<u8>),
      (status = 404, description = "File not found")
  ),
  tag = "s3::file",  // Add a tag
)]
// cdn routes to s3
// do not implement
#[allow(dead_code)]
fn get_file_documentation() {}

#[derive(OpenApi)]
#[openapi(
    info(
        terms_of_service = "https://macro.com/terms",
    ),
    paths(
      file::metadata::handle_get_metadata,
      file::put_presigned_url::put_presigned_url,
      file::delete_file::handle_delete_file,
      get_file_documentation
    ),
    components(
      schemas(
        PutFileRequest,
        PutFileResponse,
        GetFileMetadataResponse
      )
    ),
    tags(
      (name = "macro static file service", description = "Static File Service")
    )
)]
pub struct ApiDoc;
