use crate::api::context::{ApiContext, AuthorizationService};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use email::domain::mailbox::contacts::list::InboxContactsError;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
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
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization), fields(user_id=authorization.authorization.user.user_context.user_id, fusionauth_user_id=authorization.authorization.user.user_context.fusion_user_id))]
pub async fn list_contacts_handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Result<Response, Response> {
    let contacts = ctx
        .contacts
        .list(&authorization.authorization.user.user_context.user_id)
        .await
        .map_err(|error| {
            let message = match error {
                InboxContactsError::Inboxes(_) => "unable to fetch links",
                InboxContactsError::Contacts(_) => "unable to fetch contacts",
            };
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: message.into(),
                }),
            )
                .into_response()
        })?;

    Ok((StatusCode::OK, Json(ListContactsResponse { contacts })).into_response())
}
