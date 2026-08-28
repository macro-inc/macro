use super::*;
use chrono::TimeZone;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::{EntityReference, EntityType, PropertyOwner};
use models_soup::SoupProperty;
use std::collections::HashMap;

fn ts(hour: u32) -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 8, 1, hour, 0, 0).unwrap()
}

fn definition(id: Uuid, data_type: DataType) -> PropertyDefinition {
    PropertyDefinition {
        id,
        owner: PropertyOwner::System,
        display_name: "prop".to_string(),
        data_type,
        is_multi_select: false,
        specific_entity_type: Some(EntityType::Task),
        created_at: ts(0),
        updated_at: ts(0),
        is_system: true,
        is_metadata: false,
    }
}

fn select_prop(definition_id: Uuid, option: Uuid) -> SoupProperty {
    SoupProperty {
        id: Uuid::from_u128(1),
        definition: definition(definition_id, DataType::SelectString),
        value: Some(PropertyValue::SelectOption(vec![option])),
    }
}

fn task_doc(name: &str, properties: Vec<SoupProperty>) -> SoupDocument<SoupPropertiesField> {
    SoupDocument {
        id: Uuid::from_u128(42),
        document_version_id: 1,
        owner_id: macro_user_id::user_id::MacroUserIdStr::parse_from_str("macro|me@example.com")
            .unwrap(),
        name: name.to_string(),
        file_type: Some("md".to_string()),
        sha: None,
        project_id: None,
        branched_from_id: None,
        branched_from_version_id: None,
        document_family_id: None,
        created_at: ts(1),
        updated_at: ts(2),
        viewed_at: Some(ts(3)),
        sub_type: Some(SoupDocumentSubType::Task {
            is_completed: false,
        }),
        deleted_at: None,
        extra: SoupPropertiesField { properties },
    }
}

fn query() -> TaskListQuery {
    TaskListQuery {
        statuses: vec![],
        priorities: vec![],
        assignee_user_id: None,
        project_id: None,
        due_after: None,
        due_before: None,
        updated_after: None,
        updated_before: None,
        search: None,
        sort: TaskSort::Priority,
    }
}

#[test]
fn extract_task_reads_system_properties() {
    let due = ts(10);
    let doc = task_doc(
        "Ship it",
        vec![
            select_prop(
                SystemPropertyKey::STATUS_UUID,
                StatusOption::InProgress.uuid(),
            ),
            select_prop(
                SystemPropertyKey::PRIORITY_UUID,
                PriorityOption::Urgent.uuid(),
            ),
            SoupProperty {
                id: Uuid::from_u128(2),
                definition: definition(SystemPropertyKey::ASSIGNEES_UUID, DataType::Entity),
                value: Some(PropertyValue::EntityRef(vec![EntityReference::new(
                    "macro|me@example.com",
                    EntityType::User,
                )])),
            },
            SoupProperty {
                id: Uuid::from_u128(3),
                definition: definition(SystemPropertyKey::DUE_DATE_UUID, DataType::Date),
                value: Some(PropertyValue::Date(due)),
            },
        ],
    );

    let task = extract_task(&doc, &HashMap::new()).expect("task");
    assert_eq!(task.name, "Ship it");
    assert_eq!(task.status, Some(StatusOption::InProgress));
    assert_eq!(task.priority, Some(PriorityOption::Urgent));
    assert_eq!(task.assignees, vec!["macro|me@example.com".to_string()]);
    assert_eq!(task.due_date, Some(due));
}

#[test]
fn extract_task_ignores_non_tasks() {
    let mut doc = task_doc("Note", vec![]);
    doc.sub_type = Some(SoupDocumentSubType::Snippet {});
    assert!(extract_task(&doc, &HashMap::new()).is_none());
}

#[test]
fn sort_tasks_priority_urgent_first() {
    let mut tasks = vec![
        TaskRecord {
            id: Uuid::from_u128(1),
            name: "low".into(),
            status: None,
            priority: Some(PriorityOption::Low),
            assignees: vec![],
            due_date: None,
            project_id: None,
            tags: vec![],
            created_at: ts(1),
            updated_at: ts(1),
            viewed_at: None,
        },
        TaskRecord {
            id: Uuid::from_u128(2),
            name: "urgent".into(),
            status: None,
            priority: Some(PriorityOption::Urgent),
            assignees: vec![],
            due_date: None,
            project_id: None,
            tags: vec![],
            created_at: ts(1),
            updated_at: ts(1),
            viewed_at: None,
        },
        TaskRecord {
            id: Uuid::from_u128(3),
            name: "unset".into(),
            status: None,
            priority: None,
            assignees: vec![],
            due_date: None,
            project_id: None,
            tags: vec![],
            created_at: ts(1),
            updated_at: ts(2),
            viewed_at: None,
        },
    ];
    sort_tasks(&mut tasks, TaskSort::Priority);
    assert_eq!(
        tasks.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
        ["urgent", "low", "unset"]
    );
}

#[test]
fn due_date_filter_requires_a_due_date_in_range() {
    let mut q = query();
    q.due_after = Some(ts(5));
    q.due_before = Some(ts(15));

    let in_range = TaskRecord {
        id: Uuid::from_u128(1),
        name: "in".into(),
        status: None,
        priority: None,
        assignees: vec![],
        due_date: Some(ts(10)),
        project_id: None,
        tags: vec![],
        created_at: ts(1),
        updated_at: ts(1),
        viewed_at: None,
    };
    let no_due = TaskRecord {
        due_date: None,
        name: "none".into(),
        ..in_range.clone()
    };
    let too_late = TaskRecord {
        due_date: Some(ts(20)),
        name: "late".into(),
        ..in_range.clone()
    };

    assert!(q.matches_in_memory(&in_range));
    assert!(!q.matches_in_memory(&no_due));
    assert!(!q.matches_in_memory(&too_late));
}

#[test]
fn search_matches_name_case_insensitively() {
    let mut q = query();
    q.search = Some("ship".into());
    let task = TaskRecord {
        id: Uuid::from_u128(1),
        name: "Ship the MCP tool".into(),
        status: None,
        priority: None,
        assignees: vec![],
        due_date: None,
        project_id: None,
        tags: vec![],
        created_at: ts(1),
        updated_at: ts(1),
        viewed_at: None,
    };
    assert!(q.matches_in_memory(&task));
    q.search = Some("email".into());
    assert!(!q.matches_in_memory(&task));
}

#[test]
fn my_tasks_ast_filters_status_and_assignee() {
    let q = TaskListQuery {
        statuses: OPEN_STATUSES.to_vec(),
        assignee_user_id: Some("macro|me@example.com".into()),
        ..query()
    };
    let ast = q.entity_filter_ast(None).expect("ast");
    let df = ast.document_filter.expect("document filter");
    let encoded = serde_json::to_string(&df).unwrap();
    assert!(encoded.contains(r#""dst":"task""#));

    let propf = ast.properties_filter.expect("properties filter");
    let encoded = serde_json::to_string(&propf).unwrap();
    assert!(encoded.contains(&StatusOption::InProgress.uuid().to_string()));
    assert!(encoded.contains("macro|me@example.com"));
    assert!(
        !encoded.contains(&StatusOption::Completed.uuid().to_string()),
        "open-status default must not include Completed"
    );
}

#[test]
fn none_priority_is_a_negated_priority_match() {
    let q = TaskListQuery {
        priorities: vec![TaskPriorityFilter::Unset],
        ..query()
    };
    let ast = q.entity_filter_ast(None).expect("ast");
    let encoded = serde_json::to_string(&ast.properties_filter).unwrap();
    assert!(
        encoded.contains(r#""!""#),
        "no-priority must negate the priority options: {encoded}"
    );
}

#[test]
fn resolve_assignee_id_accepts_me_email_and_user_id() {
    assert_eq!(
        resolve_assignee_id("me", "macro|me@example.com"),
        "macro|me@example.com"
    );
    assert_eq!(
        resolve_assignee_id("teo@macro.com", "macro|me@example.com"),
        "macro|teo@macro.com"
    );
    assert_eq!(
        resolve_assignee_id("macro|teo@macro.com", "macro|me@example.com"),
        "macro|teo@macro.com"
    );
}

#[test]
fn property_sorts_overfetch() {
    let mut q = query();
    q.sort = TaskSort::Priority;
    assert!(q.needs_overfetch());
    assert_eq!(q.soup_limit(50), FETCH_LIMIT);
    q.sort = TaskSort::RecentlyUpdated;
    assert!(!q.needs_overfetch());
    assert_eq!(q.soup_limit(50), 50);
}
