//! Axum router for project endpoints.

#[cfg(test)]
mod tests;

pub mod create_project;
pub mod delete_project;
pub mod edit_project;
pub mod get_batch_preview;
pub mod get_project;
pub mod get_projects;
pub mod project_permission;
pub mod revert_delete_project;
pub mod upload_folder;

use std::sync::Arc;

use axum::{
    Json, Router,
    body::Body,
    extract::{FromRef, Path, State},
    http::{Request, StatusCode},
    middleware::{self, Next},
    response::IntoResponse,
};
use entity_access::domain::ports::EntityAccessService;
use macro_authorization::{MacroAuthorizationService, MacroAuthorizationState};
use model::response::GenericErrorResponse;
use serde::Deserialize;

use self::{
    create_project::create_project_handler,
    delete_project::{delete_project_handler, permanently_delete_project_handler},
    edit_project::edit_project_handler,
    get_batch_preview::get_batch_preview_handler,
    get_project::{get_project_content_handler, get_project_handler},
    get_projects::{get_pending_projects_handler, get_projects_handler},
    project_permission::{get_project_access_level_handler, get_project_permissions_handler},
    revert_delete_project::revert_delete_project_handler,
    upload_folder::{upload_extract_folder_handler, upload_folder_handler},
};
use crate::domain::{models::ProjectError, ports::ProjectService};

/// Router state containing project endpoint dependencies.
pub struct ProjectRouterState<T, Svc, Auth> {
    /// Project domain service.
    pub service: Arc<T>,
    /// Entity access service used by access extractors.
    pub access_service: Arc<Svc>,
    /// Request authorization state.
    pub authorization_state: MacroAuthorizationState<Auth>,
}

// A derived implementation would unnecessarily require all service types to be `Clone`.
impl<T, Svc, Auth> Clone for ProjectRouterState<T, Svc, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access_service: self.access_service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<T, Svc, Auth> FromRef<ProjectRouterState<T, Svc, Auth>> for Arc<Svc> {
    fn from_ref(state: &ProjectRouterState<T, Svc, Auth>) -> Self {
        state.access_service.clone()
    }
}

impl<T, Svc, Auth> FromRef<ProjectRouterState<T, Svc, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &ProjectRouterState<T, Svc, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Project path parameters.
#[derive(Deserialize)]
pub struct Params {
    id: String,
}

impl IntoResponse for ProjectError {
    fn into_response(self) -> axum::response::Response {
        let status = match &self {
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::Unauthorized | Self::UnauthorizedWithMessage(_) => StatusCode::UNAUTHORIZED,
            Self::BadRequest(_)
            | Self::NameTooLong { .. }
            | Self::CannotModifyDeleted
            | Self::RecursiveNesting => StatusCode::BAD_REQUEST,
            Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        if status.is_server_error() {
            tracing::error!(error=?self, "project request failed");
        }

        let message = self.to_string();
        (
            status,
            Json(GenericErrorResponse {
                error: true,
                message,
            }),
        )
            .into_response()
    }
}

/// Build the project router.
pub fn projects_router<T, Svc, Auth, S>(state: ProjectRouterState<T, Svc, Auth>) -> Router<S>
where
    T: ProjectService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    let project_routes = Router::new()
        .route(
            "/{id}",
            axum::routing::get(get_project_handler::<T, Svc, Auth>)
                .patch(edit_project_handler::<T, Svc, Auth>)
                .delete(delete_project_handler::<T, Svc, Auth>),
        )
        .route(
            "/{id}/content",
            axum::routing::get(get_project_content_handler::<T, Svc, Auth>),
        )
        .route(
            "/{id}/permissions",
            axum::routing::get(get_project_permissions_handler::<T, Svc, Auth>),
        )
        .route(
            "/{id}/access_level",
            axum::routing::get(get_project_access_level_handler::<T, Svc, Auth>),
        )
        .route(
            "/{id}/revert_delete",
            axum::routing::put(revert_delete_project_handler::<T, Svc, Auth>),
        )
        .route(
            "/{id}/permanent",
            axum::routing::delete(permanently_delete_project_handler::<T, Svc, Auth>),
        )
        .layer(middleware::from_fn_with_state(
            state.clone(),
            ensure_project_exists::<T, Svc, Auth>,
        ));

    Router::new()
        .merge(project_routes)
        .route(
            "/",
            axum::routing::get(get_projects_handler::<T, Svc, Auth>)
                .post(create_project_handler::<T, Svc, Auth>),
        )
        .route(
            "/pending",
            axum::routing::get(get_pending_projects_handler::<T, Svc, Auth>),
        )
        .route(
            "/preview",
            axum::routing::post(get_batch_preview_handler::<T, Svc, Auth>),
        )
        .route(
            "/upload",
            axum::routing::post(upload_folder_handler::<T, Svc, Auth>),
        )
        .route(
            "/upload_extract",
            axum::routing::post(upload_extract_folder_handler::<T, Svc, Auth>),
        )
        .with_state(state)
}

/// Load project context required by project access extractors.
#[tracing::instrument(skip(state, request, next), err)]
async fn ensure_project_exists<T, Svc, Auth>(
    State(state): State<ProjectRouterState<T, Svc, Auth>>,
    Path(Params { id }): Path<Params>,
    mut request: Request<Body>,
    next: Next,
) -> Result<axum::response::Response, ProjectError>
where
    T: ProjectService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
{
    let project = state.service.internal_get_basic_project(&id).await?;
    request.extensions_mut().insert(project);
    Ok(next.run(request).await)
}
