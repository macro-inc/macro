use super::application::application_config;
use crate::*;
use serde_json::json;

#[test]
fn checklist_plan_query_forwards_under_mutex_without_mutation_and_checks_generation() {
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
    let state = session.handle(FfiNow {mono_ms:2,wall_ms:1_000_002},FfiInput::SetState {root:serde_json::from_value(json!({"type":"root","children":[{"type":"list","listType":"check","tag":"ul","start":1,"children":[{"type":"listitem","value":1,"checked":true,"children":[{"type":"text","text":"Work!"}]}]}]})).unwrap()}).unwrap();
    let errors: Vec<_> = state
        .view
        .iter()
        .filter_map(|effect| match effect {
            FfiViewEffect::Error { message } => Some(message),
            _ => None,
        })
        .collect();
    assert!(errors.is_empty(), "state setup returned errors: {errors:?}");
    assert!(
        state
            .view
            .iter()
            .any(|effect| matches!(effect, FfiViewEffect::Diff { .. })),
        "state setup must emit its model diff"
    );
    let FfiQueryReply::Nodes { keys, nodes } = session
        .query(FfiQuery::NodesOfType {
            name: "task-list".into(),
        })
        .unwrap()
    else {
        panic!("list")
    };
    assert_eq!(
        keys.len(),
        1,
        "the app must retain one configured checklist"
    );
    assert_eq!(
        nodes.len(),
        1,
        "one serialized node must match the unique key"
    );
    assert_eq!(nodes[0]["type"], "task-list");
    let list = keys[0];
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
    let mut data: serde_json::Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../lexical/macro_document_model/src/plugins_group_b/checklist_query/request-example.json"
    )))
    .unwrap();
    data["listKey"] = json!(list.index());
    let result = session
        .application_query(
            "group-b.checklist-plan".into(),
            data.clone(),
            list.generation(),
        )
        .unwrap();
    assert_eq!(result["kind"], "planned");
    assert_eq!(result["progress"]["done"], 1);
    assert_eq!(result["items"][0]["text"], "Work!");
    assert_eq!(session.text_content().unwrap(), before);
    assert!(
        session
            .application_query(
                "group-b.checklist-plan".into(),
                serde_json::Value::Null,
                list.generation() + 1
            )
            .is_err()
    );
    data["listKey"] = json!(0);
    assert!(
        session
            .application_query("group-b.checklist-plan".into(), data, list.generation())
            .is_err()
    );
}
