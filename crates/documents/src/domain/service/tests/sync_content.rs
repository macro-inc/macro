use super::*;

#[tokio::test]
async fn notifications_resolve_the_stored_type_and_preserve_attribution() {
    for file_type in ["md", "spreadsheet"] {
        let mut repo = make_mock_repo();
        repo.expect_get_basic_document()
            .withf(|id| id == "doc-1")
            .return_once(move |_| {
                let mut document = task_document_context("doc-1");
                document.file_type = Some(file_type.to_string());
                Box::pin(std::future::ready(Ok(document)))
            });
        let (service, broker) = make_test_service_with_event_broker(repo);
        let actor = "bot|00000000-0000-0000-0000-00000000a1a1";
        let user = "macro|owner@example.com";

        service
            .publish_sync_content_updated("doc-1", Some(actor.into()), Some(user.into()))
            .await
            .unwrap();

        let published = broker.published();
        let events = published.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].key, "doc-1");
        assert_eq!(
            events[0].payload["event_type"],
            "document.sync_content_updated"
        );
        assert_eq!(events[0].payload["metadata"]["file_type"], file_type);
        assert_eq!(events[0].payload["metadata"]["actor"], actor);
        assert_eq!(events[0].payload["metadata"]["on_behalf_of"], user);
    }
}

#[tokio::test]
async fn missing_documents_do_not_publish_events() {
    let mut repo = make_mock_repo();
    repo.expect_get_basic_document().return_once(|_| {
        Box::pin(std::future::ready(Err(anyhow!(
            "no rows returned by a query that expected to return at least one row"
        ))))
    });
    let (service, broker) = make_test_service_with_event_broker(repo);
    let result = service
        .publish_sync_content_updated("missing", None, None)
        .await;
    assert!(matches!(result, Err(DocumentError::NotFound(_))));
    assert!(broker.published().lock().unwrap().is_empty());
}

#[tokio::test]
async fn notifications_surface_broker_failures() {
    let mut repo = make_mock_repo();
    repo.expect_get_basic_document()
        .return_once(|_| Box::pin(std::future::ready(Ok(task_document_context("doc-1")))));
    let (service, broker) =
        make_test_service_with_configured_event_broker(repo, TestEventBroker::failing());
    let result = service
        .publish_sync_content_updated("doc-1", None, None)
        .await;
    assert!(matches!(result, Err(DocumentError::Internal(_))));
    assert!(broker.published().lock().unwrap().is_empty());
}
