use super::*;

#[tokio::test]
async fn document_only_soup_never_calls_excluded_entity_services() {
    let nil = Uuid::nil().to_string();
    let document_id = Uuid::from_u128(1);
    let filters: EntityFilters = serde_json::from_value(serde_json::json!({
        "document_filters": { "document_ids": [document_id] },
        "email_filters": { "email_thread_ids": [nil] },
        "channel_filters": { "channel_ids": [nil] },
        "channel_thread_filters": { "thread_ids": [nil] },
        "call_filters": { "call_ids": [nil] },
        "foreign_entity_filters": { "ids": [nil] }
    }))
    .unwrap();
    let emails = RecordingEmailPreviewService::default();
    let channels = RecordingCommsService::new(Vec::new());
    let calls = RecordingCallRecordQueryService::new(Vec::new());
    let foreign_entities = RecordingForeignEntityService::new(Vec::new());
    let mut soup = MockSoupRepo::new();
    soup.expect_unexpanded_generic_cursor_soup()
        .times(1)
        .returning(move |_| {
            Box::pin(async move {
                Ok(vec![SoupItem::Document(soup_document_uuid_with_updated(
                    document_id,
                    DateTime::default(),
                ))])
            })
        });

    let page = SoupImpl::new(
        soup,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        emails.clone(),
        channels.clone(),
        calls.clone(),
        NoOpCrmService,
        foreign_entities.clone(),
        NoOpRemindersService,
    )
    .get_user_soup(
        SoupRequest {
            soup_type: SoupType::UnExpanded,
            limit: 50,
            cursor: SoupQuery::new_sort_simple(SimpleSortMethod::UpdatedAt, filters),
            sort_direction: SoupSortDirection::Desc,
            user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
            email_preview_view: PreviewView::default(),
            link_ids: vec![Uuid::from_u128(2)],
        },
        None,
    )
    .await
    .unwrap()
    .into_simple()
    .unwrap();

    assert_eq!(page.items.len(), 1);
    assert_matches!(&page.items[0], SoupItem::Document(doc) => {
        assert_eq!(doc.id, document_id);
    });
    assert!(emails.requests.lock().unwrap().is_empty());
    assert_eq!(channels.channel_calls(), 0);
    assert!(channels.thread_filters().is_empty());
    assert_eq!(calls.calls(), 0);
    assert!(foreign_entities.calls().is_empty());
}
