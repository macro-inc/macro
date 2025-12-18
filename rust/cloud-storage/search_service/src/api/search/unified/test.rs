use super::*;
use models_search::{
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
