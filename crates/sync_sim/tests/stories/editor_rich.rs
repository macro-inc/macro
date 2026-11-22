use super::*;

#[test]
fn application_block_commands_keep_real_replacements_and_durable_ids() {
    for (kind, expected) in [
        (0, "paragraph"),
        (1, "heading"),
        (2, "heading"),
        (3, "heading"),
        (4, "quote"),
        (5, "custom-code"),
    ] {
        let outcome = verify(
            SimConfig::editor(751),
            &[
                Step::Open(OpenSpec::form("a", "one")),
                Step::Open(OpenSpec::form("b", "two")),
                Step::Settle,
                Step::Edit {
                    client: ClientName("a".into()),
                    op: AbstractOp::Editor(EditorOp::SetBlock {
                        at: Pos::default(),
                        kind,
                    }),
                },
                Step::Settle,
            ],
        );
        for name in ["a", "b"] {
            let state = &outcome.finals.clients[&ClientName(name.into())]
                .editor
                .as_ref()
                .unwrap()
                .synced_json;
            let block = &state["root"]["children"][0];
            assert_eq!(block["type"], expected);
            assert_eq!(block["$"]["id"].as_str().unwrap().len(), 8);
            if (1..=3).contains(&kind) {
                assert_eq!(block["tag"], format!("h{kind}"));
            }
        }
    }
}

#[test]
fn application_list_commands_create_task_list_replacements() {
    for kind in 0..3 {
        let mut writer = OpenSpec::form("a", "one");
        writer.kind = ClientKind::AiWorker;
        let outcome = verify(
            SimConfig::editor(752),
            &[
                Step::Open(writer),
                Step::Open(OpenSpec::form("b", "two")),
                Step::Settle,
                Step::Edit {
                    client: ClientName("a".into()),
                    op: AbstractOp::Editor(EditorOp::ToggleList {
                        at: Pos::default(),
                        kind,
                    }),
                },
                Step::Settle,
            ],
        );
        let list = &outcome.finals.clients[&ClientName("b".into())]
            .editor
            .as_ref()
            .unwrap()
            .synced_json["root"]["children"][0];
        assert_eq!(list["type"], "task-list");
        assert_eq!(list["$"]["id"].as_str().unwrap().len(), 11);
        assert_eq!(
            list["listType"],
            ["number", "bullet", "check"][usize::from(kind)]
        );
        assert_eq!(list["children"][0]["type"], "listitem");
    }
}

#[test]
fn application_table_behavior_composes_with_the_application_registry() {
    let outcome = verify(
        SimConfig::editor(753),
        &[
            Step::Open(OpenSpec::form("a", "one")),
            Step::Open(OpenSpec::form("b", "two")),
            Step::Settle,
            Step::Edit {
                client: ClientName("a".into()),
                op: AbstractOp::Editor(EditorOp::InsertTable {
                    at: Pos::default(),
                    rows: 1,
                    cols: 2,
                }),
            },
            Step::Settle,
        ],
    );
    for name in ["a", "b"] {
        let blocks = outcome.finals.clients[&ClientName(name.into())]
            .editor
            .as_ref()
            .unwrap()
            .synced_json["root"]["children"]
            .as_array()
            .unwrap()
            .clone();
        let table = blocks
            .iter()
            .find(|block| block["type"] == "table")
            .unwrap();
        let rows = table["children"].as_array().unwrap();
        assert_eq!(rows.len(), 2);
        for row in rows {
            let cells = row["children"].as_array().unwrap();
            assert_eq!(cells.len(), 3);
            assert!(cells.iter().all(|cell| cell["type"] == "tablecell"));
        }
    }
}
