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
        url: url.map(String::from),
    }
}

#[test]
fn linear_task_content_composes_name_and_footer() {
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
        "It drifts.\n\n---\nStatus: In Progress · Priority: Urgent · Imported from \
         [Linear](https://linear.app/acme/issue/ENG-142)"
    );
}

#[test]
fn linear_task_content_degrades_without_optional_fields() {
    let (name, markdown) = linear_task_content(&meta(None, None, None, None, None));
    assert_eq!(name, "Fix the flux capacitor");
    assert_eq!(markdown, "---\nImported from Linear");
}

#[test]
fn notion_import_turns_scale_with_pages_and_cap() {
    assert_eq!(notion_import_max_turns(1), 8);
    assert_eq!(notion_import_max_turns(10), 26);
    assert_eq!(notion_import_max_turns(100), 40);
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
