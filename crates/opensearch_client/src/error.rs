use models_opensearch::OpenSearchEntityType;
use opensearch::{Error, http::response::Response};

/// The OpenSearch operation an error came from, one per request the crate sends.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    serde::Serialize,
    strum::Display,
    strum::AsRefStr,
    strum::IntoStaticStr,
    strum::EnumIter,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum OpensearchOperation {
    SearchChannel,
    SearchUnified,
    UpsertDocument,
    UpsertParentDocument,
    BulkUpsertSingleChunk,
    UpdateDocumentMetadata,
    UpdateDocumentProperties,
    UpsertChannelMessage,
    UpsertChatMessageParent,
    UpsertChatMessageChild,
    UpdateChatMetadata,
    UpdateChatProperties,
    UpsertEmailMessage,
    BulkUpsertEmailMessages,
    UpdateEmailThreadProperties,
    UpsertProject,
    UpdateProjectProperties,
    UpsertCalendarEvent,
    UpdateCalendarEventProperties,
    BulkUpsertCallRecordSegments,
    UpdateCallRecordProperties,
    ReconcileAgentSessionParent,
    ReconcileAgentSessionBulk,
    ReconcileAgentSessionPrune,
    DeleteDocumentById,
    DeleteDocumentByOwnerId,
    DeleteChannelById,
    DeleteChannelMessageById,
    DeleteChatById,
    DeleteChatMessageById,
    DeleteChatByUserId,
    DeleteEmailByLinkId,
    DeleteEmailMessageById,
    DeleteEmailByUserId,
    DeleteProjectById,
    DeleteCalendarEventById,
    DeleteCallRecordById,
    DeleteCallRecordsByChannelId,
    DeleteAgentSession,
}

pub use transport_failure::TransportFailure;

#[derive(thiserror::Error, Debug, serde::Serialize, PartialEq)]
#[serde(tag = "type")]
pub enum OpensearchClientError {
    #[error("error deserializing response body. operation: {operation} details: {details}")]
    DeserializationFailed {
        details: String,
        operation: OpensearchOperation,
    },

    #[error("error deserializing search response. error: {details}, raw_body: {raw_body}")]
    SearchDeserializationFailed { details: String, raw_body: String },

    #[error("unable to grab bytes from http response: {details}")]
    HttpBytesError { details: String },

    #[error("unable to serialize into json. operation: {operation} details: {details}")]
    SerializationFailed {
        details: String,
        operation: OpensearchOperation,
    },

    /// The request produced no complete response: connect, TLS, timeout, or a
    /// connection closed or reset before the response finished.
    #[error(
        "request to opensearch failed. operation: {operation} cause: {cause} details: {details}"
    )]
    RequestFailed {
        details: String,
        cause: TransportFailure,
        operation: OpensearchOperation,
    },

    #[error("a network error occurred. status_code: {status_code} message: {message}")]
    NetworkError { status_code: u16, message: String },

    #[error("invalid match type. match_type: {match_type}")]
    InvalidMatchType { match_type: String },

    #[error("validation failed: {details}")]
    ValidationFailed { details: String },

    #[error("no terms provided")]
    NoTermsProvided,

    #[error("empty search indices provided")]
    EmptySearchIndices,

    #[error("an unknown error occurred. operation: {operation} details: {details}")]
    Unknown {
        details: String,
        operation: OpensearchOperation,
    },

    #[error("no title key is available for name search")]
    NoTitleKeyForNameSearch,

    #[error("bool query not built")]
    BoolQueryNotBuilt,

    #[error("empty ids with ids only for {0}")]
    EmptyIdsWithIdsOnly(OpenSearchEntityType),

    #[error("USER_ID_KEY is required for ids_only=false search on {0}")]
    UserIdKeyRequired(OpenSearchEntityType),

    #[error("searching with exhausted cursor")]
    SearchWithExhaustedCursor,
}

impl OpensearchClientError {
    /// A request that never produced a response.
    pub(crate) fn request_failed(operation: OpensearchOperation, error: &Error) -> Self {
        Self::RequestFailed {
            details: error_chain(error),
            cause: TransportFailure::classify(error),
            operation,
        }
    }

    /// A response body that could not be read or parsed. A body cut off by a
    /// dropped connection or deadline is a request failure with that cause.
    pub(crate) fn deserialization_failed(operation: OpensearchOperation, error: &Error) -> Self {
        match TransportFailure::classify(error) {
            TransportFailure::Other => Self::DeserializationFailed {
                details: error_chain(error),
                operation,
            },
            cause => Self::RequestFailed {
                details: error_chain(error),
                cause,
                operation,
            },
        }
    }

    /// The connection closed or refused before a complete response, so the same
    /// request can succeed on a new connection.
    pub(crate) fn lost_connection(&self) -> bool {
        matches!(
            self,
            Self::RequestFailed {
                cause,
                ..
            } if cause.lost_connection()
        )
    }
}

/// reqwest's `Display` omits the cause (timeout, reset, refused connection),
/// which only its source chain carries.
pub(crate) fn error_chain(error: &(dyn std::error::Error + 'static)) -> String {
    let mut details = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        let cause_text = cause.to_string();
        // `opensearch::Error` displays exactly like the reqwest error it wraps.
        if !details.ends_with(&cause_text) {
            details.push_str(": ");
            details.push_str(&cause_text);
        }
        source = cause.source();
    }
    details
}

pub trait ResponseExt {
    #[allow(async_fn_in_trait)]
    async fn map_client_error(
        self,
        operation: OpensearchOperation,
    ) -> Result<Response, OpensearchClientError>;
}

impl ResponseExt for Result<Response, Error> {
    async fn map_client_error(
        self,
        operation: OpensearchOperation,
    ) -> Result<Response, OpensearchClientError> {
        let response =
            self.map_err(|error| OpensearchClientError::request_failed(operation, &error))?;
        if response.status_code().is_success() {
            Ok(response)
        } else {
            Err(OpensearchClientError::NetworkError {
                status_code: response.status_code().as_u16(),
                message: response.text().await.unwrap_or_default(),
            })
        }
    }
}

#[cfg(test)]
mod test;
