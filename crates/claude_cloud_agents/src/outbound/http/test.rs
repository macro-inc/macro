use super::*;

#[test]
fn direct_models_request_uses_oauth_and_pagination_without_session_beta() {
    let after = Model::parse("claude-fable-5-1").unwrap();
    let request = models_request(
        &reqwest::Client::new(),
        "test-token",
        "test-org",
        Some(&after),
    )
    .build()
    .unwrap();
    assert_eq!(request.method(), reqwest::Method::GET);
    assert_eq!(request.url().origin().ascii_serialization(), API);
    assert_eq!(request.url().path(), "/v1/models");
    assert_eq!(
        request.url().query_pairs().collect::<Vec<_>>(),
        vec![
            ("limit".into(), "1000".into()),
            ("after_id".into(), after.id().into())
        ]
    );
    assert_eq!(request.headers()["authorization"], "Bearer test-token");
    assert_eq!(request.headers()["x-organization-uuid"], "test-org");
    assert_eq!(request.headers()["anthropic-version"], "2023-06-01");
    assert!(!request.headers().contains_key("anthropic-beta"));
    assert!(request.body().is_none());
}

#[test]
fn direct_catalog_preserves_api_ids_names_order_and_next_cursor() {
    let (models, next) = model_page(json!({
        "data": [
            {"id":"claude-fable-5-1","display_name":"Claude Fable 5.1"},
            {"id":"brand-new-model","display_name":"New model"}
        ],
        "has_more":true,
        "last_id":"brand-new-model"
    }))
    .unwrap();
    assert_eq!(models[0].model.id(), "claude-fable-5-1");
    assert_eq!(models[0].name, "Claude Fable 5.1");
    assert_eq!(models[1].model.id(), "brand-new-model");
    assert_eq!(next.unwrap().id(), "brand-new-model");
    let (models, next) = model_page(json!({"data":[],"has_more":false})).unwrap();
    assert!(models.is_empty());
    assert!(next.is_none());
}

#[test]
fn malformed_catalogs_and_broken_pagination_fail_instead_of_truncating() {
    for response in [
        json!({}),
        json!({"data":[],"has_more":true,"last_id":"missing"}),
        json!({"data":[{"id":"model","display_name":"Model"}],"has_more":true}),
        json!({"data":[{"id":"model","display_name":"Model"}],"has_more":true,"last_id":"different"}),
        json!({"data":[{"id":"../model","display_name":"Model"}],"has_more":false}),
        json!({"data":[{"id":"model","display_name":" "}],"has_more":false}),
        json!({"data":[{"id":"model"}],"has_more":false}),
        json!({"data":[],"has_more":"false"}),
        json!({"data":vec![json!({"id":"model","display_name":"Model"}); MODEL_PAGE_SIZE + 1],"has_more":false}),
    ] {
        assert!(matches!(model_page(response), Err(Error::Protocol)));
    }
}

#[test]
fn model_and_prompt_are_serialized_in_one_ordered_batch() {
    let batch = event_batch(vec![
        json!({"type":"control_request","request":{"subtype":"set_model","model":"sonnet"}}),
        json!({"type":"user","message":{"content":"hello"}}),
    ]);
    assert_eq!(batch["events"].as_array().unwrap().len(), 2);
    assert_eq!(batch["events"][0]["payload"]["request"]["model"], "sonnet");
    assert_eq!(batch["events"][1]["payload"]["type"], "user");
}
