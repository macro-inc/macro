/// Service context wrapper for shared state passed to tools.
///
/// This is an alias for [`axum::extract::State`] and provides access to
/// shared application state like database connections and API clients.
pub use axum::extract::State as ServiceContext;
use macro_user_id::user_id::MacroUserId;
use std::sync::Arc;

/// Request context passed into tool calls, containing per-request data like user identity.
#[derive(Clone)]
pub struct RequestContext {
    /// The ID of the user making the request.
    pub user_id: Arc<MacroUserId<String>>,
    /// The JWT token for the request.
    #[deprecated(note = "Do not add new dependencies on this field")]
    pub jwt: Arc<String>,
}
