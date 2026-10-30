use super::*;
use entity_access::domain::models::{AccessLevel, Entity as AccessEntity, EntityPermission};
use models_soup::initiative::SoupInitiative;

fn receipt(
    viewer: Option<&str>,
    entity_type: EntityType,
    entity_id: Uuid,
) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::try_new_for_user(
        viewer.map(|user| MacroUserIdStr::parse_from_str(user).unwrap().into_owned()),
        AccessEntity {
            entity_id: entity_id.to_string(),
            entity_type,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap()
}

fn service(
    soup_mock: MockSoupRepo,
    pull_requests: RecordingPullRequestListing,
) -> impl SoupService {
    SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        pull_requests,
    )
}

#[tokio::test]
async fn a_caller_with_no_account_hydrates_without_viewer_state_or_pull_requests() {
    let initiative_id = Uuid::now_v7();
    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_expanded_viewable_by_ids()
        .times(1)
        .returning(move |viewer, entities| {
            assert_eq!(viewer, None, "no account means no viewer columns");
            assert_eq!(
                entities,
                [EntityType::Initiative.with_entity_string(initiative_id.to_string())]
            );
            Box::pin(async move {
                Ok(vec![SoupItem::Initiative(SoupInitiative {
                    id: initiative_id,
                    name: "Launch".to_owned(),
                    owner_id: Owner::User(
                        MacroUserIdStr::parse_from_str("macro|owner@example.com").unwrap(),
                    ),
                    created_at: Utc::now(),
                    updated_at: Utc::now(),
                    viewed_at: None,
                    extra: (),
                })])
            })
        });
    let pull_requests = RecordingPullRequestListing::new(Vec::new());

    let items = service(soup_mock, pull_requests.clone())
        .get_viewable_items(
            vec![receipt(None, EntityType::Initiative, initiative_id)],
            None,
        )
        .await
        .unwrap();

    assert_eq!(items.len(), 1);
    assert!(pull_requests.calls().is_empty());
}

#[tokio::test]
async fn receipts_for_different_viewers_are_refused() {
    let mut soup_mock = MockSoupRepo::new();
    soup_mock.expect_expanded_viewable_by_ids().never();

    let result = service(soup_mock, RecordingPullRequestListing::new(Vec::new()))
        .get_viewable_items(
            vec![
                receipt(
                    Some("macro|one@example.com"),
                    EntityType::Initiative,
                    Uuid::now_v7(),
                ),
                receipt(None, EntityType::AgentSession, Uuid::now_v7()),
            ],
            None,
        )
        .await;

    assert!(result.is_err());
}
