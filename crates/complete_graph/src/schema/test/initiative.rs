use super::*;

async fn execute_initiative_query(harness: &TestHarness, query: &str) -> async_graphql::Response {
    let viewer = MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap();
    harness
        .schema
        .execute(
            harness
                .request(query, authenticated_parts())
                .data(viewer)
                .data(graphql_initiative::InitiativeEntityLoader(
                    graphql_soup::soup_item_loader(
                        harness.soup_service.clone(),
                        Arc::new(harness.email_service.clone()),
                    ),
                )),
        )
        .await
}

#[tokio::test]
async fn initiative_soup_and_detail_queries_share_identity_without_loading_domain_details() {
    let harness = harness();
    let id = Uuid::from_u128(42);
    harness
        .soup_service
        .set_raw_response(vec![soup_initiative(id)]);
    // No initiative domain context/loaders are installed. Selecting the shared
    // Soup fields must still work for both collection and individual queries.
    let response = execute_initiative_query(&harness, &format!(
        r#"{{ user {{
            soup(input: {{initial: {{filters: {{initiativeFilter: {{literal: {{include: true}}}}}}}}}}) {{
                items {{ __typename id displayName metadata {{ ownerId createdAt updatedAt }} }}
            }}
            initiative(initiativeId: "{id}") {{
                __typename id displayName metadata {{ ownerId createdAt updatedAt }}
            }}
        }} }}"#
    )).await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    let data = response.data.into_json().unwrap();
    assert_eq!(data["user"]["soup"]["items"][0], data["user"]["initiative"]);
    assert_eq!(
        data["user"]["initiative"]["__typename"],
        "GraphqlSoupInitiative"
    );
    assert_eq!(data["user"]["initiative"]["id"], id.to_string());
}

#[tokio::test]
async fn initiative_detail_query_does_not_expose_a_project_missing_from_authorized_soup() {
    let harness = harness();
    harness.soup_service.set_raw_response(Vec::new());
    let response = execute_initiative_query(
        &harness,
        &format!(
            r#"{{ user {{ initiative(initiativeId: "{}") {{ id displayName }} }} }}"#,
            Uuid::from_u128(42)
        ),
    )
    .await;
    assert_eq!(response.errors.len(), 1);
    assert_eq!(response.errors[0].message, "initiative not found");
    assert_eq!(
        response.errors[0].extensions.as_ref().unwrap().get("code"),
        Some(&async_graphql::Value::from("NOT_FOUND"))
    );
    assert_eq!(harness.raw_soup_calls.load(Ordering::SeqCst), 1);
}
