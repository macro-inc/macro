use super::super::favorites::FavoriteReader;
use super::*;

struct ViewerFavorites;

impl FavoriteReader for ViewerFavorites {
    fn read<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
    ) -> std::pin::Pin<
        Box<dyn Future<Output = Result<Vec<model_entity::Entity<'static>>, SoupErr>> + Send + 'a>,
    > {
        assert_eq!(user.as_ref(), "macro|test@example.com");
        Box::pin(async {
            Ok(vec![
                EntityType::Document.with_entity_string(Uuid::from_u128(1).to_string()),
            ])
        })
    }
}

#[tokio::test]
async fn favorites_are_scoped_before_pagination_and_cursor_keeps_the_filter() {
    let mut repo = MockSoupRepo::new();
    repo.expect_unexpanded_generic_cursor_soup()
        .times(1)
        .returning(|request| {
            assert_eq!(request.user_id.as_ref(), "macro|test@example.com");
            assert_eq!(request.limit, 1);
            let SimpleSortQuery::ItemsFilter(query) = request.cursor else {
                panic!("filtered query")
            };
            let filter = query.filter();
            assert_eq!(filter.favorites_only, None);
            assert_matches!(filter.document_filter.as_deref().unwrap(),
                Expr::Literal(item_filters::ast::document::DocumentLiteral::Id(id)) => {
                    assert_eq!(*id, Uuid::from_u128(1));
                }
            );
            Box::pin(async {
                Ok(vec![SoupItem::Document(soup_document_uuid_with_updated(
                    Uuid::from_u128(1),
                    DateTime::default(),
                ))])
            })
        });
    let mut service = SoupImpl::new(
        repo,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopPullRequestListing,
    );
    service.favorites = Some(Arc::new(ViewerFavorites));
    let filters = EntityFilterAst {
        favorites_only: Some(true),
        ..Default::default()
    };
    let page = service
        .get_user_soup(
            SoupRequest {
                soup_type: SoupType::UnExpanded,
                limit: 1,
                cursor: SoupQuery::new_sort_simple(SimpleSortMethod::UpdatedAt, filters.clone()),
                sort_direction: SoupSortDirection::Desc,
                user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
                email_preview_view: PreviewView::default(),
                link_ids: vec![],
            },
            None,
        )
        .await
        .unwrap()
        .into_simple()
        .unwrap();
    assert_eq!(page.items.len(), 1);
    let cursor: CursorWithValAndFilter<String, SimpleSortMethod, EntityFilterAst> =
        page.next_cursor.unwrap().decode_json().unwrap();
    assert_eq!(
        serde_json::to_value(cursor.filter).unwrap(),
        serde_json::to_value(filters).unwrap()
    );
}
