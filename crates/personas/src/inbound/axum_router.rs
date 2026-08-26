//! Axum router for persona management.
//!
//! Thin adapters: identity comes from the authorization extractor, every
//! decision from the domain service.

#[cfg(test)]
mod test;

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{FromRef, Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{delete, get, patch, post},
};
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use model_error_response::ErrorResponse;

use crate::domain::models::{BotId, CreatePersonaRequest, PatchPersonaRequest, Persona};
use crate::domain::ports::{PersonaError, PersonaService};

/// State for the personas router.
pub struct PersonasRouterState<S, Auth> {
    service: Arc<S>,
    authorization_state: MacroAuthorizationState<Auth>,
}

impl<S, Auth> Clone for PersonasRouterState<S, Auth> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            authorization_state: self.authorization_state.clone(),
        }
    }
}

impl<S: PersonaService, Auth> PersonasRouterState<S, Auth> {
    /// Create a router state.
    pub fn new(service: S, authorization_state: MacroAuthorizationState<Auth>) -> Self {
        Self {
            service: Arc::new(service),
            authorization_state,
        }
    }
}

impl<S, Auth> FromRef<PersonasRouterState<S, Auth>> for MacroAuthorizationState<Auth> {
    fn from_ref(state: &PersonasRouterState<S, Auth>) -> Self {
        state.authorization_state.clone()
    }
}

/// Persona path.
#[derive(Debug, serde::Deserialize)]
pub struct PersonaPath {
    /// Persona id.
    pub persona_id: BotId,
}

/// Create a personas router.
pub fn personas_router<S, Auth, T>(state: PersonasRouterState<S, Auth>) -> Router<T>
where
    S: PersonaService,
    Auth: MacroAuthorizationService,
    T: Send + Sync,
{
    Router::new()
        .route("/personas", get(list_personas_handler::<S, Auth>))
        .route("/personas", post(create_persona_handler::<S, Auth>))
        .route(
            "/personas/{persona_id}",
            get(get_persona_handler::<S, Auth>),
        )
        .route(
            "/personas/{persona_id}",
            patch(patch_persona_handler::<S, Auth>),
        )
        .route(
            "/personas/{persona_id}",
            delete(delete_persona_handler::<S, Auth>),
        )
        .with_state(state)
}

/// Handler for `GET /personas`.
#[utoipa::path(
    get,
    tag = "personas",
    operation_id = "list_personas",
    path = "/personas",
    responses(
        (status = 200, body = Vec<Persona>),
        (status = 401, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn list_personas_handler<S: PersonaService, Auth: MacroAuthorizationService>(
    State(state): State<PersonasRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
) -> Result<Json<Vec<Persona>>, PersonasHandlerErr> {
    Ok(Json(
        state
            .service
            .list_personas(authorization.authorization.user.macro_user_id)
            .await?,
    ))
}

/// Handler for `POST /personas`.
#[utoipa::path(
    post,
    tag = "personas",
    operation_id = "create_persona",
    path = "/personas",
    request_body = CreatePersonaRequest,
    responses(
        (status = 201, body = Persona),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn create_persona_handler<S: PersonaService, Auth: MacroAuthorizationService>(
    State(state): State<PersonasRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Json(req): Json<CreatePersonaRequest>,
) -> Result<(StatusCode, Json<Persona>), PersonasHandlerErr> {
    let persona = state
        .service
        .create_persona(authorization.authorization.user.macro_user_id, req)
        .await?;
    Ok((StatusCode::CREATED, Json(persona)))
}

/// Handler for `GET /personas/{persona_id}`.
#[utoipa::path(
    get,
    tag = "personas",
    operation_id = "get_persona",
    path = "/personas/{persona_id}",
    params(("persona_id" = uuid::Uuid, Path, description = "Persona id")),
    responses(
        (status = 200, body = Persona),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn get_persona_handler<S: PersonaService, Auth: MacroAuthorizationService>(
    State(state): State<PersonasRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<PersonaPath>,
) -> Result<Json<Persona>, PersonasHandlerErr> {
    Ok(Json(
        state
            .service
            .get_persona(
                authorization.authorization.user.macro_user_id,
                path.persona_id,
            )
            .await?,
    ))
}

/// Handler for `PATCH /personas/{persona_id}`.
#[utoipa::path(
    patch,
    tag = "personas",
    operation_id = "patch_persona",
    path = "/personas/{persona_id}",
    params(("persona_id" = uuid::Uuid, Path, description = "Persona id")),
    request_body = PatchPersonaRequest,
    responses(
        (status = 200, body = Persona),
        (status = 400, body = ErrorResponse),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 409, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn patch_persona_handler<S: PersonaService, Auth: MacroAuthorizationService>(
    State(state): State<PersonasRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<PersonaPath>,
    Json(req): Json<PatchPersonaRequest>,
) -> Result<Json<Persona>, PersonasHandlerErr> {
    Ok(Json(
        state
            .service
            .patch_persona(
                authorization.authorization.user.macro_user_id,
                path.persona_id,
                req,
            )
            .await?,
    ))
}

/// Handler for `DELETE /personas/{persona_id}`.
#[utoipa::path(
    delete,
    tag = "personas",
    operation_id = "delete_persona",
    path = "/personas/{persona_id}",
    params(("persona_id" = uuid::Uuid, Path, description = "Persona id")),
    responses(
        (status = 204),
        (status = 401, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
pub async fn delete_persona_handler<S: PersonaService, Auth: MacroAuthorizationService>(
    State(state): State<PersonasRouterState<S, Auth>>,
    authorization: MacroAuthorizationExtractor<Auth, UserOrInternal>,
    Path(path): Path<PersonaPath>,
) -> Result<StatusCode, PersonasHandlerErr> {
    state
        .service
        .delete_persona(
            authorization.authorization.user.macro_user_id,
            path.persona_id,
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Errors from persona handlers.
#[derive(Debug, thiserror::Error)]
pub enum PersonasHandlerErr {
    /// Domain error.
    #[error(transparent)]
    Persona(#[from] PersonaError),
}

impl IntoResponse for PersonasHandlerErr {
    fn into_response(self) -> axum::response::Response {
        let status = match &self {
            Self::Persona(PersonaError::BadRequest(_)) => StatusCode::BAD_REQUEST,
            Self::Persona(PersonaError::HandleTaken) => StatusCode::CONFLICT,
            Self::Persona(PersonaError::NotFound) => StatusCode::NOT_FOUND,
            Self::Persona(PersonaError::Repo(_)) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        if status == StatusCode::INTERNAL_SERVER_ERROR {
            tracing::error!(error=?self, "personas handler error");
        }
        (
            status,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}
