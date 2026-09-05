use super::*;
use messages::domain::ports::MessageError;
use sqlx::PgPool;

fn request() -> DeleteUnthreadedAnchorRequest {
    DeleteUnthreadedAnchorRequest::Pdf(DeleteUnthreadedPdfAnchorRequest::Highlight(
        Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap(),
    ))
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("message_annotations")))]
async fn another_user_cannot_delete_annotation_or_its_discussion(pool: PgPool) {
    let result = delete_document_anchor(&pool, "macro|user2@user.com", request()).await;
    assert!(matches!(result.unwrap_err(), MessageError::Forbidden));
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
    let response = delete_document_anchor(&pool, "macro|user@user.com", request())
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
) -> std::result::Result<DeleteUnthreadedAnchorResponse, MessageError> {
    messages::domain::annotations::AnnotationService::new(
        crate::annotations::repository::PgAnnotationRepository(pool.clone()),
        entity_access::domain::service::EntityAccessServiceImpl::new(
            entity_access::outbound::PgAccessRepository::new(pool.clone()),
        ),
    )
    .delete(&user.to_owned().try_into().unwrap(), None, request)
    .await
}
