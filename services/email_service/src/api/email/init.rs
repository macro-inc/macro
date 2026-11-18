use crate::api::ApiContext;
use crate::api::context::AuthorizationService;
use axum::{
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Json, Response},
};
use email::domain::mailbox::connection::{
    ConnectionError, ConnectionFailureObserver, ConnectionRequest,
};
use email::domain::mailbox::initialization::InitializationError;
use email_api_client::domain::models::EmailApiError;
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use model::response::ErrorResponse;
use thiserror::Error;
use utoipa::ToSchema;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// An HTTP error whose status is fixed by the single connection status rule.
#[derive(Error)]
#[error("{kind}")]
pub struct InitError {
    status: StatusCode,
    kind: InitErrorKind,
}

impl std::fmt::Debug for InitError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Debug::fmt(&self.kind, f)
    }
}

#[derive(Debug, Error)]
enum InitErrorKind {
    #[error(transparent)]
    MailboxInitialization(InitializationError),
    #[error("User is already initialized")]
    AlreadyInitialized,

    #[error("No Gmail grant available to provision from")]
    NoGmailGrant,

    #[error("Failed to enqueue backfill message")]
    EnqueueError,

    #[error("Database query error")]
    DatabaseError(#[from] anyhow::Error),

    #[error("Email provider operation failed")]
    ProviderError(EmailApiError),

    #[error("Bad request")]
    BadRequest(String),

    #[error("Invalid input")]
    Parse(#[from] macro_user_id::error::ParseErr),

    #[error("Inbox is already connected by another user")]
    SharedInboxConflict {
        email_address: String,
        existing_owner_email: String,
        existing_link_id: Uuid,
    },
}

/// Stable machine-readable code for [`ConnectionError::AlreadyInitialized`].
pub const ALREADY_INITIALIZED_CODE: &str = "ALREADY_INITIALIZED";

/// Stable machine-readable code for [`ConnectionError::NoGmailGrant`].
pub const NO_GMAIL_GRANT_CODE: &str = "NO_GMAIL_GRANT";

/// Structured 400 body carrying a machine-readable code. Clients branch on
/// `code` instead of parsing the human message.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct InitErrorCodeResponse {
    /// Stable machine-readable error code.
    pub code: String,
    /// Human-readable explanation.
    pub message: String,
}

/// The transport's single HTTP status rule, shared by responses and failure logs.
fn connection_error_status(error: &ConnectionError) -> StatusCode {
    match error {
        ConnectionError::MailboxInitialization(error) => match error {
            InitializationError::PaymentRequired => StatusCode::PAYMENT_REQUIRED,
            InitializationError::InvalidAttempt => StatusCode::BAD_REQUEST,
            InitializationError::IdentityConflict
            | InitializationError::Changed
            | InitializationError::SharingConfirmation { .. } => StatusCode::CONFLICT,
            InitializationError::Unavailable => StatusCode::SERVICE_UNAVAILABLE,
        },
        ConnectionError::AlreadyInitialized
        | ConnectionError::NoGmailGrant
        | ConnectionError::InvalidUserIdentity
        | ConnectionError::InvalidAttemptProvider
        | ConnectionError::AttemptOwnerMismatch
        | ConnectionError::AttemptAuthenticationIncomplete
        | ConnectionError::LoginEmailUnavailable
        | ConnectionError::Parse(_) => StatusCode::BAD_REQUEST,
        ConnectionError::ProviderError(EmailApiError::RateLimited { .. }) => {
            StatusCode::TOO_MANY_REQUESTS
        }
        ConnectionError::EnqueueError
        | ConnectionError::DatabaseError(_)
        | ConnectionError::ProviderError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        ConnectionError::SharedInboxConflict { .. } => StatusCode::CONFLICT,
    }
}

impl InitError {
    fn status_code(&self) -> StatusCode {
        self.status
    }
}

/// Observes a failed use case before the domain performs attempt cleanup.
pub(crate) struct InitFailureObserver;

impl ConnectionFailureObserver for InitFailureObserver {
    fn observe_failure(&self, request: &ConnectionRequest, error: &ConnectionError) {
        let status = connection_error_status(error);
        let link_id = request.attempt;
        if status.is_server_error() {
            tracing::error!(error = ?error, "init failed");
        } else if matches!(error, ConnectionError::AlreadyInitialized) {
            tracing::debug!(error = %error, "init declined");
        } else {
            tracing::info!(?link_id, status = status.as_u16(), outcome = %error, "init declined");
        }
    }
}

impl IntoResponse for InitError {
    fn into_response(self) -> Response {
        let status_code = self.status_code();
        let headers = match &self.kind {
            InitErrorKind::ProviderError(error) => {
                super::provider_error::provider_error_headers(error)
            }
            _ => axum::http::HeaderMap::new(),
        };

        match self.kind {
            InitErrorKind::SharedInboxConflict {
                email_address,
                existing_owner_email,
                existing_link_id,
            } => (
                status_code,
                Json(SharedInboxConflictResponse {
                    email_address,
                    existing_owner_email,
                    existing_link_id,
                }),
            )
                .into_response(),
            InitErrorKind::AlreadyInitialized => (
                status_code,
                Json(InitErrorCodeResponse {
                    code: ALREADY_INITIALIZED_CODE.to_string(),
                    message: InitErrorKind::AlreadyInitialized.to_string(),
                }),
            )
                .into_response(),
            InitErrorKind::NoGmailGrant => (
                status_code,
                Json(InitErrorCodeResponse {
                    code: NO_GMAIL_GRANT_CODE.to_string(),
                    message: InitErrorKind::NoGmailGrant.to_string(),
                }),
            )
                .into_response(),
            other => (status_code, headers, other.to_string()).into_response(),
        }
    }
}

/// Returned with a `409 Conflict` when a connect targets an external mailbox another
/// macro user has already connected. The client surfaces a confirmation; on confirm it
/// retries `/email/init` with `force_share=true` to promote the mailbox to a shared inbox.
#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct SharedInboxConflictResponse {
    /// The mailbox address that is already connected.
    pub email_address: String,
    /// The email of the macro user who first connected the mailbox.
    pub existing_owner_email: String,
    /// The existing link that would be shared if the caller confirms.
    pub existing_link_id: Uuid,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, ToSchema)]
pub struct InitResponse {
    /// The email_links row id for the now-accessible inbox. For cross-user delegation
    /// this is the *existing* child link the caller now delegates over; for the
    /// self-link bootstrap and the data-source path it's a freshly upserted row.
    pub link_id: Uuid,
    /// Present when init enqueued a backfill job. Absent for cross-user delegation,
    /// where the child link's backfill already ran under its own macro_id; present for
    /// the self-link bootstrap, where a fresh link is provisioned and backfilled.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub backfill_job_id: Option<Uuid>,
}

#[derive(Debug, serde::Deserialize)]
pub struct InitParams {
    /// Optional link id from a `/link/gmail` flow. When set, init provisions the inbox
    /// for the email recorded on the in_progress_user_link row instead of the JWT email.
    link_id: Option<Uuid>,
    /// When set, a connect that collides with a mailbox already connected by another
    /// macro user promotes it to a shared inbox instead of returning a 409 conflict.
    #[serde(default)]
    force_share: bool,
}

/// Initialize email functionality for the user. Populates initial threads and enables inbox syncing.
#[utoipa::path(
    post,
    tag = "Init",
    path = "/email/init",
    params(
        ("link_id" = Option<Uuid>, Query, description = "**OPTIONAL**. The in_progress_user_link id from a /link/gmail flow."),
        ("force_share" = Option<bool>, Query, description = "**OPTIONAL**. Confirms promoting a mailbox already connected by another user into a shared inbox."),
    ),
    operation_id = "init_user",
    responses(
            (status = 200, body=InitResponse),
            (status = 400, body=InitErrorCodeResponse),
            (status = 401, body=ErrorResponse),
            (status = 402, body=ErrorResponse),
            (status = 409, body=SharedInboxConflictResponse),
            (status = 429, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, authorization), fields(user_id=authorization.authorization.user.user_context.user_id, fusionauth_user_id=authorization.authorization.user.user_context.fusion_user_id))]
pub(crate) async fn handler(
    State(ctx): State<ApiContext>,
    query: Query<InitParams>,
    authorization: MacroAuthorizationExtractor<AuthorizationService, UserOrInternal>,
) -> Result<Response, InitError> {
    let request = ConnectionRequest {
        actor_macro_id: authorization.authorization.user.macro_user_id.clone(),
        actor_id: authorization
            .authorization
            .user
            .user_context
            .user_id
            .clone(),
        actor_fusion_id: authorization
            .authorization
            .user
            .user_context
            .fusion_user_id
            .clone(),
        attempt: query.link_id,
        force_share: query.force_share,
    };
    let outcome = ctx
        .inbox_connection
        .connect(request)
        .await
        .map_err(InitError::from)?;
    Ok(Json(InitResponse {
        link_id: outcome.link_id,
        backfill_job_id: outcome.backfill_job_id,
    })
    .into_response())
}

impl From<ConnectionError> for InitError {
    fn from(error: ConnectionError) -> Self {
        let status = connection_error_status(&error);
        let kind = match error {
            ConnectionError::MailboxInitialization(error) => {
                InitErrorKind::MailboxInitialization(error)
            }
            ConnectionError::AlreadyInitialized => InitErrorKind::AlreadyInitialized,
            ConnectionError::NoGmailGrant => InitErrorKind::NoGmailGrant,
            ConnectionError::EnqueueError => InitErrorKind::EnqueueError,
            ConnectionError::DatabaseError(error) => InitErrorKind::DatabaseError(error),
            ConnectionError::ProviderError(error) => InitErrorKind::ProviderError(error),
            ConnectionError::InvalidUserIdentity => {
                InitErrorKind::BadRequest("invalid user identity".into())
            }
            ConnectionError::InvalidAttemptProvider => {
                InitErrorKind::BadRequest("invalid mailbox linking attempt".into())
            }
            ConnectionError::AttemptOwnerMismatch => {
                InitErrorKind::BadRequest("link_id does not belong to the requesting user".into())
            }
            ConnectionError::AttemptAuthenticationIncomplete => {
                InitErrorKind::BadRequest("link has not completed authentication yet".into())
            }
            ConnectionError::LoginEmailUnavailable => {
                InitErrorKind::BadRequest("Failed to extract email".into())
            }
            ConnectionError::Parse(error) => InitErrorKind::Parse(error),
            ConnectionError::SharedInboxConflict {
                email_address,
                existing_owner_email,
                existing_link_id,
            } => InitErrorKind::SharedInboxConflict {
                email_address,
                existing_owner_email,
                existing_link_id,
            },
        };
        Self { status, kind }
    }
}
