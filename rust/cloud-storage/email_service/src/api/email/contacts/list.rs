use crate::api::context::ApiContext;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::{Extension, Json};
use model::response::ErrorResponse;
use model::user::UserContext;
use models_email::email::service::address::ContactInfoWithInteraction;
use sqlx::types::Uuid;
use std::collections::HashMap;
use utoipa::ToSchema;

// The response returned from the list links endpoint
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct ListContactsResponse {
    /// the thread, with messages inside
    pub contacts: HashMap<Uuid, Vec<ContactInfoWithInteraction>>,
}

/// List all contacts belonging to the user, grouped by link.
#[utoipa::path(
    get,
    tag = "Contacts",
    path = "/email/contacts",
    operation_id = "list_contacts",
    responses(
            (status = 200, body=ListContactsResponse),
            (status = 401, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, user_context), fields(user_id=user_context.user_id, fusionauth_user_id=user_context.fusion_user_id))]
pub async fn list_contacts_handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> Result<Response, Response> {
    let link = email_db_client::links::get::fetch_link_by_macro_id(&ctx.db, &user_context.user_id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to fetch links");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to fetch links",
                }),
            )
                .into_response()
        })?
        .ok_or_else(|| {
            (
                StatusCode::NOT_FOUND,
                Json(ErrorResponse {
                    message: "link not found",
                }),
            )
                .into_response()
        })?;

    let contacts = email_db_client::contacts::get::fetch_contacts_by_link_id(&ctx.db, link.id)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to fetch contacts");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to fetch contacts",
                }),
            )
                .into_response()
        })?;

    Ok((
        StatusCode::OK,
        Json(ListContactsResponse {
            contacts: HashMap::from([(link.id, contacts)]),
        }),
    )
        .into_response())
}
