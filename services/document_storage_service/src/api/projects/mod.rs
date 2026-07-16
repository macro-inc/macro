use super::context::ApiContext;
use axum::Router;

pub(in crate::api) mod delete_project;
pub(in crate::api) mod get_batch_preview;
pub(in crate::api) mod get_project;
pub(in crate::api) mod get_projects;
pub(in crate::api) mod project_permission;
pub(in crate::api) mod upload_folder;

pub fn router(_state: ApiContext) -> Router<ApiContext> {
    Router::new()
    // NOTE: GET / is now served by the projects hex crate router.
    // NOTE: GET /pending is now served by the projects hex crate router.
    // NOTE: GET /{id} is now served by the projects hex crate router.
    // NOTE: GET /{id}/content is now served by the projects hex crate router.
    // NOTE: GET /{id}/permissions is now served by the projects hex crate router.
    // NOTE: GET /{id}/access_level is now served by the projects hex crate router.
    // NOTE: POST /preview is now served by the projects hex crate router.
    // NOTE: POST / is now served by the projects hex crate router.
    // NOTE: PATCH and DELETE /{id} are now served by the projects hex crate router.
    // NOTE: PUT /{id}/revert_delete is now served by the projects hex crate router.
    // NOTE: Upload and permanent-delete routes are now served by the projects hex crate router.
}
