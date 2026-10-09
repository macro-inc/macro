use super::*;
use crate::domain::models::{
    WorkFeedCandidate, WorkFeedPagePosition, WorkFeedSoupMode, WorkFeedSoupRequest,
};

fn work_feed_request(limit: u16) -> WorkFeedSoupRequest {
    WorkFeedSoupRequest {
        user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        link_ids: vec![],
        limit,
        mode: WorkFeedSoupMode::Work,
        types: vec![EntityType::Document],
        filter: EntityFilterAst::default(),
        after: None,
        only: None,
    }
}

fn candidate(
    id: Uuid,
    attention: Option<DateTime<Utc>>,
    touched: Option<DateTime<Utc>>,
) -> WorkFeedCandidate {
    WorkFeedCandidate {
        entity: EntityType::Document.with_entity_string(id.to_string()),
        attention_at: attention,
        touched_at: touched,
        sort_at: attention.max(touched).unwrap(),
    }
}

fn service(
    soup_mock: MockSoupRepo,
) -> SoupImpl<
    MockSoupRepo,
    FrecencyQueryServiceImpl<MockFrecencyStorage>,
    NoopEmailPreviewService,
    RecordingCommsService,
    NoopCallRecordQueryService,
    NoOpCrmService,
    NoopPullRequestListing,
> {
    SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        RecordingCommsService::new(vec![]),
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopPullRequestListing,
    )
}

/// Hydration drops refill the page from the next candidate page, every item
/// keeps both reason timestamps, and the request's mode and types reach the
/// candidate query.
#[tokio::test]
async fn work_feed_refills_after_drops_and_carries_reason_timestamps() {
    let own = Uuid::from_u128(1);
    let ghost = Uuid::from_u128(2);
    let notified = Uuid::from_u128(3);
    let base: DateTime<Utc> = DateTime::default();

    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_work_feed_soup_page()
        .times(2)
        .returning(move |req| {
            assert_eq!(req.limit, 2);
            assert_eq!(req.mode, WorkFeedSoupMode::Work);
            assert_eq!(req.types, &[EntityType::Document]);
            assert!(req.only.is_none());
            let rows = match &req.after {
                None => vec![
                    candidate(own, Some(base + Days::new(1)), Some(base + Days::new(5))),
                    candidate(ghost, Some(base + Days::new(4)), None),
                ],
                Some(after) => {
                    assert_eq!(
                        *after,
                        WorkFeedPagePosition {
                            sort_at: base + Days::new(4),
                            entity_id: ghost.to_string(),
                        }
                    );
                    vec![candidate(notified, Some(base + Days::new(3)), None)]
                }
            };
            Box::pin(async move { Ok(rows) })
        });
    soup_mock
        .expect_expanded_soup_by_ids_with_projection()
        .times(2)
        .returning(move |params| {
            let items = params
                .entities
                .iter()
                .filter_map(|entity| {
                    let id = Uuid::parse_str(&entity.entity_id).unwrap();
                    (id != ghost).then(|| SoupProjectionHydration {
                        item: SoupItem::Document(soup_document_uuid_with_updated(
                            id,
                            Default::default(),
                        )),
                        document_server_facts: None,
                    })
                })
                .collect();
            Box::pin(async move { Ok(items) })
        });

    let page = service(soup_mock)
        .get_work_feed_page(work_feed_request(2), None)
        .await
        .unwrap();

    let items: Vec<_> = page
        .items
        .iter()
        .map(|item| {
            (
                item.hydration.item.id(),
                item.attention_at,
                item.touched_at,
                item.sort_at,
            )
        })
        .collect();
    assert_eq!(
        items,
        vec![
            (
                own,
                Some(base + Days::new(1)),
                Some(base + Days::new(5)),
                base + Days::new(5)
            ),
            (
                notified,
                Some(base + Days::new(3)),
                None,
                base + Days::new(3)
            ),
        ]
    );
    // The second candidate page was short and fully consumed.
    assert!(page.next.is_none());
}

#[tokio::test]
async fn work_feed_full_page_continues_from_the_last_candidate() {
    let first = Uuid::from_u128(1);
    let second = Uuid::from_u128(2);
    let base: DateTime<Utc> = DateTime::default();

    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_work_feed_soup_page()
        .times(1)
        .returning(move |_| {
            Box::pin(async move {
                Ok(vec![
                    candidate(first, Some(base + Days::new(5)), None),
                    candidate(second, None, Some(base + Days::new(4))),
                ])
            })
        });
    soup_mock
        .expect_expanded_soup_by_ids_with_projection()
        .times(1)
        .returning(move |params| {
            let items = params
                .entities
                .iter()
                .map(|entity| SoupProjectionHydration {
                    item: SoupItem::Document(soup_document_uuid_with_updated(
                        Uuid::parse_str(&entity.entity_id).unwrap(),
                        Default::default(),
                    )),
                    document_server_facts: None,
                })
                .collect();
            Box::pin(async move { Ok(items) })
        });

    let page = service(soup_mock)
        .get_work_feed_page(work_feed_request(2), None)
        .await
        .unwrap();

    assert_eq!(page.items.len(), 2);
    assert_eq!(
        page.next,
        Some(WorkFeedPagePosition {
            sort_at: base + Days::new(4),
            entity_id: second.to_string(),
        })
    );
}

#[tokio::test]
async fn work_feed_rejects_calendar_filters_it_cannot_fold() {
    let mut soup_mock = MockSoupRepo::new();
    soup_mock.expect_work_feed_soup_page().times(0);
    let mut request = work_feed_request(2);
    request.filter.calendar_event_filter = Some(Arc::new(Expr::val(
        item_filters::ast::calendar_event::CalendarEventLiteral::Status("confirmed".into()),
    )));

    let error = service(soup_mock)
        .get_work_feed_page(request, None)
        .await
        .unwrap_err();
    assert_matches!(error, SoupErr::NotifiedUnsupportedFilter("calendar_event"));
}
