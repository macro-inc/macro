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

#[cfg(test)]
mod test {
    use super::*;
    use lexical_client::test_utils::{FakeLexical, HELLO_DOCUMENT};

    #[tokio::test]
    async fn missing_comment_marks_use_the_selected_route_in_every_mode() {
        for mode in ["http", "in_process", "shadow"] {
            let backend = FakeLexical::new(
                HELLO_DOCUMENT,
                vec![(
                    "GET",
                    "/comment-mark/document-test/00000000-0000-0000-0000-000000000001",
                    serde_json::json!({"data":null}),
                )],
            )
            .await;
            let marks = LexicalCommentMarks::new(backend.client(&format!("markdown={mode}")));
            assert!(
                marks
                    .resolve("document-test", uuid::Uuid::from_u128(1))
                    .await
                    .unwrap()
                    .is_none()
            );
            assert_eq!(backend.requests().len(), usize::from(mode != "in_process"));
            assert_eq!(backend.raw_reads(), usize::from(mode != "http"));
        }
    }
}
