use macro_user_id::cowlike::CowLike as _;
use wiremock::matchers::{body_json, header, method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

use super::*;

const OWNER: &str = "macro|owner@example.com";

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(OWNER).unwrap().into_owned()
}

#[test]
fn a_writer_is_told_its_effort_and_thinking_only_where_its_model_takes_them() {
    assert_eq!(
        model_params("anthropic/claude-sonnet-5-5", Some(Effort::Low), false),
        Some(json!({ "output_config": { "effort": "low" } }))
    );
    assert_eq!(
        model_params("anthropic/claude-sonnet-5-5", Some(Effort::Medium), true),
        Some(json!({
            "thinking": { "type": "adaptive" },
            "output_config": { "effort": "medium" }
        }))
    );
    assert_eq!(
        model_params("anthropic/claude-haiku-4-5", Some(Effort::Low), true),
        Some(json!({ "thinking": { "type": "enabled", "budget_tokens": 4_000 } }))
    );
    assert_eq!(
        model_params("openai/gpt-5.5", Some(Effort::Low), true),
        Some(json!({ "reasoning": { "effort": "low" } }))
    );
    assert_eq!(model_params("anthropic/claude-haiku-4-5", Some(Effort::Low), false), None);
    assert_eq!(model_params("anthropic/claude-sonnet-5-5", None, false), None);
}

#[tokio::test]
async fn names_are_looked_up_in_document_storage_as_the_owner() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/search/names"))
        .and(header(INTERNAL_API_KEY_HEADER, "internal"))
        .and(header(INTERNAL_MACRO_USER_ID_HEADER, OWNER))
        .and(body_json(json!({
            "names": [
                { "name": "Finance", "kinds": ["label"] },
                { "name": "urgent", "kinds": ["tag", "channel_label"] }
            ]
        })))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "results": [
                {
                    "name": "Finance",
                    "matches": [
                        { "name": "Finance", "exact": true, "item": { "kind": "label", "id": "l1" } }
                    ]
                },
                {
                    "name": "urgent",
                    "matches": [{
                        "name": "Urgent",
                        "exact": true,
                        "item": { "kind": "tag", "id": "t1", "definitionId": "d1" }
                    }]
                }
            ],
            "unavailable": ["agent"]
        })))
        .expect(1)
        .mount(&server)
        .await;
    let names = DocumentStorageNames::new(&format!("{}/", server.uri()), "internal".to_owned())
        .unwrap();

    let answers = names
        .look_up(
            &owner(),
            &[
                NameAsked {
                    name: "Finance".to_owned(),
                    kinds: vec![ItemKind::Label],
                },
                NameAsked {
                    name: "urgent".to_owned(),
                    kinds: vec![ItemKind::Tag, ItemKind::ChannelLabel],
                },
            ],
        )
        .await
        .unwrap();

    assert_eq!(
        answers,
        vec![
            NameAnswer {
                name: "Finance".to_owned(),
                matches: vec![NameMatch {
                    name: "Finance".to_owned(),
                    exact: true,
                    kind: ItemKind::Label,
                    id: "l1".to_owned(),
                    definition_id: None,
                }],
            },
            NameAnswer {
                name: "urgent".to_owned(),
                matches: vec![NameMatch {
                    name: "Urgent".to_owned(),
                    exact: true,
                    kind: ItemKind::Tag,
                    id: "t1".to_owned(),
                    definition_id: Some("d1".to_owned()),
                }],
            },
        ]
    );
}

#[tokio::test]
async fn a_refused_lookup_is_an_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/search/names"))
        .respond_with(ResponseTemplate::new(500))
        .mount(&server)
        .await;
    let names = DocumentStorageNames::new(&server.uri(), "internal".to_owned()).unwrap();

    let looked_up = names
        .look_up(
            &owner(),
            &[NameAsked {
                name: "Finance".to_owned(),
                kinds: Vec::new(),
            }],
        )
        .await;

    assert!(looked_up.is_err());
}
