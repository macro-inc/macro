//! Literal application code persistence through the production session factory.
use super::*;

#[test]
fn macro_code_persisted_ids_survive_a_fresh_session_reload() {
    let mut config = wire::SessionConfigMsg {
        doc: "persisted-code-fixture".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![7, 8, 9],
        access: wire::Access::Edit,
        transport: wire::Transport::None,
        durable: false,
        chatter: false,
        headless: false,
        view_engine: 1,
        view_os: 0,
        token: String::new(),
        traceparent: String::new(),
        coalesce: 25,
        snapshot_interval: 0,
        observed: vec![],
    };
    let mut writer = machine::Machine::create_macro_with_namespace(
        generated::ABI_MAJOR,
        &bytes(&config).expect("config"),
        0.0,
        1000.0,
        "source-editor-instance_17",
    )
    .expect("production Macro factory");
    writer.sync(SyncInput::Start, 0.0, None).expect("start");
    writer
        .sync(
            SyncInput::Seed {
                kind: SeedKind::Optimistic,
                snapshot: vec![],
            },
            1.0,
            None,
        )
        .expect("seed");
    writer
        .editor(
            Input::SetState {
                state: serde_json::from_value(serde_json::json!({"root":{
                    "type":"root","version":1,"children":[{
                        "type":"custom-code","version":1,"language":"javascript",
                        "children":[{"type":"text","version":1,"text":"const persistenceCode = 1;",
                            "format":0,"detail":0,"mode":"normal","style":""}]
                    }]
                }}))
                .expect("literal code"),
                tags: TagSet::default(),
            },
            2.0,
        )
        .expect("insert code");
    writer
        .editor(
            Input::Command {
                command: Command::SelectAll(None),
                selection: ViewSelection::KeepModel,
            },
            3.0,
        )
        .expect("select code");
    let machine::Session::Editor(session) = &writer.session else {
        panic!("editor")
    };
    assert_eq!(session.surface().namespace(), "source-editor-instance_17");
    let clipboard = query::clipboard(
        session.surface().state(),
        session.surface().namespace(),
        false,
        query::ExportFlavor::Macro,
    )
    .expect("configured clipboard");
    let clipboard: serde_json::Value =
        serde_json::from_str(&clipboard.lexical).expect("clipboard JSON");
    assert_eq!(clipboard["namespace"], "source-editor-instance_17");

    assert!(!session
        .last_output()
        .view
        .iter()
        .any(|effect| matches!(effect, ViewEffect::Error(_))));
    let before = serde_json::to_value(session.surface().state().to_json().expect("saved JSON"))
        .expect("JSON");
    assert_eq!(before["root"]["children"][0]["type"], "custom-code");
    assert!(before["root"]["children"][0]["$"]["id"]
        .as_str()
        .is_some_and(|id| !id.is_empty()));
    let persisted = lexical_loro::snapshot::raw_state_to_loro_snapshot(
        &before,
        Some(lexical_loro::golden::MARKDOWN_GOLDEN),
    )
    .expect("persisted Loro snapshot");
    drop(writer);

    config.session = "00000000-0000-0000-0000-000000000002".into();
    config.peers = vec![77, 78, 79];
    let mut reader = machine::Machine::create_macro(
        generated::ABI_MAJOR,
        &bytes(&config).expect("config"),
        0.0,
        2000.0,
    )
    .expect("fresh production Macro factory");
    reader.sync(SyncInput::Start, 0.0, None).expect("start");
    reader
        .sync(
            SyncInput::Seed {
                kind: SeedKind::CachedS3,
                snapshot: persisted,
            },
            1.0,
            None,
        )
        .expect("reload");
    let machine::Session::Editor(session) = &reader.session else {
        panic!("editor")
    };
    let errors: Vec<_> = session
        .last_output()
        .view
        .iter()
        .filter_map(|effect| {
            if let ViewEffect::Error(error) = effect {
                Some(error.to_string())
            } else {
                None
            }
        })
        .collect();
    assert!(errors.is_empty(), "reload errors: {errors:?}");
    assert!(session
        .last_output()
        .view
        .iter()
        .any(|effect| matches!(effect, ViewEffect::Initialize(_))));
    assert_eq!(
        session.surface().state().root_text_content().as_ref(),
        "const persistenceCode = 1;\n\n"
    );
    let after = serde_json::to_value(session.surface().state().to_json().expect("reloaded JSON"))
        .expect("JSON");
    assert_eq!(after, before);
}
