use super::application::application_config;
use crate::*;
use serde_json::json;

#[test]
fn table_facts_query_forwards_the_shared_bulk_dto_under_read_without_writes() {
    let session = NativeEditorSession::new(
        application_config(),
        None,
        FfiNow {
            mono_ms: 0,
            wall_ms: 1_000_000,
        },
    )
    .unwrap();
    session
        .handle(
            FfiNow {
                mono_ms: 0,
                wall_ms: 1_000_000,
            },
            FfiInput::Start,
        )
        .unwrap();
    session
        .handle(
            FfiNow {
                mono_ms: 1,
                wall_ms: 1_000_001,
            },
            FfiInput::Seed {
                kind: SeedKind::Optimistic,
                snapshot: vec![],
            },
        )
        .unwrap();
    session.handle(FfiNow {mono_ms:2,wall_ms:1_000_002},FfiInput::SetState {root:serde_json::from_value(json!({"type":"root","children":[{"type":"table","colWidths":[80,140],"children":[{"type":"tablerow","children":[
        {"type":"tablecell","headerState":1,"children":[{"type":"paragraph","children":[{"type":"text","text":"A"}]}]},
        {"type":"tablecell","children":[{"type":"paragraph","children":[{"type":"text","text":"B"}]}]}
    ]}]}]})).unwrap()}).unwrap();
    let FfiQueryReply::Nodes { keys, .. } = session
        .query(FfiQuery::NodesOfType {
            name: "table".into(),
        })
        .unwrap()
    else {
        panic!("table")
    };
    let table = keys[0];
    session
        .handle(
            FfiNow {
                mono_ms: 3,
                wall_ms: 1_000_003,
            },
            FfiInput::Authorization {
                state: AuthorizationState {
                    current: true,
                    can_write: false,
                    can_comment: false,
                },
            },
        )
        .unwrap();
    assert_eq!(session.effective_access().unwrap(), Access::Read);
    let before = session.text_content().unwrap();
    let mut data = json!({"keys":[table.index()]});
    let result = session
        .application_query(
            "group-b.table-facts".into(),
            data.clone(),
            table.generation(),
        )
        .unwrap();
    assert_eq!(result["tables"][0]["columnCount"], 2);
    assert_eq!(
        result["tables"][0]["colWidths"],
        json!({"kind":"value","value":[80,140]})
    );
    assert_eq!(result["tables"][0]["cells"][0]["headerState"], 1);
    assert_eq!(
        result["tables"][0]["cells"]
            .as_array()
            .expect("cells")
            .len(),
        2
    );
    assert_eq!(session.text_content().unwrap(), before);
    assert!(
        session
            .application_query(
                "group-b.table-facts".into(),
                serde_json::Value::Null,
                table.generation() + 1
            )
            .is_err()
    );
    data["keys"] = json!([table.index(), 0]);
    assert!(
        session
            .application_query("group-b.table-facts".into(), data, table.generation())
            .is_err()
    );
}
