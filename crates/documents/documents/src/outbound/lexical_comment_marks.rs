//! Lexical-service lookup of the live text a comment mark covers.

use std::sync::Arc;

use lexical_client::LexicalClient;
use uuid::Uuid;

use crate::domain::comments::CommentMarks;

/// [`CommentMarks`] resolved by the lexical service from the synced document.
pub struct LexicalCommentMarks {
    lexical: Arc<LexicalClient>,
}

impl LexicalCommentMarks {
    /// Resolve marks through `lexical`.
    pub fn new(lexical: Arc<LexicalClient>) -> Self {
        Self { lexical }
    }
}

#[async_trait::async_trait]
impl CommentMarks for LexicalCommentMarks {
    async fn marked_text(
        &self,
        document_id: &str,
        mark_id: Uuid,
    ) -> anyhow::Result<Option<String>> {
        Ok(self
            .lexical
            .resolve_comment_mark(document_id, &mark_id.to_string())
            .await?
            .map(|mark| mark.marked_text))
    }
}
