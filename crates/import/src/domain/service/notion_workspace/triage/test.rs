use super::*;

fn page(key: &str, title: &str) -> TriageItem {
    TriageItem {
        key: key.to_string(),
        kind: ImportKind::Page,
        title: title.to_string(),
        path: Vec::new(),
        children: 0,
        table: None,
    }
}

fn table(key: &str, title: &str) -> TriageItem {
    TriageItem {
        table: Some(TriageTable {
            columns: vec!["Name (title)".to_string(), "Status (status)".to_string()],
            rows: 12,
            sample_titles: vec!["Fix login".to_string()],
        }),
        kind: ImportKind::DataSource,
        ..page(key, title)
    }
}

#[test]
fn verdicts_keep_the_models_answers_and_fill_in_what_it_left_out() {
    let batch = vec![
        page("a", "Roadmap"),
        page("b", "Untitled"),
        table("c", "Bugs"),
        page("d", "Team wiki"),
    ];
    let verdicts = vec![
        Verdict {
            key: "b".to_string(),
            decision: NotionDecision::Skip,
            reason: Some("Empty page".to_string()),
            task_fields: None,
            shared: None,
            shared_reason: None,
        },
        Verdict {
            key: "c".to_string(),
            decision: NotionDecision::Tasks,
            reason: Some("A bug tracker".to_string()),
            task_fields: Some(NotionTaskFields {
                status: Some("Status".to_string()),
                ..NotionTaskFields::default()
            }),
            shared: None,
            shared_reason: None,
        },
        // Only a data source can become tasks.
        Verdict {
            key: "d".to_string(),
            decision: NotionDecision::Tasks,
            reason: None,
            task_fields: Some(NotionTaskFields::default()),
            shared: None,
            shared_reason: None,
        },
        // A key the batch never had is dropped.
        Verdict {
            key: "zz".to_string(),
            decision: NotionDecision::Skip,
            reason: None,
            task_fields: None,
            shared: None,
            shared_reason: None,
        },
    ];

    let decided = fill_missing(&batch, verdicts);

    assert_eq!(decided.len(), 4);
    assert_eq!(decided["a"].decision, NotionDecision::Copy);
    assert_eq!(
        decided["a"].reason.as_deref(),
        Some("The decision model gave no answer")
    );
    assert_eq!(decided["b"].decision, NotionDecision::Skip);
    assert_eq!(decided["c"].decision, NotionDecision::Tasks);
    assert_eq!(
        decided["c"]
            .task_fields
            .as_ref()
            .and_then(|fields| fields.status.as_deref()),
        Some("Status")
    );
    assert_eq!(decided["d"].decision, NotionDecision::Copy);
    assert_eq!(decided["d"].task_fields, None);
}

#[test]
fn the_verdict_schema_is_one_the_structured_output_validator_accepts() {
    let validator =
        agent::structured_output::validate_schema(&triage_schema(NotionSharing::Personal)).unwrap();
    let answer = serde_json::json!({
        "verdicts": [
            { "key": "c", "decision": "tasks", "reason": "A bug tracker", "taskFields": { "status": "Status" } },
            { "key": "a", "decision": "copy" }
        ]
    });
    assert!(validator.is_valid(&answer));
    let output: TriageOutput = serde_json::from_value(answer).unwrap();
    assert_eq!(output.verdicts[0].decision, NotionDecision::Tasks);
    assert!(!validator.is_valid(&serde_json::json!({
        "verdicts": [{ "key": "a", "decision": "delete" }]
    })));
}

#[test]
fn sharing_is_asked_of_the_model_only_when_the_user_left_it_to_the_model() {
    let verdict = serde_json::json!({
        "verdicts": [{ "key": "a", "decision": "copy" }]
    });
    let with_sharing = serde_json::json!({
        "verdicts": [{ "key": "a", "decision": "copy", "shared": true, "sharedReason": "The team wiki" }]
    });
    let personal =
        agent::structured_output::validate_schema(&triage_schema(NotionSharing::Team)).unwrap();
    let ai = agent::structured_output::validate_schema(&triage_schema(NotionSharing::Ai)).unwrap();

    assert!(personal.is_valid(&verdict));
    assert!(
        !personal.is_valid(&with_sharing),
        "sharing is the user's when they chose it"
    );
    assert!(
        !ai.is_valid(&verdict),
        "every verdict says whether to share"
    );
    assert!(ai.is_valid(&with_sharing));
    assert!(triage_system(NotionSharing::Ai).contains(TRIAGE_SHARING));
    assert!(!triage_system(NotionSharing::Personal).contains(TRIAGE_SHARING));

    let parsed: TriageOutput = serde_json::from_value(with_sharing).unwrap();
    assert_eq!(parsed.verdicts[0].shared, Some(true));
    assert_eq!(
        parsed.verdicts[0].shared_reason.as_deref(),
        Some("The team wiki")
    );
}
