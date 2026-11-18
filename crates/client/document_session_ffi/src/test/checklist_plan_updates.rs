use super::application::application_config;
use crate::*;
use serde_json::json;

#[test]
fn failed_conversion_retains_delivery_until_owned_retry_and_rebind() {
    let session = NativeEditorSession::new(
        application_config(),
        None,
        FfiNow {
            mono_ms: 0,
            wall_ms: 1_000_000,
        },
    )
    .expect("session");
    session
        .handle(
            FfiNow {
                mono_ms: 0,
                wall_ms: 1_000_000,
            },
            FfiInput::Start,
        )
        .expect("start");
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
        .expect("seed");
    let state = session.handle(FfiNow { mono_ms: 2, wall_ms: 1_000_002 }, FfiInput::SetState { root: serde_json::from_value(json!({"type":"root","children":[{"type":"list","listType":"check","tag":"ul","start":1,"children":[{"type":"listitem","value":1,"checked":true,"children":[{"type":"text","text":"Work"}]}]}]})).expect("root") }).expect("state");
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
        .expect("query")
    else {
        panic!("nodes")
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
    let generation = keys[0].generation();
    let mut payload: serde_json::Value = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../lexical/macro_document_model/src/plugins_group_b/checklist_query/request-example.json"
    )))
    .expect("facts");
    payload.as_object_mut().expect("object").remove("listKey");
    payload["factsVersion"] = json!("1");
    {
        let _injection = convert::fail_next_output();
        let failed = session.application_command(
            FfiNow {
                mono_ms: 3,
                wall_ms: 1_000_003,
            },
            "group-b.set-checklist-facts".into(),
            payload.clone(),
            generation,
            ViewSelection::KeepModel,
        );
        assert!(
            failed.is_err(),
            "conversion failed after native accepted the facts"
        );
        assert!(
            failed
                .err()
                .expect("conversion error")
                .to_string()
                .contains("injected output conversion")
        );
    }
    let first = session
        .application_command(
            FfiNow {
                mono_ms: 4,
                wall_ms: 1_000_004,
            },
            "group-b.set-checklist-facts".into(),
            payload.clone(),
            generation,
            ViewSelection::KeepModel,
        )
        .expect("facts accepted");
    let events: Vec<_> = first
        .view
        .iter()
        .filter_map(|effect| match effect {
            FfiViewEffect::PluginEvent {
                name,
                payload: Some(payload),
            } if name == "group-b.checklist-plan-updates" => Some(payload),
            _ => None,
        })
        .collect();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["reset"], true);
    assert_eq!(
        events[0]["sequence"], "1",
        "failed conversion retained the exact original delivery"
    );
    assert_eq!(events[0]["lists"][0]["result"]["progress"]["done"], 1);
    assert!(first.io.is_empty());
    let duplicate = session
        .application_command(
            FfiNow {
                mono_ms: 5,
                wall_ms: 1_000_005,
            },
            "group-b.set-checklist-facts".into(),
            payload.clone(),
            generation,
            ViewSelection::KeepModel,
        )
        .expect("duplicate");
    assert!(!duplicate.view.iter().any(|effect| matches!(effect, FfiViewEffect::PluginEvent { name, .. } if name == "group-b.checklist-plan-updates")), "successful owned conversion acknowledged the exact prior output");
    payload["rebind"] = json!(true);
    let rebound = session
        .application_command(
            FfiNow {
                mono_ms: 6,
                wall_ms: 1_000_006,
            },
            "group-b.set-checklist-facts".into(),
            payload,
            generation,
            ViewSelection::KeepModel,
        )
        .expect("rebind");
    let events: Vec<_> = rebound
        .view
        .iter()
        .filter_map(|effect| match effect {
            FfiViewEffect::PluginEvent {
                name,
                payload: Some(payload),
            } if name == "group-b.checklist-plan-updates" => Some(payload),
            _ => None,
        })
        .collect();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0]["sequence"], "2");
    assert_eq!(events[0]["factsVersion"], "1");
    assert_eq!(events[0]["reset"], true);
    assert_eq!(events[0]["lists"].as_array().expect("lists").len(), 1);
    assert_eq!(session.text_content().expect("text"), "Work");
}
