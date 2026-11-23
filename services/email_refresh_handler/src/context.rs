use std::sync::Arc;

/// Context for refresh handler
pub(crate) struct Context<S> {
    pub(crate) service: Arc<S>,
}

impl<S> Clone for Context<S> {
    fn clone(&self) -> Self {
        Self {
            service: Arc::clone(&self.service),
        }
    }
}
