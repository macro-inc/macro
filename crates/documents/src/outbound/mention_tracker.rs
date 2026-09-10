//! Outbound adapter for recording the mentions embedded in document content.

use lexical_client::LexicalClient;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use std::sync::Arc;

use crate::domain::ports::mentions::DocumentMentionTrackingPort;

/// Mention tracker backed by lexical-service and MacroDB.
#[derive(Clone)]
pub struct LexicalCommsMentionTracker {
    db: PgPool,
    lexical: Arc<LexicalClient>,
}

impl LexicalCommsMentionTracker {
    /// Construct a tracker writing to `db` and parsing through `lexical`.
    pub fn new(db: PgPool, lexical: Arc<LexicalClient>) -> Self {
        Self { db, lexical }
    }
}

impl DocumentMentionTrackingPort for LexicalCommsMentionTracker {
    #[tracing::instrument(skip(self, markdown), fields(document.id = %document_id))]
    async fn track_document_mentions(
        &self,
        document_id: &str,
        user_id: &MacroUserIdStr<'static>,
        markdown: &str,
    ) -> anyhow::Result<()> {
        if markdown.trim().is_empty() {
            return Ok(());
        }

        let mentions = self.lexical.extract_mentions(markdown).await?;
        if mentions.is_empty() {
            return Ok(());
        }

        let mentions: Vec<_> = mentions
            .into_iter()
            .map(
                |mention| comms_db_client::entity_mentions::NewEntityMention {
                    entity_type: mention.entity_type,
                    entity_id: mention.entity_id,
                },
            )
            .collect();

        let inserted = comms_db_client::entity_mentions::create_entity_mentions(
            &self.db,
            "document",
            document_id,
            Some(user_id.as_ref()),
            &mentions,
        )
        .await?;
        tracing::debug!(mention_count = inserted, "recorded document mentions");

        Ok(())
    }
}
