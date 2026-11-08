use super::*;

fn config(seed: u64) -> SimConfig {
    let mut config = SimConfig::editor(seed);
    let SeedDocument::Editor(state) = config.seeds.get_mut(&DocIx(0)).unwrap() else {
        panic!("editor seed");
    };
    state["root"]["children"][0]["children"][0]["text"] = serde_json::json!("tail");
    config
}
fn text(node: &serde_json::Value) -> String {
    if let Some(value) = node.get("text").and_then(serde_json::Value::as_str) {
        return value.into();
    }
    node.get("children")
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .map(text)
        .collect()
}
#[test]
fn browser_shortcuts_use_real_per_character_package_followups() {
    // Actual source-web-plugin probe: three conversions; bare backticks decline.
    for (shortcut, kind, contents) in [
        (0, "heading", "tail"),
        (1, "task-list", "tail"),
        (2, "quote", "tail"),
        (3, "paragraph", "```tail"),
    ] {
        let outcome = verify(
            config(839 + u64::from(shortcut)),
            &[
                Step::Open(OpenSpec::form("writer", "one")),
                Step::Open(OpenSpec::form("reader", "two")),
                Step::Settle,
                Step::Edit {
                    client: ClientName("writer".into()),
                    op: AbstractOp::Editor(EditorOp::MarkdownShortcut { block: 0, shortcut }),
                },
                Step::Settle,
            ],
        );
        let state = &outcome.finals.clients[&ClientName("writer".into())]
            .editor
            .as_ref()
            .unwrap()
            .synced_json;
        let block = &state["root"]["children"][0];
        assert_eq!(block["type"], kind, "shortcut{shortcut}: {state}");
        assert_eq!(text(block), contents);
        assert!(outcome.events.iter().any(|event| matches!(&event.fact,
            Fact::LocalOp { op: AbstractOp::Editor(EditorOp::MarkdownShortcut { shortcut: actual, .. }), spans, .. }
                if *actual == shortcut && !spans.is_empty())));
        assert!(!outcome.events.iter().any(|event| matches!(
            &event.fact,
            Fact::LocalOp {
                op: AbstractOp::Editor(EditorOp::Type { .. }),
                ..
            }
        )));
    }
}
#[test]
fn ordinary_typing_stays_literal_and_shipping_ai_has_no_browser_shortcut_binding() {
    let mut ai = OpenSpec::form("ai", "two");
    ai.kind = ClientKind::AiWorker;
    let outcome = verify(
        config(847),
        &[
            Step::Open(OpenSpec::form("writer", "one")),
            Step::Open(ai),
            Step::Settle,
            Step::Edit {
                client: ClientName("writer".into()),
                op: AbstractOp::Editor(EditorOp::Type {
                    at: Pos::default(),
                    text: "# ".into(),
                }),
            },
            Step::Edit {
                client: ClientName("ai".into()),
                op: AbstractOp::Editor(EditorOp::MarkdownShortcut {
                    block: 0,
                    shortcut: 0,
                }),
            },
            Step::Settle,
        ],
    );
    let state = &outcome.finals.clients[&ClientName("writer".into())]
        .editor
        .as_ref()
        .unwrap()
        .synced_json;
    assert_eq!(state["root"]["children"][0]["type"], "paragraph");
    assert_eq!(text(&state["root"]["children"][0]), "# tail");
    assert!(outcome.events.iter().any(|event| matches!(&event.fact,
        Fact::OpSkipped { client, reason } if client.0 == "ai" && reason == "BrowserShortcutUnavailable")));
}
