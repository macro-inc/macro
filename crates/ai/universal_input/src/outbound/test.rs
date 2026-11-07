use super::clairic::{ClairicFieldExtractor, CloudflareAccountId, CloudflareApiToken};
use super::*;
use ai_usage::{AiFeature, NoOpUsageRecorder};

fn live_extractor() -> impl FieldExtractor {
    let recorder: Arc<dyn UsageRecorder> = Arc::new(NoOpUsageRecorder);
    crate::domain::search::WithSearchExtraction::new(crate::domain::FallbackFieldExtractor::new(
        ClairicFieldExtractor::from_config(
            &CloudflareAccountId::new().unwrap_or(CloudflareAccountId::Unset),
            &CloudflareApiToken::new().unwrap_or(CloudflareApiToken::Unset),
            recorder.clone(),
        )
        .unwrap(),
        AgentFieldExtractor::new(recorder),
    ))
}

#[tokio::test]
#[ignore = "requires configured model provider credentials"]
async fn query_only_search_keeps_unsupported_sender_wording() {
    use crate::domain::search::{SearchExtractor, SearchType};
    let recorder: Arc<dyn UsageRecorder> = Arc::new(NoOpUsageRecorder);
    let primary = ClairicFieldExtractor::from_config(
        &CloudflareAccountId::new().unwrap_or(CloudflareAccountId::Unset),
        &CloudflareApiToken::new().unwrap_or(CloudflareApiToken::Unset),
        recorder.clone(),
    )
    .unwrap();
    let fallback = AgentFieldExtractor::new(recorder);
    for text in [
        "search documents from julia",
        "search documents from Person A",
    ] {
        let input = ExtractInputRequest {
            text: text.into(),
            intent: InputIntent::Search,
            revision: 1,
            reference_time: "2026-10-27T12:00:00Z".parse().unwrap(),
            time_zone: "UTC".into(),
            search_type: None,
            property_definitions: vec![],
        };
        if let Some(primary) = &primary {
            let fields = primary
                .extract_search(
                    &input,
                    SearchType::DocumentOrFile,
                    UsageContext::system(AiFeature::DynamicCompletionsApi),
                )
                .await
                .unwrap();
            let crate::domain::search::SearchSuggestions::DocumentOrFile(fields) = fields else {
                panic!("expected document search");
            };
            assert_eq!(
                fields.query.as_deref(),
                text.strip_prefix("search documents ")
            );
        }
        let fields = fallback
            .extract_search(
                &input,
                SearchType::DocumentOrFile,
                UsageContext::system(AiFeature::DynamicCompletionsApi),
            )
            .await
            .unwrap();
        let crate::domain::search::SearchSuggestions::DocumentOrFile(fields) = fields else {
            panic!("expected document search");
        };
        assert_eq!(
            fields.query.as_deref(),
            text.strip_prefix("search documents ")
        );
    }
}

#[test]
fn search_options_follow_the_supplied_catalog_and_unknown_values_are_rejected() {
    use crate::domain::search::{SearchSuggestions, SearchType};
    let input = ExtractInputRequest {
        text: "search blocked tasks".into(),
        intent: InputIntent::Search,
        revision: 1,
        reference_time: "2026-10-27T12:00:00Z".parse().unwrap(),
        time_zone: "UTC".into(),
        search_type: None,
        property_definitions: vec![crate::domain::InputPropertyDefinition {
            name: "Status".into(),
            options: vec!["Blocked".into()],
        }],
    };
    let schema = search_schema(&input, SearchType::Task);
    assert_eq!(
        schema["properties"]["status"]["items"]["enum"],
        json!(["Blocked"])
    );
    assert_eq!(schema["properties"]["priority"]["maxItems"], 0);
    let fields =
        json!({"query":null,"status":["blocked"],"priority":[],"assignees":[],"created_by":[]});
    let SearchSuggestions::Task(fields) = decode_search(&input, SearchType::Task, fields).unwrap()
    else {
        panic!("expected task search");
    };
    assert_eq!(fields.status, ["Blocked"]);
    assert!(
        decode_search(
            &input,
            SearchType::Task,
            json!({"query":null,"status":["invented"],"priority":[],"assignees":[],"created_by":[]})
        )
        .is_err()
    );
    for malformed in [json!([]), json!("query"), json!(false), Value::Null] {
        assert!(decode_search(&input, SearchType::All, malformed).is_err());
    }
}

#[tokio::test]
#[ignore = "requires configured model provider credentials"]
async fn search_query_excludes_consumed_filters_without_losing_the_topic() {
    let extractor = live_extractor();
    for (text, query, from, channel) in [
        (
            "search channels for messages from Person A",
            None,
            "Person A",
            None,
        ),
        (
            "search channels for messages from user@example.com",
            None,
            "user@example.com",
            None,
        ),
        (
            "search channels for messages from user@example.com in #team",
            None,
            "user@example.com",
            Some("#team"),
        ),
        (
            "search channels for messages from user@example.com about budget",
            Some("budget"),
            "user@example.com",
            None,
        ),
        (
            "search messages from user@example.com about growth in 2026",
            Some("growth in 2026"),
            "user@example.com",
            None,
        ),
    ] {
        let input = ExtractInputRequest {
            text: text.into(),
            intent: InputIntent::Search,
            revision: 1,
            reference_time: "2026-10-27T12:00:00Z".parse().unwrap(),
            time_zone: "UTC".into(),
            search_type: None,
            property_definitions: vec![],
        };
        let suggestions = extractor
            .extract(
                &input,
                UsageContext::system(AiFeature::DynamicCompletionsApi),
            )
            .await
            .unwrap();
        let InputSuggestions::Search(crate::domain::search::SearchSuggestions::Channels(fields)) =
            suggestions
        else {
            panic!("expected search suggestions");
        };
        assert_eq!(fields.query.as_deref(), query, "{text}: {fields:?}");
        assert_eq!(fields.from, [from], "{text}");
        assert_eq!(
            fields.r#in,
            channel.into_iter().map(str::to_owned).collect::<Vec<_>>(),
            "{text}"
        );
    }
    for (text, expected) in [
        (
            "search high priority tasks assigned to Person A",
            json!({"type":"task", "query":null, "status":[], "priority":["high"], "assignees":["Person A"], "created_by":[]}),
        ),
        (
            "search in progress high priority tasks assigned to Person A created by Person B about android",
            json!({"type":"task", "query":"android", "status":["in progress"], "priority":["high"], "assignees":["Person A"], "created_by":["Person B"]}),
        ),
        (
            "tasks related to android",
            json!({"type":"task", "query":"android", "status":[], "priority":[], "assignees":[], "created_by":[]}),
        ),
        (
            "search documents from Person A",
            json!({"type":"document-or-file", "query":"from Person A"}),
        ),
    ] {
        let input = ExtractInputRequest {
            text: text.into(),
            intent: InputIntent::Search,
            revision: 1,
            reference_time: "2026-10-27T12:00:00Z".parse().unwrap(),
            time_zone: "UTC".into(),
            search_type: None,
            property_definitions: vec![
                crate::domain::InputPropertyDefinition {
                    name: "Status".into(),
                    options: vec![
                        "Not Started".into(),
                        "In Progress".into(),
                        "In Review".into(),
                        "Completed".into(),
                        "Canceled".into(),
                    ],
                },
                crate::domain::InputPropertyDefinition {
                    name: "Priority".into(),
                    options: vec![
                        "Urgent".into(),
                        "High".into(),
                        "Medium".into(),
                        "Low".into(),
                    ],
                },
            ],
        };
        let InputSuggestions::Search(fields) = extractor
            .extract(
                &input,
                UsageContext::system(AiFeature::DynamicCompletionsApi),
            )
            .await
            .unwrap()
        else {
            panic!("expected search");
        };
        let mut fields = serde_json::to_value(fields).unwrap();
        for name in ["priority", "status"] {
            if let Some(values) = fields.get_mut(name).and_then(Value::as_array_mut) {
                for value in values {
                    *value = json!(value.as_str().unwrap().to_lowercase());
                }
            }
        }
        assert_eq!(fields, expected, "{text}");
    }
}

#[tokio::test]
#[ignore = "requires configured model provider credentials"]
async fn named_channel_message_separates_the_recipient_and_entire_body() {
    let input = ExtractInputRequest {
        text: "message bug reports, cmd k menu not closing".into(),
        intent: InputIntent::Message,
        revision: 1,
        reference_time: "2026-10-27T12:00:00Z".parse().unwrap(),
        time_zone: "UTC".into(),
        search_type: None,
        property_definitions: vec![],
    };
    let InputSuggestions::Message(fields) = live_extractor()
        .extract(
            &input,
            UsageContext::system(AiFeature::DynamicCompletionsApi),
        )
        .await
        .unwrap()
    else {
        panic!("expected message");
    };
    assert_eq!(fields.recipients.len(), 1, "{fields:?}");
    assert!(fields.recipients[0].eq_ignore_ascii_case("bug reports"));
    assert_eq!(fields.body.as_deref(), Some("cmd k menu not closing"));
}

#[tokio::test]
#[ignore = "requires configured model provider credentials"]
async fn calendar_clock_and_separate_daypart_form_one_start_time() {
    use crate::domain::temporal::{
        Daypart, StartExpression, TemporalExpressions, TemporalExtractor,
    };
    let recorder: Arc<dyn UsageRecorder> = Arc::new(NoOpUsageRecorder);
    let input = ExtractInputRequest {
        text: "tomorrow morning at 8 investor meeting with julia and teo".into(),
        intent: InputIntent::Calendar,
        revision: 1,
        reference_time: "2026-10-27T12:00:00Z".parse().unwrap(),
        time_zone: "UTC".into(),
        search_type: None,
        property_definitions: vec![],
    };
    let temporal = temporal::AgentTemporalExtractor::new(recorder);
    let expressions = temporal
        .extract_temporal(
            &input,
            UsageContext::system(AiFeature::DynamicCompletionsApi),
        )
        .await
        .unwrap();
    let TemporalExpressions::Calendar(fields) = expressions else {
        panic!("expected calendar expressions");
    };
    let Some(StartExpression::Local {
        clock: Some(clock), ..
    }) = fields.start
    else {
        panic!("expected one start clock");
    };
    assert_eq!(clock.span, "8");
    assert_eq!(clock.hour, 8);
    assert!(matches!(clock.daypart, Some(Daypart::Morning)));
    assert!(
        fields.end.is_none(),
        "a daypart modifier cannot add an end clock"
    );
}
