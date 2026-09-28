use super::super::test_support::*;
use super::*;
use serde_json::json;

#[tokio::test]
async fn pages_all_candidates_and_redelivery_deduplicates_using_owner_not_actor() {
    let repo = Arc::new(Repo::default());
    repo.0.lock().unwrap().configurations = (0..5).map(|_| configuration()).collect();
    let access = Arc::new(Access::default());
    let service = EventAdmissionService::new(repo.clone(), access.clone(), 2.try_into().unwrap());
    let event = incoming();
    assert_eq!(
        service.ingest(&event).await.unwrap(),
        EventIngestionResult::Admitted { inserted: 5 }
    );
    assert_eq!(repo.0.lock().unwrap().pages.len(), 4);
    assert_eq!(
        service.ingest(&event).await.unwrap(),
        EventIngestionResult::Admitted { inserted: 0 }
    );
    assert_eq!(repo.0.lock().unwrap().pending.len(), 5);
    assert!(
        access
            .calls
            .lock()
            .unwrap()
            .iter()
            .all(|owner| owner == &user())
    );
}

#[tokio::test]
async fn partial_fanout_failure_is_not_acknowledged_and_replay_is_safe() {
    let repo = Arc::new(Repo::default());
    repo.0.lock().unwrap().configurations = vec![configuration(), configuration()];
    repo.0.lock().unwrap().fail_page = Some(2);
    let service = EventAdmissionService::new(
        repo.clone(),
        Arc::new(Access::default()),
        1.try_into().unwrap(),
    );
    let event = incoming();
    assert!(service.ingest(&event).await.is_err());
    assert_eq!(repo.0.lock().unwrap().pending.len(), 1);
    assert_eq!(
        service.ingest(&event).await.unwrap(),
        EventIngestionResult::Admitted { inserted: 1 }
    );
    assert_eq!(repo.0.lock().unwrap().pending.len(), 2);
}

#[tokio::test]
async fn coarse_candidates_are_rechecked_before_access_or_admission() {
    let repo = Arc::new(Repo::default());
    let mut configs: Vec<_> = (0..5).map(|_| configuration()).collect();
    configs[0].enabled = false;
    configs[1].activated_at = Utc::now() + chrono::Duration::days(1);
    configs[2].filters =
        serde_json::from_value(json!([{"events":["document.updated"],"ids":[]}])).unwrap();
    configs[3].owner = Owner::Team(generate_uuid_v7());
    configs[4].owner =
        Owner::from_principal_str("bot|01900000-0000-7000-8000-000000000004").unwrap();
    repo.0.lock().unwrap().configurations = configs;
    let access = Arc::new(Access::default());
    let service = EventAdmissionService::new(repo, access.clone(), 100.try_into().unwrap());
    assert_eq!(
        service.ingest(&incoming()).await.unwrap(),
        EventIngestionResult::Admitted { inserted: 0 }
    );
    assert!(access.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn permanent_rejections_do_not_query_candidates() {
    let repo = Arc::new(Repo::default());
    let service = EventAdmissionService::new(
        repo.clone(),
        Arc::new(Access::default()),
        10.try_into().unwrap(),
    );
    let mut event = incoming();
    event.schema_version = 2;
    assert_eq!(
        service.ingest(&event).await.unwrap(),
        EventIngestionResult::Rejected(EventRejection::UnsupportedSchema)
    );
    event.schema_version = 1;
    let super::super::super::event_trigger::EventPayload::Document(ref mut payload) = event.payload
    else {
        unreachable!()
    };
    *payload = serde_json::from_value(json!({"event_type":"document.updated", "metadata": {
        "document_id":generate_uuid_v7(),"share_permission_updated":false,
        "actor":"bot|01900000-0000-7000-8000-000000000004",
        "actor_user_id":"macro|event-actor@macro.com", "owner":"macro|event-actor@macro.com"
    }}))
    .unwrap();
    assert_eq!(
        service.ingest(&event).await.unwrap(),
        EventIngestionResult::Rejected(EventRejection::UnsafeAttribution)
    );
    assert!(repo.0.lock().unwrap().pages.is_empty());
}

#[tokio::test]
async fn denied_and_mismatched_receipts_skip_but_unavailable_access_defers_intake() {
    let repo = Arc::new(Repo::default());
    repo.0.lock().unwrap().configurations.push(configuration());
    let access = Arc::new(Access::default());
    let service = EventAdmissionService::new(repo.clone(), access.clone(), 10.try_into().unwrap());
    *access.denied.lock().unwrap() = true;
    assert_eq!(
        service.ingest(&incoming()).await.unwrap(),
        EventIngestionResult::Admitted { inserted: 0 }
    );
    *access.denied.lock().unwrap() = false;
    *access.override_receipt.lock().unwrap() =
        Some(capability(user(), &incoming().normalize().unwrap()));
    assert_eq!(
        service.ingest(&incoming()).await.unwrap(),
        EventIngestionResult::Admitted { inserted: 0 }
    );
    *access.unavailable.lock().unwrap() = true;
    assert!(service.ingest(&incoming()).await.is_err());
    assert!(repo.0.lock().unwrap().pending.is_empty());
}
