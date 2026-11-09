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
    let allocated_before = editor.compatibility.as_ref().unwrap().keys.last_allocated();
    assert!(editor
        .compat_begin_compact_inner(&bytes(&compat::CompatBeginRequest {
            tags: vec![],
            reserve_keys: 3,
            class_mask_patches: vec![compat::CompatClassMaskPatch {
                owner_id: 99,
                class_id: 1,
                hooks: 0
            }],
        })?)
        .is_err());
    assert!(editor.compatibility.as_ref().unwrap().pending.is_none());
    assert_eq!(
        editor.compatibility.as_ref().unwrap().keys.last_allocated(),
        allocated_before
    );
    assert!(editor
        .compat_begin_compact_inner(&bytes(&compat::CompatBeginRequest {
            tags: vec![],
            reserve_keys: u32::MAX,
            class_mask_patches: vec![],
        })?)
        .is_err());
    assert!(editor.compatibility.as_ref().unwrap().pending.is_none());
    let compact = editor.compat_begin_compact_inner(&bytes(&compat::CompatBeginRequest {
        tags: vec!["history-push".into(), "fixture-tag".into()],
        class_mask_patches: vec![compat::CompatClassMaskPatch {
            owner_id: 1,
            class_id: 1,
            hooks: 0,
        }],
        reserve_keys: 3,
    })?)?;
    assert_eq!(compact.reservation.keys.len(), 3);
    assert!(compact.reservation.keys.iter().all(|key| key.index != 0));
    let reserved = editor.compat_reserve_keys_inner(2)?;
    let reservation_id = reserved.reservation_id;
    let first_reservation_id = compact.reservation.reservation_id;
    assert!(reservation_id > first_reservation_id);
    let last_reserved = reserved.keys.last().unwrap().index;

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
    assert!(p.key.index > last_reserved);
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
    let selection_reply = editor.compat_call_inner(&bytes(&compat::CompatRequest {
        operation: Op::CreateRangeSelection,
        historical: false,
        state_version: seeded_version,
        has_receiver: false,
        receiver: NO_RECORD,
        args: vec![],
    })?)?;
    assert!(selection_reply.selections.is_empty());
    let Value::ForeignSelectionArgument {
        value: selection_ref,
    } = selection_reply.value
    else {
        panic!("owned selection");
    };
    editor
        .compat_retain_selection(&bytes(&selection_ref)?)
        .expect("retain owned selection");
    let selection_body = compat::CompatSelectionData::CompatRangeSelection {
        reference: selection_ref,
        anchor: compat::CompatPoint {
            key: text.key,
            offset: 2,
            kind: compat::CompatPointKind::Text,
        },
        focus: compat::CompatPoint {
            key: text.key,
            offset: 2,
            kind: compat::CompatPointKind::Text,
        },
        format: 0,
        style: vec![],
        dirty: true,
        has_cached_backward: false,
        cached_backward: false,
        has_cached_nodes: false,
        cached_nodes: vec![],
    };
    editor.compat_set_selection_inner(&bytes(&compat::CompatSelectionPatch {
        historical: false,
        state_version: seeded_version,
        activate: true,
        selection: selection_body.clone(),
    })?)?;
    let selection_read = editor.compat_call_inner(&bytes(&compat::CompatRequest {
        operation: Op::SelectionIsCollapsed,
        historical: false,
        state_version: seeded_version,
        has_receiver: false,
        receiver: NO_RECORD,
        args: vec![Value::ForeignSelectionArgument {
            value: selection_ref,
        }],
    })?)?;
    assert!(matches!(
        selection_read.value,
        Value::ForeignBooleanArgument { value: true }
    ));
    assert!(selection_read.selections.is_empty());
    let pending_version = editor
        .compatibility
        .as_ref()
        .unwrap()
        .pending_version
        .unwrap();
    let readonly_value = editor.compat_call_inner(&bytes(&compat::CompatRequest {
        operation: Op::CreateRangeSelection,
        historical: true,
        state_version: pending_version,
        has_receiver: false,
        receiver: NO_RECORD,
        args: vec![],
    })?)?;
    let Value::ForeignSelectionArgument {
        value: readonly_ref,
    } = readonly_value.value
    else {
        panic!("readonly owned value");
    };
    editor
        .compat_retain_selection(&bytes(&readonly_ref)?)
        .expect("retain readonly value");
    let mut readonly_body = selection_body.clone();
    if let compat::CompatSelectionData::CompatRangeSelection { reference, .. } = &mut readonly_body
    {
        *reference = readonly_ref;
    }
    editor.compat_set_selection_inner(&bytes(&compat::CompatSelectionPatch {
        historical: true,
        state_version: pending_version,
        activate: false,
        selection: readonly_body,
    })?)?;
    let readonly_nodes = editor.compat_call_inner(&bytes(&compat::CompatRequest {
        operation: Op::SelectionGetNodes,
        historical: true,
        state_version: pending_version,
        has_receiver: false,
        receiver: NO_RECORD,
        args: vec![Value::ForeignSelectionArgument {
            value: readonly_ref,
        }],
    })?)?;
    assert!(
        matches!(readonly_nodes.value, Value::ForeignNodeArrayArgument { values } if values.len() == 1 && values[0].key == text.key)
    );
    editor
        .compat_release_selection(&bytes(&readonly_ref)?)
        .expect("release readonly value");
    // The same detached object may already have a slot in the live update.
    // A readonly peer must still hydrate the latest patched fields.
    let materialized = editor.compat_call_inner(&bytes(&compat::CompatRequest {
        operation: Op::CreateRangeSelection,
        historical: false,
        state_version: seeded_version,
        has_receiver: false,
        receiver: NO_RECORD,
        args: vec![],
    })?)?;
    let Value::ForeignSelectionArgument {
        value: materialized_ref,
    } = materialized.value
    else {
        panic!("materialized owned value");
    };
    editor
        .compat_retain_selection(&bytes(&materialized_ref)?)
        .expect("retain materialized");
    editor.compat_call_inner(&bytes(&compat::CompatRequest {
        operation: Op::SelectionIsCollapsed,
        historical: false,
        state_version: seeded_version,
        has_receiver: false,
        receiver: NO_RECORD,
        args: vec![Value::ForeignSelectionArgument {
            value: materialized_ref,
        }],
    })?)?;
    let mut patched_readonly = selection_body.clone();
    if let compat::CompatSelectionData::CompatRangeSelection {
        reference,
        anchor,
        focus,
        ..
    } = &mut patched_readonly
    {
        *reference = materialized_ref;
        anchor.offset = 1;
        focus.offset = 4;
    }
    editor.compat_set_selection_inner(&bytes(&compat::CompatSelectionPatch {
        historical: true,
        state_version: pending_version,
        activate: false,
        selection: patched_readonly,
    })?)?;
    let readonly_text = editor.compat_call_inner(&bytes(&compat::CompatRequest {
        operation: Op::SelectionGetTextContent,
        historical: true,
        state_version: pending_version,
        has_receiver: false,
        receiver: NO_RECORD,
        args: vec![Value::ForeignSelectionArgument {
            value: materialized_ref,
        }],
    })?)?;
    assert!(
        matches!(readonly_text.value, Value::ForeignStringArgument { value } if String::from_utf16(&value).unwrap() == "ati")
    );
    editor
        .compat_release_selection(&bytes(&materialized_ref)?)
        .expect("release materialized");
    let second = editor.compat_call_inner(&bytes(&compat::CompatRequest {
        operation: Op::CreateRangeSelection,
        historical: false,
        state_version: seeded_version,
        has_receiver: false,
        receiver: NO_RECORD,
        args: vec![],
    })?)?;
    let Value::ForeignSelectionArgument { value: second_ref } = second.value else {
        panic!("second owned selection");
    };
    editor
        .compat_retain_selection(&bytes(&second_ref)?)
        .expect("retain replacement");
    let second_body = compat::CompatSelectionData::CompatRangeSelection {
        reference: second_ref,
        anchor: compat::CompatPoint {
            key: text.key,
            offset: 1,
            kind: compat::CompatPointKind::Text,
        },
        focus: compat::CompatPoint {
            key: text.key,
            offset: 1,
            kind: compat::CompatPointKind::Text,
        },
        format: 0,
        style: vec![],
        dirty: true,
        has_cached_backward: false,
        cached_backward: false,
        has_cached_nodes: false,
        cached_nodes: vec![],
    };
    editor.compat_set_selection_inner(&bytes(&compat::CompatSelectionPatch {
        historical: false,
        state_version: seeded_version,
        activate: true,
        selection: second_body.clone(),
    })?)?;

    let machine::Session::Editor(session) = &editor.machine.session else {
        panic!("editor");
    };
    assert!(session.surface().state().is_empty_state());
    editor.compat_flush_inner()?;
    let machine::Session::Editor(session) = &editor.machine.session else {
        panic!("editor");
    };
    assert!(session.surface().state().is_empty_state());
    assert!(editor.compat_commit_inner(f64::NAN, 2.0).is_err());
    assert!(editor.compatibility.as_ref().unwrap().pending.is_some());
    let committed = editor.compat_commit_inner(2.0, 2.0)?;
    assert!(committed.changed);
    editor.compat_set_selection_inner(&bytes(&compat::CompatSelectionPatch {
        historical: true,
        state_version: committed.version,
        activate: false,
        selection: selection_body,
    })?)?;
    assert!(editor
        .compat_set_selection_inner(&bytes(&compat::CompatSelectionPatch {
            historical: true,
            state_version: committed.version,
            activate: false,
            selection: second_body,
        })?)
        .is_err());
    let previous = editor.compat_call_inner(&bytes(&compat::CompatRequest {
        operation: Op::GetPreviousSelection,
        historical: true,
        state_version: 0,
        has_receiver: false,
        receiver: NO_RECORD,
        args: vec![],
    })?)?;
    let compat::CompatSelectionData::CompatRangeSelection {
        reference: previous_ref,
        anchor,
        ..
    } = previous.selections[0]
    else {
        panic!("current editor previous selection");
    };
    assert!(previous_ref == second_ref);
    let previous_offset = anchor.offset;
    assert_eq!(previous_offset, 1);
    editor
        .compat_release_selection(&bytes(&second_ref)?)
        .expect("release replacement");

    editor
        .compat_release_selection(&bytes(&selection_ref)?)
        .expect("release owned selection binding");
    assert!(editor
        .compatibility
        .as_ref()
        .unwrap()
        .reservations
        .is_empty());
    assert!(editor.compat_reserve_keys_inner(1).is_err());
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
    let cloned = editor.compat_call_inner(&bytes(&compat::CompatRequest {
        operation: Op::SelectionClone,
        historical: false,
        state_version: committed.version,
        has_receiver: false,
        receiver: NO_RECORD,
        args: vec![Value::ForeignSelectionArgument { value: second_ref }],
    })?)?;
    let Value::ForeignSelectionArgument {
        value: detached_ref,
    } = cloned.value
    else {
        panic!("detached clone");
    };
    editor
        .compat_retain_selection(&bytes(&detached_ref)?)
        .expect("retain detached clone");
    let mut detached_body = editor
        .compatibility
        .as_ref()
        .unwrap()
        .selection_values
        .get(detached_ref)?
        .encoded();
    editor.compat_set_selection_inner(&bytes(&compat::CompatSelectionPatch {
        historical: false,
        state_version: committed.version,
        activate: false,
        selection: detached_body.clone(),
    })?)?;
    editor.compat_call_inner(&bytes(&compat::CompatRequest {
        operation: Op::SelectionIsCollapsed,
        historical: false,
        state_version: committed.version,
        has_receiver: false,
        receiver: NO_RECORD,
        args: vec![Value::ForeignSelectionArgument {
            value: detached_ref,
        }],
    })?)?;
    if let compat::CompatSelectionData::CompatRangeSelection { anchor, focus, .. } =
        &mut detached_body
    {
        anchor.offset = 3;
        focus.offset = 3;
    }
    editor.compat_set_selection_inner(&bytes(&compat::CompatSelectionPatch {
        historical: false,
        state_version: committed.version,
        activate: false,
        selection: detached_body,
    })?)?;
    editor.compat_call_inner(&bytes(&compat::CompatRequest {
        operation: Op::SelectionInsertText,
        historical: false,
        state_version: committed.version,
        has_receiver: false,
        receiver: NO_RECORD,
        args: vec![
            Value::ForeignSelectionArgument {
                value: detached_ref,
            },
            Value::ForeignStringArgument { value: vec![33] },
        ],
    })?)?;
    let staged = editor.compat_call_inner(&bytes(&compat::CompatRequest {
        operation: Op::GetTextContent,
        historical: false,
        state_version: committed.version,
        has_receiver: true,
        receiver: frozen_text,
        args: vec![],
    })?)?;
    assert!(
        matches!(staged.value, Value::ForeignStringArgument { value } if String::from_utf16(&value).unwrap() == "nat!ive text")
    );
    editor
        .compat_release_selection(&bytes(&detached_ref)?)
        .expect("release detached clone");
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
    let discarded_tickets = editor.compat_reserve_keys_inner(1)?;
    let discarded_key = discarded_tickets.keys[0];
    editor.compat_discard().expect("discard staged update");
    assert!(editor
        .compatibility
        .as_ref()
        .unwrap()
        .reservations
        .is_empty());
    editor.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
    let new_tickets = editor.compat_reserve_keys_inner(1)?;
    assert!(new_tickets.keys[0].index > discarded_key.index);
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
    assert!(editor
        .compatibility
        .as_ref()
        .unwrap()
        .reservations
        .is_empty());
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
        let retained = editor.compat_call_inner(&bytes(&compat::CompatRequest {
            operation: Op::CreateRangeSelection,
            historical: false,
            state_version: 0,
            has_receiver: false,
            receiver: NO_RECORD,
            args: vec![],
        })?)?;
        let Value::ForeignSelectionArgument {
            value: retained_ref,
        } = retained.value
        else {
            panic!("retained rejected selection");
        };
        editor
            .compat_retain_selection(&bytes(&retained_ref)?)
            .expect("retain rejected value");
        let retained_body = editor
            .compatibility
            .as_ref()
            .unwrap()
            .selection_values
            .get(retained_ref)?
            .encoded();
        editor.compat_set_selection_inner(&bytes(&compat::CompatSelectionPatch {
            historical: false,
            state_version: 0,
            activate: true,
            selection: retained_body.clone(),
        })?)?;
        assert!(editor.compat_commit_inner(2.0, 2.0).is_err());
        let machine::Session::Editor(session) = &editor.machine.session else {
            panic!("editor");
        };
        assert!(session.surface().state().is_empty_state());
        assert!(editor.compatibility.as_ref().unwrap().pending.is_none());
        editor.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
        editor.compat_set_selection_inner(&bytes(&compat::CompatSelectionPatch {
            historical: false,
            state_version: 0,
            activate: false,
            selection: retained_body,
        })?)?;
        editor
            .compat_release_selection(&bytes(&retained_ref)?)
            .expect("release rejected value");
        editor.compat_discard().expect("discard retry scope");
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

#[test]
fn reserved_tickets_construct_once_on_the_same_native_allocator() -> Result<(), BoundaryError> {
    let config = wire::SessionConfigMsg {
        doc: "compat-reserved-constructor".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![27, 28, 29],
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
    let mut editor = EditorSession::create_compat_inner(
        generated::ABI_MAJOR,
        &bytes(&config)?,
        0.0,
        0.0,
        &bytes(&compat::CompatConfig {
            editor_id: 1,
            classes: vec![],
        })?,
    )?;
    let reply = editor.compat_begin_compact_inner(&bytes(&compat::CompatBeginRequest {
        tags: vec![],
        reserve_keys: 2,
        class_mask_patches: vec![],
    })?)?;
    let (host, machine) = editor.compat_parts()?;
    let (_, tickets) = host
        .reservations
        .get_mut(&reply.reservation.reservation_id)
        .unwrap();
    let key = NodeKey::from_parts(KeyParts {
        index: reply.reservation.keys[0].index,
        generation: reply.reservation.keys[0].generation,
    });
    let ticket = tickets.remove(&key).expect("issued capability");
    assert!(tickets.remove(&key).is_none());
    let allocated = host.keys.last_allocated();
    let pending = host.pending.take().expect("pending update");
    let machine::Session::Editor(session) = &mut machine.session else {
        panic!("editor");
    };
    let (pending, created) = session.with_compat_update(pending, |tx| {
        tx.create_reserved_with(ticket, Text::default(), BaseData::Text(TextData::default()))
    })?;
    host.pending = Some(pending);
    assert_eq!(created?.key(), key);
    assert_eq!(host.keys.last_allocated(), allocated);
    editor.compat_discard().expect("discard update");
    assert!(editor
        .compatibility
        .as_ref()
        .unwrap()
        .reservations
        .is_empty());
    editor.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
    let next = editor.compat_reserve_keys_inner(1)?;
    assert!(next.keys[0].index > reply.reservation.keys[1].index);
    editor.compat_discard().expect("discard update");
    Ok(())
}
