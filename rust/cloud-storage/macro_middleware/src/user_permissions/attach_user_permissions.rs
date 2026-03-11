use crate::error_handler::error_handler;
use axum::{
    Extension, RequestPartsExt,
    extract::{FromRef, FromRequestParts, Request, State, rejection::ExtensionRejection},
    http::{StatusCode, request::Parts},
    middleware::Next,
    response::{IntoResponse, Response},
};
use model::user::UserContext;
use sqlx::PgPool;
use std::collections::HashSet;
use thiserror::Error;

#[derive(Debug)]
pub struct PermissionsExtractor(pub HashSet<String>);

#[derive(Debug, Error)]
pub enum PermissionErr {
    #[error("Internal server error")]
    DbErr(#[from] anyhow::Error),
    #[error("Internal servier error")]
    Extension(#[from] ExtensionRejection),
}

impl IntoResponse for PermissionErr {
    fn into_response(self) -> Response {
        (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()).into_response()
    }
}

impl<S> FromRequestParts<S> for PermissionsExtractor
where
    S: Send + Sync + 'static,
    PgPool: FromRef<S>,
{
    type Rejection = PermissionErr;

    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let user_ctx: Extension<UserContext> = parts.extract_with_state(state).await?;
        let db = PgPool::from_ref(state);

        let permissions =
            macro_db_client::user::get_permissions::get_user_permissions(&db, &user_ctx.user_id)
                .await?;

        Ok(Self(permissions))
    }
}

/// Attaches user permissions to the UserContext
#[tracing::instrument(skip(db, user_context, req, next), fields(user_id=?user_context.user_id))]
pub async fn handler(
    State(db): State<PgPool>,
    user_context: Extension<UserContext>,
    mut req: Request,
    next: Next,
) -> Result<Response, Response> {
    let permissions = match macro_db_client::user::get_permissions::get_user_permissions(
        &db,
        &user_context.user_id,
    )
    .await
    {
        Ok(permissions) => permissions,
        Err(e) => {
            tracing::error!(error=?e, user_id=?user_context.user_id, "unable to get user permissions");
            return Err(error_handler(
                "unable to get user permissions",
                StatusCode::INTERNAL_SERVER_ERROR,
            ));
        }
    };

    // Attach user permissions to the UserContext
    req.extensions_mut().insert(UserContext {
        user_id: user_context.user_id.clone(),
        fusion_user_id: user_context.fusion_user_id.clone(),
        permissions: Some(permissions),
        organization_id: user_context.organization_id,
    });

    Ok(next.run(req).await)
}
