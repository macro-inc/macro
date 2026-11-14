use crate::{Offer, View, Widget, decode_view, present_view_schema};
use serde_json::json;

/// One of every widget, with every field the types name.
#[test]
fn a_view_of_every_widget_decodes() {
    let view = json!({
        "title": "Everything",
        "widgets": [
            { "type": "md", "markdown": "**Shipped** the agenda." },
            {
                "type": "timeline",
                "title": "Today",
                "events": [{
                    "time": "9:00am",
                    "title": "Standup",
                    "description": "Daily",
                    "entity": { "id": "doc-1", "type": "document" },
                    "future": true
                }]
            },
            {
                "type": "list",
                "title": "Initiatives",
                "source": { "kind": "items", "entities": [{ "id": "init-1", "type": "initiative" }] },
                "groupBy": "project",
                "limit": 5
            },
            {
                "type": "list",
                "source": {
                    "kind": "query",
                    "query": {
                        "include": { "documentId": ["doc-1"], "channelId": ["channel-1"] },
                        "documentWhere": [{ "op": "not", "clause": { "include": { "documentDone": true } } }],
                        "emailView": "inbox"
                    }
                }
            },
            { "type": "channelMessage", "channelId": "channel-1", "messageId": "message-1" },
            { "type": "events", "title": "This week", "events": [{ "eventId": "event-1", "occurrenceKey": "2026-10-14" }] },
            { "type": "cards", "title": "Docs", "items": [{ "type": "document", "id": "doc-1" }, { "type": "database", "id": "database-1" }] },
            {
                "type": "tags",
                "title": "Engineering tags",
                "tags": [{
                    "label": "Type",
                    "description": "What kind of work it is",
                    "children": [{ "label": "bug", "color": "red", "tagId": "tag-1" }]
                }]
            },
            {
                "type": "agentUpdates",
                "items": [{
                    "session": { "id": "session-1" },
                    "sessionName": "Signing",
                    "harness": "opencode",
                    "kind": "tool_approval",
                    "since": "2026-10-30T20:00:00Z"
                }]
            },
            {
                "type": "container",
                "direction": "row",
                "gap": 8,
                "wrap": false,
                "align": "start",
                "justify": "between",
                "title": "Side by side",
                "children": [
                    { "type": "md", "markdown": "Left" },
                    { "type": "container", "children": [{ "type": "md", "markdown": "Nested" }] }
                ]
            }
        ]
    });
    let decoded = decode_view(&view).expect("every widget decodes");
    assert_eq!(serde_json::to_value(&decoded).unwrap(), view);
}

/// The model's schema negates only a clause, but a view that negates a
/// combination, as the web's query can, still decodes.
#[test]
fn a_negated_combination_decodes() {
    let view = json!({
        "widgets": [{
            "type": "list",
            "source": {
                "kind": "query",
                "query": {
                    "documentWhere": {
                        "op": "not",
                        "clause": {
                            "op": "or",
                            "clauses": [
                                { "include": { "documentDone": true } },
                                { "op": "not", "clause": { "op": "and", "clauses": [] } }
                            ]
                        }
                    }
                }
            }
        }]
    });
    let decoded = decode_view(&view).expect("a negated combination decodes");
    assert_eq!(serde_json::to_value(&decoded).unwrap(), view);
}

/// The model passes macro.agentSessions.updates() items unchanged.
#[test]
fn agent_updates_take_the_sdk_items_as_they_serialize() {
    let view = json!({
        "widgets": [{
            "type": "agentUpdates",
            "items": [{
                "session": { "id": "session-1", "url": "https://macro.com/app/agent/session-1" },
                "sessionName": "Signing",
                "harness": "opencode",
                "pullRequestUrl": "https://github.com/o/r/pull/1",
                "kind": "permission",
                "summary": "Signing wants to run codesign",
                "since": "2026-10-30T20:00:00Z",
                "options": ["Allow"]
            }]
        }]
    });
    assert_eq!(
        serde_json::to_value(decode_view(&view).unwrap()).unwrap(),
        json!({
            "widgets": [{
                "type": "agentUpdates",
                "items": [{
                    "session": { "id": "session-1" },
                    "sessionName": "Signing",
                    "harness": "opencode",
                    "kind": "permission",
                    "since": "2026-10-30T20:00:00Z"
                }]
            }]
        })
    );
}

#[test]
fn fields_the_types_do_not_name_are_dropped() {
    let view = json!({
        "title": "Notes",
        "theme": "dark",
        "widgets": [{ "type": "md", "markdown": "Hi", "style": { "bold": true } }]
    });
    assert_eq!(
        decode_view(&view),
        Ok(View {
            title: Some("Notes".to_owned()),
            widgets: vec![Widget::Md {
                markdown: "Hi".to_owned()
            }],
        })
    );
}

/// The views the old schema check turned back, each still turned back, with
/// where the problem is.
#[test]
fn what_the_renderer_cannot_draw_is_named_by_its_place() {
    let widget_types = "`md`, `timeline`, `list`, `channelMessage`, `events`, `cards`, `tags`, `agentUpdates`, `container`";
    let cases = [
        (
            json!({ "widgets": [{ "type": "markdown", "markdown": "### Routines" }] }),
            format!("view.widgets[0].type should be one of {widget_types}"),
        ),
        (
            json!({ "widgets": [{ "type": "list", "title": "Created docs" }] }),
            r#"view.widgets[0] is missing "source""#.to_owned(),
        ),
        (
            json!({ "widgets": [{ "type": "container", "children": [{ "type": "channelMessage", "channelId": "channel-1" }] }] }),
            r#"view.widgets[0] is missing "messageId""#.to_owned(),
        ),
        (
            json!({ "widgets": [{ "type": "list", "source": { "entities": [] } }] }),
            r#"view.widgets[0] is missing "kind""#.to_owned(),
        ),
        (
            json!({ "widgets": [{ "title": "No type" }] }),
            r#"view.widgets[0] is missing "type""#.to_owned(),
        ),
        (
            json!({ "widgets": {} }),
            "view.widgets should be an array, not an object".to_owned(),
        ),
        (
            json!({ "widgets": [{ "type": "container", "gap": 9, "children": [] }] }),
            "view.widgets[0] should be less or equal to 8".to_owned(),
        ),
        (
            json!({ "widgets": [{ "type": "tags", "title": "Created tags" }] }),
            r#"view.widgets[0] is missing "tags""#.to_owned(),
        ),
        (
            json!({ "widgets": [{ "type": "cards", "items": [{ "type": "spaceship", "id": "s-1" }] }] }),
            "view.widgets[0] should be one of `document`, `database`, `email_thread`, `calendar_event`, `project`, `channel`, `routine`, `form`, `initiative`"
                .to_owned(),
        ),
        (
            json!({ "widgets": [{ "type": "tags", "tags": [{ "label": "Type", "children": [{ "color": "red" }] }] }] }),
            r#"view.widgets[0] is missing "label""#.to_owned(),
        ),
        (json!({}), r#"view is missing "widgets""#.to_owned()),
    ];
    for (view, problem) in cases {
        assert_eq!(decode_view(&view), Err(problem), "{view}");
    }
}

#[test]
fn a_problem_never_repeats_what_the_view_holds() {
    let cases = [
        json!({ "title": 7, "widgets": [] }),
        json!({ "widgets": ["private text"] }),
        json!({ "widgets": [{ "type": "private type" }] }),
        json!({ "widgets": [{ "type": "md", "markdown": 4242 }] }),
        json!({ "widgets": [{ "type": "container", "gap": "private gap", "children": [] }] }),
        json!({ "widgets": [{ "type": "list", "source": { "kind": "items", "entities": [{ "id": "a", "type": "private kind" }] } }] }),
        json!("private view"),
    ];
    for view in cases {
        let problem = decode_view(&view).expect_err("turned back");
        assert!(
            !problem.contains("private") && !problem.contains("4242"),
            "{problem}"
        );
    }
}

/// Maps are sorted: serde_json keeps insertion order only when a build
/// unifies its `preserve_order` feature.
#[test]
fn the_present_view_schema_is_pinned() {
    let schema: serde_json::Value =
        serde_json::from_str(&present_view_schema(Offer::Views)).expect("the schema is JSON");
    insta::with_settings!({ sort_maps => true }, {
        insta::assert_json_snapshot!(schema);
    });
}

#[test]
fn the_dashboard_schema_is_pinned() {
    let schema: serde_json::Value =
        serde_json::from_str(&present_view_schema(Offer::Dashboards)).expect("the schema is JSON");
    insta::with_settings!({ sort_maps => true }, {
        insta::assert_json_snapshot!(schema);
    });
}

/// The widget types a schema offers the model.
fn offered_types(offer: Offer) -> Vec<String> {
    let schema: serde_json::Value =
        serde_json::from_str(&present_view_schema(offer)).expect("the schema is JSON");
    schema["$defs"]["Widget"]["oneOf"]
        .as_array()
        .expect("widget variants")
        .iter()
        .map(|variant| {
            variant["properties"]["type"]["const"]
                .as_str()
                .unwrap()
                .to_owned()
        })
        .collect()
}

/// Without agent dashboards the model never reads the dashboard widgets,
/// though a view holding them still decodes.
#[test]
fn only_dashboards_offer_layouts_and_panes() {
    let views = [
        "md",
        "timeline",
        "list",
        "channelMessage",
        "events",
        "cards",
        "tags",
        "agentUpdates",
        "container",
    ];
    assert_eq!(offered_types(Offer::Views), views);
    let mut dashboards = views.to_vec();
    dashboards.extend(["grid", "tabs", "stat", "chart", "table", "savedView"]);
    assert_eq!(offered_types(Offer::Dashboards), dashboards);

    let views_schema = present_view_schema(Offer::Views);
    for name in ["Grid", "Stat", "dense", "queryId"] {
        assert!(!views_schema.contains(&format!("\"{name}\"")), "{name}");
    }
}

/// Every dashboard layout and pane, with every field the types name.
#[test]
fn a_dashboard_of_every_pane_decodes() {
    let view = json!({
        "title": "Operations",
        "widgets": [{
            "type": "tabs",
            "tabs": [
                {
                    "label": "Monitor",
                    "children": [{
                        "type": "grid",
                        "title": "Today",
                        "columns": 12,
                        "spans": [3, 3, 6, 12],
                        "rowHeight": 240,
                        "dense": true,
                        "children": [
                            {
                                "type": "stat",
                                "label": "Open invoices",
                                "source": { "kind": "query", "queryId": "query-1" },
                                "delta": true,
                                "sparkline": true,
                                "dense": true
                            },
                            {
                                "type": "stat",
                                "label": "Open tasks",
                                "source": { "kind": "count", "query": { "include": { "documentDone": false } } }
                            },
                            {
                                "type": "chart",
                                "queryId": "query-2",
                                "mode": "bar",
                                "chart": { "x": "week", "y": ["invoices"], "title": "Invoices", "color": "status", "stack": true },
                                "dense": false
                            },
                            {
                                "type": "table",
                                "title": "Customers",
                                "source": { "kind": "view", "databaseId": "database-1", "viewId": "view-1" },
                                "dense": true
                            }
                        ]
                    }]
                },
                {
                    "label": "Work",
                    "children": [
                        { "type": "table", "source": { "kind": "query", "queryId": "query-3" } },
                        { "type": "savedView", "viewId": "saved-1", "title": "My tasks", "dense": true }
                    ]
                }
            ]
        }]
    });
    let decoded = decode_view(&view).expect("every pane decodes");
    assert_eq!(serde_json::to_value(&decoded).unwrap(), view);
}

#[test]
fn a_dashboard_out_of_bounds_is_named_by_its_place() {
    let cases = [
        (
            json!({ "widgets": [{ "type": "grid", "columns": 13, "children": [] }] }),
            "view.widgets[0] should be less or equal to 12",
        ),
        (
            json!({ "widgets": [{ "type": "grid", "columns": 0, "children": [] }] }),
            "view.widgets[0] should be greater or equal to 1",
        ),
        (
            json!({ "widgets": [{ "type": "grid", "columns": 2, "spans": [1, 13], "children": [] }] }),
            "view.widgets[0] should be less or equal to 12",
        ),
        (
            json!({ "widgets": [{ "type": "grid", "columns": 2, "rowHeight": 20, "children": [] }] }),
            "view.widgets[0] should be greater or equal to 64",
        ),
        (
            json!({ "widgets": [{ "type": "chart", "queryId": "q", "mode": "donut", "chart": { "x": "a", "y": ["b"] } }] }),
            "view.widgets[0] should be one of `bar`, `line`, `area`, `scatter`, `pie`",
        ),
        (
            json!({ "widgets": [{ "type": "stat", "label": "Open", "source": { "kind": "sql" } }] }),
            "view.widgets[0] should be `query` or `count`",
        ),
        (
            json!({ "widgets": [{ "type": "table", "source": { "kind": "view", "viewId": "v" } }] }),
            r#"view.widgets[0] is missing "databaseId""#,
        ),
    ];
    for (view, problem) in cases {
        assert_eq!(decode_view(&view), Err(problem.to_owned()), "{view}");
    }
}
