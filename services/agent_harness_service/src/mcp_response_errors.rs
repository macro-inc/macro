//! The error responses of this process's MCP servers, logged without their data.
//!
//! rmcp logs every error response with its whole `ErrorData`, and
//! [`DROPPED_RMCP_CALLSITES`] drops that statement: the data can hold the
//! caller's words (the first step of an MCP Events subscribe answers with the
//! query and the filter compiled from it). The servers' handlers log their
//! errors with [`log_error_response`] instead.

#[cfg(test)]
#[path = "mcp_response_errors/test.rs"]
mod test;

use macro_entrypoint::DroppedCallsite;
use rmcp::ErrorData;
use rmcp::model::RequestId;

/// The rmcp 3.9.0 log statements dropped from every sink of this process. A
/// different rmcp version matches neither, so they are logged again until
/// these are moved to its lines.
pub const DROPPED_RMCP_CALLSITES: &[DroppedCallsite] = &[
    // Every error response, with its data. The handlers log theirs with
    // [`log_error_response`]; errors rmcp answers before a handler runs (an
    // unsupported protocol version, a method no handler implements) and the
    // errors this process returns as an MCP client go unlogged.
    DroppedCallsite {
        target: "rmcp::service",
        level: tracing::Level::WARN,
        file: RMCP_SERVICE_FILE,
        line: 1625,
    },
    // A stateless streamable HTTP request ends when its client closes the
    // stream, which is how an MCP Events stream always ends. rmcp then sends
    // the cancelled handler's response into the closed stream and logs the
    // failure as an error, once per stream. Sending into this transport fails
    // only when the stream is gone.
    DroppedCallsite {
        target: "rmcp::service",
        level: tracing::Level::ERROR,
        file: RMCP_SERVICE_FILE,
        line: 1806,
    },
];

const RMCP_SERVICE_FILE: &str = "rmcp-3.9.0/src/service.rs";

/// Logs an error response by its code and message, as rmcp's own warning did,
/// without its data.
pub(crate) fn log_error_response(id: &RequestId, error: &ErrorData) {
    tracing::warn!(
        %id,
        code = error.code.0,
        error_message = %error.message,
        "response error"
    );
}
