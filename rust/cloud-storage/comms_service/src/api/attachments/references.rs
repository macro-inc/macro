use axum::Extension;
use axum::extract::{Json, Path, State};
use axum::http::StatusCode;
use comms_db_client::attachments::get_attachment_references::{
    EntityReference, get_attachment_references,
};
use model::user::UserContext;

use crate::api::context::AppState;

#[derive(Debug, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct GetAttachmentReferencesResponse {
    references: Vec<EntityReference>,
}

#[utoipa::path(
        get,
        path = "/attachments/{entity_type}/{entity_id}/references",
        tag = "attachments",
        operation_id = "get_attachment_references",
        params(
            ("entity_type" = String, Path, description = "type of the attachment entity"),
            ("entity_id" = String, Path, description = "id of the attachment entity"),
        ),
        responses(
            (status = 200, body=GetAttachmentReferencesResponse),
            (status = 401, body=String),
            (status = 404, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(
    skip(ctx, user_context),
    fields(user_id=?user_context.user_id)
)]
pub async fn handler(
    State(ctx): State<AppState>,
    user_context: Extension<UserContext>,
    Path((entity_type, entity_id)): Path<(String, String)>,
) -> Result<(StatusCode, Json<GetAttachmentReferencesResponse>), (StatusCode, String)> {
    let references =
        get_attachment_references(&ctx.db, &entity_type, &entity_id, &user_context.user_id)
            .await
            .map_err(|err| {
                tracing::error!(error=?err, "unable to get attachment references");
                (StatusCode::INTERNAL_SERVER_ERROR, err.to_string())
            })?;

    Ok((
        StatusCode::OK,
        Json(GetAttachmentReferencesResponse { references }),
    ))
}
