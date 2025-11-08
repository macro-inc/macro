/// A reference is a link to one entity from another entity
///
/// Currently, there are three types of references:
/// - Attaching an entity in a channel is a reference [`ChannelReference`]
/// - Mentioning an entity in a channel is a reference [`ChannelReference`]
/// - Mentioning an entity in a document is a reference [`GenericReference`]
use anyhow::{Context, Result};
use futures::try_join;
use sqlx::{Pool, Postgres};

/// Representation of a reference from a channel/message
#[derive(Debug, PartialEq, Clone, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct ChannelReference {
    /// Channel that contains the message
    pub channel_id: uuid::Uuid,
    /// Optional channel name (DMs do not have a name)
    pub channel_name: Option<String>,
    /// Message that contains the attachment reference
    pub message_id: uuid::Uuid,
    /// If the message belongs to a thread this is the parent id
    pub thread_id: Option<uuid::Uuid>,
    /// Sender of the message
    pub sender_id: String,
    /// Full message content (might be used for preview/snippet)
    pub message_content: String,
    /// When the message itself was created
    pub message_created_at: chrono::DateTime<chrono::Utc>,
    /// When the attachment row was created (normally identical to message
    /// creation, but stored separately just in case)
    pub attachment_created_at: chrono::DateTime<chrono::Utc>,
}

/// Representation of a reference from any entity type
#[derive(Debug, PartialEq, Clone, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
pub struct GenericReference {
    /// Type of the source entity (e.g., "document", "chat", etc.)
    pub source_entity_type: String,
    /// ID of the source entity
    pub source_entity_id: String,
    /// Type of the referenced entity
    pub entity_type: String,
    /// ID of the referenced entity
    pub entity_id: String,
    /// User who created this reference (optional for non-user sources like channels)
    pub user_id: Option<String>,
    /// When this reference was created
    pub created_at: chrono::DateTime<chrono::Utc>,
    /// Optional metadata specific to the source type
    pub metadata: Option<serde_json::Value>,
}

#[derive(Debug, PartialEq, Clone, serde::Serialize, serde::Deserialize, utoipa::ToSchema)]
#[serde(tag = "reference_type", rename_all = "snake_case")]
pub enum EntityReference {
    /// An entity was referenced from a channel
    Channel(ChannelReference),
    /// An entity was referenced from anything but a channel
    Generic(GenericReference),
}

#[tracing::instrument(skip(db))]
pub async fn get_attachment_references(
    db: &Pool<Postgres>,
    entity_type: &str,
    entity_id: &str,
    user_id: &str,
) -> Result<Vec<EntityReference>> {
    let (attachment_references, mention_references, generic_references) = try_join!(
        // Get attachment references
        async {
            sqlx::query_as!(
                ChannelReference,
                r#"
                SELECT 
                    a.channel_id                     AS "channel_id: uuid::Uuid",
                    c.name                           AS "channel_name?",            -- Option<String>
                    a.message_id                     AS "message_id: uuid::Uuid",
                    m.thread_id                      AS "thread_id?: uuid::Uuid",
                    m.sender_id                      AS "sender_id!",               -- String
                    m.content                        AS "message_content!",         -- String
                    m.created_at                     AS "message_created_at!: chrono::DateTime<chrono::Utc>",
                    a.created_at                     AS "attachment_created_at!: chrono::DateTime<chrono::Utc>"
                FROM comms_attachments a
                JOIN comms_messages m ON a.message_id = m.id
                JOIN comms_channels c ON a.channel_id = c.id
                JOIN comms_channel_participants cp ON cp.channel_id = c.id
                WHERE a.entity_type = $1
                  AND a.entity_id  = $2
                  AND cp.user_id   = $3
                  AND cp.left_at  IS NULL
                  AND m.deleted_at IS NULL
                ORDER BY a.created_at DESC
                "#,
                entity_type,
                entity_id,
                user_id,
            )
            .fetch_all(db)
            .await
            .context("failed to get attachment references")
        },
        // Get mention references from messages
        async {
            sqlx::query_as!(
                ChannelReference,
                r#"
                SELECT 
                    m.channel_id                     AS "channel_id: uuid::Uuid",
                    c.name                           AS "channel_name?",            -- Option<String>
                    m.id                             AS "message_id: uuid::Uuid",
                    m.thread_id                      AS "thread_id?: uuid::Uuid",
                    m.sender_id                      AS "sender_id!",               -- String
                    m.content                        AS "message_content!",         -- String
                    m.created_at                     AS "message_created_at!: chrono::DateTime<chrono::Utc>",
                    em.created_at                    AS "attachment_created_at!: chrono::DateTime<chrono::Utc>"
                FROM comms_entity_mentions em
                JOIN comms_messages m ON (em.source_entity_id = m.id::text AND em.source_entity_type = 'message')
                JOIN comms_channels c ON m.channel_id = c.id
                JOIN comms_channel_participants cp ON cp.channel_id = c.id
                WHERE em.entity_type = $1
                  AND em.entity_id  = $2
                  AND cp.user_id   = $3
                  AND cp.left_at  IS NULL
                  AND m.deleted_at IS NULL
                ORDER BY em.created_at DESC
                "#,
                entity_type,
                entity_id,
                user_id,
            )
            .fetch_all(db)
            .await
            .context("failed to get mention references")
        },
        // Get generic entity mentions (non-message sources)
        async {
            sqlx::query!(
                r#"
                SELECT 
                    em.source_entity_type,
                    em.source_entity_id,
                    em.entity_type,
                    em.entity_id,
                    em.user_id,
                    em.created_at
                FROM comms_entity_mentions em
                WHERE em.entity_type = $1
                  AND em.entity_id  = $2
                  AND em.source_entity_type != 'message'
                ORDER BY em.created_at DESC
                "#,
                entity_type,
                entity_id,
            )
            .fetch_all(db)
            .await
            .context("failed to get generic entity references")
            .map(|rows| {
                rows.into_iter()
                    .map(|row| GenericReference {
                        source_entity_type: row.source_entity_type,
                        source_entity_id: row.source_entity_id,
                        entity_type: row.entity_type,
                        entity_id: row.entity_id,
                        user_id: row.user_id,
                        created_at: row.created_at,
                        metadata: None,
                    })
                    .collect::<Vec<_>>()
            })
        }
    )?;

    let mut references: Vec<EntityReference> = attachment_references
        .into_iter()
        .map(EntityReference::Channel)
        .collect();

    references.extend(mention_references.into_iter().map(EntityReference::Channel));

    references.extend(generic_references.into_iter().map(EntityReference::Generic));

    references.sort_by(|a, b| {
        let a_time = match a {
            EntityReference::Channel(c) => c.attachment_created_at,
            EntityReference::Generic(g) => g.created_at,
        };
        let b_time = match b {
            EntityReference::Channel(c) => c.attachment_created_at,
            EntityReference::Generic(g) => g.created_at,
        };
        b_time.cmp(&a_time)
    });

    Ok(references)
}

#[cfg(test)]
mod tests {
    use super::*;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;

    // Helper function to extract channel references from entity references for testing
    fn extract_channel_refs(refs: Vec<EntityReference>) -> Vec<ChannelReference> {
        refs.into_iter()
            .filter_map(|r| match r {
                EntityReference::Channel(c) => Some(c),
                _ => None,
            })
            .collect()
    }

    // Helper function to extract generic references from entity references for testing
    fn extract_generic_refs(refs: Vec<EntityReference>) -> Vec<GenericReference> {
        refs.into_iter()
            .filter_map(|r| match r {
                EntityReference::Generic(g) => Some(g),
                _ => None,
            })
            .collect()
    }

    // user1 owns "private 1" and there is a single doc1 attachment
    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("attachments"))
    )]
    async fn test_get_attachment_references_private_channel_access(pool: Pool<Postgres>) {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
        let refs = get_attachment_references(&pool, "doc", "doc1", "user1")
            .await
            .unwrap();
        assert_eq!(refs.len(), 1);

        let channel_refs = extract_channel_refs(refs);
        assert_eq!(channel_refs.len(), 1);
        assert_eq!(channel_refs[0].channel_name, Some("private 1".into()));
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("attachments"))
    )]
    async fn test_get_attachment_references_no_access(pool: Pool<Postgres>) {
        // user4 is not a participant in channel 1111
        let refs = get_attachment_references(&pool, "doc", "doc1", "user4")
            .await
            .unwrap();
        assert!(refs.is_empty());
    }

    // deleted_doc lives in a channel where user2 has no membership
    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("attachments"))
    )]
    async fn test_get_attachment_references_deleted_message(pool: Pool<Postgres>) {
        let refs = get_attachment_references(&pool, "doc", "deleted_doc", "user2")
            .await
            .unwrap();
        assert!(refs.is_empty());
    }

    // thread_doc is in the public channel; only user5 is a participant there
    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("attachments"))
    )]
    async fn test_get_attachment_references_thread_message(pool: Pool<Postgres>) {
        let refs = get_attachment_references(&pool, "doc", "thread_doc", "user5")
            .await
            .unwrap();
        assert_eq!(refs.len(), 1);

        let channel_refs = extract_channel_refs(refs);
        assert_eq!(channel_refs.len(), 1);
        assert_eq!(channel_refs[0].thread_id, None);
    }

    // leftuser_doc exists, but user7 is no longer in the channel
    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("attachments"))
    )]
    async fn test_get_attachment_references_left_channel(pool: Pool<Postgres>) {
        let refs = get_attachment_references(&pool, "doc", "leftuser_doc", "user7")
            .await
            .unwrap();
        assert!(refs.is_empty());
    }

    // public-channel access check for a valid participant (user5)
    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("attachments"))
    )]
    async fn test_get_attachment_references_public_channel(pool: Pool<Postgres>) {
        let refs = get_attachment_references(&pool, "doc", "thread_doc", "user5")
            .await
            .unwrap();
        assert_eq!(refs.len(), 1);

        let channel_refs = extract_channel_refs(refs);
        assert_eq!(channel_refs.len(), 1);
        assert_eq!(channel_refs[0].channel_name, Some("public channel".into()));
    }

    // Test document mentions functionality
    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("attachments"))
    )]
    async fn test_get_attachment_references_document_mention_access(pool: Pool<Postgres>) {
        // user1 should see doc_mention1 which is mentioned in their private channel
        let refs = get_attachment_references(&pool, "doc", "doc_mention1", "user1")
            .await
            .unwrap();
        assert_eq!(refs.len(), 1);

        let channel_refs = extract_channel_refs(refs);
        assert_eq!(channel_refs.len(), 1);
        assert_eq!(channel_refs[0].channel_name, Some("private 1".into()));
        assert_eq!(channel_refs[0].message_content, "message 2 content");
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("attachments"))
    )]
    async fn test_get_attachment_references_document_mention_public_channel(pool: Pool<Postgres>) {
        // user5 should see doc_mention2 which is mentioned in the public channel
        let refs = get_attachment_references(&pool, "doc", "doc_mention2", "user5")
            .await
            .unwrap();
        assert_eq!(refs.len(), 1);

        let channel_refs = extract_channel_refs(refs);
        assert_eq!(channel_refs.len(), 1);
        assert_eq!(channel_refs[0].channel_name, Some("public channel".into()));
        assert_eq!(
            channel_refs[0].message_content,
            "I found another version of that doc"
        );
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("attachments"))
    )]
    async fn test_get_attachment_references_document_mention_org_channel(pool: Pool<Postgres>) {
        // user1 should see doc_mention3 which is mentioned in their org channel
        let refs = get_attachment_references(&pool, "doc", "doc_mention3", "user1")
            .await
            .unwrap();
        assert_eq!(refs.len(), 1);

        let channel_refs = extract_channel_refs(refs);
        assert_eq!(channel_refs.len(), 1);
        assert_eq!(channel_refs[0].channel_name, Some("org channel".into()));
        assert_eq!(
            channel_refs[0].message_content,
            "Here are multiple docs to review"
        );
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("attachments"))
    )]
    async fn test_get_attachment_references_document_mention_thread(pool: Pool<Postgres>) {
        // user5 should see doc_mention4 which is mentioned in a thread message
        let refs = get_attachment_references(&pool, "doc", "doc_mention4", "user5")
            .await
            .unwrap();
        assert_eq!(refs.len(), 1);

        let channel_refs = extract_channel_refs(refs);
        assert_eq!(channel_refs.len(), 1);
        assert_eq!(channel_refs[0].channel_name, Some("public channel".into()));
        assert_eq!(
            channel_refs[0].message_content,
            "Here are my thoughts on the doc"
        );
        assert_eq!(
            channel_refs[0].thread_id,
            Some(uuid::uuid!("85905168-b64d-492d-bad8-91761c0fd860"))
        );
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("attachments"))
    )]
    async fn test_get_attachment_references_document_mention_no_access(pool: Pool<Postgres>) {
        // user1 should NOT see doc_mention_no_access which is mentioned in user2's private channel
        let refs = get_attachment_references(&pool, "doc", "doc_mention_no_access", "user1")
            .await
            .unwrap();
        assert!(refs.is_empty());
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("attachments"))
    )]
    async fn test_get_attachment_references_document_mention_deleted_message(pool: Pool<Postgres>) {
        // doc_mention_deleted is mentioned in a deleted message, should not appear
        let refs = get_attachment_references(&pool, "doc", "doc_mention_deleted", "user5")
            .await
            .unwrap();
        assert!(refs.is_empty());
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("attachments"))
    )]
    async fn test_get_attachment_references_user_mention_not_returned(pool: Pool<Postgres>) {
        // user123 is mentioned but we're searching for docs, should not return anything
        let refs = get_attachment_references(&pool, "doc", "user123", "user1")
            .await
            .unwrap();
        assert!(refs.is_empty());
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("attachments"))
    )]
    async fn test_get_attachment_references_combined_attachment_and_mention(pool: Pool<Postgres>) {
        // Test a scenario where the same document has both direct attachments and mentions
        // First add a mention for an existing attached document
        sqlx::query!(
            "INSERT INTO comms_entity_mentions (id, source_entity_type, source_entity_id, entity_type, entity_id, user_id) VALUES (gen_random_uuid(), 'message', $1, 'doc', 'doc1', NULL)",
            uuid::uuid!("3f91f184-7803-44e2-9a43-7c027b23ff03").to_string()
        )
        .execute(&pool)
        .await
        .unwrap();

        let refs = get_attachment_references(&pool, "doc", "doc1", "user1")
            .await
            .unwrap();

        // Should get 2 references: 1 from attachment, 1 from mention
        assert_eq!(refs.len(), 2);

        let channel_refs = extract_channel_refs(refs);
        assert_eq!(channel_refs.len(), 2);

        // Both should be in the same channel (private 1)
        assert!(
            channel_refs
                .iter()
                .all(|r| r.channel_name == Some("private 1".into()))
        );

        // Should have different message contents
        let contents: Vec<&str> = channel_refs
            .iter()
            .map(|r| r.message_content.as_str())
            .collect();
        assert!(contents.contains(&"message 1 content"));
        assert!(contents.contains(&"message 2 content"));
    }

    // Test generic entity mention functionality
    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("attachments"))
    )]
    async fn test_get_attachment_references_generic_doc_mention(pool: Pool<Postgres>) {
        // Test doc_generic1 which is mentioned by doc_source1
        let refs = get_attachment_references(&pool, "doc", "doc_generic1", "user1")
            .await
            .unwrap();
        assert_eq!(refs.len(), 1);

        let generic_refs = extract_generic_refs(refs);
        assert_eq!(generic_refs.len(), 1);
        assert_eq!(generic_refs[0].source_entity_type, "doc");
        assert_eq!(generic_refs[0].source_entity_id, "doc_source1");
        assert_eq!(generic_refs[0].entity_type, "doc");
        assert_eq!(generic_refs[0].entity_id, "doc_generic1");
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("attachments"))
    )]
    async fn test_get_attachment_references_generic_user_mention(pool: Pool<Postgres>) {
        // Test doc_generic2 which is mentioned by user_source1
        let refs = get_attachment_references(&pool, "doc", "doc_generic2", "user5")
            .await
            .unwrap();
        assert_eq!(refs.len(), 1);

        let generic_refs = extract_generic_refs(refs);
        assert_eq!(generic_refs.len(), 1);
        assert_eq!(generic_refs[0].source_entity_type, "user");
        assert_eq!(generic_refs[0].source_entity_id, "user_source1");
        assert_eq!(generic_refs[0].entity_type, "doc");
        assert_eq!(generic_refs[0].entity_id, "doc_generic2");
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("attachments"))
    )]
    async fn test_get_attachment_references_generic_chat_mention(pool: Pool<Postgres>) {
        // Test doc_generic3 which is mentioned by chat_source1
        let refs = get_attachment_references(&pool, "doc", "doc_generic3", "user2")
            .await
            .unwrap();
        assert_eq!(refs.len(), 1);

        let generic_refs = extract_generic_refs(refs);
        assert_eq!(generic_refs.len(), 1);
        assert_eq!(generic_refs[0].source_entity_type, "chat");
        assert_eq!(generic_refs[0].source_entity_id, "chat_source1");
        assert_eq!(generic_refs[0].entity_type, "doc");
        assert_eq!(generic_refs[0].entity_id, "doc_generic3");
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("attachments"))
    )]
    async fn test_get_attachment_references_generic_project_mention(pool: Pool<Postgres>) {
        // Test doc_generic4 which is mentioned by project_source1
        let refs = get_attachment_references(&pool, "doc", "doc_generic4", "user3")
            .await
            .unwrap();
        assert_eq!(refs.len(), 1);

        let generic_refs = extract_generic_refs(refs);
        assert_eq!(generic_refs.len(), 1);
        assert_eq!(generic_refs[0].source_entity_type, "project");
        assert_eq!(generic_refs[0].source_entity_id, "project_source1");
        assert_eq!(generic_refs[0].entity_type, "doc");
        assert_eq!(generic_refs[0].entity_id, "doc_generic4");
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("attachments"))
    )]
    async fn test_get_attachment_references_mixed_channel_and_generic(pool: Pool<Postgres>) {
        // Test a document that has both channel references and generic references
        // First add a generic mention for an existing document that also has channel references
        sqlx::query!(
            "INSERT INTO comms_entity_mentions (id, source_entity_type, source_entity_id, entity_type, entity_id, user_id) VALUES (gen_random_uuid(), 'doc', 'doc_source_mixed', 'doc', 'doc1', NULL)"
        )
        .execute(&pool)
        .await
        .unwrap();

        let refs = get_attachment_references(&pool, "doc", "doc1", "user1")
            .await
            .unwrap();

        // Should get references from both channels and generic sources
        assert!(refs.len() >= 2); // At least the attachment + generic mention

        let channel_refs = extract_channel_refs(refs.clone());
        let generic_refs = extract_generic_refs(refs);

        // Should have at least one channel reference (from attachment)
        assert!(!channel_refs.is_empty());

        // Should have at least one generic reference
        assert!(!generic_refs.is_empty());
        assert_eq!(generic_refs[0].source_entity_type, "doc");
        assert_eq!(generic_refs[0].source_entity_id, "doc_source_mixed");
    }
}
