use super::super::project_scope::ProjectViewer;
use super::*;
use item_filters::ast::properties::{EntityRefId, PropertiesLiteral, PropertyMatchValue};
use system_properties::SystemPropertyKey;

const PROJECT: Uuid = Uuid::from_u128(7);

/// Answers the access check for [`PROJECT`] with `can_view`.
struct Projects {
    can_view: bool,
}

impl ProjectViewer for Projects {
    fn can_view<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'_>,
        project: Uuid,
    ) -> std::pin::Pin<Box<dyn Future<Output = Result<bool, SoupErr>> + Send + 'a>> {
        assert_eq!(user.as_ref(), "macro|test@example.com");
        assert_eq!(project, PROJECT);
        let can_view = self.can_view;
        Box::pin(async move { Ok(can_view) })
    }
}

/// Lists one project's tasks and returns the viewable project the repository
/// was asked to list with.
async fn listed_with(can_view: bool) -> Option<Uuid> {
    let seen = Arc::new(Mutex::new(None));
    let mut repo = MockSoupRepo::new();
    let record = seen.clone();
    repo.expect_expanded_generic_cursor_soup()
        .times(1)
        .returning(move |request| {
            let SimpleSortQuery::ItemsFilter(query) = request.cursor else {
                panic!("filtered query")
            };
            *record.lock().unwrap() = Some(query.filter().viewable_project);
            Box::pin(async { Ok(vec![]) })
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
    service.projects = Some(Arc::new(Projects { can_view }));
    let filters = EntityFilterAst {
        properties_filter: Some(Arc::new(Expr::Literal(PropertiesLiteral {
            property_definition_id: SystemPropertyKey::PROJECT_UUID,
            entity_type: None,
            value: PropertyMatchValue::EntityRef(EntityRefId::new(PROJECT.to_string()).unwrap()),
        }))),
        ..Default::default()
    };
    service
        .get_user_soup(
            SoupRequest {
                soup_type: SoupType::Expanded,
                limit: 10,
                cursor: SoupQuery::new_sort_simple(SimpleSortMethod::UpdatedAt, filters),
                sort_direction: SoupSortDirection::Desc,
                user: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
                email_preview_view: PreviewView::default(),
                link_ids: vec![],
            },
            None,
        )
        .await
        .unwrap();
    seen.lock().unwrap().expect("the repository was asked")
}

#[tokio::test]
async fn a_viewer_of_the_project_lists_its_tasks() {
    assert_eq!(listed_with(true).await, Some(PROJECT));
}

#[tokio::test]
async fn a_caller_who_cannot_view_the_project_lists_only_their_own_tasks() {
    assert_eq!(listed_with(false).await, None);
}
