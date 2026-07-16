use super::context::ApiContext;
use axum::{
    Router,
    routing::{delete, get, patch, post, put},
};
use macro_middleware::cloud_storage::project::ensure_project_exists;

pub(in crate::api) mod create_project;
pub(in crate::api) mod delete_project;
pub(in crate::api) mod edit_project;
pub(in crate::api) mod get_batch_preview;
pub(in crate::api) mod get_project;
pub(in crate::api) mod get_projects;
pub(in crate::api) mod project_permission;
pub(in crate::api) mod revert_delete_project;
pub(in crate::api) mod upload_folder;

pub fn router(state: ApiContext) -> Router<ApiContext> {
    let ensure_project_exists_middleware =
        axum::middleware::from_fn_with_state(state.clone(), ensure_project_exists::handler);
    Router::new()
        .route("/", get(get_projects::get_projects_handler))
        .route("/pending", get(get_projects::get_pending_projects_handler))
        .route(
            "/{id}/permissions",
            get(project_permission::get_project_permissions_handler)
                .layer(ensure_project_exists_middleware.clone()),
        )
        .route(
            "/{id}/access_level",
            get(project_permission::get_project_access_level_handler)
                .layer(ensure_project_exists_middleware.clone()),
        )
        .route(
            "/{id}/content",
            get(get_project::get_project_content_handler)
                .layer(ensure_project_exists_middleware.clone()),
        )
        .route("/", post(create_project::create_project_handler))
        .route("/upload", post(upload_folder::upload_folder_handler))
        .route(
            "/upload_extract",
            post(upload_folder::upload_extract_folder_handler),
        )
        .route(
            "/{id}",
            patch(edit_project::edit_project_handler)
                .layer(ensure_project_exists_middleware.clone()),
        )
        .route(
            "/{id}/revert_delete",
            put(revert_delete_project::handler).layer(ensure_project_exists_middleware.clone()),
        )
        .route(
            "/{id}",
            delete(delete_project::delete_project_handler)
                .layer(ensure_project_exists_middleware.clone()),
        )
        .route(
            "/{id}/permanent",
            delete(delete_project::permanently_delete_project_handler)
                .layer(ensure_project_exists_middleware.clone()),
        )
        .route(
            "/{id}",
            get(get_project::get_project_handler).layer(ensure_project_exists_middleware),
        )
        .route(
            "/preview",
            post(get_batch_preview::get_batch_preview_handler),
        )
}
