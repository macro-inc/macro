use macro_user_id::user_id::MacroUserId;
use std::sync::Arc;

/// Request context passed into tool calls
pub struct RequestContext {
    /// User
    pub user_id: Arc<MacroUserId<String>>,
    /// jwt
    /// Deprecated. Do not add new dependencies on this
    #[deprecated]
    pub jwt: Arc<String>,
}
