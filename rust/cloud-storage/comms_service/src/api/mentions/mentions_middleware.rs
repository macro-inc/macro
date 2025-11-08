use crate::{
    api::{context::DocumentPermissionJwtSecretKey, middleware::validate_edit_document_permission},
    constants,
};
use axum::{
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use secretsmanager_client::LocalOrRemoteSecret;

/// Validate user permissions based on the `x-permissions-token` header.
/// Checks that the souce type is `document` and that the user has edit access to the document.
pub async fn validate_mention_edit_permission(
    headers: &HeaderMap,
    permissions_token_secret: LocalOrRemoteSecret<DocumentPermissionJwtSecretKey>,
    source_entity_type: &str,
    source_entity_id: &str,
) -> Result<(), Response> {
    if source_entity_type == "document" {
        let token = headers
            .get(constants::MACRO_PERMISSIONS_TOKEN_HEADER_KEY)
            .and_then(|header| header.to_str().ok())
            .ok_or_else(|| {
                tracing::error!("missing x-permissions-token header");
                (
                    StatusCode::UNAUTHORIZED,
                    "missing required authentication header",
                )
                    .into_response()
            })?;

        validate_edit_document_permission(
            token,
            source_entity_id,
            permissions_token_secret.as_ref(),
        )
        .map_err(|err| {
            tracing::error!(error=?err, "permission validation failed");
            (
                StatusCode::FORBIDDEN,
                "insufficient permissions: edit access required",
            )
                .into_response()
        })?;
    } else {
        return Err((StatusCode::BAD_REQUEST, "invalid source entity type").into_response());
    }

    Ok(())
}
