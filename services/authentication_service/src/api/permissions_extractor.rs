use std::collections::HashSet;

use axum::{
    Json,
    extract::{FromRef, FromRequestParts},
    http::{StatusCode, request::Parts},
    response::{IntoResponse, Response},
};
use macro_authorization::{MacroAuthorizationExtractor, MacroAuthorizationState};
use model::response::ErrorResponse;
use sqlx::PgPool;

use crate::api::context::AuthorizationService;

/// An authorized user and their current database-backed permissions.
pub(crate) struct DbPermissionsExtractor {
    pub(crate) authorization: MacroAuthorizationExtractor<AuthorizationService>,
    pub(crate) permissions: HashSet<String>,
}

impl<S> FromRequestParts<S> for DbPermissionsExtractor
where
    S: Send + Sync + 'static,
    PgPool: FromRef<S>,
    MacroAuthorizationState<AuthorizationService>: FromRef<S>,
{
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let authorization =
            MacroAuthorizationExtractor::<AuthorizationService>::from_request_parts(parts, state)
                .await
                .map_err(IntoResponse::into_response)?;
        let db = PgPool::from_ref(state);
        let permissions = macro_db_client::user::get_permissions::get_user_permissions(
            &db,
            &authorization.user_context.user_id,
        )
        .await
        .map_err(|error| {
            tracing::error!(
                error = ?error,
                user_id = %authorization.user_context.user_id,
                "unable to get user permissions"
            );
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "internal error".into(),
                }),
            )
                .into_response()
        })?;

        Ok(Self {
            authorization,
            permissions,
        })
    }
}
