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
    BulkUpdateDocumentEmailAttachment,
    UpsertChannelMessage,
    UpsertChatMessageParent,
    UpsertChatMessageChild,
    UpdateChatMetadata,
    UpdateChatProperties,
    ReadIndexedChatMessages,
    UpsertEmailMessage,
    BulkUpsertEmailMessages,
    UpdateEmailThreadProperties,
    UpsertProject,
    UpdateProjectProperties,
    UpsertCalendarEvent,
    UpdateCalendarEventProperties,
    BulkUpsertCallRecordSegments,
    UpdateCallRecordProperties,
    ReadAgentSessionParent,
    ReconcileAgentSessionParent,
    ReconcileAgentSessionBulk,
    ReconcileAgentSessionPrune,
    DeleteDocumentById,
    DeleteStaleDocumentChunks,
    DeleteDocumentByOwnerId,
    DeleteChannelById,
    DeleteChannelMessageById,
    DeleteChatById,
    DeleteChatMessageById,
    DeleteChatByUserId,
    BulkDeleteChatMessages,
    StartEmailLinkDelete,
    EmailDeleteTask,
    RunningEmailLinkDeletes,
    DeleteEmailMessages,
    DeleteEmailMessageById,
    DeleteEmailMessageOutsideThread,
    RefreshEmailIndex,
    DeleteEmailByUserId,
    DeleteProjectById,
    DeleteCalendarEventById,
    DeleteCallRecordById,
    DeleteCallRecordsByChannelId,
    DeleteAgentSession,
}

/// Why a request produced no response.
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
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum TransportFailure {
    /// The request or connection attempt exceeded its deadline.
    Timeout,
    /// No connection could be established (refused, DNS, unreachable).
    Connect,
    /// The connection was closed or reset before the response completed.
    ConnectionClosed,
    /// Any other transport failure; `details` carries the cause.
    Other,
}

impl TransportFailure {
    /// Classify by the first cause in the chain that names a known failure.
    pub(crate) fn classify(error: &(dyn std::error::Error + 'static)) -> Self {
        let mut source: Option<&(dyn std::error::Error + 'static)> = Some(error);
        while let Some(cause) = source {
            if let Some(failure) = Self::from_cause(cause) {
                return failure;
            }
            source = cause.source();
        }
        Self::Other
    }

    fn from_cause(cause: &(dyn std::error::Error + 'static)) -> Option<Self> {
        if let Some(error) = cause.downcast_ref::<reqwest::Error>() {
            if error.is_timeout() {
                return Some(Self::Timeout);
            }
            if error.is_connect() {
                return Some(Self::Connect);
            }
        }
        if let Some(error) = cause.downcast_ref::<hyper::Error>() {
            if error.is_timeout() {
                return Some(Self::Timeout);
            }
            if error.is_incomplete_message() || error.is_closed() || error.is_canceled() {
                return Some(Self::ConnectionClosed);
            }
        }
        // Over HTTP/2 a recycled connection arrives as GOAWAY or RST_STREAM, and
        // `h2::Error` exposes no source for the I/O failure it wraps.
        if let Some(error) = cause.downcast_ref::<h2::Error>()
            && (error.is_go_away() || error.is_reset() || error.is_io())
        {
            return Some(Self::ConnectionClosed);
        }
        if let Some(error) = cause.downcast_ref::<std::io::Error>() {
            use std::io::ErrorKind;
            return match error.kind() {
                ErrorKind::TimedOut => Some(Self::Timeout),
                ErrorKind::ConnectionRefused
                | ErrorKind::HostUnreachable
                | ErrorKind::NetworkUnreachable
                | ErrorKind::AddrNotAvailable => Some(Self::Connect),
                ErrorKind::ConnectionReset
                | ErrorKind::ConnectionAborted
                | ErrorKind::BrokenPipe
                | ErrorKind::UnexpectedEof => Some(Self::ConnectionClosed),
                _ => None,
            };
        }
        None
    }
}

/// Why OpenSearch refused a write to protect itself.
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
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum WriteRefusal {
    /// A 429: a full write queue or a tripped circuit breaker.
    TooManyRequests,
    /// A `cluster_block_exception`, such as the read-only block OpenSearch puts
    /// on an index once a node crosses the flood-stage disk watermark.
    ClusterBlock,
}

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

    /// OpenSearch refused the write to protect itself. Sending it again adds
    /// to the load that caused the refusal, so callers stop and resume later
    /// instead of retrying.
    #[error(
        "opensearch refused the write. operation: {operation} cause: {cause} details: {details}"
    )]
    WritesRefused {
        details: String,
        cause: WriteRefusal,
        operation: OpensearchOperation,
    },

    /// OpenSearch answered a `_bulk` request but failed some of its items.
    /// The items it wrote stay written; the request's work is not done.
    #[error(
        "opensearch failed {failed} of {total} bulk items. operation: {operation} refusal: {refusal:?} errors: {errors:?}"
    )]
    BulkItemsFailed {
        failed: usize,
        total: usize,
        /// Set when OpenSearch refused at least one item to protect itself.
        refusal: Option<WriteRefusal>,
        /// The first few distinct item errors, as `type: reason`.
        errors: Vec<String>,
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
                cause: TransportFailure::ConnectionClosed | TransportFailure::Connect,
                ..
            }
        )
    }

    /// Whether OpenSearch refused the request, or one of its items, to protect
    /// itself. Requests that keep OpenSearch's error body in `details` are read
    /// from it: an error response's `status` and `error.type`, or a by-query
    /// response's `failures`.
    pub fn refusal(&self) -> Option<WriteRefusal> {
        match self {
            Self::WritesRefused { cause, .. } => Some(*cause),
            Self::BulkItemsFailed { refusal, .. } => *refusal,
            Self::NetworkError { status_code, .. } => {
                write_refusal(*status_code, &serde_json::Value::Null)
            }
            Self::Unknown { details, .. } => refusal_in_body(details),
            _ => None,
        }
    }

    /// How many items of a bulk request OpenSearch failed.
    pub fn failed_items(&self) -> usize {
        match self {
            Self::BulkItemsFailed { failed, .. } => *failed,
            _ => 0,
        }
    }
}

/// The refusal, if any, in a request's or an item's status and `error`.
pub(crate) fn write_refusal(status: u16, error: &serde_json::Value) -> Option<WriteRefusal> {
    if error["type"].as_str() == Some("cluster_block_exception") {
        return Some(WriteRefusal::ClusterBlock);
    }
    (status == 429).then_some(WriteRefusal::TooManyRequests)
}

fn refusal_in_body(body: &str) -> Option<WriteRefusal> {
    let body = serde_json::from_str::<serde_json::Value>(body).ok()?;
    let status_of = |value: &serde_json::Value| {
        value["status"]
            .as_u64()
            .and_then(|status| u16::try_from(status).ok())
            .unwrap_or_default()
    };
    // A by-query error keeps its `failures` list, alone or in the response.
    let failures = body.as_array().or_else(|| body["failures"].as_array());
    write_refusal(status_of(&body), &body["error"]).or_else(|| {
        failures?
            .iter()
            .find_map(|failure| write_refusal(status_of(failure), &failure["cause"]))
    })
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
