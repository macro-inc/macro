pub mod bulk_delete_file;
pub mod delete_file;
pub mod get_file;
pub mod metadata;
pub mod put_presigned_url;

use axum::Router;
use axum::routing::{delete, get, post, put};
use macro_authorization::{MacroAuthorization, MacroUserAuthentication};

use crate::api::context::AppState;

fn required_user(authorization: &MacroAuthorization) -> &MacroUserAuthentication {
    authorization
        .acting_user()
        .expect("required authorization guarantees an acting user")
}

pub fn router() -> Router<AppState> {
    Router::new()
        .route(
            "/file/metadata/{file_id}",
            get(metadata::handle_get_metadata),
        )
        .route(
            "/file/{file_id}/presigned-url",
            get(get_file::handle_get_presigned_url),
        )
        .route("/file", put(put_presigned_url::put_presigned_url))
        .route("/file/{file_id}", delete(delete_file::handle_delete_file))
        .route(
            "/file/bulk-delete",
            post(bulk_delete_file::handle_bulk_delete_file),
        )
}
