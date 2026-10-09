use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::IntoResponse,
    routing::{get, post},
};
use axum_extra::extract::Cached;
use macro_authorization::{
    MacroAuthorizationExtractor, MacroAuthorizationService, MacroAuthorizationState, UserOrInternal,
};
use model_error_response::ErrorResponse;
use thiserror::Error;

use crate::domain::{models::EmailErr, ports::EmailService};

use super::{
    api_types::{CreateDraftRequest, CreateDraftResponse},
    axum_impls::{EmailLinkExtractor, MultiEmailLinkExtractor},
    previews_router::EmailRouterState,
};

/// Create the draft router with a `POST /` handler.
pub fn draft_router<S, T, Auth>() -> Router<S>
where
    S: Send + Sync + Clone + 'static,
    T: EmailService,
    Auth: MacroAuthorizationService,
    EmailRouterState<T>: axum::extract::FromRef<S>,
    MacroAuthorizationState<Auth>: axum::extract::FromRef<S>,
{
    Router::new()
        .route(
            "/{id}/operation",
            get(message_operation_status_handler::<T, Auth>),
        )
        .route("/", post(create_draft_handler::<T, Auth>))
        .route(
            "/{id}/resolve",
            post(resolve_message_operation_handler::<T, Auth>),
        )
}

/// Errors from the create draft handler.
#[derive(Debug, Error)]
pub enum CreateDraftError {
    /// Validation error (bad request).
    #[error("{0}")]
    Validation(String),
    /// Not found.
    #[error("{0}")]
    NotFound(String),
    /// Internal error.
    #[error("Internal error")]
    Internal(EmailErr),
}

impl IntoResponse for CreateDraftError {
    fn into_response(self) -> axum::response::Response {
        if matches!(self, CreateDraftError::Internal(_)) {
            tracing::error!(error=?self, "create draft error");
        }

        let status = match &self {
            CreateDraftError::Validation(_) => StatusCode::BAD_REQUEST,
            CreateDraftError::NotFound(_) => StatusCode::NOT_FOUND,
            CreateDraftError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        let message = self.to_string();
        (
            status,
            Json(ErrorResponse {
                message: message.into(),
            }),
        )
            .into_response()
    }
}

impl From<EmailErr> for CreateDraftError {
    fn from(err: EmailErr) -> Self {
        match &err {
            EmailErr::MessageNotFound(_) | EmailErr::ThreadNotFound => {
                CreateDraftError::NotFound(err.to_string())
            }
            EmailErr::MessageAlreadySent(_)
            | EmailErr::InvalidDraft(_)
            | EmailErr::MessageDeliveryConflict(_)
            | EmailErr::CannotReplyToDraft
            | EmailErr::Base64DecodeError(_)
            | EmailErr::Utf8Error(_) => CreateDraftError::Validation(err.to_string()),
            _ => CreateDraftError::Internal(err),
        }
    }
}

/// Create a draft.
#[utoipa::path(
    post,
    tag = "Drafts",
    path = "/email/drafts",
    operation_id = "create_draft",
    request_body = CreateDraftRequest,
    responses(
        (status = 201, body = CreateDraftResponse),
        (status = 400, body = ErrorResponse),
        (status = 404, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(err, skip(state, link, accessible_inboxes, authorization, body))]
pub async fn create_draft_handler<T: EmailService, Auth: MacroAuthorizationService>(
    State(state): State<EmailRouterState<T>>,
    Cached(EmailLinkExtractor(link, _)): Cached<EmailLinkExtractor<T, Auth>>,
    Cached(MultiEmailLinkExtractor(accessible_inboxes, _)): Cached<
        MultiEmailLinkExtractor<T, Auth>,
    >,
    Cached(authorization): Cached<MacroAuthorizationExtractor<Auth, UserOrInternal>>,
    Json(body): Json<CreateDraftRequest>,
) -> Result<impl IntoResponse, CreateDraftError> {
    let mut input = body.into_domain();
    input.actor = Some(authorization.authorization.user.macro_user_id.clone());
    let draft = state
        .inner
        .create_draft(&link, &accessible_inboxes, input)
        .await?;

    Ok((
        StatusCode::CREATED,
        Json(CreateDraftResponse {
            draft: draft.into(),
        }),
    ))
}

/// Resolve an observed draft conflict or uncertain provider operation.
#[utoipa::path(post,tag="Drafts",path="/email/drafts/{id}/resolve",operation_id="resolve_message_operation",
    request_body=super::api_types::ResolveMessageOperationRequest,
    params(("id"=uuid::Uuid,Path,description="Message ID")),
    responses((status=204),(status=400,body=ErrorResponse),(status=403,body=ErrorResponse),(status=404,body=ErrorResponse),(status=409,body=ErrorResponse)))]
#[tracing::instrument(skip_all, err)]
pub async fn resolve_message_operation_handler<T: EmailService, Auth: MacroAuthorizationService>(
    State(state): State<EmailRouterState<T>>,
    Cached(actor): Cached<MacroAuthorizationExtractor<Auth, UserOrInternal>>,
    Path(message_id): Path<uuid::Uuid>,
    Json(input): Json<super::api_types::ResolveMessageOperationRequest>,
) -> Result<StatusCode, super::thread_labels_router::UpdateThreadLabelError> {
    use super::thread_labels_router::UpdateThreadLabelError;
    state
        .inner
        .resolve_message_operation(
            actor.authorization.user.macro_user_id,
            crate::domain::models::mailbox_operation::MessageResolutionRequest {
                message_id,
                revision: input
                    .revision
                    .parse()
                    .map_err(|_| UpdateThreadLabelError::Validation("Invalid revision".into()))?,
                remote_version: input.remote_version,
                action: input.action.into(),
                accept_duplicate_risk: input.accept_duplicate_risk,
            },
        )
        .await?;
    Ok(StatusCode::NO_CONTENT)
}

/// The same provider-neutral state returned on fully hydrated email messages.
#[utoipa::path(get,tag="Drafts",path="/email/drafts/{id}/operation",operation_id="message_operation_status",
    params(("id"=uuid::Uuid,Path,description="Message ID")),
    responses((status=200,body=super::api_types::MessageOperationResponse),(status=403,body=ErrorResponse),(status=404,body=ErrorResponse)))]
#[tracing::instrument(skip_all, err)]
pub async fn message_operation_status_handler<T: EmailService, Auth: MacroAuthorizationService>(
    State(state): State<EmailRouterState<T>>,
    Cached(actor): Cached<MacroAuthorizationExtractor<Auth, UserOrInternal>>,
    Path(message_id): Path<uuid::Uuid>,
) -> Result<
    Json<super::api_types::MessageOperationResponse>,
    super::thread_labels_router::UpdateThreadLabelError,
> {
    Ok(Json(super::api_types::MessageOperationResponse {
        operation: state
            .inner
            .message_operation_status(actor.authorization.user.macro_user_id, message_id)
            .await?
            .map(Into::into),
    }))
}
