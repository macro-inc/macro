use super::*;
use chrono::DateTime;
use models_search::{
    SearchHighlight,
    channel::ChannelMessageSearchResponseItem,
    chat::{ChatMetadata, ChatSearchResponseItem, ChatSearchResponseItemWithMetadata},
    document::{
        DocumentMetadata, DocumentSearchResponseItem, DocumentSearchResponseItemWithMetadata,
    },
    email::{EmailSearchResponseItem, EmailSearchResponseItemWithMetadata},
    project::{ProjectMetadata, ProjectSearchResponseItem, ProjectSearchResponseItemWithMetadata},
};
use sqlx::types::Uuid;

fn channel_message_item(channel_id: Uuid, message_id: Uuid, ts: i64) -> UnifiedSearchResponseItem {
    UnifiedSearchResponseItem::ChannelMessage(ChannelMessageSearchResponseItem {
        id: channel_id,
        owner_id: Some("owner1".to_string()),
        channel_type: "public".to_string(),
        channel_id,
        message_id,
        thread_id: None,
        sender_id: "sender1".to_string(),
        created_at: DateTime::from_timestamp(ts, 0).unwrap(),
        updated_at: DateTime::from_timestamp(ts, 0).unwrap(),
        deleted_at: None,
        highlight: SearchHighlight::default(),
        score: None,
    })
}

#[test]
fn test_sort_unified_search_results() {
    // Create test UUIDs
    let doc_id = Uuid::new_v4();
    let chat_id = Uuid::new_v4();
    let email_id = Uuid::new_v4();
    let project_id = Uuid::new_v4();
    let doc2_id = Uuid::new_v4();

    // Create items with different updated_at timestamps
    // These are intentionally out of order to test sorting
    let results: Vec<UnifiedSearchResponseItem> = vec![
        // Document with updated_at = 1000 (oldest)
        UnifiedSearchResponseItem::Document(DocumentSearchResponseItemWithMetadata {
            properties: None,
            metadata: Some(DocumentMetadata {
                created_at: DateTime::from_timestamp(900, 0).unwrap(),
                updated_at: DateTime::from_timestamp(1000, 0).unwrap(),
                viewed_at: None,
                project_id: None,
                deleted_at: None,
            }),
            extra: DocumentSearchResponseItem {
                id: doc_id,
                name: "Old Document".to_string(),
                owner_id: "owner1".to_string(),
                document_id: doc_id,
                document_name: "Old Document".to_string(),
                file_type: Some("pdf".to_string()),
                sub_type: None,
                document_search_results: vec![],
            },
        }),
        // Chat with updated_at = 3000 (newest)
        UnifiedSearchResponseItem::Chat(ChatSearchResponseItemWithMetadata {
            properties: None,
            metadata: Some(ChatMetadata {
                created_at: DateTime::from_timestamp(2900, 0).unwrap(),
                updated_at: DateTime::from_timestamp(3000, 0).unwrap(),
                viewed_at: None,
                project_id: None,
                deleted_at: None,
            }),
            extra: ChatSearchResponseItem {
                id: chat_id,
                name: "Newest Chat".to_string(),
                owner_id: "owner1".to_string(),
                chat_id,
                user_id: "user1".to_string(),
                chat_search_results: vec![],
            },
        }),
        // Email with updated_at = 1500 (middle)
        UnifiedSearchResponseItem::Email(EmailSearchResponseItemWithMetadata {
            created_at: DateTime::from_timestamp(1400, 0).unwrap(),
            updated_at: DateTime::from_timestamp(1500, 0).unwrap(),
            viewed_at: None,
            snippet: None,
            is_read: false,
            inbox_visible: true,
            is_draft: false,
            is_important: false,
            properties: None,
            extra: EmailSearchResponseItem {
                id: email_id,
                name: Some("Middle Email".to_string()),
                owner_id: "owner1".to_string(),
                subject: Some("Email Subject".to_string()),
                thread_id: email_id,
                user_id: "user1".to_string(),
                link_id: email_id,
                email_message_search_results: vec![],
                participants: vec![],
            },
        }),
        // Project with updated_at = 2000 (second newest)
        UnifiedSearchResponseItem::Project(ProjectSearchResponseItemWithMetadata {
            properties: None,
            metadata: Some(ProjectMetadata {
                created_at: DateTime::from_timestamp(1900, 0).unwrap(),
                updated_at: DateTime::from_timestamp(2000, 0).unwrap(),
                viewed_at: None,
                parent_project_id: None,
                deleted_at: None,
            }),
            extra: ProjectSearchResponseItem {
                id: project_id,
                name: "Recent Project".to_string(),
                owner_id: "owner1".to_string(),
                updated_at: DateTime::from_timestamp(2000, 0).unwrap(),
                created_at: DateTime::from_timestamp(1900, 0).unwrap(),
                project_search_results: vec![],
            },
        }),
        // Another Document with updated_at = 2500 (second)
        UnifiedSearchResponseItem::Document(DocumentSearchResponseItemWithMetadata {
            properties: None,
            metadata: Some(DocumentMetadata {
                created_at: DateTime::from_timestamp(2400, 0).unwrap(),
                updated_at: DateTime::from_timestamp(2500, 0).unwrap(),
                viewed_at: None,
                project_id: None,
                deleted_at: None,
            }),
            extra: DocumentSearchResponseItem {
                id: doc2_id,
                name: "Recent Document".to_string(),
                owner_id: "owner1".to_string(),
                document_id: doc2_id,
                document_name: "Recent Document".to_string(),
                file_type: Some("docx".to_string()),
                sub_type: None,
                document_search_results: vec![],
            },
        }),
    ];

    // Expected order after sorting by updated_at descending (newest first)
    let expected_ids: Vec<Uuid> = vec![
        chat_id,    // 3000 - newest
        doc2_id,    // 2500
        project_id, // 2000
        email_id,   // 1500
        doc_id,     // 1000 - oldest
    ];

    let results = sort_unified_search_results(results);

    assert_eq!(
        results.iter().map(|r| r.entity_id()).collect::<Vec<Uuid>>(),
        expected_ids
    );
}

#[test]
fn test_channel_message_updated_at_is_own_timestamp() {
    let item = channel_message_item(Uuid::new_v4(), Uuid::new_v4(), 3000);
    assert_eq!(
        item.updated_at(),
        Some(DateTime::from_timestamp(3000, 0).unwrap())
    );
}

#[test]
fn test_channel_messages_interleave_by_own_recency() {
    // Several matching messages from one channel must not cluster at the
    // channel's newest hit: each per-message item carries its own timestamp,
    // so other entities sort in between.
    let doc_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();
    let newer_msg = Uuid::new_v4();
    let older_msg = Uuid::new_v4();

    let results: Vec<UnifiedSearchResponseItem> = vec![
        channel_message_item(channel_id, older_msg, 1500),
        channel_message_item(channel_id, newer_msg, 3000),
        // Document with updated_at = 2000, between the two messages
        UnifiedSearchResponseItem::Document(DocumentSearchResponseItemWithMetadata {
            properties: None,
            metadata: Some(DocumentMetadata {
                created_at: DateTime::from_timestamp(1900, 0).unwrap(),
                updated_at: DateTime::from_timestamp(2000, 0).unwrap(),
                viewed_at: None,
                project_id: None,
                deleted_at: None,
            }),
            extra: DocumentSearchResponseItem {
                id: doc_id,
                name: "Document".to_string(),
                owner_id: "owner1".to_string(),
                document_id: doc_id,
                document_name: "Document".to_string(),
                file_type: Some("pdf".to_string()),
                sub_type: None,
                document_search_results: vec![],
            },
        }),
    ];

    let results = sort_unified_search_results(results);

    let message_id = |item: &UnifiedSearchResponseItem| match item {
        UnifiedSearchResponseItem::ChannelMessage(m) => Some(m.message_id),
        _ => None,
    };

    assert_eq!(results.len(), 3);
    assert_eq!(message_id(&results[0]), Some(newer_msg));
    assert_eq!(results[1].entity_id(), doc_id);
    assert_eq!(message_id(&results[2]), Some(older_msg));
}
