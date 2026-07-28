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
fn slack_gather_lists_channels_with_an_explicit_empty_query() {
    let prompt = prompts::gather_system(ImportSource::Slack);

    assert!(prompt.contains("FIRST call `Search channels`"));
    assert!(prompt.contains(r#"{"query": ""}"#));
    assert!(prompt.contains("an empty query lists all channels"));
    assert!(!prompt.contains("Always pass a non-empty query"));
    assert!(prompt.contains("Participant details are optional"));
}

#[test]
fn slack_channel_search_tool_names_match_by_shape() {
    assert!(is_slack_channel_search_tool_name(
        "mcp__Slack__search_channels"
    ));
    assert!(is_slack_channel_search_tool_name(
        "mcp__Slack__slack_search_channels"
    ));
    assert!(is_slack_channel_search_tool_name(
        "mcp__Slack__search-channels"
    ));
    assert!(is_slack_channel_search_tool_name(
        "mcp__Slack__list_channels"
    ));
    assert!(is_slack_channel_search_tool_name(
        "mcp__Slack__conversations_list"
    ));

    // Other channel-adjacent surfaces must not be mistaken for the listing.
    assert!(!is_slack_channel_search_tool_name(
        "mcp__Slack__list_channel_members"
    ));
    assert!(!is_slack_channel_search_tool_name(
        "mcp__Slack__search_messages_and_files"
    ));
    assert!(!is_slack_channel_search_tool_name(
        "mcp__Slack__get_channel_history"
    ));
    assert!(!is_slack_channel_search_tool_name(
        "mcp__Slack__create_channel"
    ));
    assert!(!is_slack_channel_search_tool_name(
        "mcp__Slack__search_users"
    ));
    assert!(!is_slack_channel_search_tool_name("search_channels")); // unmangled
}

#[test]
fn slack_channel_page_parses_structured_results_with_cursors() {
    let page = parse_slack_channel_page(serde_json::json!({
        "channels": [
            {
                "id": "C0123456789",
                "name": "engineering",
                "purpose": { "value": "Build the thing" },
                "member_count": 42,
                "is_archived": false,
            },
            {
                "id": "C0000000001",
                "name": "#design",
                "topic": "Make it pretty",
                "num_members": 7,
            },
            { "id": "D0123456789", "name": "dm", "is_im": true },
            { "id": "C0000000002", "name": "old-stuff", "is_archived": true },
        ],
        "response_metadata": { "next_cursor": "cursor-2" },
    }));

    assert_eq!(page.next_cursor.as_deref(), Some("cursor-2"));
    assert_eq!(
        page.channels,
        vec![
            SlackChannelCandidate {
                id: Some("C0123456789".into()),
                name: "engineering".into(),
                purpose: Some("Build the thing".into()),
                member_count: Some(42),
                archived: false,
            },
            SlackChannelCandidate {
                id: Some("C0000000001".into()),
                name: "design".into(),
                purpose: Some("Make it pretty".into()),
                member_count: Some(7),
                archived: false,
            },
            SlackChannelCandidate {
                id: Some("C0000000002".into()),
                name: "old-stuff".into(),
                purpose: None,
                member_count: None,
                archived: true,
            },
        ]
    );
}

#[test]
fn slack_channel_page_parses_json_text_and_bare_arrays() {
    // Results without structured content arrive as JSON re-encoded as text.
    let page = parse_slack_channel_page(serde_json::Value::String(
        r#"{"results": [{"id": "C1", "name": "general"}], "next_cursor": "abc"}"#.to_string(),
    ));
    assert_eq!(page.channels.len(), 1);
    assert_eq!(page.channels[0].name, "general");
    assert_eq!(page.next_cursor.as_deref(), Some("abc"));

    let page = parse_slack_channel_page(serde_json::json!([
        { "id": "C1", "name": "general" },
        { "id": "C2", "name": "random" },
    ]));
    assert_eq!(page.channels.len(), 2);
    assert_eq!(page.next_cursor, None);

    // Plain prose is not a channel list.
    let page = parse_slack_channel_page(serde_json::Value::String("No channels found.".into()));
    assert_eq!(page, SlackChannelPage::default());

    // An empty cursor string means "no more pages", not a page named "".
    let page = parse_slack_channel_page(serde_json::json!({
        "channels": [{ "id": "C1", "name": "general" }],
        "response_metadata": { "next_cursor": "" },
    }));
    assert_eq!(page.next_cursor, None);
}

#[test]
fn slack_candidates_rank_by_size_dedupe_and_cap() {
    let channel = |id: &str, name: &str, members: Option<u64>| SlackChannelCandidate {
        id: Some(id.to_string()),
        name: name.to_string(),
        purpose: None,
        member_count: members,
        archived: false,
    };

    let mut channels = vec![
        channel("C1", "tiny", Some(2)),
        channel("C2", "big", Some(50)),
        channel("C2", "big", Some(50)), // duplicate id collapses
        channel("C3", "medium", Some(10)),
        SlackChannelCandidate {
            archived: true,
            ..channel("C4", "archived", Some(99))
        },
        // No id: deduped by name instead.
        SlackChannelCandidate {
            id: None,
            ..channel("", "no-id", None)
        },
        SlackChannelCandidate {
            id: None,
            ..channel("", "no-id", None)
        },
    ];
    channels
        .extend((0..20).map(|i| channel(&format!("C{}", 100 + i), &format!("filler-{i}"), None)));

    let selected = select_slack_candidates(channels, SLACK_GATHER_MAX_CHANNELS);
    assert_eq!(selected.len(), SLACK_GATHER_MAX_CHANNELS);
    // Largest first; archived and duplicates gone.
    assert_eq!(selected[0].name, "big");
    assert_eq!(selected[1].name, "medium");
    assert_eq!(selected[2].name, "tiny");
    assert!(selected.iter().all(|channel| !channel.archived));
    assert_eq!(
        selected
            .iter()
            .filter(|channel| channel.name == "no-id")
            .count(),
        1
    );
    // Ties keep listing order.
    assert_eq!(selected[3].name, "no-id");
    assert_eq!(selected[4].name, "filler-0");
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
fn notion_page_references_become_external_markdown_links() {
    let input = r#"<ancestor-path>
<ancestor-3-page url="https://app.notion.com/p/93fa70f914eb477f89049c38912f9bb1" title=""/>
<ancestor-4-page url="https://app.notion.com/p/dcff3c11ce9847f9b17b4a10eafa4410" title="Parent"/>
</ancestor-path>
See <mention-page url="https://notion.so/roadmap">Roadmap</mention-page>.
<page url="https://notion.so/spec">Product spec</page>
<page url="https://notion.so/draft">Plan \ [draft]</page>"#;

    assert_eq!(
        normalize_notion_markdown(input),
        "[Notion page](https://app.notion.com/p/93fa70f914eb477f89049c38912f9bb1)\n\
[Parent](https://app.notion.com/p/dcff3c11ce9847f9b17b4a10eafa4410)\n\
See [Roadmap](https://notion.so/roadmap).\n\
[Product spec](https://notion.so/spec)\n\
[Plan \\\\ \\[draft\\]](https://notion.so/draft)"
    );
}

#[test]
fn notion_prompt_imports_only_source_backed_body_content() {
    let prompt = prompts::NOTION_IMPORT_SYSTEM;

    assert!(prompt.contains("canonical Notion `notion-fetch` tool"));
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
    assert!(prepare_notion_markdown(view_wrapper).is_err());
    assert!(prepare_notion_markdown(r#"[{"title":"Content team"}]"#).is_err());
    assert!(prepare_notion_markdown("# Actual page content").is_ok());
}

#[test]
fn notion_toggles_and_databases_are_not_imported_as_markup() {
    let input = r#"# Useful notes {toggle="true"}
Keep this text.
<database url="https://notion.so/database">Content calendar</database>
<mention-database url="https://notion.so/roadmap">Roadmap</mention-database>
End."#;

    assert_eq!(
        normalize_notion_markdown(input),
        "# Useful notes\nKeep this text.\n\n\nEnd."
    );
}

#[test]
fn notion_enhanced_markdown_becomes_macro_markdown() {
    let input = r#"<details color="Gray">
<summary>Coming in Q2 (starts <mention-date start="2024-04-01"/>)</summary>
	### Revamp Java PDF Parser
	- [ ] Open task
	- [x] Assigned to <mention-user url="https://notion.so/user">Teo Nys</mention-user>
	<callout icon="🔢" color="Gray">
		Numbers are estimates in **weeks**.
	</callout>
</details>

<file src="https://notion.so/organizing-polish.docx">Organizing-polish.docx</file>
<span underline="true">Readable text</span>
<unknown url="https://notion.so/unsupported" alt="Linked preview"/>
<empty-block/>"#;

    assert_eq!(
        normalize_notion_markdown(input),
        "Coming in Q2 (starts April 1, 2024)\n\
### Revamp Java PDF Parser\n\
- [ ] Open task\n\
- [x] Assigned to @Teo Nys\n\
> 🔢 Numbers are estimates in **weeks**.\n\
\n\
[Organizing-polish.docx](https://notion.so/organizing-polish.docx)\n\
Readable text\n\
[Linked preview](https://notion.so/unsupported)"
    );
}

#[test]
fn notion_escaped_todos_are_repaired_but_code_examples_are_untouched() {
    let input = r#"\[x\] Completed
	\[ \] Nested

```text
\[x\] This is an example
<page url="https://notion.so/example">also an example</page>
```"#;

    assert_eq!(
        normalize_notion_markdown(input),
        "- [x] Completed\n\
\t- [ ] Nested\n\
\n\
```text\n\
\\[x\\] This is an example\n\
<page url=\"https://notion.so/example\">also an example</page>\n\
```"
    );
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

#[test]
fn notion_tables_become_rectangular_macro_pipe_tables() {
    let input = r#"<table fit-page-width="true" header-row="true">
<colgroup>
<col width="379">
<col width="230">
</colgroup>
<tr>
<td>AI PDF Editors</td>
<td>Features</td>
<td>Pricing</td>
</tr>
<tr>
lc
</tr>
<tr>
<td>PDFelement</td>
<td>• Automatically bookmarks important pages
• Use Lumi AI to chat with PDFs</td>
<td>Paid plans start at $79.99 per year.</td>
</tr>
<tr><td>Forma | Pro</td><td>Draft with AI</td></tr>
</table>"#;

    assert_eq!(
        normalize_notion_markdown(input),
        "| AI PDF Editors | Features | Pricing |\n\
| --- | --- | --- |\n\
| PDFelement | • Automatically bookmarks important pages\\n• Use Lumi AI to chat with PDFs | Paid plans start at $79.99 per year. |\n\
| Forma &#124; Pro | Draft with AI |  |"
    );
}
