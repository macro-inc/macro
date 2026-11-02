use super::*;
use ai_usage::{AiFeature, UsageEvent};
use serde_json::json;
use std::sync::Mutex;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{header, method, path},
};

const ACCOUNT: &str = "0123456789abcdef0123456789abcdef";

#[derive(Default)]
struct Recorder(Mutex<Vec<UsageEvent>>);
impl UsageRecorder for Recorder {
    fn record(&self, event: UsageEvent) {
        self.0.lock().unwrap().push(event);
    }
}

fn input(intent: InputIntent, text: &str) -> ExtractInputRequest {
    ExtractInputRequest {
        text: text.into(),
        intent,
        revision: 9,
        reference_time: "2026-10-24T01:00:00Z".parse().unwrap(),
        time_zone: "America/Los_Angeles".into(),
        search_type: None,
        property_definitions: vec![],
    }
}
fn answer(kind: &str, value: Value) -> Value {
    json!({"type": kind, "value": value, "confidence": 0.99, "p_null": 0.01})
}
fn response(mut answers: Value) -> Value {
    if answers.get("subject").is_some() {
        let fields = answers.as_object_mut().unwrap();
        for field in ["cc", "bcc"] {
            fields
                .entry(field)
                .or_insert_with(|| answer("list", json!([])));
        }
    }
    if answers.get("query").is_some() {
        let fields = answers.as_object_mut().unwrap();
        fields
            .entry("search_scope")
            .or_insert_with(|| answer("text", Value::Null));
        fields
            .entry("from")
            .or_insert_with(|| answer("list", json!([])));
        fields
            .entry("in")
            .or_insert_with(|| answer("list", json!([])));
    }
    if answers.get("start").is_some() {
        answers
            .as_object_mut()
            .unwrap()
            .entry("start_assumption")
            .or_insert_with(|| answer("text", Value::Null));
    }
    json!({"success": true, "errors": [], "result": {"model": "clairic", "answers": answers, "truncated": false, "usage": {"input_tokens": 234, "output_tokens": 0}}})
}
async fn provider(body: Value) -> (MockServer, ClairicFieldExtractor, Arc<Recorder>) {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path(format!("/accounts/{ACCOUNT}/ai/run/{MODEL}")))
        .and(header("authorization", "Bearer test-token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(body))
        .expect(1)
        .mount(&server)
        .await;
    let recorder = Arc::new(Recorder::default());
    let extractor = ClairicFieldExtractor::with_base_url(
        ACCOUNT,
        "test-token",
        recorder.clone(),
        &server.uri(),
    )
    .unwrap();
    (server, extractor, recorder)
}
fn usage() -> UsageContext {
    UsageContext::system(AiFeature::DynamicCompletionsApi)
}

#[tokio::test]
async fn search_type_selection_requests_no_filters_or_query() {
    let (server, extractor, recorder) = provider(response(json!({
        "search_scope": answer("text", json!("tasks"))
    })))
    .await;
    let selected = extractor
        .select_search_type(
            &input(
                InputIntent::Search,
                "search high priority tasks assigned to Person A",
            ),
            usage(),
        )
        .await
        .unwrap();
    assert_eq!(selected, SearchType::Task);
    let requests = server.received_requests().await.unwrap();
    let body: Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert_eq!(
        body["fields"]
            .as_object()
            .unwrap()
            .keys()
            .collect::<Vec<_>>(),
        ["search_scope"]
    );
    assert_eq!(recorder.0.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn task_search_requests_task_facets_and_never_channel_filters() {
    let draft = "search in progress high priority tasks assigned to Person A created by Person B about android";
    let (server, extractor, _) = provider(response(json!({
        "query": answer("text", json!("android")),
        "status": answer("list", json!(["in progress"])),
        "priority": answer("list", json!(["high"])),
        "assignees": answer("list", json!(["Person A"])),
        "created_by": answer("list", json!(["Person B"]))
    })))
    .await;
    let mut request = input(InputIntent::Search, draft);
    request.property_definitions = vec![
        crate::domain::InputPropertyDefinition {
            name: "Status".into(),
            options: vec!["In Progress".into()],
        },
        crate::domain::InputPropertyDefinition {
            name: "Priority".into(),
            options: vec!["High".into()],
        },
    ];
    let SearchSuggestions::Task(fields) = extractor
        .extract_search(&request, SearchType::Task, usage())
        .await
        .unwrap()
    else {
        panic!("expected task search");
    };
    assert_eq!(fields.assignees, ["Person A"]);
    assert_eq!(fields.created_by, ["Person B"]);
    assert_eq!(fields.status, ["In Progress"]);
    assert_eq!(fields.priority, ["High"]);
    let requests = server.received_requests().await.unwrap();
    let body: Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert!(body["fields"].get("from").is_none());
    assert!(body["fields"].get("in").is_none());
    assert!(body["fields"].get("search_scope").is_none());
    assert_eq!(body["fields"].as_object().unwrap().len(), 5);
}

#[tokio::test]
async fn scalar_search_filters_cannot_reuse_the_same_source_occurrence_as_keywords() {
    for (search_type, draft, answers) in [
        (
            SearchType::Calls,
            "find missed calls",
            json!({
                "query": answer("text", json!("missed")), "from": answer("list", json!([])), "in": answer("list", json!([])), "status": answer("text", json!("missed"))
            }),
        ),
        (
            SearchType::Email,
            "find important emails",
            json!({
                "query": answer("text", json!("important")), "importance": answer("text", json!("important")), "inboxes": answer("list", json!([]))
            }),
        ),
    ] {
        let (_server, extractor, _) = provider(response(answers)).await;
        assert!(matches!(
            extractor
                .extract_search(&input(InputIntent::Search, draft), search_type, usage())
                .await,
            Err(InputError::Extraction)
        ));
    }
}

#[tokio::test]
async fn extracts_email_with_intent_specific_schema_raw_draft_and_metered_usage() {
    let draft = "email Julia cc Sam bcc investor@example.org\nCan we reschedule tomorrow?\nLet the investors know.";
    let (server, extractor, recorder) = provider(response(json!({
        "subject": answer("text", json!("reschedule tomorrow")),
        "body": answer("text", json!("Can we reschedule tomorrow?\nLet the investors know.")),
        "recipients": answer("list", json!(["Julia"])),
        "cc": answer("list", json!(["Sam"])), "bcc": answer("list", json!(["investor@example.org"]))
    })))
    .await;
    let fields = extractor
        .extract(&input(InputIntent::Email, draft), usage())
        .await
        .unwrap();
    let InputSuggestions::Email(fields) = fields else {
        panic!("wrong intent");
    };
    assert_eq!(fields.recipients, ["Julia"]);
    assert_eq!(fields.cc, ["Sam"]);
    assert_eq!(fields.bcc, ["investor@example.org"]);
    assert_eq!(
        fields.body.as_deref(),
        Some("Can we reschedule tomorrow?\nLet the investors know.")
    );
    let requests = server.received_requests().await.unwrap();
    let body: Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert_eq!(body["state"], draft);
    let schema = body["fields"].as_object().unwrap();
    assert_eq!(schema.len(), 5);
    assert_eq!(schema["recipients"]["type"], "list");
    assert_eq!(schema["recipients"]["items"], "text");
    assert_eq!(schema["body"]["type"], "text");
    let events = recorder.0.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].model, MODEL);
    assert_eq!(events[0].user, usage().user);
    assert_eq!(
        events[0].amount,
        UsageAmount::Tokens {
            input: 234,
            output: 0,
            cache_read: 0,
            cache_write: 0
        }
    );
}

#[tokio::test]
async fn extracts_event_content_without_requesting_temporal_fields() {
    let draft = "Call Julia tomorrow at 7";
    let (server, extractor, _) = provider(response(json!({
        "title": answer("text", json!("Call Julia")), "body": answer("text", Value::Null),
        "location": answer("text", Value::Null), "guests": answer("list", json!([]))
    })))
    .await;
    let fields = extractor
        .extract(&input(InputIntent::Calendar, draft), usage())
        .await
        .unwrap();
    let InputSuggestions::Calendar(fields) = fields else {
        panic!("wrong intent");
    };
    assert!(fields.start.is_none());
    assert!(fields.guests.is_empty());
    let requests = server.received_requests().await.unwrap();
    let body: Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert!(body["fields"].get("start").is_none());
    assert!(body["fields"].get("end").is_none());
    assert_eq!(body["fields"]["guests"]["type"], "list");
}

#[tokio::test]
async fn task_property_lists_map_to_catalog_names_without_requesting_nested_objects() {
    let draft = "notification click not going to target\nOn mobile the button does nothing\npriority urgent";
    let (server, extractor, _) = provider(response(json!({
        "title": answer("text", json!("notification click not going to target")),
        "body": answer("text", json!("On mobile the button does nothing")),
        "due_date": answer("date", Value::Null),
        "property_0": answer("list", json!(["urgent"])),
        "property_1": answer("list", json!([]))
    })))
    .await;
    let mut request = input(InputIntent::Task, draft);
    request.property_definitions = vec![
        crate::domain::InputPropertyDefinition {
            name: "Priority".into(),
            options: vec!["Urgent".into(), "High".into()],
        },
        crate::domain::InputPropertyDefinition {
            name: "Status".into(),
            options: vec!["Todo".into(), "Done".into()],
        },
    ];
    let fields = extractor.extract(&request, usage()).await.unwrap();
    let InputSuggestions::Task(fields) = fields else {
        panic!("wrong intent");
    };
    assert_eq!(
        fields.body.as_deref(),
        Some("On mobile the button does nothing")
    );
    assert!(fields.due_date.is_none());
    assert_eq!(fields.properties.len(), 1);
    assert_eq!(fields.properties[0].name, "Priority");
    assert_eq!(fields.properties[0].values, ["urgent"]);
    let requests = server.received_requests().await.unwrap();
    let body: Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert!(body["fields"].get("properties").is_none());
    assert_eq!(body["fields"]["property_0"]["type"], "list");
    assert!(
        body["fields"]["property_0"]["instructions"]
            .as_str()
            .unwrap()
            .contains("Priority")
    );
}

#[tokio::test]
async fn absent_answers_do_not_use_provider_guesses() {
    let (_server, extractor, _) = provider(response(json!({"query":
        {"type":"text", "value":null, "guess":"invented query", "confidence":0.99, "p_null":0.99},
        "from": {"type":"list", "value":[], "confidence":0.01}
    })))
    .await;
    let fields = extractor
        .extract_search(
            &input(InputIntent::Search, "Keep this"),
            SearchType::Channels,
            usage(),
        )
        .await
        .unwrap();
    let SearchSuggestions::Channels(fields) = fields else {
        panic!("wrong intent");
    };
    assert!(fields.query.is_none());
}

#[tokio::test]
async fn rejects_search_answers_that_assign_one_source_span_to_competing_fields() {
    for (draft, query, from, channel) in [
        (
            "search channels for messages from user@example.com",
            Some("messages from user@example.com"),
            "user@example.com",
            None,
        ),
        (
            "search messages from user@example.com about budget",
            Some("budget"),
            "user@example.com",
            Some("budget"),
        ),
        (
            "search channels for messages from user@example.com",
            None,
            "user@example.com",
            Some("user@example.com"),
        ),
        (
            "search messages from budget about budget",
            Some("budget"),
            "budget",
            Some("budget"),
        ),
    ] {
        let (_server, extractor, recorder) = provider(response(json!({
            "query": answer("text", json!(query)),
            "search_scope": answer("text", json!("messages")),
            "from": answer("list", json!([from])),
            "in": answer("list", json!(channel.into_iter().collect::<Vec<_>>())),
        })))
        .await;
        assert!(matches!(
            extractor
                .extract_search(
                    &input(InputIntent::Search, draft),
                    SearchType::Channels,
                    usage()
                )
                .await,
            Err(InputError::Extraction)
        ));
        assert_eq!(recorder.0.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn accepts_a_filter_name_independently_repeated_as_search_keywords() {
    let (_server, extractor, _) = provider(response(json!({
        "query": answer("text", json!("budget")),
        "search_scope": answer("text", json!("messages")),
        "from": answer("list", json!([])),
        "in": answer("list", json!(["budget"])),
    })))
    .await;
    let fields = extractor
        .extract_search(
            &input(
                InputIntent::Search,
                "search messages in budget about budget",
            ),
            SearchType::Channels,
            usage(),
        )
        .await
        .unwrap();
    let SearchSuggestions::Channels(fields) = fields else {
        panic!("wrong intent");
    };
    assert_eq!(fields.query.as_deref(), Some("budget"));
    assert_eq!(fields.r#in, ["budget"]);
}

#[tokio::test]
async fn unusable_answers_fail_but_still_record_provider_usage() {
    for answers in [
        json!({"query": answer("text", json!("invented"))}),
        json!({}),
        json!({"query": answer("list", json!(["launch"]))}),
        json!({"query": answer("unknown", json!("launch"))}),
        json!({"query": {"type":"text", "value":"launch", "confidence": 2.0}}),
        json!({"query": {"type":"text", "value":"launch", "confidence": 0.2, "p_null": 0.1}}),
        json!({"query": {"type":"text", "value":"launch", "confidence": 0.99, "p_null": 0.9}}),
        json!({"query": answer("text", json!("launch")), "from": {"type":"list", "value":["launch"], "confidence":0.2}}),
    ] {
        let (_server, extractor, recorder) = provider(response(answers)).await;
        assert!(matches!(
            extractor
                .extract_search(
                    &input(InputIntent::Search, "find launch"),
                    SearchType::Channels,
                    usage()
                )
                .await,
            Err(InputError::Extraction)
        ));
        assert_eq!(recorder.0.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn partial_outgoing_bodies_are_rejected_instead_of_dropping_later_sentences() {
    for intent in [InputIntent::Email, InputIntent::Message] {
        let mut answers = json!({
            "body": answer("text", json!("Can we reschedule tomorrow?")),
            "recipients": answer("list", json!(["Julia"]))
        });
        if intent == InputIntent::Email {
            answers["subject"] = answer("text", Value::Null);
        }
        let (_server, extractor, recorder) = provider(response(answers)).await;
        let request = input(
            intent,
            "email Julia\nCan we reschedule tomorrow?\nLet the investors know.",
        );
        assert!(matches!(
            extractor.extract(&request, usage()).await,
            Err(InputError::Extraction)
        ));
        assert_eq!(recorder.0.lock().unwrap().len(), 1);
    }
}

#[tokio::test]
async fn truncated_results_are_metered_and_rejected() {
    let mut body = response(json!({"query": answer("text", json!("launch"))}));
    body["result"]["truncated"] = json!(true);
    let (_server, extractor, recorder) = provider(body).await;
    assert!(matches!(
        extractor
            .extract_search(
                &input(InputIntent::Search, "find launch"),
                SearchType::Channels,
                usage()
            )
            .await,
        Err(InputError::Extraction)
    ));
    assert_eq!(recorder.0.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn http_failures_are_not_retried_before_domain_fallback() {
    for status in [401, 429, 503] {
        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .respond_with(ResponseTemplate::new(status))
            .expect(1)
            .mount(&server)
            .await;
        let recorder = Arc::new(Recorder::default());
        let extractor = ClairicFieldExtractor::with_base_url(
            ACCOUNT,
            "test-token",
            recorder.clone(),
            &server.uri(),
        )
        .unwrap();
        assert!(matches!(
            extractor
                .extract_search(
                    &input(InputIntent::Search, "find launch"),
                    SearchType::Channels,
                    usage()
                )
                .await,
            Err(InputError::Extraction)
        ));
        assert!(recorder.0.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn ai_intent_does_not_send_an_empty_schema_to_cloudflare() {
    let server = MockServer::start().await;
    let extractor = ClairicFieldExtractor::with_base_url(
        ACCOUNT,
        "test-token",
        Arc::new(Recorder::default()),
        &server.uri(),
    )
    .unwrap();
    extractor
        .extract(&input(InputIntent::Ai, "Explain indexes"), usage())
        .await
        .unwrap();
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[test]
fn configuration_validates_both_credentials_at_startup() {
    let recorder = || Arc::new(Recorder::default());
    assert!(
        ClairicFieldExtractor::from_config(
            &CloudflareAccountId::Runtime(" ".into()),
            &CloudflareApiToken::Runtime("".into()),
            recorder()
        )
        .unwrap()
        .is_none()
    );
    assert!(
        ClairicFieldExtractor::from_config(
            &CloudflareAccountId::Unset,
            &CloudflareApiToken::Unset,
            recorder()
        )
        .unwrap()
        .is_none()
    );
    assert!(matches!(
        ClairicFieldExtractor::from_config(
            &CloudflareAccountId::Unset,
            &CloudflareApiToken::Runtime("token".into()),
            recorder()
        ),
        Err(ClairicConfigError::Incomplete)
    ));
    for invalid in ["", "account/../other", "nothexaccount00000000000000000000"] {
        assert!(matches!(
            ClairicFieldExtractor::with_base_url(invalid, "token", recorder(), API_BASE),
            Err(ClairicConfigError::InvalidAccount)
        ));
    }
}

#[tokio::test]
async fn a_stalled_provider_returns_control_to_the_fallback() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(200).set_delay(Duration::from_millis(200)))
        .expect(1)
        .mount(&server)
        .await;
    let mut extractor = ClairicFieldExtractor::with_base_url(
        ACCOUNT,
        "test-token",
        Arc::new(Recorder::default()),
        &server.uri(),
    )
    .unwrap();
    extractor.client = Client::builder()
        .timeout(Duration::from_millis(50))
        .build()
        .unwrap();
    assert!(matches!(
        extractor
            .extract_search(
                &input(InputIntent::Search, "find launch"),
                SearchType::Channels,
                usage()
            )
            .await,
        Err(InputError::Extraction)
    ));
}

#[tokio::test]
async fn extracts_search_fields_without_reparsing_keyword_prepositions() {
    let draft = "search messages in sales about growth in 2026";
    let (server, extractor, _) = provider(response(json!({
        "query": answer("text", json!("growth in 2026")),
        "search_scope": answer("text", json!("messages")),
        "from": answer("list", json!([])),
        "in": answer("list", json!(["sales"]))
    })))
    .await;
    let fields = extractor
        .extract_search(
            &input(InputIntent::Search, draft),
            SearchType::Channels,
            usage(),
        )
        .await
        .unwrap();
    let SearchSuggestions::Channels(fields) = fields else {
        panic!("wrong intent");
    };
    assert_eq!(fields.query.as_deref(), Some("growth in 2026"));
    assert_eq!(fields.r#in, ["sales"]);
    let requests = server.received_requests().await.unwrap();
    let body: Value = serde_json::from_slice(&requests[0].body).unwrap();
    assert_eq!(body["fields"]["from"]["type"], "list");
    assert_eq!(body["fields"].as_object().unwrap().len(), 3);
}
