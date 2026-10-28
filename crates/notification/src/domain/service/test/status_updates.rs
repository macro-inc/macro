use super::*;

#[tokio::test]
async fn deduplicates_push_clears_by_collapse_key() {
    let user = test_user_id("collapse@example.com");
    let ids: Vec<_> = (0..200).map(|_| Uuid::now_v7()).collect();
    let mut repo = MockRepository::new().with_device_endpoint(
        user.clone(),
        DeviceEndpoint::Ios("ios-endpoint".to_string()),
    );
    for (index, id) in ids.iter().enumerate() {
        repo = repo.with_basic_notification(*id, format!("channel-{}", index % 2));
    }
    let queue = Arc::new(MockQueue::new());
    let service = NotificationReaderService {
        repository: Arc::new(repo),
        queue: queue.clone(),
        sns_endpoint: MockSnsEndpoint,
        platform_config: test_platform_config(),
        realtime: crate::domain::ports::NoopNotificationRealtimePublisher,
    };

    let rows = service
        .update_notifications_and_return::<TestNotifEvent>(UpdateNotificationsRequest {
            user_id: user,
            notification_ids: &ids,
            status: NotificationStatus::Seen,
        })
        .await
        .unwrap();

    assert_eq!(
        rows.len(),
        ids.len(),
        "push deduplication must not truncate the response"
    );
    let published = queue.get_published();
    if !cfg!(feature = "clear_ios_push") {
        assert!(published.is_empty());
        return;
    }
    assert_eq!(published.len(), 2);
    let keys: HashSet<_> = published
        .iter()
        .map(|message| {
            message["content"]["Ios"]["notif"]["identifier"]
                .as_str()
                .unwrap()
        })
        .collect();
    assert_eq!(keys, HashSet::from(["channel-0", "channel-1"]));
}

#[tokio::test]
async fn clears_pushes_only_for_authoritative_owned_rows() {
    let user = test_user_id("owned-clears@example.com");
    let owned_id = Uuid::now_v7();
    let other_id = Uuid::now_v7();
    let now = Utc::now();
    let repo = Arc::new(
        MockRepository::new()
            .with_updated_notifications(vec![updated_notification(
                user.clone(),
                owned_id,
                false,
                Some(now),
                now,
            )])
            .with_basic_notification(owned_id, "owned".to_string())
            .with_basic_notification(other_id, "other-user".to_string())
            .with_device_endpoint(
                user.clone(),
                DeviceEndpoint::Ios("ios-endpoint".to_string()),
            ),
    );
    let queue = Arc::new(MockQueue::new());
    let service = NotificationReaderService {
        repository: repo.clone(),
        queue: queue.clone(),
        sns_endpoint: MockSnsEndpoint,
        platform_config: test_platform_config(),
        realtime: crate::domain::ports::NoopNotificationRealtimePublisher,
    };

    service
        .update_notifications(UpdateNotificationsRequest {
            user_id: user,
            notification_ids: &[owned_id, other_id],
            status: NotificationStatus::Seen,
        })
        .await
        .unwrap();

    let published = queue.get_published();
    if !cfg!(feature = "clear_ios_push") {
        assert!(repo.basic_notification_calls.lock().unwrap().is_empty());
        assert!(published.is_empty());
        return;
    }
    assert_eq!(
        repo.basic_notification_calls.lock().unwrap().as_slice(),
        [vec![owned_id]]
    );
    assert_eq!(published.len(), 1);
    assert_eq!(
        published[0]["content"]["Ios"]["notif"]["identifier"],
        "owned"
    );
}

#[tokio::test]
async fn no_owned_rows_skips_push_lookup_and_publication() {
    let user = test_user_id("no-owned-clears@example.com");
    let id = Uuid::now_v7();
    let repo = Arc::new(
        MockRepository::new()
            .with_updated_notifications(vec![])
            .with_basic_notification(id, "other-user".to_string())
            .with_device_endpoint(
                user.clone(),
                DeviceEndpoint::Ios("ios-endpoint".to_string()),
            ),
    );
    let queue = Arc::new(MockQueue::new());
    let service = NotificationReaderService {
        repository: repo.clone(),
        queue: queue.clone(),
        sns_endpoint: MockSnsEndpoint,
        platform_config: test_platform_config(),
        realtime: crate::domain::ports::NoopNotificationRealtimePublisher,
    };

    service
        .update_notifications(UpdateNotificationsRequest {
            user_id: user,
            notification_ids: &[id],
            status: NotificationStatus::Seen,
        })
        .await
        .unwrap();

    assert!(repo.basic_notification_calls.lock().unwrap().is_empty());
    assert!(queue.get_published().is_empty());
}
