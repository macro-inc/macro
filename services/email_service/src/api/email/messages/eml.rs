use crate::api::context::{ApiContext, AuthorizationService};
use crate::api::email::drafts::attachment_error::AttachmentApiError;
use axum::{
    extract::{Path, State},
    http::header,
    response::{IntoResponse, Response},
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
use uuid::Uuid;

const EML_CONTENT_TYPE: &str = "message/rfc822";

/// The message's original RFC 822 bytes.
pub(crate) struct EmlFile;

impl utoipa::PartialSchema for EmlFile {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        use utoipa::openapi::schema::{KnownFormat, ObjectBuilder, SchemaFormat, Type};
        ObjectBuilder::new()
            .schema_type(Type::String)
            .format(Some(SchemaFormat::KnownFormat(KnownFormat::Binary)))
            .into()
    }
}

impl utoipa::ToSchema for EmlFile {}

/// Download a message's original source as an `.eml` file.
#[utoipa::path(
    get,
    tag = "Messages",
    path = "/email/messages/{id}/eml",
    operation_id = "get_message_eml",
    params(
        ("id" = Uuid, Path, description = "Message ID."),
    ),
    responses(
            (status = 200, content_type = "message/rfc822", body = EmlFile),
            (status = 401, body=ErrorResponse),
            (status = 403, body=ErrorResponse),
            (status = 404, body=ErrorResponse),
            (status = 409, body=ErrorResponse),
            (status = 429, body=ErrorResponse),
            (status = 503, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization), fields(eml_bytes = tracing::field::Empty), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
    Path(id): Path<Uuid>,
) -> Result<Response, AttachmentApiError> {
    let source = ctx
        .message_sources
        .download(&authorization.authorization.user.macro_user_id, id)
        .await?;
    tracing::Span::current().record("eml_bytes", source.bytes.len());
    Ok((
        [
            (header::CONTENT_TYPE, EML_CONTENT_TYPE.to_owned()),
            (
                header::CONTENT_DISPOSITION,
                content_disposition(&source.filename),
            ),
        ],
        source.bytes,
    )
        .into_response())
}

/// An ASCII `filename` for older clients plus the exact UTF-8 `filename*`.
fn content_disposition(filename: &str) -> String {
    let ascii: String = filename
        .chars()
        .map(|c| if c.is_ascii() { c } else { '_' })
        .collect();
    format!(
        "attachment; filename=\"{ascii}\"; filename*=UTF-8''{}",
        urlencoding::encode(filename)
    )
}

#[cfg(test)]
mod test;
