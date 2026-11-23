//! Microsoft Graph's error responses.

use serde_json::{Value, json};

/// An error answered the way Graph answers it: a status, and a body of
/// `{"error": {"code", "message", "innerError"}}`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct GraphError {
    pub(crate) status: u16,
    /// `error.code`, such as `ErrorItemNotFound`.
    pub(crate) code: &'static str,
    pub(crate) message: String,
    pub(crate) retry_after_seconds: Option<u64>,
}

impl GraphError {
    fn new(status: u16, code: &'static str, message: &str) -> Self {
        Self {
            status,
            code,
            message: message.to_string(),
            retry_after_seconds: None,
        }
    }

    pub(crate) fn bad_request(message: &str) -> Self {
        Self::new(400, "BadRequest", message)
    }

    pub(crate) fn invalid_request(message: &str) -> Self {
        Self::new(400, "InvalidRequest", message)
    }

    /// Graph refuses the operation on this item, such as a native reply to
    /// some parents.
    pub(crate) fn invalid_operation(message: &str) -> Self {
        Self::new(400, "ErrorInvalidOperation", message)
    }

    pub(crate) fn unauthenticated(message: &str) -> Self {
        Self::new(401, "InvalidAuthenticationToken", message)
    }

    pub(crate) fn access_denied() -> Self {
        Self::new(
            403,
            "ErrorAccessDenied",
            "Access is denied. Check credentials and try again.",
        )
    }

    pub(crate) fn item_not_found() -> Self {
        Self::new(
            404,
            "ErrorItemNotFound",
            "The specified object was not found in the store.",
        )
    }

    pub(crate) fn resource_not_found(what: &str) -> Self {
        Self::new(
            404,
            "ResourceNotFound",
            &format!("Resource could not be discovered: {what}"),
        )
    }

    /// An unknown path: the emulator does not serve it.
    pub(crate) fn unknown_segment(segment: &str) -> Self {
        Self::bad_request(&format!("Resource not found for the segment '{segment}'."))
    }

    pub(crate) fn folder_exists() -> Self {
        Self::new(
            409,
            "ErrorFolderExists",
            "A folder with the specified name already exists.",
        )
    }

    pub(crate) fn conflict(message: &str) -> Self {
        Self::new(409, "Conflict", message)
    }

    /// A delta token Graph no longer holds the sync state for.
    pub(crate) fn sync_state_not_found() -> Self {
        Self::new(
            410,
            "SyncStateNotFound",
            "The sync state generation is not found; the delta token is expired or invalid. \
             A full resynchronization is required.",
        )
    }

    /// `If-Match` named a version the item is no longer at.
    pub(crate) fn changed_since_read() -> Self {
        Self::new(
            412,
            "ErrorIrresolvableConflict",
            "The send or update operation could not be performed because the change key \
             passed in the request does not match the current change key for the item.",
        )
    }

    pub(crate) fn too_large(message: &str) -> Self {
        Self::new(413, "ErrorMessageSizeExceeded", message)
    }

    pub(crate) fn invalid_range(message: &str) -> Self {
        Self::new(416, "InvalidRange", message)
    }

    /// The mailbox's request limit, or its concurrency limit.
    pub(crate) fn throttled(limit: &str, retry_after_seconds: Option<u64>) -> Self {
        Self {
            retry_after_seconds,
            ..Self::new(
                429,
                "ApplicationThrottled",
                &format!("Application is over its {limit} limit."),
            )
        }
    }

    pub(crate) fn too_many_requests(retry_after_seconds: Option<u64>) -> Self {
        Self {
            retry_after_seconds,
            ..Self::new(429, "TooManyRequests", "Please retry again later.")
        }
    }

    pub(crate) fn server(status: u16, code: &'static str, message: &str) -> Self {
        Self::new(status, code, message)
    }

    pub(crate) fn with_retry_after(mut self, seconds: Option<u64>) -> Self {
        if seconds.is_some() {
            self.retry_after_seconds = seconds;
        }
        self
    }

    /// The JSON body, naming the request it answers.
    pub(crate) fn body(&self, request_id: &str, date: &str) -> Value {
        json!({
            "error": {
                "code": self.code,
                "message": self.message,
                "innerError": {
                    "date": date,
                    "request-id": request_id,
                    "client-request-id": request_id,
                }
            }
        })
    }
}
