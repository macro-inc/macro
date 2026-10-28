use super::*;

pub(super) mod admission;

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
fn notion_import_failure_reason_preserves_the_actual_error() {
    let failure = Err(anyhow::anyhow!("notion fetch was truncated"));
    assert_eq!(
        notion_import_failure_reason(&failure),
        "notion fetch was truncated"
    );
    assert_eq!(
        notion_import_failure_reason(&Ok(())),
        "the import job did not finish this item"
    );
}

#[test]
fn notion_fetch_text_parses_the_fetch_document_shape() {
    let parsed = parse_notion_fetch_result(serde_json::Value::String(
        r##"{"id":"abc","title":"Roadmap H2","text":"# Roadmap\ncontent","url":"https://notion.so/x","properties":{"title":"Roadmap H2","Tags":["Planning","H2"],"Done":"__YES__","Score":4.5,"date:Due:start":"2026-08-01","date:Due:is_datetime":0}}"##
            .to_string(),
    ));
    assert_eq!(parsed.title.as_deref(), Some("Roadmap H2"));
    assert_eq!(parsed.body, "# Roadmap\ncontent");
    assert_eq!(parsed.properties.tags, vec!["Planning", "H2"]);
    assert_eq!(
        parsed.properties.values,
        vec![
            ImportedDocumentProperty {
                name: "Done".into(),
                value: ImportedDocumentPropertyValue::Boolean { value: true },
            },
            ImportedDocumentProperty {
                name: "Due".into(),
                value: ImportedDocumentPropertyValue::Date {
                    value: "2026-08-01".into(),
                },
            },
            ImportedDocumentProperty {
                name: "Score".into(),
                value: ImportedDocumentPropertyValue::Number { value: 4.5 },
            },
        ]
    );

    // Anything else is the body itself.
    let parsed = parse_notion_fetch_result(serde_json::Value::String(
        "# Plain markdown\nno wrapper".to_string(),
    ));
    assert_eq!(parsed.title, None);
    assert_eq!(parsed.body, "# Plain markdown\nno wrapper");

    // Metadata-only JSON is not page content.
    let raw = r#"{"unexpected":"shape"}"#;
    let parsed = parse_notion_fetch_result(serde_json::Value::String(raw.to_string()));
    assert_eq!(parsed.title, None);
    assert_eq!(parsed.body, "");
}

#[test]
fn notion_fetch_accepts_structured_markdown_and_resource_arrays() {
    let parsed = parse_notion_fetch_result(serde_json::json!({
        "object": "page_markdown",
        "id": "abc",
        "title": "Roadmap",
        "markdown": "# Actual body",
        "truncated": false,
    }));
    assert_eq!(parsed.title.as_deref(), Some("Roadmap"));
    assert_eq!(parsed.body, "# Actual body");

    let parsed = parse_notion_fetch_result(serde_json::json!([
        {"title": "Content team"},
        {"text": "First paragraph."},
        {"text": "Second paragraph."}
    ]));
    assert_eq!(parsed.title.as_deref(), Some("Content team"));
    assert_eq!(parsed.body, "First paragraph.\n\nSecond paragraph.");
}

#[test]
fn notion_property_cardinality_comes_from_the_source_shape() {
    let parsed = parse_notion_fetch_result(serde_json::json!({
        "title": "Roadmap",
        "text": "# Roadmap",
        "properties": {
            "Topics": ["Planning"],
            "Homepage": "https://notion.so/home",
            "References": ["https://notion.so/spec"]
        }
    }));

    assert_eq!(
        parsed.properties.values,
        vec![
            ImportedDocumentProperty {
                name: "Homepage".into(),
                value: ImportedDocumentPropertyValue::Link {
                    urls: vec!["https://notion.so/home".into()],
                    multi: false,
                },
            },
            ImportedDocumentProperty {
                name: "References".into(),
                value: ImportedDocumentPropertyValue::Link {
                    urls: vec!["https://notion.so/spec".into()],
                    multi: true,
                },
            },
            ImportedDocumentProperty {
                name: "Topics".into(),
                value: ImportedDocumentPropertyValue::Select {
                    values: vec!["Planning".into()],
                    multi: true,
                },
            },
        ]
    );
}

#[test]
fn notion_fetch_unwraps_hosted_mcp_page_content_and_properties() {
    let response = serde_json::json!({
        "metadata": {"type": "page"},
        "title": "Q1 Product + Engineering Planning",
        "url": "https://app.notion.com/p/4d005e63b2fd4d079df4e376e35b7519",
        "text": "Here is the result of \"view\" for the Page with URL https://app.notion.com/p/4d005e63b2fd4d079df4e376e35b7519 as of 2026-07-25T19:00:00Z:\n<page url=\"https://app.notion.com/p/4d005e63b2fd4d079df4e376e35b7519\">\n<properties>\n{\"Name\":\"Q1 Product + Engineering Planning\",\"Status\":\"Not started\",\"Tags\":[\"Planning\",\"Q1\"]}\n</properties>\n<content>\n## Pre-requisite reading\n\n- <page url=\"https://notion.so/preflight\">Macro 4.0 pre-flight items 🚀</page>\n- [x] Ship it\n</content>\n</page>"
    });

    let parsed = parse_notion_fetch_result(response);
    assert_eq!(
        parsed.title.as_deref(),
        Some("Q1 Product + Engineering Planning")
    );
    assert_eq!(
        parsed.body,
        "## Pre-requisite reading\n\n- <page url=\"https://notion.so/preflight\">Macro 4.0 pre-flight items 🚀</page>\n- [x] Ship it"
    );
    assert_eq!(parsed.properties.tags, vec!["Planning", "Q1"]);
    assert_eq!(
        parsed.properties.values,
        vec![ImportedDocumentProperty {
            name: "Status".into(),
            value: ImportedDocumentPropertyValue::String {
                value: "Not started".into(),
            },
        }]
    );
    assert!(!parsed.is_database);
    assert!(!parsed.truncated);
}

#[test]
fn notion_fetch_marks_databases_and_truncated_markdown() {
    let database = parse_notion_fetch_result(serde_json::json!({
        "metadata": {"type": "database"},
        "text": "A database"
    }));
    assert!(database.is_database);

    let truncated = parse_notion_fetch_result(serde_json::json!({
        "object": "page_markdown",
        "markdown": "# Partial",
        "truncated": true,
        "unknown_block_ids": ["abc"]
    }));
    assert!(truncated.truncated);
}

#[test]
fn notion_fetch_recognizes_documented_tool_aliases() {
    assert!(is_notion_fetch_tool_name("mcp__Notion__notion-fetch"));
    assert!(is_notion_fetch_tool_name("mcp__Notion__fetch"));
    assert!(!is_notion_fetch_tool_name("mcp__Notion__search"));
}

#[test]
fn notion_prompt_imports_only_source_backed_body_content() {
    let prompt = prompts::NOTION_IMPORT_SYSTEM;

    assert!(prompt.contains("canonical Notion `notion-fetch` tool"));
    assert!(prompt.contains("connector's page retrieval and block-children tools instead"));
    assert!(prompt.contains("following pagination and recursively reading blocks"));
    assert!(prompt.contains("Page metadata alone is not body content"));
    assert!(prompt.contains("Never use a search snippet or a generic `view` result"));
    assert!(prompt.contains("ONLY body content that actually appears in the fetched page"));
    assert!(prompt.contains(r#"Here is the result of "view"..."#));
    assert!(prompt.contains(r#"[{"title":"Content team"}]"#));
    assert!(prompt.contains("use only the contents of `<content>`"));
    assert!(prompt.contains("do not repeat it in `content_markdown`"));
    assert!(prompt.contains("inferred or invented"));
    assert!(prompt.contains("Remove every `<database>`"));
    assert!(prompt.contains("skip the whole page"));
    assert!(prompt.contains("arrays are multi-valued even when"));
    assert!(!prompt.contains("staged summary plus the backlink"));
}

#[test]
fn notion_tool_result_wrappers_are_rejected_as_content() {
    let view_wrapper = r#"Here is the result of "view" for the Page with URL https://app.notion.com/p/39dd7bb70863806ab8afe6d96ecf9701 as of 2026-07-14T21:50:42.234Z:
[{"title":""}]"#;
    assert!(check_notion_markdown(view_wrapper).is_err());
    assert!(check_notion_markdown(r#"[{"title":"Content team"}]"#).is_err());
    assert!(check_notion_markdown("# Actual page content").is_ok());
}

#[test]
fn notion_database_heavy_pages_are_detected() {
    assert!(notion_page_is_mostly_database(
        r#"<database url="https://notion.so/database">Content calendar</database>"#
    ));
    assert!(notion_page_is_mostly_database(
        r#"A short introduction.
<database url="https://notion.so/database">Content calendar</database>"#
    ));
    assert!(!notion_page_is_mostly_database(
        "A substantive standalone page without any database content."
    ));

    let substantive = format!(
        "{}\n<database url=\"https://notion.so/database\">Content calendar</database>",
        "Useful non-database documentation. ".repeat(20)
    );
    assert!(!notion_page_is_mostly_database(&substantive));
}
