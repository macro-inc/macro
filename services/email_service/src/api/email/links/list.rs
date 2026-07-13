use crate::api::context::ApiContext;
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
#[tracing::instrument(skip(ctx, user_context), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id))]
pub async fn list_links_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> Result<Response, ListLinksError> {
    let links =
        email_db_client::links::get::fetch_inboxes_for_macro_id(&ctx.db, &user_context.user_id)
            .await
            .map_err(ListLinksError::DatabaseError)?;

    let tasks = links.into_iter().map(|link| {
        let ctx = ctx.clone();
        async move {
            let settings = email_db_client::settings::fetch_settings(&ctx.db, link.id)
                .await
                .map_err(ListLinksError::DatabaseError)?;

            let latest_job =
                email_db_client::backfill::job::get::get_latest_backfill_job_by_link_id(
                    &ctx.db, link.id,
                )
                .await
                .map_err(ListLinksError::DatabaseError)?;
            let sync_status = api::link::SyncStatus::derive(
                link.is_sync_active,
                link.needs_reauth,
                latest_job.map(|job| job.status),
            );

            // The inbox's own photo comes from its self-contact (synced from people/me).
            let photo_url = email_db_client::contacts::get::fetch_contact_by_email(
                &ctx.db,
                link.id,
                link.email_address.0.as_ref(),
            )
            .await
            .map_err(ListLinksError::DatabaseError)?
            .and_then(|contact| contact.photo_url);

            Ok(api::link::Link::new(
                link,
                api::settings::Settings::from(settings),
                sync_status,
                photo_url,
            ))
        }
    });

    let results = join_all(tasks).await;

    let api_links: Result<Vec<_>, _> = results.into_iter().collect();
    let api_links = api_links?;

    Ok((StatusCode::OK, Json(ListLinksResponse { links: api_links })).into_response())
}
