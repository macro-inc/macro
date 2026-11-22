use super::application::application_config;
use crate::*;
use serde_json::json;

#[test]
fn application_query_reads_live_search_controllers_without_mutation_and_rejects_stale_generations()
{
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
    session.handle(FfiNow { mono_ms: 2, wall_ms: 1_000_002 }, FfiInput::SetState {
        root: serde_json::from_value(json!({"type":"root","children":[{"type":"paragraph","children":[{"type":"text","text":" "}]}]})).unwrap(),
    }).unwrap();
    let FfiQueryReply::Nodes { keys, .. } = session
        .query(FfiQuery::NodesOfType {
            name: "text".into(),
        })
        .unwrap()
    else {
        panic!("text");
    };
    let key = keys[0];
    let generation = key.generation();
    session
        .handle(
            FfiNow {
                mono_ms: 3,
                wall_ms: 1_000_003,
            },
            FfiInput::Command {
                command: FfiCommand::InsertText {
                    text: String::new(),
                },
                selection: ViewSelection::Range {
                    anchor: Point::text(key, Utf16Offset(1)),
                    focus: Point::text(key, Utf16Offset(1)),
                    resolution_dirty: false,
                },
            },
        )
        .unwrap();
    session
        .application_command(
            FfiNow {
                mono_ms: 4,
                wall_ms: 1_000_004,
            },
            "group-a.search-trigger".into(),
            json!({"kind":"actions"}),
            generation,
            ViewSelection::KeepModel,
        )
        .unwrap();
    session
        .handle(
            FfiNow {
                mono_ms: 5,
                wall_ms: 1_000_005,
            },
            FfiInput::Command {
                command: FfiCommand::InsertText {
                    text: "head".into(),
                },
                selection: ViewSelection::KeepModel,
            },
        )
        .unwrap();
    let FfiQueryReply::Nodes { keys, .. } = session
        .query(FfiQuery::NodesOfType {
            name: "inline-search".into(),
        })
        .unwrap()
    else {
        panic!("search");
    };
    assert_eq!(keys.len(), 1);
    let expected = json!({"kind":"actions","open":true,"term":"head","range":{"key":keys[0].index(),"offset":0,"expected":"/head"}});
    let FfiQueryReply::State { root: before } = session.query(FfiQuery::State).unwrap() else {
        panic!("before");
    };
    for _ in 0..2 {
        assert_eq!(
            session
                .application_query(
                    "group-a.search-query".into(),
                    json!({"kind":"actions"}),
                    generation
                )
                .unwrap(),
            expected
        );
    }
    let error = session
        .application_query(
            "group-a.search-query".into(),
            json!({"kind":"actions"}),
            generation + 1,
        )
        .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("application model generation changed")
    );
    // Stale generation is checked before even a malformed query can be decoded.
    let error = session
        .application_query("group-a.search-query".into(), json!(null), generation + 1)
        .unwrap_err();
    assert!(
        error
            .to_string()
            .contains("application model generation changed")
    );
    assert!(
        session
            .application_query("group-a.search-query".into(), json!(null), generation)
            .is_err()
    );
    assert!(
        session
            .application_query("unknown-query".into(), json!({}), generation)
            .is_err()
    );
    let FfiQueryReply::State { root: after } = session.query(FfiQuery::State).unwrap() else {
        panic!("after");
    };
    assert_eq!(after, before);
    assert_eq!(session.text_content().unwrap(), " /head");
    // A query owns no clock input and cannot advance the next admission's clock.
    session
        .application_command(
            FfiNow {
                mono_ms: 5,
                wall_ms: 1_000_005,
            },
            "group-a.search-close".into(),
            json!({}),
            generation,
            ViewSelection::KeepModel,
        )
        .unwrap();
    assert_eq!(
        session
            .application_query(
                "group-a.search-query".into(),
                json!({"kind":"actions"}),
                generation
            )
            .unwrap(),
        json!({"kind":"actions","open":false,"term":"head","range":null})
    );
    assert_eq!(session.text_content().unwrap(), " /head");
}
