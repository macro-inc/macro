use super::*;
use crate::outbound::outlook::test::setup;
use wiremock::{
    Mock, ResponseTemplate,
    matchers::{body_json, method, path, query_param},
};

fn rule(id: &str, correlation: Uuid) -> Value {
    json!({"id":id,"displayName":format!("Macro block {correlation}"),"isEnabled":true,
        "conditions":{"fromAddresses":[{"emailAddress":{"address":"BLOCKED@example.com"}}],"subjectContains":[]},
        "actions":{"delete":true,"stopProcessingRules":true,"forwardTo":[]},"exceptions":{}})
}
#[tokio::test]
async fn rule_ownership_rejects_broadened_predicates_extra_actions_and_exceptions() {
    let (server, api, token) = setup().await;
    let id = Uuid::now_v7();
    let good = rule("owned", id);
    let mut changed = rule("changed", id);
    changed["conditions"]["subjectContains"] = json!(["invoice"]);
    let mut forwarded = rule("forwarded", id);
    forwarded["actions"]["forwardTo"] =
        json!([{"emailAddress":{"address":"elsewhere@example.com"}}]);
    let mut exception = rule("exception", id);
    exception["exceptions"] = json!({"hasAttachments":true});
    let mut unrelated = rule("unrelated", id);
    unrelated["displayName"] = json!("My Outlook rule");
    Mock::given(method("GET"))
        .and(path("/v1.0/me/mailFolders/inbox/messageRules"))
        .respond_with(
            ResponseTemplate::new(200)
                .set_body_json(json!({"value":[good,changed,forwarded,exception,unrelated]})),
        )
        .mount(&server)
        .await;
    let result = api.sender_rules(&token).await.unwrap();
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].id.as_str(), "owned");
    assert_eq!(result[0].sender, "blocked@example.com");
}
#[tokio::test]
async fn blocking_uses_exact_address_and_recoverable_trash_not_permanent_deletion() {
    let (server, api, token) = setup().await;
    let id = Uuid::now_v7();
    Mock::given(method("POST"))
        .and(path("/v1.0/me/mailFolders/inbox/messageRules"))
        .and(body_json(
            json!({"displayName":format!("Macro block {id}"),"sequence":1,"isEnabled":true,
            "conditions":{"fromAddresses":[{"emailAddress":{"address":"blocked@example.com"}}]},
            "actions":{"delete":true,"stopProcessingRules":true}}),
        ))
        .respond_with(ResponseTemplate::new(201).set_body_json(json!({"id":"created"})))
        .expect(1)
        .mount(&server)
        .await;
    assert_eq!(
        api.create_sender_rule(&token, id, "blocked@example.com")
            .await
            .unwrap()
            .as_str(),
        "created"
    );
}
#[tokio::test]
async fn category_cleanup_escapes_filter_and_keeps_etag_for_concurrent_edits() {
    let (server, api, token) = setup().await;
    Mock::given(method("GET")).and(path("/v1.0/me/messages"))
        .and(query_param("$filter","categories/any(c:c eq 'Owner''s category')")).and(query_param("$top","25"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"value":[{"id":"m","categories":["Owner's category","Keep"],"@odata.etag":"revision"}],"@odata.nextLink":"https://unused.invalid"})))
        .expect(1).mount(&server).await;
    let result = api
        .category_messages(&token, "Owner's category")
        .await
        .unwrap();
    assert_eq!(result[0].version.as_deref(), Some("revision"));
    assert_eq!(result[0].categories.len(), 2);
}
