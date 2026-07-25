use super::*;

fn meta(
    identifier: Option<&str>,
    description: Option<&str>,
    status: Option<&str>,
    priority: Option<&str>,
    url: Option<&str>,
) -> LinearIssueMeta {
    LinearIssueMeta {
        identifier: identifier.map(String::from),
        title: "Fix the flux capacitor".into(),
        description: description.map(String::from),
        status: status.map(String::from),
        priority: priority.map(String::from),
        assignee: None,
        assignee_email: None,
        due_date: None,
        url: url.map(String::from),
    }
}

#[test]
fn linear_task_content_keeps_mapped_labels_out_of_the_footer() {
    // "In Progress" and "Urgent" both map onto real task properties, so the
    // footer carries only the provenance link.
    let (name, markdown) = linear_task_content(&meta(
        Some("ENG-142"),
        Some("It drifts.\n"),
        Some("In Progress"),
        Some("Urgent"),
        Some("https://linear.app/acme/issue/ENG-142"),
    ));
    assert_eq!(name, "ENG-142 Fix the flux capacitor");
    assert_eq!(
        markdown,
        "It drifts.\n\n---\nImported from [Linear](https://linear.app/acme/issue/ENG-142)"
    );
}

#[test]
fn linear_task_content_keeps_unmapped_labels_in_the_footer() {
    let (_, markdown) = linear_task_content(&meta(
        None,
        None,
        Some("Blocked on vendor"),
        Some("P0"),
        None,
    ));
    assert_eq!(
        markdown,
        "---\nStatus: Blocked on vendor · Priority: P0 · Imported from Linear"
    );
}

#[test]
fn linear_task_content_degrades_without_optional_fields() {
    let (name, markdown) = linear_task_content(&meta(None, None, None, None, None));
    assert_eq!(name, "Fix the flux capacitor");
    assert_eq!(markdown, "---\nImported from Linear");
}

#[test]
fn linear_status_and_priority_map_onto_macro_labels() {
    assert_eq!(map_linear_status("Backlog"), Some("Not Started"));
    assert_eq!(map_linear_status("Todo"), Some("Not Started"));
    assert_eq!(map_linear_status("In Progress"), Some("In Progress"));
    assert_eq!(map_linear_status("In Review"), Some("In Review"));
    assert_eq!(map_linear_status("Done"), Some("Completed"));
    assert_eq!(map_linear_status("Cancelled"), Some("Canceled"));
    assert_eq!(map_linear_status("Duplicate"), Some("Canceled"));
    assert_eq!(map_linear_status("Blocked on vendor"), None);

    assert_eq!(map_linear_priority("Urgent"), Some("Urgent"));
    assert_eq!(map_linear_priority("medium"), Some("Medium"));
    assert_eq!(map_linear_priority("No priority"), None);
}

#[test]
fn linear_task_properties_normalize_and_carry_through() {
    let mut input = meta(None, None, Some("Todo"), Some("High"), None);
    input.due_date = Some("2026-08-01".into());
    input.assignee_email = Some("sam@acme.com".into());
    let properties = linear_task_properties(&input);
    assert_eq!(properties.status.as_deref(), Some("Not Started"));
    assert_eq!(properties.priority.as_deref(), Some("High"));
    assert_eq!(properties.due_date.as_deref(), Some("2026-08-01"));
    assert_eq!(properties.assignee_email.as_deref(), Some("sam@acme.com"));

    // Unmappable labels drop out of the properties (they stay in the body).
    let odd = linear_task_properties(&meta(None, None, Some("Blocked"), Some("P0"), None));
    assert_eq!(odd.status, None);
    assert_eq!(odd.priority, None);
}

#[test]
fn notion_import_turns_scale_with_pages_and_cap() {
    assert_eq!(notion_import_max_turns(1), 8);
    assert_eq!(notion_import_max_turns(10), 26);
    assert_eq!(notion_import_max_turns(100), 40);
}

#[test]
fn slack_gather_lists_channels_with_an_explicit_empty_query() {
    let prompt = prompts::gather_system(ImportSource::Slack);

    assert!(prompt.contains("FIRST call `Search channels`"));
    assert!(prompt.contains(r#"{"query": ""}"#));
    assert!(prompt.contains("an empty query lists all channels"));
    assert!(!prompt.contains("Always pass a non-empty query"));
    assert!(prompt.contains("Participant details are optional"));
}

#[test]
fn notion_fetch_text_parses_the_fetch_document_shape() {
    let (title, body) = parse_notion_fetch_text(
        r##"{"id":"abc","title":"Roadmap H2","text":"# Roadmap\ncontent","url":"https://notion.so/x"}"##,
    );
    assert_eq!(title.as_deref(), Some("Roadmap H2"));
    assert_eq!(body, "# Roadmap\ncontent");

    // Anything else is the body itself.
    let (title, body) = parse_notion_fetch_text("# Plain markdown\nno wrapper");
    assert_eq!(title, None);
    assert_eq!(body, "# Plain markdown\nno wrapper");

    // JSON without a text field falls through to raw.
    let raw = r#"{"unexpected":"shape"}"#;
    let (title, body) = parse_notion_fetch_text(raw);
    assert_eq!(title, None);
    assert_eq!(body, raw);
}
