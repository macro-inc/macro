use super::*;
use compat::{CompatOperation as Op, ForeignCallbackValue as Value};
use doc_sync_core::*;
use lexical_model::*;
const NO_RECORD: compat::ForeignRecordRef = compat::ForeignRecordRef {
    node: compat::ForeignNodeRef {
        editor_id: 0,
        version: 0,
        key: compat::ForeignKey {
            index: 0,
            generation: 0,
        },
        instance_owner_id: 0,
        class_id: 0,
        instance_id: 0,
    },
    update_id: 0,
    access: compat::ForeignAccess::Unknown,
    capture_id: 0,
};

#[test]
fn typed_calls_publish_once_on_the_real_core_and_keep_exact_historical_captures(
) -> Result<(), BoundaryError> {
    let config = wire::SessionConfigMsg {
        doc: "compat-fixture".into(),
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
    let registration = compat::CompatConfig {
        editor_id: 1,
        classes: vec![compat::ForeignClassRegistration {
            owner_id: 1,
            class_id: 1,
            type_name: "heading".into(),
            class_name: "HeadingNode".into(),
            kind: compat::ForeignNodeKind::Element,
            ancestry: vec![],
            native_type: "heading".into(),
            hooks: 0,
        }],
    };
    let mut editor = EditorSession::create_compat_inner(
        generated::ABI_MAJOR,
        &bytes(&config)?,
        0.0,
        0.0,
        &bytes(&registration)?,
    )?;
    let mut overrides = registration.clone();
    overrides.classes[0].hooks = ForeignHook::TextContent.bit();
    assert!(EditorSession::create_compat_inner(
        generated::ABI_MAJOR,
        &bytes(&config)?,
        0.0,
        0.0,
        &bytes(&overrides)?
    )
    .is_err());
    let initial = editor.compat_snapshot_inner(0)?;
    assert_eq!(initial.batch.records.len(), 1);
    assert_eq!(initial.batch.records[0].type_name, "root");
    let original = initial.batch.records[0].record;
    editor.machine.sync(SyncInput::Start, 0.0, None)?;
    editor.machine.sync(
        SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        },
        1.0,
        None,
    )?;
    let seeded_version = editor.compat_current_version_inner()?;
    assert!(seeded_version > 0);
    let initial_version = editor.compat_snapshot_inner(0)?.batch.records[0]
        .record
        .node
        .version;
    assert_eq!(initial_version, 0);
    editor.compat_begin_inner(&bytes(&compat::CompatBegin {
        tags: vec!["history-push".into(), "fixture-tag".into()],
    })?)?;
    assert!(editor
        .compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)
        .is_err());
    let mut request = compat::CompatRequest {
        operation: Op::GetRoot,
        historical: false,
        state_version: seeded_version,
        has_receiver: false,
        receiver: NO_RECORD,
        args: vec![],
    };
    let reply = editor.compat_call_inner(&bytes(&request)?)?;
    let root = reply
        .records
        .iter()
        .find(|record| record.type_name == "root")
        .unwrap()
        .record;
    let capture_count = editor.compatibility.as_ref().unwrap().captures.len();
    for _ in 0..10 {
        let repeated = editor.compat_call_inner(&bytes(&request)?)?;
        assert_eq!(repeated.records.len(), 1);
        assert!(repeated.records[0].record == root);
    }
    assert_eq!(
        editor.compatibility.as_ref().unwrap().captures.len(),
        capture_count
    );
    request.operation = Op::CreateParagraph;
    let reply = editor.compat_call_inner(&bytes(&request)?)?;
    let Value::ForeignNodeArgument { value: p } = reply.value else {
        panic!("paragraph");
    };
    let paragraph = reply
        .records
        .iter()
        .find(|record| record.record.node.key == p.key)
        .unwrap()
        .record;
    request.operation = Op::CreateText;
    request.args = vec![Value::ForeignStringArgument {
        value: "native text".encode_utf16().collect(),
    }];
    let reply = editor.compat_call_inner(&bytes(&request)?)?;
    let Value::ForeignNodeArgument { value: text } = reply.value else {
        panic!("text");
    };
    request.operation = Op::Append;
    request.has_receiver = true;
    request.receiver = paragraph;
    request.args = vec![Value::ForeignNodeArrayArgument { values: vec![text] }];
    editor.compat_call_inner(&bytes(&request)?)?;
    request.receiver = root;
    request.args = vec![Value::ForeignNodeArrayArgument { values: vec![p] }];
    editor.compat_call_inner(&bytes(&request)?)?;
    let machine::Session::Editor(session) = &editor.machine.session else {
        panic!("editor");
    };
    assert!(session.surface().state().is_empty_state());
    editor.compat_flush_inner()?;
    let machine::Session::Editor(session) = &editor.machine.session else {
        panic!("editor");
    };
    assert!(session.surface().state().is_empty_state());
    let committed = editor.compat_commit_inner(2.0, 2.0)?;
    assert!(committed.changed);
    assert!(committed.version > seeded_version);
    assert_ne!(committed.flags, 0);
    assert!(committed.tags.contains(&"fixture-tag".to_owned()));
    assert!(committed.dirty_leaves.contains(&text.key));
    let machine::Session::Editor(session) = &editor.machine.session else {
        panic!("editor");
    };
    assert_eq!(
        session.surface().state().root_text_content().as_ref(),
        "native text"
    );
    assert!(editor.compat_commit_inner(3.0, 3.0).is_err());
    request.operation = Op::GetChildren;
    request.historical = true;
    request.state_version = 0;
    request.receiver = original;
    request.args = vec![];
    let historical = editor.compat_call_inner(&bytes(&request)?)?;
    assert!(
        matches!(historical.value,Value::ForeignNodeArrayArgument{values} if values.is_empty())
    );
    request.operation = Op::GetWritable;
    assert!(editor.compat_call_inner(&bytes(&request)?).is_err());
    let snapshot = editor.compat_snapshot_inner(committed.version)?;
    let frozen_text = snapshot
        .batch
        .records
        .iter()
        .find(|record| record.type_name == "text")
        .unwrap()
        .record;
    request.operation = Op::GetTextContent;
    request.state_version = committed.version;
    request.receiver = frozen_text;
    assert!(
        matches!(editor.compat_call_inner(&bytes(&request)?)?.value,Value::ForeignStringArgument{value} if String::from_utf16(&value).unwrap()=="native text")
    );
    editor.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
    request.operation = Op::SetTextContent;
    request.historical = false;
    request.receiver = frozen_text;
    request.args = vec![Value::ForeignStringArgument {
        value: "discarded edit".encode_utf16().collect(),
    }];
    let edited = editor.compat_call_inner(&bytes(&request)?)?;
    let discarded_version = edited.records[0].record.node.version;
    let writable_text = edited
        .records
        .iter()
        .find(|record| record.record.node.key == frozen_text.node.key)
        .unwrap()
        .record;
    request.operation = Op::SetNativeField;
    request.receiver = frozen_text;
    request.args = vec![
        Value::ForeignStringArgument {
            value: "__format".encode_utf16().collect(),
        },
        Value::ForeignNumberArgument { value: 1.0 },
    ];
    assert!(editor.compat_call_inner(&bytes(&request)?).is_err());
    request.receiver = writable_text;
    editor.compat_call_inner(&bytes(&request)?)?;
    request.receiver = frozen_text;

    request.operation = Op::GetNodeField;
    request.args = vec![Value::ForeignStringArgument {
        value: "__text".encode_utf16().collect(),
    }];
    let raw = editor.compat_call_inner(&bytes(&request)?)?;
    assert!(
        matches!(raw.value,Value::ForeignStringArgument{value} if String::from_utf16(&value).unwrap()=="native text")
    );
    assert!(raw.records.is_empty());
    editor.compat_discard().expect("discard staged update");
    editor.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
    request.operation = Op::GetNodeByKey;
    request.has_receiver = false;
    let mut forged_record = frozen_text;
    forged_record.capture_id += 1;
    request.args = vec![Value::ForeignRecordArgument {
        value: forged_record,
    }];
    assert!(editor.compat_call_inner(&bytes(&request)?).is_err());
    let mut forged = text;
    forged.class_id = 999;
    request.args = vec![Value::ForeignNodeArgument { value: forged }];
    assert!(editor.compat_call_inner(&bytes(&request)?).is_err());
    request.operation = Op::GetRoot;
    request.has_receiver = false;
    request.args = vec![];
    let next = editor.compat_call_inner(&bytes(&request)?)?;
    assert!(next.records[0].record.node.version > discarded_version);
    editor.compat_flush_inner()?;
    assert!(editor.compat_finish_noop_inner()?);
    assert_eq!(editor.compat_current_version_inner()?, committed.version);
    request.has_receiver = true;
    request.receiver = frozen_text;
    request.operation = Op::GetTextContent;
    request.historical = true;
    request.receiver.capture_id += 1;
    assert!(editor.compat_call_inner(&bytes(&request)?).is_err());
    editor.machine.call(
        document_session::SessionInput::Editor(Input::Undo),
        4.0,
        Some(4.0),
    )?;
    let undo_version = editor.compat_current_version_inner()?;
    assert!(undo_version > committed.version);
    let machine::Session::Editor(session) = &editor.machine.session else {
        panic!("editor");
    };
    assert_eq!(session.surface().state().root_text_content().as_ref(), "");
    request.receiver = frozen_text;
    assert!(
        matches!(editor.compat_call_inner(&bytes(&request)?)?.value,Value::ForeignStringArgument{value} if String::from_utf16(&value).unwrap()=="native text")
    );
    editor
        .compat_release_version(committed.version)
        .expect("release text publication");
    editor.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
    request.operation = Op::GetNodeByKey;
    request.historical = false;
    request.has_receiver = false;
    request.args = vec![Value::ForeignNodeArgument {
        value: frozen_text.node,
    }];
    assert!(editor.compat_call_inner(&bytes(&request)?).is_err());
    editor.compat_discard().expect("discard rejected argument");
    editor
        .compat_release_version(0)
        .expect("historical release");
    assert!(editor.compat_snapshot_inner(0).is_err());
    Ok(())
}

#[test]
fn admission_rejects_readonly_and_unseeded_sessions_without_publishing_staged_text(
) -> Result<(), BoundaryError> {
    let mut config = wire::SessionConfigMsg {
        doc: "compat-readiness".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![17, 18, 19],
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
    let registration = bytes(&compat::CompatConfig {
        editor_id: 2,
        classes: vec![],
    })?;
    for (ready, access) in [(false, wire::Access::Edit), (true, wire::Access::Read)] {
        config.access = access;
        let mut editor = EditorSession::create_compat_inner(
            generated::ABI_MAJOR,
            &bytes(&config)?,
            0.0,
            0.0,
            &registration,
        )?;
        if ready {
            editor.machine.sync(SyncInput::Start, 0.0, None)?;
            editor.machine.sync(
                SyncInput::Seed {
                    kind: SeedKind::Optimistic,
                    snapshot: vec![],
                },
                1.0,
                None,
            )?;
        }
        editor.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
        let request = compat::CompatRequest {
            operation: Op::CreateText,
            historical: false,
            state_version: 0,
            has_receiver: false,
            receiver: NO_RECORD,
            args: vec![Value::ForeignStringArgument {
                value: "not admitted".encode_utf16().collect(),
            }],
        };
        editor.compat_call_inner(&bytes(&request)?)?;
        assert!(editor.compat_commit_inner(2.0, 2.0).is_err());
        let machine::Session::Editor(session) = &editor.machine.session else {
            panic!("editor");
        };
        assert!(session.surface().state().is_empty_state());
        assert!(editor.compatibility.as_ref().unwrap().pending.is_none());
    }
    Ok(())
}

#[test]
fn historical_leaf_reply_size_and_capture_count_are_independent_of_document_size(
) -> Result<(), BoundaryError> {
    let mut sizes = vec![];
    for count in [10, 10_000] {
        let config = wire::SessionConfigMsg {
            doc: "compat-sparse-read".into(),
            session: "00000000-0000-0000-0000-000000000001".into(),
            user: "fixture-user".into(),
            peers: vec![17, 18, 19],
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
        let mut session = EditorSession::create_compat_inner(
            generated::ABI_MAJOR,
            &bytes(&config)?,
            0.0,
            0.0,
            &bytes(&compat::CompatConfig {
                editor_id: 1,
                classes: vec![],
            })?,
        )?;
        let mut model = Editor::builder(EditorMode::Headless)
            .build()
            .expect("core registry");
        let mut tx = model.transaction();
        let leaf = {
            let mut first = None;
            let mut paragraphs = Vec::with_capacity(count);
            for _ in 0..count {
                let p = tx.create(Paragraph::default())?;
                let t = tx.create_text("fixed text")?;
                first.get_or_insert(t.key());
                tx.append(p, &[t.key()])?;
                paragraphs.push(p.key());
            }
            tx.append(NodeKey::ROOT, &paragraphs)?;
            first.expect("nonempty document")
        };
        let source = Arc::new(tx.view().snapshot_for_foreign_read()?);
        let state = source.state().clone();
        let host = session.compatibility.as_mut().unwrap();
        host.owner = state.view().foreign_instance_owner();
        host.states.insert(0, state);
        let issued = host.records(source, vec![leaf], 0, 0, compat::ForeignAccess::Frozen, &[])?;
        let receiver = issued[0].record;
        let request = bytes(&compat::CompatRequest {
            operation: Op::GetTextContent,
            historical: true,
            state_version: 0,
            has_receiver: true,
            receiver,
            args: vec![],
        })?;
        let first = session.compat_call_inner(&request)?;
        assert_eq!(first.records.len(), 1);
        assert!(first.records[0].record == receiver);
        for _ in 0..20 {
            let repeated = session.compat_call_inner(&request)?;
            assert!(repeated.records[0].record == receiver);
        }
        assert_eq!(session.compatibility.as_ref().unwrap().captures.len(), 1);
        sizes.push(bytes(&first)?.len());
    }
    assert_eq!(sizes[0], sizes[1]);
    assert!(sizes[0] <= 4096);
    Ok(())
}
