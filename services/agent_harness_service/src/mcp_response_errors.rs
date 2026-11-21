//! The error responses of this process's MCP servers, logged by their code.
//!
//! rmcp logs every error response with its whole `ErrorData`, and
//! [`DROPPED_RMCP_CALLSITES`] drops that statement: the data can hold the
//! caller's words (the first step of an MCP Events subscribe answers with the
//! query and the filter compiled from it). The servers' handlers log their
//! errors with [`log_error_response`] instead, by method and code only: the
//! message can hold the caller's words too (a deserialization error quotes the
//! value it refused, a filter refusal quotes the query).

#[cfg(test)]
#[path = "mcp_response_errors/test.rs"]
mod test;

use macro_entrypoint::DroppedCallsite;
use rmcp::ErrorData;

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

/// The requests whose error responses this process logs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub(crate) enum McpMethod {
    Initialize,
    /// A request rmcp does not model, such as an MCP Events method.
    Custom,
    ListTools,
    CallTool,
}

/// Logs an error response by the request's method and the error's code only:
/// not its message or data, nor the request id, which a client chooses. The
/// caller still receives the message and data.
pub(crate) fn log_error_response(method: McpMethod, error: &ErrorData) {
    let method: &'static str = method.into();
    tracing::warn!(method, code = error.code.0, "response error");
}
