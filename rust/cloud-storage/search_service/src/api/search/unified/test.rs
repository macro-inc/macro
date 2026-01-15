use super::*;
use models_search::{
    SearchHighlight,
    channel::{
        ChannelMetadata, ChannelSearchResponseItem, ChannelSearchResponseItemWithMetadata,
        ChannelSearchResult,
    },
    chat::{ChatMetadata, ChatSearchResponseItem, ChatSearchResponseItemWithMetadata},
    document::{
        DocumentMetadata, DocumentSearchResponseItem, DocumentSearchResponseItemWithMetadata,
    },
    email::{EmailSearchResponseItem, EmailSearchResponseItemWithMetadata},
    project::{ProjectMetadata, ProjectSearchResponseItem, ProjectSearchResponseItemWithMetadata},
};
use sqlx::types::Uuid;

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
            metadata: Some(DocumentMetadata {
                created_at: 900,
                updated_at: 1000,
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
            metadata: Some(ChatMetadata {
                created_at: 2900,
                updated_at: 3000,
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
            created_at: 1400,
            updated_at: 1500,
            viewed_at: None,
            snippet: None,
            extra: EmailSearchResponseItem {
                id: email_id,
                name: Some("Middle Email".to_string()),
                owner_id: "owner1".to_string(),
                subject: Some("Email Subject".to_string()),
                thread_id: email_id,
                user_id: "user1".to_string(),
                email_message_search_results: vec![],
            },
        }),
        // Project with updated_at = 2000 (second newest)
        UnifiedSearchResponseItem::Project(ProjectSearchResponseItemWithMetadata {
            metadata: Some(ProjectMetadata {
                created_at: 1900,
                updated_at: 2000,
                viewed_at: None,
                parent_project_id: None,
                deleted_at: None,
            }),
            extra: ProjectSearchResponseItem {
                id: project_id,
                name: "Recent Project".to_string(),
                owner_id: "owner1".to_string(),
                updated_at: 2000,
                created_at: 1900,
                project_search_results: vec![],
            },
        }),
        // Another Document with updated_at = 2500 (second)
        UnifiedSearchResponseItem::Document(DocumentSearchResponseItemWithMetadata {
            metadata: Some(DocumentMetadata {
                created_at: 2400,
                updated_at: 2500,
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
fn test_channel_updated_at_uses_max_from_message_results() {
    let channel_id = Uuid::new_v4();

    // Channel with metadata.updated_at = 1000, but message results have higher values
    let channel = UnifiedSearchResponseItem::Channel(ChannelSearchResponseItemWithMetadata {
        metadata: Some(ChannelMetadata {
            created_at: 900,
            updated_at: 1000,
            viewed_at: None,
            interacted_at: None,
        }),
        extra: ChannelSearchResponseItem {
            id: channel_id,
            owner_id: Some("owner1".to_string()),
            channel_type: "slack".to_string(),
            channel_id,
            channel_message_search_results: vec![
                ChannelSearchResult {
                    message_id: Some(Uuid::new_v4()),
                    thread_id: None,
                    sender_id: Some("sender1".to_string()),
                    created_at: Some(1800),
                    updated_at: Some(2000), // Second highest
                    highlight: SearchHighlight::default(),
                    score: None,
                },
                ChannelSearchResult {
                    message_id: Some(Uuid::new_v4()),
                    thread_id: None,
                    sender_id: Some("sender2".to_string()),
                    created_at: Some(2900),
                    updated_at: Some(3000), // Highest - should be used
                    highlight: SearchHighlight::default(),
                    score: None,
                },
                ChannelSearchResult {
                    message_id: Some(Uuid::new_v4()),
                    thread_id: None,
                    sender_id: Some("sender3".to_string()),
                    created_at: Some(1400),
                    updated_at: Some(1500), // Lowest of results
                    highlight: SearchHighlight::default(),
                    score: None,
                },
            ],
        },
    });

    // Should return 3000 (max from message results), not 1000 (metadata)
    assert_eq!(channel.updated_at(), 3000);
}

#[test]
fn test_channel_updated_at_falls_back_to_metadata_when_no_results() {
    let channel_id = Uuid::new_v4();

    // Channel with metadata.updated_at = 1000, but no message results
    let channel = UnifiedSearchResponseItem::Channel(ChannelSearchResponseItemWithMetadata {
        metadata: Some(ChannelMetadata {
            created_at: 900,
            updated_at: 1000,
            viewed_at: None,
            interacted_at: None,
        }),
        extra: ChannelSearchResponseItem {
            id: channel_id,
            owner_id: Some("owner1".to_string()),
            channel_type: "slack".to_string(),
            channel_id,
            channel_message_search_results: vec![],
        },
    });

    // Should return 1000 (metadata) since no message results
    assert_eq!(channel.updated_at(), 1000);
}

#[test]
fn test_channel_updated_at_falls_back_to_metadata_when_results_have_no_updated_at() {
    let channel_id = Uuid::new_v4();

    // Channel with metadata.updated_at = 1000, message results have None for updated_at
    let channel = UnifiedSearchResponseItem::Channel(ChannelSearchResponseItemWithMetadata {
        metadata: Some(ChannelMetadata {
            created_at: 900,
            updated_at: 1000,
            viewed_at: None,
            interacted_at: None,
        }),
        extra: ChannelSearchResponseItem {
            id: channel_id,
            owner_id: Some("owner1".to_string()),
            channel_type: "slack".to_string(),
            channel_id,
            channel_message_search_results: vec![
                ChannelSearchResult {
                    message_id: Some(Uuid::new_v4()),
                    thread_id: None,
                    sender_id: Some("sender1".to_string()),
                    created_at: Some(1800),
                    updated_at: None, // No updated_at
                    highlight: SearchHighlight::default(),
                    score: None,
                },
                ChannelSearchResult {
                    message_id: Some(Uuid::new_v4()),
                    thread_id: None,
                    sender_id: Some("sender2".to_string()),
                    created_at: Some(2900),
                    updated_at: None, // No updated_at
                    highlight: SearchHighlight::default(),
                    score: None,
                },
            ],
        },
    });

    // Should return 1000 (metadata) since all message results have None for updated_at
    assert_eq!(channel.updated_at(), 1000);
}

#[test]
fn test_sort_unified_search_results_with_channel() {
    // Test that channels are sorted correctly based on max message result updated_at
    let doc_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();

    let results: Vec<UnifiedSearchResponseItem> = vec![
        // Document with updated_at = 2000
        UnifiedSearchResponseItem::Document(DocumentSearchResponseItemWithMetadata {
            metadata: Some(DocumentMetadata {
                created_at: 1900,
                updated_at: 2000,
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
        // Channel with metadata.updated_at = 1000, but message result has updated_at = 3000
        UnifiedSearchResponseItem::Channel(ChannelSearchResponseItemWithMetadata {
            metadata: Some(ChannelMetadata {
                created_at: 900,
                updated_at: 1000, // Would be sorted after document if this was used
                viewed_at: None,
                interacted_at: None,
            }),
            extra: ChannelSearchResponseItem {
                id: channel_id,
                owner_id: Some("owner1".to_string()),
                channel_type: "slack".to_string(),
                channel_id,
                channel_message_search_results: vec![ChannelSearchResult {
                    message_id: Some(Uuid::new_v4()),
                    thread_id: None,
                    sender_id: Some("sender1".to_string()),
                    created_at: Some(2900),
                    updated_at: Some(3000), // Should make channel sort first
                    highlight: SearchHighlight::default(),
                    score: None,
                }],
            },
        }),
    ];

    // Channel should be first because its message result has updated_at = 3000
    let expected_ids: Vec<Uuid> = vec![channel_id, doc_id];

    let results = sort_unified_search_results(results);

    assert_eq!(
        results.iter().map(|r| r.entity_id()).collect::<Vec<Uuid>>(),
        expected_ids
    );
}
