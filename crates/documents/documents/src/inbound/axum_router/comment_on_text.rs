//! Start a comment thread on a quoted passage of a document, as the
//! CommentOnText tool does.
use super::DocumentRouterState;
use crate::domain::{
    models::DocumentError,
    ports::DocumentService,
    text_comment::{TextCommentError, TextCommentRequest, comment_on_text},
};
use axum::{
    Extension, Json,
    extract::{State, rejection::JsonRejection},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use entity_access::{
    domain::{
        models::{AccessError, EntityType},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::message_sender_entity_access_receipt,
};
use macro_authorization::{AnyPrincipal, MacroAuthorizationExtractor, MacroAuthorizationService};
use messages::{
    domain::{
        models::{Message, SimpleMention},
        ports::MessageError,
    },
    inbound::axum_router::sender_attribution,
};
use model_error_response::ErrorResponse;
use shared_types::document::DocumentBasic;

/// A comment on a quoted passage.
#[derive(Debug, serde::Deserialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommentOnTextRequest {
    /// Comment body in macro markdown.
    pub content: String,
    /// The people and items the body mentions, notified as in any comment.
    #[serde(default)]
    pub mentions: Vec<SimpleMention>,
    /// The passage to comment on, quoted exactly as the document reads: plain
    /// text without markdown syntax, within one paragraph, heading, list item
    /// or table cell.
    #[schema(min_length = 1)]
    pub quote: String,
    /// Which appearance of the passage, counting from 1 in document order.
    /// Only needed when it appears more than once.
    #[schema(minimum = 1)]
    pub occurrence: Option<u32>,
}

/// The thread the comment started.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CommentOnTextResponse {
    /// The posted comment, the root of its thread.
    pub comment: Message,
    /// The text the comment is anchored to, as the document reads.
    pub marked_text: String,
}

/// Error code of a quote the document cannot anchor to.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum CommentOnTextRefusedCode {
    /// The quote appears more than once, or not at all.
    QuoteNotPlaced,
}

/// The quote could not be anchored; nothing was posted.
#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
pub struct CommentOnTextRefused {
    /// Always `quote_not_placed`.
    pub error: CommentOnTextRefusedCode,
    /// Lists each appearance to choose from with `occurrence`, or says the
    /// text was not found.
    pub reason: String,
}

/// HTTP mapping for [`TextCommentError`].
pub struct CommentOnTextError(TextCommentError);

impl From<TextCommentError> for CommentOnTextError {
    fn from(error: TextCommentError) -> Self {
        Self(error)
    }
}

impl IntoResponse for CommentOnTextError {
    fn into_response(self) -> Response {
        let message = |status: StatusCode, message: String| {
            (
                status,
                Json(ErrorResponse {
                    message: message.into(),
                }),
            )
                .into_response()
        };
        match self.0 {
            TextCommentError::Invalid(reason) => message(StatusCode::BAD_REQUEST, reason),
            TextCommentError::Refused(reason) => (
                StatusCode::UNPROCESSABLE_ENTITY,
                Json(CommentOnTextRefused {
                    error: CommentOnTextRefusedCode::QuoteNotPlaced,
                    reason,
                }),
            )
                .into_response(),
            TextCommentError::Document(error) => error.into_response(),
            TextCommentError::Anchor(error) => {
                tracing::error!(error = ?error, "could not anchor comment to text");
                message(
                    StatusCode::BAD_GATEWAY,
                    "unable to anchor the comment to the text".to_string(),
                )
            }
            TextCommentError::Message(error) => match error {
                MessageError::Forbidden => message(
                    StatusCode::FORBIDDEN,
                    "comment access to the document is required".to_string(),
                ),
                MessageError::Invalid(reason) => {
                    message(StatusCode::BAD_REQUEST, reason.to_string())
                }
                MessageError::NotFound => {
                    message(StatusCode::NOT_FOUND, "document not found".to_string())
                }
                MessageError::Conflict => message(
                    StatusCode::CONFLICT,
                    "message id already exists".to_string(),
                ),
                MessageError::Repository(error) => {
                    tracing::error!(error = ?error, "could not post comment on text");
                    message(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "unable to post the comment".to_string(),
                    )
                }
            },
        }
    }
}

/// Start a comment thread anchored to a quoted passage of a markdown or Word
/// document, with the caller's comment access. On markdown the passage is
/// marked in the live document first, and nothing is posted when the quote is
/// ambiguous or missing.
#[utoipa::path(
    post,
    tag = "document",
    path = "/documents/{document_id}/comments/text",
    operation_id = "comment_on_document_text",
    params(("document_id" = String, Path, description = "Document identity")),
    request_body = CommentOnTextRequest,
    responses(
        (status = 200, body = CommentOnTextResponse),
        (status = 400, description = "Not a markdown or Word document, or an invalid quote or occurrence", body = ErrorResponse),
        (status = 401, description = "Authentication required"),
        (status = 403, description = "Document comment access denied", body = ErrorResponse),
        (status = 404, description = "Document not found"),
        (status = 422, description = "The quote appears more than once or not at all; nothing was posted", body = CommentOnTextRefused),
        (status = 500, description = "The comment could not be posted", body = ErrorResponse),
        (status = 502, description = "The comment could not be anchored; nothing was posted", body = ErrorResponse)
    )
)]
pub async fn comment_on_text_handler<
    T: DocumentService,
    Svc: EntityAccessService,
    Auth: MacroAuthorizationService,
>(
    State(state): State<DocumentRouterState<T, Svc, Auth>>,
    caller: MacroAuthorizationExtractor<Auth, AnyPrincipal>,
    // Request-local metadata from ensure_document_exists, not a shared service.
    // ast-grep-ignore: rust-no-axum-extension-param
    Extension(document): Extension<DocumentBasic>,
    body: Result<Json<CommentOnTextRequest>, JsonRejection>,
) -> Result<Json<CommentOnTextResponse>, CommentOnTextError> {
    let Json(request) = body.map_err(|rejection| {
        TextCommentError::Document(DocumentError::BadRequest(rejection.body_text()))
    })?;
    // The sender receipt posts as the agent a user credential names, the way
    // the message routes do, so the comment carries the agent's attribution.
    let access = message_sender_entity_access_receipt(
        state.access_service.as_ref(),
        &caller.authorization,
        &document.document_id,
        EntityType::Document,
    )
    .await
    .map_err(|error| {
        TextCommentError::Message(match error {
            AccessError::Unavailable(error) | AccessError::Internal(error) => {
                MessageError::Repository(error)
            }
            _ => MessageError::Forbidden,
        })
    })?;
    let comment = comment_on_text(
        state.editing_worker.as_ref(),
        state.messages.as_ref(),
        &state.document_permission_jwt_secret,
        access,
        &document,
        sender_attribution(&caller.authorization),
        TextCommentRequest {
            content: &request.content,
            mentions: request.mentions,
            quote: &request.quote,
            occurrence: request.occurrence,
        },
    )
    .await?;
    Ok(Json(CommentOnTextResponse {
        comment: comment.message,
        marked_text: comment.marked_text,
    }))
}
