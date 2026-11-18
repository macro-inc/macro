//! Replacement-free comment permission validation, independent of Worker I/O.
use crate::domain::{ports::CommentGate, state::RootChange};

/// The one in-process gate implementation shared by Worker and simulation.
pub struct InProcessCommentGate {
    context: macro_document_model::DocumentContext,
}
impl InProcessCommentGate {
    /// Supply the runtime's clock and entropy; the shared core performs no I/O.
    pub fn new(context: macro_document_model::DocumentContext) -> Self {
        Self { context }
    }
}
impl CommentGate for InProcessCommentGate {
    type Error = macro_document_model::Error;
    async fn is_comment_only_change(&self, change: &RootChange) -> Result<bool, Self::Error> {
        macro_document_model::comment_gate::is_comment_only_root_change_with_context(
            &change.before,
            &change.after,
            &self.context,
        )
    }
}

#[cfg(test)]
mod test;
