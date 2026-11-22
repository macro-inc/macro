//! Native application gate; production continues to use the existing HTTP adapter.
use macro_document_model::{DocumentContext, NodeClock, NodeHost, NodeRandom};
use std::sync::Arc;
use sync_server_core::domain::{ports::CommentGate, state::RootChange};
use sync_server_sim::ports::{SimError, SimNow};

pub(crate) struct InProcessCommentGate(pub SimNow);
impl CommentGate for InProcessCommentGate {
    type Error = SimError;
    async fn is_comment_only_change(&self, change: &RootChange) -> Result<bool, SimError> {
        self.check(change)
    }
}
/// Evaluate actual proposed editor roots with the injected room clock.
pub fn evaluate(change: &RootChange, now: SimNow) -> Result<bool, SimError> {
    InProcessCommentGate(now).check(change)
}
impl InProcessCommentGate {
    fn check(&self, change: &RootChange) -> Result<bool, SimError> {
        let error = |error: String| SimError::Failure(error);
        let millis = u64::try_from(self.0.unix_ms).map_err(|e| error(e.to_string()))?;
        let context = DocumentContext {
            clock: NodeClock(Arc::new(move || millis)),
            random: NodeRandom(Arc::new(|length| vec![0; length])),
            host: NodeHost::default(),
            keys: lexical_model::KeySource::default(),
            editor_created: None,
        };
        let before = serde_json::from_value(serde_json::json!({"root": change.before}))
            .map_err(|e| error(e.to_string()))?;
        let after = serde_json::from_value(serde_json::json!({"root": change.after}))
            .map_err(|e| error(e.to_string()))?;
        let before = macro_document_model::comment_gate::content_without_comments_with_context(
            &before, &context,
        )
        .map_err(|e| error(e.to_string()))?;
        let after = macro_document_model::comment_gate::content_without_comments_with_context(
            &after, &context,
        )
        .map_err(|e| error(e.to_string()))?;
        Ok(before == after)
    }
}
