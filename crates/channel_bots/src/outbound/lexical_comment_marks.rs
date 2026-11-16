//! Lexical-service lookup of the live text a comment mark covers.

use async_trait::async_trait;
use lexical_client::LexicalClient;

use crate::domain::{models::MarkedPassage, ports::CommentMarks};

/// [`CommentMarks`] resolved by the lexical service from the synced document.
pub struct LexicalCommentMarks {
    lexical: LexicalClient,
}

impl LexicalCommentMarks {
    /// Resolve marks through `lexical`.
    pub fn new(lexical: LexicalClient) -> Self {
        Self { lexical }
    }
}

#[async_trait]
impl CommentMarks for LexicalCommentMarks {
    async fn resolve(
        &self,
        document_id: &str,
        mark_id: uuid::Uuid,
    ) -> anyhow::Result<Option<MarkedPassage>> {
        Ok(self
            .lexical
            .resolve_comment_mark(document_id, &mark_id.to_string())
            .await?
            .map(|mark| MarkedPassage {
                marked_text: mark.marked_text,
                surrounding_text: mark.surrounding_text,
            }))
    }
}
