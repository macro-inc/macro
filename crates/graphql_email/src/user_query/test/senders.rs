use super::*;

#[tokio::test]
async fn aliases_are_lazy_and_use_the_authenticated_viewer() {
    let service = Arc::new(FakeEmailUserService::default());
    let schema = Schema::build(
        GraphqlEmailQuery::new(service.clone(), user_id()),
        EmptyMutation,
        EmptySubscription,
    )
    .finish();
    let response = schema.execute("{ emailLinks { id } }").await;
    assert!(response.errors.is_empty());
    assert_eq!(
        service.requested_users.lock().unwrap().len(),
        1,
        "the unselected sender field must not call the provider"
    );
    service.requested_users.lock().unwrap().clear();
    let response = schema
        .execute("{ emailLinks { id sendAs { emailAddress displayName } } }")
        .await;
    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data.into_json().unwrap()["emailLinks"][0]["sendAs"],
        serde_json::json!([
            { "emailAddress": "alias@example.com", "displayName": "Alias" }
        ])
    );
    assert_eq!(
        *service.requested_users.lock().unwrap(),
        vec![user_id(), user_id()]
    );
}

#[tokio::test]
async fn one_bad_grant_does_not_hide_other_aliases_or_inboxes() {
    let service = Arc::new(FakeEmailUserService {
        unavailable_inbox: true,
        ..Default::default()
    });
    let schema = Schema::build(
        GraphqlEmailQuery::new(service, user_id()),
        EmptyMutation,
        EmptySubscription,
    )
    .finish();
    let response = schema
        .execute("{ emailLinks { id emailAddress sendAs { emailAddress } } }")
        .await;
    assert_eq!(response.errors.len(), 1);
    assert_eq!(
        response.errors[0].extensions.as_ref().unwrap().get("code"),
        Some(&async_graphql::Value::from("NEEDS_REAUTH"))
    );
    let data = response.data.into_json().unwrap();
    assert_eq!(data["emailLinks"].as_array().unwrap().len(), 2);
    assert_eq!(
        data["emailLinks"][0]["sendAs"][0]["emailAddress"],
        "alias@example.com"
    );
    assert!(data["emailLinks"][1]["sendAs"].is_null());
    assert!(data["emailLinks"][1]["emailAddress"].is_string());
}
