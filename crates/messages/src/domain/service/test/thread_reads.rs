use super::*;

#[tokio::test]
async fn paged_thread_and_root_reads_share_rest_parent_and_thread_policy() {
    let repo = fixture();
    let root = repo.message.id;
    let service = MessageService::new(repo.clone(), Events::default());
    let view = || {
        access("macro|viewer@example.com", "doc", AccessLevel::Comment)
            .try_into_requirement::<MessageView>()
            .unwrap()
    };
    assert!(
        service
            .thread_page(view(), root, MessageThreadQuery::default())
            .await
            .is_ok()
    );
    assert!(service.get_root(view(), root).await.is_ok());
    let different_parent = access("macro|viewer@example.com", "other", AccessLevel::Comment)
        .try_into_requirement::<MessageView>()
        .unwrap();
    assert!(matches!(
        service
            .thread_page(different_parent, root, MessageThreadQuery::default())
            .await,
        Err(MessageError::NotFound)
    ));
    assert!(matches!(
        service
            .thread_page(
                view(),
                root,
                MessageThreadQuery {
                    cursor: Some(MessageReplyCursor::from_message(&repo.message)),
                    around: Some(root),
                    ..Default::default()
                }
            )
            .await,
        Err(MessageError::Invalid(_))
    ));
    repo.thread_deletes.lock().unwrap().push(root);
    assert!(matches!(
        service.get_thread(view(), root).await,
        Err(MessageError::NotFound)
    ));
    assert!(matches!(
        service
            .thread_page(view(), root, MessageThreadQuery::default())
            .await,
        Err(MessageError::NotFound)
    ));
    assert!(matches!(
        service.get_root(view(), root).await,
        Err(MessageError::NotFound)
    ));
}
