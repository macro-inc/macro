use databases_sql::view_rows::{ViewPageError, ViewRowsPage, ViewRowsRequest, ViewRowsService};
use models_databases::{
    RowId, TableVersion,
    views::{FilterNode, FilterTest, NumberOperator, SortDirection},
};
use models_soup::database_row::SoupDatabaseRow;

use super::*;

struct ViewRows(Arc<AtomicUsize>);

impl ViewRowsService for ViewRows {
    async fn page(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        request: ViewRowsRequest,
    ) -> Result<ViewRowsPage, ViewPageError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        assert_eq!(
            receipt.entity().entity_id,
            database_activity::VIEWABLE_DATABASE_ID
        );
        assert_eq!(request.limit, 500);
        assert_eq!(request.query.sort[0].direction, SortDirection::Descending);
        let FilterNode::Condition(condition) =
            &request.query.filter.as_ref().unwrap().conditions[0]
        else {
            panic!("expected a condition")
        };
        assert_eq!(
            condition.test,
            FilterTest::Number {
                operator: NumberOperator::GreaterThan,
                value: 25.0
            }
        );
        Ok(ViewRowsPage {
            rows: vec![
                RowId::from_uuid(Uuid::from_u128(2)),
                RowId::from_uuid(Uuid::from_u128(1)),
            ],
            next_cursor: Some("next-page".into()),
            version: TableVersion(7),
        })
    }
}

fn query(database: &str) -> String {
    format!(
        r#"{{ user {{ id databaseViewRows(databaseId: "{database}", input: {{tableId: "00000000-0000-0000-0000-000000000003", query: {{filter: {{conjunction: AND, conditions: [{{condition: {{column: "00000000-0000-0000-0000-000000000004", test: {{number: {{operator: GREATER_THAN, value: 25}}}}}}}}]}}, sort: [{{column: "00000000-0000-0000-0000-000000000004", direction: DESCENDING}}]}}}}) {{ items {{ __typename id tableId }} nextCursor version }} }} }}"#
    )
}

async fn execute(
    harness: &TestHarness,
    database: &str,
    calls: Arc<AtomicUsize>,
) -> async_graphql::Response {
    let context = graphql_databases::DatabaseRowsGraphqlContext::new(
        ViewRows(calls),
        harness.state.entity_access.clone(),
        graphql_soup::soup_item_loader(
            harness.soup_service.clone(),
            Arc::new(harness.email_service.clone()),
        ),
    );
    harness
        .schema
        .execute(
            harness
                .request(&query(database), authenticated_parts())
                .data(MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap())
                .data(context),
        )
        .await
}

#[tokio::test]
async fn view_pages_return_shared_row_entities_in_the_service_order() {
    let harness = harness();
    harness.soup_service.set_raw_response(
        [1, 2]
            .into_iter()
            .map(|id| {
                SoupItem::DatabaseRow(SoupDatabaseRow {
                    id: Uuid::from_u128(id),
                    table_id: Uuid::from_u128(3),
                    database_id: database_activity::VIEWABLE_DATABASE_ID.parse().unwrap(),
                    position: id.to_string(),
                    owner_id: Owner::from_principal_str(VALID_USER_ID).unwrap(),
                    created_by: None,
                    created_at: "2026-01-01T00:00:00Z".parse().unwrap(),
                    updated_at: "2026-01-01T00:00:00Z".parse().unwrap(),
                    extra: (),
                })
            })
            .collect(),
    );
    let calls = Arc::new(AtomicUsize::new(0));
    let response = execute(
        &harness,
        database_activity::VIEWABLE_DATABASE_ID,
        calls.clone(),
    )
    .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data,
        async_graphql::value!({ "user": { "id": VALID_USER_ID, "databaseViewRows": {
        "items": [
            { "__typename": "GraphqlSoupDatabaseRow", "id": "00000000-0000-0000-0000-000000000002", "tableId": "00000000-0000-0000-0000-000000000003" },
            { "__typename": "GraphqlSoupDatabaseRow", "id": "00000000-0000-0000-0000-000000000001", "tableId": "00000000-0000-0000-0000-000000000003" }
        ], "nextCursor": "next-page", "version": 7
    } } })
    );
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    assert_eq!(harness.raw_soup_calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn a_denied_database_never_reaches_the_view_reader() {
    let harness = harness();
    let calls = Arc::new(AtomicUsize::new(0));
    let response = execute(
        &harness,
        "0199a000-0000-7000-8000-00000000d1d1",
        calls.clone(),
    )
    .await;
    assert_eq!(response.errors.len(), 1);
    assert_eq!(response.errors[0].message, "not found");
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert_eq!(harness.raw_soup_calls.load(Ordering::SeqCst), 0);
}
