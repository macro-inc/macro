use crate::api::context::ApiContext;
use crate::util::gmail::auth::fetch_gmail_access_token_from_link;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use futures::future::join_all;
use model::response::ErrorResponse;
use model::user::UserContext;
use models_email::api;
use utoipa::ToSchema;

use strum_macros::AsRefStr;
use thiserror::Error;

#[derive(Debug, Error, AsRefStr)]
pub enum ListLinksError {
    #[error("Database error")]
    DatabaseError(anyhow::Error),

    #[error("Failed to fetch Gmail access token")]
    AuthError(anyhow::Error),
}

impl IntoResponse for ListLinksError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            ListLinksError::DatabaseError(_) | ListLinksError::AuthError(_) => {
                StatusCode::INTERNAL_SERVER_ERROR
            }
        };

        (status_code, self.to_string()).into_response()
    }
}

/// The response returned from the list links endpoint
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct ListLinksResponse {
    /// the thread, with messages inside
    pub links: Vec<api::link::Link>,
}

/// List all links belonging to the user.
#[utoipa::path(
    get,
    tag = "Links",
    path = "/email/links",
    operation_id = "list_links",
    responses(
            (status = 200, body=ListLinksResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id))]
pub async fn list_links_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> Result<Response, ListLinksError> {
    let links = email_db_client::links::get::fetch_links_by_fusionauth_user_id(
        &ctx.db,
        &user_context.fusion_user_id,
    )
    .await
    .map_err(ListLinksError::DatabaseError)?;

    let tasks = links.into_iter().map(|link| {
        let ctx = ctx.clone();
        async move {
            let settings = email_db_client::settings::fetch_settings(&ctx.db, link.id)
                .await
                .map_err(ListLinksError::DatabaseError)?;

            let access_token = fetch_gmail_access_token_from_link(
                &link,
                &ctx.redis_client,
                &ctx.auth_service_client,
            )
            .await
            .map_err(ListLinksError::AuthError)?;

            let signature = ctx
                .gmail_client
                .get_email_signature(&access_token, &link.email_address)
                .await
                .unwrap_or(None);

            Ok(api::link::Link::new(
                link,
                signature,
                api::settings::Settings::from(settings),
            ))
        }
    });

    let results = join_all(tasks).await;

    let api_links: Result<Vec<_>, _> = results.into_iter().collect();
    let api_links = api_links?;

    Ok((StatusCode::OK, Json(ListLinksResponse { links: api_links })).into_response())
}
