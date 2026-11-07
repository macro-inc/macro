use super::*;

/// The Soup query shape of clients built before reminders were removed
/// (#7536) and before project descriptions became surfaces (#7193). App Store
/// bundles keep sending it until the bundle updater replaces them.
#[tokio::test]
async fn soup_query_from_a_pre_removal_client_still_resolves() {
    let harness = harness();
    let initiative_id = Uuid::from_u128(0x1717);
    harness
        .soup_service
        .set_raw_response(vec![soup_initiative(initiative_id)]);

    let response = harness
        .execute(
            r#"query Soup($filters: GraphqlEntityFilterAst) {
                user { soup(input: {initial: {filters: $filters}}) {
                    items {
                        __typename id
                        ... on GraphqlSoupInitiative { descriptionDocumentId }
                        ... on GraphqlSoupReminder {
                            description scheduleType remindAt nextRunAt enabled
                            referencedEntity { id entityType }
                        }
                    }
                } }
            }"#,
        )
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data,
        async_graphql::value!({ "user": { "soup": { "items": [{
            "__typename": "GraphqlSoupInitiative",
            "id": initiative_id.to_string(),
            "descriptionDocumentId": null
        }] } } })
    );

    let with_reminder_filter = harness
        .schema
        .execute(
            harness
                .request(
                    r#"query Soup($filters: GraphqlEntityFilterAst) {
                        user { soup(input: {initial: {filters: $filters}}) { items { id } } }
                    }"#,
                    authenticated_parts(),
                )
                .variables(async_graphql::Variables::from_json(serde_json::json!({
                    "filters": { "reminderFilter": { "literal": { "include": true } } }
                }))),
        )
        .await;
    assert!(
        with_reminder_filter.errors.is_empty(),
        "{:?}",
        with_reminder_filter.errors
    );
}
