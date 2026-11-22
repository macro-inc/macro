use crate::Error;
use std::sync::Arc;
/// Metadata-only association between a reported follow-up error and its effect.
/// Implementations must not call out, reenter, perform I/O, or mutate the model.
pub trait FollowUpErrorObserver: Send + Sync {
    /// Borrow the actual cause at its exact Output.effects emission index.
    fn reported(&self, error: &Arc<Error>, effect_index: usize);
}

#[cfg(test)]
mod test;
