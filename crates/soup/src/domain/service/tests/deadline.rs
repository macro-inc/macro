use super::*;
use models_grouping::DeadlineBoundaries;

#[tokio::test]
async fn timestamp_sorted_deadline_groups_reach_the_repository() {
    let mut repo = MockSoupRepo::new();
    repo.expect_expanded_grouped_cursor_soup()
        .times(1)
        .withf(|request| {
            matches!(request.grouping.field, GroupByField::Deadline { .. })
                && matches!(
                    request.cursor.sort_method(),
                    SimpleSortMethod::ViewedUpdated
                )
                && request.grouping.per_group_limit == Some(25)
        })
        .returning(|_| Box::pin(async { Ok(Vec::<ItemGroupingInfo>::new().into_iter()) }));
    let service = SoupImpl::new(
        repo,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopPullRequestListing,
    );
    let request = GroupedSortRequest::initial(
        MacroUserIdStr::parse_from_str("macro|viewer@example.com").unwrap(),
        25,
        SimpleSortMethod::ViewedUpdated,
        EntityFilterAst::mock_empty(),
        GroupingConfig {
            field: GroupByField::Deadline {
                boundaries: DeadlineBoundaries {
                    today: "2026-03-08T05:00:00Z".parse().unwrap(),
                    tomorrow: "2026-03-09T04:00:00Z".parse().unwrap(),
                    day_two: "2026-03-10T04:00:00Z".parse().unwrap(),
                    day_eight: "2026-03-16T04:00:00Z".parse().unwrap(),
                },
            },
            group_key: None,
            per_group_limit: Some(25),
        },
    );
    let items = service
        .get_user_soup_grouped(request)
        .await
        .unwrap()
        .collect::<Vec<_>>();
    assert!(items.is_empty());
}
