use super::*;
use messages::domain::ports::{MessageChange, MessageError, MessageEvent, MessageEventPublisher};
use sqlx::PgPool;
use std::sync::{Arc, Mutex};

#[derive(Clone, Default)]
struct RecordedEvents(Arc<Mutex<Vec<MessageEvent>>>);

impl MessageEventPublisher for RecordedEvents {
    async fn publish(&self, event: MessageEvent) -> Result<(), rootcause::Report> {
        self.0.lock().unwrap().push(event);
        Ok(())
    }
}

fn request() -> DeleteUnthreadedAnchorRequest {
    DeleteUnthreadedAnchorRequest::Pdf(DeleteUnthreadedPdfAnchorRequest::Highlight(
        Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap(),
    ))
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("message_annotations")))]
async fn another_user_cannot_delete_annotation_or_its_discussion(pool: PgPool) {
    let events = RecordedEvents::default();
    let result =
        delete_document_anchor(&pool, "macro|user2@user.com", request(), events.clone()).await;
    assert!(matches!(result.unwrap_err(), MessageError::Forbidden));
    assert!(events.0.lock().unwrap().is_empty());
    let roots = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM comms_message_threads WHERE deleted_at IS NULL"#
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(roots, 4);
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("message_annotations")))]
async fn deleting_threaded_annotation_uses_shared_thread_tombstones(pool: PgPool) {
    let events = RecordedEvents::default();
    let response = delete_document_anchor(&pool, "macro|user@user.com", request(), events.clone())
        .await
        .unwrap();
    assert_eq!(response.thread_id, Some(Uuid::from_u128(4)));
    let state = sqlx::query!(
        "SELECT deleted_at, anchor FROM comms_message_threads WHERE root_id = $1",
        Uuid::from_u128(4)
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(state.deleted_at.is_some());
    assert!(state.anchor.is_none());
    let message = sqlx::query!(
        "SELECT deleted_at, content FROM comms_messages WHERE id = $1",
        Uuid::from_u128(4)
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(message.deleted_at.is_some());
    assert!(message.content.is_empty());
    let emitted = events.0.lock().unwrap();
    assert_eq!(emitted.len(), 1);
    assert_eq!(emitted[0].parent.entity_id(), "document-with-comments");
    assert_eq!(emitted[0].actor, "macro|user@user.com");
    let MessageChange::ThreadUpdated { state } = &emitted[0].change else {
        panic!("annotation deletion must reach shared message subscribers");
    };
    assert_eq!(state.root_id, response.thread_id.unwrap());
    assert!(state.deleted_at.is_some());
    assert!(state.anchor.is_none());
    drop(emitted);
    let highlights =
        crate::annotations::get::fetch_pdf_highlight_anchors(&pool, "document-with-comments")
            .await
            .unwrap();
    assert_eq!(highlights.len(), 1);
    assert_eq!(highlights[0].text, "Standalone underline");
}

async fn delete_document_anchor(
    pool: &PgPool,
    user: &str,
    request: DeleteUnthreadedAnchorRequest,
    events: impl MessageEventPublisher,
) -> std::result::Result<DeleteUnthreadedAnchorResponse, MessageError> {
    messages::domain::annotations::AnnotationService::new(
        crate::annotations::repository::PgAnnotationRepository(pool.clone()),
        entity_access::domain::service::EntityAccessServiceImpl::new(
            entity_access::outbound::PgAccessRepository::new(pool.clone()),
        ),
        events,
    )
    .delete(&user.to_owned().try_into().unwrap(), None, request)
    .await
}
