use super::application::application_config;
use crate::*;
use serde_json::json;

#[test]
fn native_decorator_actions_keep_shared_targets_history_and_access_policy() {
    let session = NativeEditorSession::new(
        application_config(),
        None,
        FfiNow {
            mono_ms: 0,
            wall_ms: 1_000_000,
        },
    )
    .unwrap();
    for (step, input) in [
        FfiInput::Start,
        FfiInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        },
        FfiInput::SetState {
            root: serde_json::from_value(
                json!({"type":"root","children":[{"type":"paragraph","children":[
                    {"type":"equation","equation":"x^2","inline":false},
                    {"type":"user-mention","userId":" raw-id ","displayName":"Old"},
                    {"type":"user-mention","userId":"raw-id","displayName":"Unchanged"}
                ]}]}),
            )
            .unwrap(),
        },
    ]
    .into_iter()
    .enumerate()
    {
        let output = session
            .handle(
                FfiNow {
                    mono_ms: step as u64,
                    wall_ms: 1_000_000 + step as i64,
                },
                input,
            )
            .unwrap();
        assert!(
            !output
                .view
                .iter()
                .any(|effect| matches!(effect, FfiViewEffect::Error { .. }))
        );
    }
    let FfiQueryReply::Nodes { keys, .. } = session
        .query(FfiQuery::NodesOfType {
            name: "equation".into(),
        })
        .unwrap()
    else {
        panic!("equation")
    };
    let equation = keys[0];
    session
        .application_command(
            FfiNow {
                mono_ms: 1000,
                wall_ms: 1_001_000,
            },
            "group-b.equation".into(),
            json!({"key":equation.index(),"equation":" "}),
            equation.generation(),
            ViewSelection::KeepModel,
        )
        .unwrap();
    let FfiQueryReply::State { root } = session.query(FfiQuery::State).unwrap() else {
        panic!("state")
    };
    assert_eq!(root["children"][0]["children"][0]["equation"], " ");
    assert_eq!(root["children"][0]["children"][0]["inline"], false);
    assert!(
        session
            .application_command(
                FfiNow {
                    mono_ms: 1001,
                    wall_ms: 1_001_001,
                },
                "group-b.equation".into(),
                json!({"key":equation.index(),"equation":"stale"}),
                equation.generation() + 1,
                ViewSelection::KeepModel,
            )
            .is_err()
    );
    let FfiQueryReply::State { root: unchanged } = session.query(FfiQuery::State).unwrap() else {
        panic!("state")
    };
    assert_eq!(root, unchanged);
    let stale = session.application_command(
        FfiNow {
            mono_ms: 1002,
            wall_ms: 1_001_002,
        },
        "group-b.user-display-names".into(),
        json!({"names": 5}),
        equation.generation() + 1,
        ViewSelection::KeepModel,
    );
    assert!(
        matches!(stale, Err(FfiSessionError::Invalid { reason }) if reason == "application model generation changed")
    );
    assert!(
        session
            .application_command(
                FfiNow {
                    mono_ms: 1003,
                    wall_ms: 1_001_003
                },
                "group-b.user-display-names".into(),
                json!({"names": {" raw-id ": "Stale"}}),
                equation.generation() + 1,
                ViewSelection::KeepModel,
            )
            .is_err()
    );
    let FfiQueryReply::State { root: unchanged } = session.query(FfiQuery::State).unwrap() else {
        panic!("state")
    };
    assert_eq!(root, unchanged);
    let names = session
        .application_command(
            FfiNow {
                mono_ms: 2000,
                wall_ms: 1_002_000,
            },
            "group-b.user-display-names".into(),
            json!({"names":{" raw-id ":"New","raw-id":""}}),
            equation.generation(),
            ViewSelection::KeepModel,
        )
        .unwrap();
    assert!(!names.view.iter().any(|effect| matches!(
        effect,
        FfiViewEffect::Error { .. } | FfiViewEffect::SetSelection { .. }
    )));
    let FfiQueryReply::State { root } = session.query(FfiQuery::State).unwrap() else {
        panic!("state")
    };
    assert_eq!(root["children"][0]["children"][1]["displayName"], "New");
    assert_eq!(
        root["children"][0]["children"][2]["displayName"],
        "Unchanged"
    );
    session
        .handle(
            FfiNow {
                mono_ms: 3000,
                wall_ms: 1_003_000,
            },
            FfiInput::Undo,
        )
        .unwrap();
    let FfiQueryReply::State { root } = session.query(FfiQuery::State).unwrap() else {
        panic!("state")
    };
    assert_eq!(root["children"][0]["children"][0]["equation"], "x^2");
    session
        .handle(
            FfiNow {
                mono_ms: 4000,
                wall_ms: 1_004_000,
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
    session
        .application_command(
            FfiNow {
                mono_ms: 5000,
                wall_ms: 1_005_000,
            },
            "group-b.equation".into(),
            json!({"key":equation.index(),"equation":"denied"}),
            equation.generation(),
            ViewSelection::KeepModel,
        )
        .unwrap();
    let FfiQueryReply::State { root: denied } = session.query(FfiQuery::State).unwrap() else {
        panic!("state")
    };
    assert_eq!(root, denied);
}
