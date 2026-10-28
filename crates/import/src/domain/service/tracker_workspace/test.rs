use super::*;
use import_tracker::domain::model::{GroupKind, ObjectId};

fn issue(id: &str, parent: Option<&str>, group: Option<&str>) -> Issue {
    Issue {
        id: ObjectId::parse(id).unwrap(),
        identifier: format!("ENG-{id}"),
        title: format!("Issue {id}"),
        description: "Body **kept**".into(),
        status: "Doing".into(),
        status_category: "started".into(),
        issue_type: None,
        priority: Some("Highest".into()),
        assignee_email: Some("owner@example.com".into()),
        due_date: Some("2026-11-01".into()),
        labels: vec!["bug".into()],
        estimate: Some(3.0),
        parent: parent.map(|id| ObjectId::parse(id).unwrap()),
        group: group.map(|id| ObjectId::parse(id).unwrap()),
        team: None,
        cycle: None,
        url: format!("https://example.com/{id}"),
        comments: Vec::new(),
    }
}

#[test]
fn stages_parents_first_and_inherits_group_skip_without_losing_content() {
    let inventory = Inventory {
        groups: vec![Group {
            id: ObjectId::parse("project").unwrap(),
            title: "Project".into(),
            kind: GroupKind::Project,
            parent: None,
            url: None,
            description: None,
        }],
        issues: vec![
            issue("child", Some("parent"), Some("project")),
            issue("parent", None, Some("project")),
        ],
        ..Inventory::default()
    };
    let rows = plan::rows(
        ImportSource::Linear,
        &inventory,
        NotionSharing::Personal,
        false,
    )
    .unwrap();
    assert_eq!(
        rows.iter()
            .map(|row| row.foreign_id.as_str())
            .collect::<Vec<_>>(),
        ["group:project", "parent", "child"]
    );
    let verdict = triage::Verdict {
        key: "group:project".into(),
        decision: NotionDecision::Skip,
        reason: Some("Archived work".into()),
        task_fields: None,
        shared: None,
        shared_reason: None,
    };
    let decided = plan::decide(
        &rows,
        &HashMap::from([("group:project".into(), verdict)]),
        NotionSharing::Personal,
        false,
    )
    .unwrap();
    for row in &decided {
        let meta: TrackerMeta = serde_json::from_value(row.metadata.clone()).unwrap();
        assert_eq!(meta.plan.decision, Some(NotionDecision::Skip));
        assert!(!meta.plan.shared);
    }
    let meta: TrackerMeta = serde_json::from_value(decided[2].metadata.clone()).unwrap();
    let TrackerObject::Issue(issue) = meta.object else {
        panic!("issue payload lost")
    };
    assert_eq!(issue.description, "Body **kept**");
    assert_eq!(issue.parent.unwrap().as_str(), "parent");
}

#[test]
fn cyclic_parents_are_broken_and_teamless_ai_plans_stay_personal() {
    let inventory = Inventory {
        issues: vec![issue("a", Some("b"), None), issue("b", Some("a"), None)],
        ..Inventory::default()
    };
    let rows = plan::rows(ImportSource::Jira, &inventory, NotionSharing::Ai, false).unwrap();
    assert!(rows[0].parent_foreign_id.is_none());
    let decided = plan::decide(&rows, &HashMap::new(), NotionSharing::Ai, false).unwrap();
    for row in decided {
        let meta: TrackerMeta = serde_json::from_value(row.metadata).unwrap();
        assert!(!meta.plan.shared);
        assert!(!meta.plan.shareable);
    }
}

#[test]
fn maps_task_fields_and_keeps_unmapped_details_in_markdown() {
    let issue = issue("12", None, None);
    let properties = values::properties(&issue);
    assert_eq!(properties.status.as_deref(), Some("In Progress"));
    assert_eq!(properties.priority.as_deref(), Some("Urgent"));
    assert_eq!(properties.due_date.as_deref(), Some("2026-11-01"));
    assert_eq!(
        properties.assignee_email.as_deref(),
        Some("owner@example.com")
    );
    let body = values::task_body(&issue);
    assert!(body.contains("Body **kept**"));
    assert!(body.contains("Estimate: 3"));
    assert!(body.contains("Labels: bug"));
}
