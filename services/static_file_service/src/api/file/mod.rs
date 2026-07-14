#[cfg(test)]
mod test;

pub mod bulk_delete_file;
pub mod delete_file;
pub mod get_file;
pub mod metadata;
pub mod put_presigned_url;

use axum::Router;
use axum::routing::{delete, get, post, put};

use crate::api::context::AppState;
use macro_authorization::OptionalMacroAuthorizationExtractor;

const ANONYMOUS_OWNER_ID: &str = "nobody";

fn authenticated_user_id(identity: &OptionalMacroAuthorizationExtractor) -> Option<&str> {
    identity
        .macro_user_id
        .as_ref()
        .map(|_| identity.user_context.user_id.as_str())
}

fn owner_id_for_upload(user_id: Option<&str>) -> &str {
    user_id.unwrap_or(ANONYMOUS_OWNER_ID)
}

fn can_delete_file(owner_id: &str, user_id: Option<&str>, has_internal_key: bool) -> bool {
    if has_internal_key {
        return true;
    }

    user_id.is_some_and(|user_id| owner_id == user_id)
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
