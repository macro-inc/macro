use super::*;
use models_soup::database_row::SoupDatabaseRow;

#[tokio::test]
async fn a_row_of_a_named_table_comes_back_with_its_placement() {
    let harness = harness();
    harness
        .soup_service
        .set_raw_response(vec![SoupItem::DatabaseRow(SoupDatabaseRow {
            id: Uuid::from_u128(0x70000000_0000_0000_0000_000000000001),
            table_id: Uuid::from_u128(0x7ab00000_0000_0000_0000_000000000001),
            database_id: Uuid::from_u128(0xdb000000_0000_0000_0000_000000000001),
            position: "a".into(),
            owner_id: Owner::from_principal_str(VALID_USER_ID).unwrap(),
            created_by: Some(VALID_USER_ID.into()),
            created_at: "2026-01-01T00:00:00Z".parse().unwrap(),
            updated_at: "2026-01-02T00:00:00Z".parse().unwrap(),
            extra: (),
        })]);

    let response = harness
        .execute(
            r#"{ user { soup(input: {initial: {filters: {databaseRowFilter: {literal: {tableId: "7ab00000-0000-0000-0000-000000000001"}}}}}) {
                items {
                    __typename id entityType displayName
                    metadata { ownerId createdAt updatedAt }
                    properties { id }
                    ... on GraphqlSoupDatabaseRow {
                        tableId databaseId position ownerId creatorId createdAt updatedAt
                    }
                }
            } } }"#,
        )
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data,
        async_graphql::value!({ "user": { "soup": { "items": [{
            "__typename": "GraphqlSoupDatabaseRow",
            "id": "70000000-0000-0000-0000-000000000001",
            "entityType": "DATABASE_ROW",
            "displayName": null,
            "metadata": {
                "ownerId": VALID_USER_ID,
                "createdAt": "2026-01-01T00:00:00+00:00",
                "updatedAt": "2026-01-02T00:00:00+00:00"
            },
            "properties": [],
            "tableId": "7ab00000-0000-0000-0000-000000000001",
            "databaseId": "db000000-0000-0000-0000-000000000001",
            "position": "a",
            "ownerId": VALID_USER_ID,
            "creatorId": VALID_USER_ID,
            "createdAt": "2026-01-01T00:00:00+00:00",
            "updatedAt": "2026-01-02T00:00:00+00:00"
        }] } } })
    );
    assert_eq!(harness.raw_soup_calls.load(Ordering::SeqCst), 1);
}
