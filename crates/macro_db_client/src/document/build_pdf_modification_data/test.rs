use super::*;
use sqlx::PgPool;

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("message_annotations")))]
async fn exports_shared_bodies_original_authors_resolution_and_geometry(pool: PgPool) {
    let data = get_complete_pdf_modification_data(&pool, "document-with-comments", None)
        .await
        .unwrap();
    assert_eq!(data.placeables.len(), 3);
    let first = data
        .placeables
        .iter()
        .find(|p| p.original_index == 0)
        .unwrap();
    let Payload::Thread(thread) = &first.payload else {
        panic!("expected thread")
    };
    assert_eq!(thread.comments.len(), 2);
    assert_eq!(thread.comments[0].sender, "Original PDF author");
    assert_eq!(thread.comments[0].content, "Initial question on page 1");
    assert_eq!(thread.comments[1].sender, "macro|user2@user.com");
    assert!(
        thread
            .comments
            .iter()
            .all(|c| uuid::Uuid::parse_str(&c.id).is_ok())
    );
    assert_eq!((first.position.x_pct, first.position.y_pct), (0.2, 0.3));
    let resolved = data
        .placeables
        .iter()
        .find(|p| p.original_index == 1)
        .unwrap();
    assert!(matches!(&resolved.payload, Payload::Thread(t) if t.is_resolved));
    let highlights = data.highlights.unwrap();
    assert_eq!(highlights.values().map(Vec::len).sum::<usize>(), 2);
    assert!(
        highlights
            .values()
            .flatten()
            .any(|h| h.thread.is_none() && h.text == "Standalone underline")
    );
    assert!(highlights.values().flatten().any(|h| {
        h.thread
            .as_ref()
            .is_some_and(|t| t.comments[0].content == "Highlight discussion")
    }));
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("message_annotations")))]
async fn deleted_bodies_are_not_exported_but_root_location_survives(pool: PgPool) {
    use messages::domain::{models::MessageParent, ports::MessageRepository};
    let repo = messages::outbound::pg_message_repo::PgMessageRepository::new(pool.clone());
    let parent = MessageParent::parse("document", "document-with-comments").unwrap();
    repo.delete(&parent, uuid::Uuid::from_u128(1))
        .await
        .unwrap();
    let data = get_complete_pdf_modification_data(&pool, "document-with-comments", None)
        .await
        .unwrap();
    let first = data
        .placeables
        .iter()
        .find(|p| p.original_index == 0)
        .unwrap();
    let Payload::Thread(thread) = &first.payload else {
        panic!("expected thread")
    };
    assert_eq!(thread.comments.len(), 1);
    assert_eq!(thread.comments[0].content, "Reply from a collaborator");
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("message_annotations")))]
async fn empty_document_keeps_non_comment_modification_data(pool: PgPool) {
    let initial = PdfModificationData {
        bookmarks: vec![serde_json::json!({"label":"Saved bookmark"})],
        ..Default::default()
    };
    let data = get_complete_pdf_modification_data(&pool, "empty-document", Some(initial))
        .await
        .unwrap();
    assert!(data.placeables.is_empty());
    assert!(data.highlights.unwrap().is_empty());
    assert_eq!(data.bookmarks.len(), 1);
}
