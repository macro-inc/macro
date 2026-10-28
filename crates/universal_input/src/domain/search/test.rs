use super::*;
use ai_usage::AiFeature;
use std::sync::Mutex;

struct Extractor {
    stages: Mutex<Vec<&'static str>>,
    wrong_type: bool,
}
impl FieldExtractor for Extractor {
    async fn extract(
        &self,
        _: &ExtractInputRequest,
        _: UsageContext,
    ) -> Result<InputSuggestions, InputError> {
        panic!("search must use the staged port");
    }
}
impl SearchExtractor for Extractor {
    async fn select_search_type(
        &self,
        input: &ExtractInputRequest,
        _: UsageContext,
    ) -> Result<SearchType, InputError> {
        assert!(input.property_definitions.is_empty());
        self.stages.lock().unwrap().push("type");
        Ok(SearchType::Task)
    }
    async fn extract_search(
        &self,
        input: &ExtractInputRequest,
        search_type: SearchType,
        _: UsageContext,
    ) -> Result<SearchSuggestions, InputError> {
        assert_eq!(*self.stages.lock().unwrap(), ["type"]);
        assert_eq!(search_type, SearchType::Task);
        assert_eq!(input.property_definitions[0].name, "Priority");
        self.stages.lock().unwrap().push("fields");
        if self.wrong_type {
            return Ok(SearchSuggestions::All(QuerySearchSuggestions::default()));
        }
        Ok(SearchSuggestions::Task(TaskSearchSuggestions {
            query: Some("android".into()),
            priority: vec!["High".into()],
            status: vec!["In Progress".into()],
            assignees: vec!["Person A".into()],
            created_by: vec!["Person B".into()],
        }))
    }
}

#[tokio::test]
async fn type_is_selected_before_fields_and_cannot_change_in_the_second_stage() {
    let input = ExtractInputRequest {
        text: "find high priority in progress tasks assigned to Person A created by Person B about android".into(),
        intent: InputIntent::Search, revision: 1,
        reference_time: "2026-10-27T12:00:00Z".parse().unwrap(),
        time_zone: "UTC".into(), search_type: None, property_definitions: vec![super::super::InputPropertyDefinition { name: "Priority".into(), options: vec!["High".into()] }],
    };
    for wrong_type in [false, true] {
        let extractor = WithSearchExtraction::new(Extractor {
            stages: Mutex::new(vec![]),
            wrong_type,
        });
        let result = extractor
            .extract(
                &input,
                UsageContext::system(AiFeature::DynamicCompletionsApi),
            )
            .await;
        if wrong_type {
            assert!(matches!(result, Err(InputError::Extraction)));
        } else {
            let InputSuggestions::Search(SearchSuggestions::Task(fields)) = result.unwrap() else {
                panic!("expected task search");
            };
            assert_eq!(fields.assignees, ["Person A"]);
            assert_eq!(fields.created_by, ["Person B"]);
            assert_eq!(fields.priority, ["High"]);
            assert_eq!(fields.status, ["In Progress"]);
        }
        assert_eq!(*extractor.fields.stages.lock().unwrap(), ["type", "fields"]);
    }
}

#[test]
fn task_and_channel_schemas_reject_each_others_filters() {
    for value in [
        serde_json::json!({"type":"task", "query":null, "status":[], "priority":[], "assignees":[], "created_by":[], "from":["Person A"]}),
        serde_json::json!({"type":"channels", "query":null, "from":[], "in":[], "priority":["High"]}),
    ] {
        assert!(serde_json::from_value::<SearchSuggestions>(value).is_err());
    }
}

#[test]
fn every_field_in_each_response_schema_has_extraction_guidance() {
    for search_type in [
        SearchType::All,
        SearchType::Channels,
        SearchType::DocumentOrFile,
        SearchType::Task,
        SearchType::Email,
        SearchType::Calls,
        SearchType::Folders,
        SearchType::Agent,
        SearchType::Calendar,
    ] {
        for field in search_type.fields() {
            assert!(
                search_type.guidance(&field).is_some(),
                "{search_type:?}.{field} needs extraction guidance"
            );
        }
    }
}

struct SearchProvider {
    calls: std::sync::Arc<Mutex<Vec<String>>>,
    name: &'static str,
    fail_fields: bool,
    search_type: SearchType,
}
impl FieldExtractor for SearchProvider {
    async fn extract(
        &self,
        _: &ExtractInputRequest,
        _: UsageContext,
    ) -> Result<InputSuggestions, InputError> {
        panic!("search must use its dedicated stages");
    }
}
impl SearchExtractor for SearchProvider {
    async fn select_search_type(
        &self,
        input: &ExtractInputRequest,
        _: UsageContext,
    ) -> Result<SearchType, InputError> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("{}.type", self.name));
        assert!(input.property_definitions.is_empty());
        Ok(self.search_type)
    }
    async fn extract_search(
        &self,
        input: &ExtractInputRequest,
        search_type: SearchType,
        usage: UsageContext,
    ) -> Result<SearchSuggestions, InputError> {
        assert_eq!(search_type, self.search_type);
        if search_type == SearchType::DocumentOrFile {
            assert!(input.property_definitions.is_empty());
            return Ok(SearchSuggestions::DocumentOrFile(
                QuerySearchSuggestions::default(),
            ));
        }
        assert_eq!(
            usage.user,
            UsageContext::system(AiFeature::DynamicCompletionsApi).user
        );
        self.calls
            .lock()
            .unwrap()
            .push(format!("{}.fields", self.name));
        if self.fail_fields {
            return Err(InputError::Extraction);
        }
        Ok(SearchSuggestions::Task(TaskSearchSuggestions::default()))
    }
}

#[tokio::test]
async fn field_failover_preserves_the_selected_type_without_classifying_again() {
    let calls = std::sync::Arc::new(Mutex::new(vec![]));
    let extractor = WithSearchExtraction::new(super::super::FallbackFieldExtractor::new(
        Some(SearchProvider {
            calls: calls.clone(),
            name: "primary",
            fail_fields: true,
            search_type: SearchType::Task,
        }),
        SearchProvider {
            calls: calls.clone(),
            name: "fallback",
            fail_fields: false,
            search_type: SearchType::Task,
        },
    ));
    let input = ExtractInputRequest {
        text: "search tasks assigned to Person A".into(),
        intent: InputIntent::Search,
        revision: 1,
        reference_time: "2026-10-27T12:00:00Z".parse().unwrap(),
        time_zone: "UTC".into(),
        search_type: None,
        property_definitions: vec![],
    };
    assert!(matches!(
        extractor
            .extract(
                &input,
                UsageContext::system(AiFeature::DynamicCompletionsApi)
            )
            .await
            .unwrap(),
        InputSuggestions::Search(SearchSuggestions::Task(_))
    ));
    assert_eq!(
        *calls.lock().unwrap(),
        ["primary.type", "primary.fields", "fallback.fields"]
    );
}

#[tokio::test]
async fn a_manually_selected_search_type_skips_inference() {
    let calls = std::sync::Arc::new(Mutex::new(vec![]));
    let extractor = WithSearchExtraction::new(SearchProvider {
        calls: calls.clone(),
        name: "provider",
        fail_fields: false,
        search_type: SearchType::Task,
    });
    let input = ExtractInputRequest {
        text: "search tasks assigned to Person A".into(),
        intent: InputIntent::Search,
        revision: 1,
        reference_time: "2026-10-27T12:00:00Z".parse().unwrap(),
        time_zone: "UTC".into(),
        search_type: Some(SearchType::Task),
        property_definitions: vec![],
    };
    extractor
        .extract(
            &input,
            UsageContext::system(AiFeature::DynamicCompletionsApi),
        )
        .await
        .unwrap();
    assert_eq!(*calls.lock().unwrap(), ["provider.fields"]);
}

#[tokio::test]
async fn unrelated_task_options_are_not_sent_to_document_search_extraction() {
    let calls = std::sync::Arc::new(Mutex::new(vec![]));
    let extractor = WithSearchExtraction::new(SearchProvider {
        calls: calls.clone(),
        name: "documents",
        fail_fields: false,
        search_type: SearchType::DocumentOrFile,
    });
    let input = ExtractInputRequest {
        text: "search documents from Person A".into(),
        intent: InputIntent::Search,
        revision: 1,
        reference_time: "2026-10-27T12:00:00Z".parse().unwrap(),
        time_zone: "UTC".into(),
        search_type: None,
        property_definitions: vec![super::super::InputPropertyDefinition {
            name: "Priority".into(),
            options: vec!["High".into()],
        }],
    };
    assert!(matches!(
        extractor
            .extract(
                &input,
                UsageContext::system(AiFeature::DynamicCompletionsApi)
            )
            .await
            .unwrap(),
        InputSuggestions::Search(SearchSuggestions::DocumentOrFile(_))
    ));
    assert_eq!(*calls.lock().unwrap(), ["documents.type"]);
}
