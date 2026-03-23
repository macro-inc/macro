use macro_user_id::user_id::MacroUserIdStr;
use std::ops::{Deref, DerefMut};

/// Service context wrapper for shared state passed to tools.
///
/// This is provides access to
/// shared application state like database connections and API clients.
#[derive(Default, Debug, Clone, Copy)]
pub struct ServiceContext<S>(pub S);

impl<S> Deref for ServiceContext<S> {
    type Target = S;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl<S> DerefMut for ServiceContext<S> {
    fn deref_mut(&mut self) -> &mut Self::Target {
        &mut self.0
    }
}

/// Request context passed into tool calls, containing per-request data like user identity.
#[derive(Clone)]
pub struct RequestContext {
    /// The ID of the user making the request.
    pub user_id: MacroUserIdStr<'static>,
}
