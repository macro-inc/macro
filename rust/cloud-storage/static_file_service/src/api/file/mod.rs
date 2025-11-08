pub mod delete_file;
pub mod get_file;
pub mod metadata;
pub mod put_presigned_url;

use axum::Router;
use axum::routing::{delete, get, put};

use crate::api::context::AppState;

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/file/metadata/:file_id",
            get(metadata::handle_get_metadata),
        )
        .route(
            "/file/:file_id/presigned-url",
            get(get_file::handle_get_presigned_url),
        )
        .route("/file", put(put_presigned_url::put_presigned_url))
        .route("/file/:file_id", delete(delete_file::handle_delete_file))
}
