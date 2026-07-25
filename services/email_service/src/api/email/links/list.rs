use crate::api::context::{ApiContext, AuthorizationService};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
use models_email::api;
use utoipa::ToSchema;

use strum_macros::AsRefStr;
use thiserror::Error;

#[derive(Debug, Error, AsRefStr)]
pub enum ListLinksError {
    #[error("Database error")]
    DatabaseError(anyhow::Error),
}

impl IntoResponse for ListLinksError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            ListLinksError::DatabaseError(_) => StatusCode::INTERNAL_SERVER_ERROR,
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
#[tracing::instrument(skip(ctx, authorization), fields(user_id=authorization.authorization.user.user_context.user_id, fusionauth_user_id=authorization.authorization.user.user_context.fusion_user_id))]
pub async fn list_links_handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Result<Response, ListLinksError> {
    let inboxes = email_db_client::links::get::fetch_inbox_details_for_macro_id(
        &ctx.db,
        &authorization.authorization.user.macro_user_id,
    )
    .await
    .map_err(ListLinksError::DatabaseError)?;

    let links = inboxes
        .into_iter()
        .map(|inbox| {
            let sync_status = api::link::SyncStatus::derive(
                inbox.link.is_sync_active,
                inbox.link.needs_reauth,
                inbox.latest_backfill_status,
            );
            api::link::Link::new(
                inbox.link,
                api::settings::Settings::from(inbox.settings),
                sync_status,
                inbox.photo_url,
            )
        })
        .collect();

    Ok((StatusCode::OK, Json(ListLinksResponse { links })).into_response())
}
