use super::*;
use entity_access::domain::models::MemberParticipantRole;
use models_permissions::share_permission::LinkShareState;

fn source() -> EntityAccessReceipt<MemberParticipantRole> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        test_user(),
        "customer-channel",
        EntityType::Channel,
    )
}
fn file(id: uuid::Uuid) -> NewDocument {
    let mut file = new_document(FileType::Pdf);
    file.id = Some(id);
    file.sha = "ab".repeat(32);
    file
}
fn metadata(id: uuid::Uuid) -> DocumentMetadata {
    let mut m = make_test_metadata();
    m.document_id = id.to_string();
    m.file_type = Some("pdf".into());
    m.sha = Some("ab".repeat(32));
    m.project_id = None;
    m
}

#[tokio::test]
async fn received_file_is_private_and_system_attributed() {
    let id = uuid::Uuid::now_v7();
    let mut repo = make_mock_repo();
    let mut sync = crate::domain::ports::sync::MockDocumentSyncPort::new();
    sync.expect_exists()
        .returning(|_| Box::pin(std::future::ready(Ok(false))));
    repo.expect_create_document()
        .withf(|args, share| {
            args.document.project_id.is_none()
                && args.document.team_id.is_none()
                && !args.document.share_with_team
                && args.document.sub_type.is_none()
                && args.document.skip_history
                && share.link_share_state() == LinkShareState::Off
        })
        .times(1)
        .returning(move |_, _| Box::pin(std::future::ready(Ok(metadata(id)))));
    repo.expect_set_document_content()
        .times(1)
        .returning(|_, _| Box::pin(std::future::ready(Ok(()))));
    repo.expect_get_team_task_metadata()
        .returning(|_| Box::pin(std::future::ready(Ok(None))));
    let service = spreadsheet_test_service(repo, sync);
    let mut document = file(id);
    document.project_id = Some(uuid::Uuid::now_v7());
    document.team_id = Some(uuid::Uuid::now_v7());
    document.share_with_team = true;
    document.sub_type = Some(DocumentSubType::Task);
    let result = service
        .prepare_received_file(source(), document)
        .await
        .unwrap();
    assert!(result.document_response.presigned_url.is_some());
    let events = service.macro_event_broker.published();
    let events = events.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(
        events[0].payload["metadata"]["actor"],
        bot_id::MACRO_SYSTEM_BOT_ID.into_storage_id().as_ref()
    );
    assert!(events[0].payload["metadata"]["on_behalf_of"].is_null());
}

#[tokio::test]
async fn ready_received_file_is_not_rewritten_or_republished() {
    let id = uuid::Uuid::now_v7();
    let mut repo = make_mock_repo();
    let mut sync = crate::domain::ports::sync::MockDocumentSyncPort::new();
    sync.expect_exists()
        .returning(|_| Box::pin(std::future::ready(Ok(false))));
    repo.expect_create_document().returning(|_, _| {
        Box::pin(std::future::ready(Err(DocumentError::Conflict(
            "exists".into(),
        ))))
    });
    repo.expect_get_document_metadata()
        .returning(move |_| Box::pin(std::future::ready(Ok(metadata(id)))));
    repo.expect_get_persisted_document_content().returning(|_| {
        Box::pin(std::future::ready(Ok(Some(DocumentContent::ready(
            DocumentContentLocation::ObjectStorage,
        )))))
    });
    repo.expect_set_document_content().times(0);
    let service = spreadsheet_test_service(repo, sync);
    let result = service
        .prepare_received_file(source(), file(id))
        .await
        .unwrap();
    assert!(result.document_response.presigned_url.is_none());
    assert!(
        service
            .macro_event_broker
            .published()
            .lock()
            .unwrap()
            .is_empty()
    );
}

#[tokio::test]
async fn reservation_cannot_adopt_another_owners_file() {
    let id = uuid::Uuid::now_v7();
    let mut repo = make_mock_repo();
    let mut sync = crate::domain::ports::sync::MockDocumentSyncPort::new();
    sync.expect_exists()
        .returning(|_| Box::pin(std::future::ready(Ok(false))));
    repo.expect_create_document().returning(|_, _| {
        Box::pin(std::future::ready(Err(DocumentError::Conflict(
            "exists".into(),
        ))))
    });
    repo.expect_get_document_metadata().returning(move |_| {
        let mut m = metadata(id);
        m.owner = Owner::from_principal_str("macro|other@user.com").unwrap();
        Box::pin(std::future::ready(Ok(m)))
    });
    let service = spreadsheet_test_service(repo, sync);
    assert!(matches!(
        service.prepare_received_file(source(), file(id)).await,
        Err(DocumentError::Conflict(_))
    ));
}
