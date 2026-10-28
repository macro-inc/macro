use super::*;

#[tokio::test]
async fn options_batch_passes_caller_and_verified_team_to_one_repository_read() {
    let ids = vec![Uuid::from_u128(1), Uuid::from_u128(2)];
    let expected_ids = ids.clone();
    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_visible_property_options_batch()
        .times(1)
        .withf(move |ids, user, team| {
            ids == expected_ids && user == &caller_user_id() && *team == Some(team_id())
        })
        .returning(|_, _, _| {
            Box::pin(async { Ok(HashMap::from([(Uuid::from_u128(1), Vec::new())])) })
        });
    let service = service_with_event_broker(repo, RecordingEventBroker::default());
    let options = service
        .get_property_options_batch(&ids, &caller_user_id(), Some(&team_receipt()))
        .await
        .unwrap();
    assert_eq!(options.len(), 1);
    assert!(options[&ids[0]].is_empty());
    assert!(!options.contains_key(&ids[1]));
}

#[tokio::test]
async fn options_batch_propagates_repository_failure_without_a_team() {
    let mut repo = MockPropertiesRepo::new();
    repo.expect_get_visible_property_options_batch()
        .times(1)
        .withf(|_, user, team| user == &caller_user_id() && team.is_none())
        .returning(|_, _, _| Box::pin(async { Err(anyhow!("options unavailable")) }));
    let service = service_with_event_broker(repo, RecordingEventBroker::default());
    assert!(
        service
            .get_property_options_batch(&[Uuid::from_u128(1)], &caller_user_id(), None)
            .await
            .is_err()
    );
}
