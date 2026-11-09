use super::*;
use doc_sync_core::*;

fn fixture() -> Result<EditorSession, BoundaryError> {
    let config = wire::SessionConfigMsg {
        doc: "capture-lease-fixture".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![71, 72, 73],
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
    let editor = EditorSession::create_compat_inner(
        generated::ABI_MAJOR,
        &bytes(&config)?,
        0.0,
        0.0,
        &bytes(&compat::CompatConfig {
            editor_id: 1,
            classes: vec![],
        })?,
    )?;
    Ok(editor)
}

#[test]
fn leased_exact_capture_survives_retired_graph_and_prunes_after_final_release(
) -> Result<(), BoundaryError> {
    let mut editor = fixture()?;
    let original = editor.compat_snapshot_inner(0)?.batch.records[0].record;
    let original_id = original.capture_id;
    let before = editor.compat_audit_snapshot_inner()?;
    editor.compat_capture_leases_inner(&bytes(&compat::CompatCaptureLeases {
        editor_id: 1,
        retain: vec![original.capture_id],
        release: vec![],
    })?)?;
    let retained = editor.compat_audit_snapshot_inner()?;
    assert!(retained.version == before.version);
    assert!(retained.retained_captures == before.retained_captures);
    assert!(retained.retirement_epoch > before.retirement_epoch);
    let invalid = compat::CompatCaptureLeases {
        editor_id: 1,
        retain: vec![original.capture_id, u64::MAX],
        release: vec![],
    };
    assert!(editor
        .compat_capture_leases_inner(&bytes(&invalid)?)
        .is_err());
    assert!(editor.compat_audit_snapshot_inner()?.retirement_epoch == retained.retirement_epoch);
    editor.machine.sync(SyncInput::Start, 0.0, None)?;
    editor.machine.sync(
        SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        },
        1.0,
        None,
    )?;
    let current = editor.compat_current_version_inner()?;
    assert!(current > 0);
    editor.compat_snapshot_inner(current)?;
    editor.compat_release_version_inner(0)?;
    assert!(editor
        .compatibility
        .as_ref()
        .expect("host")
        .captures
        .contains_key(&original_id));
    let raw = editor.compat_call_inner(&bytes(&compat::CompatRequest {
        operation: compat::CompatOperation::GetNodeField,
        historical: true,
        state_version: 0,
        has_receiver: true,
        receiver: original,
        args: vec![calls::text("__type")],
    })?)?;
    assert!(
        matches!(raw.value,compat::ForeignCallbackValue::ForeignStringArgument{value} if value=="root".encode_utf16().collect::<Vec<_>>())
    );
    let held = editor.compat_audit_snapshot_inner()?;
    editor.compat_capture_leases_inner(&bytes(&compat::CompatCaptureLeases {
        editor_id: 1,
        retain: vec![],
        release: vec![original.capture_id],
    })?)?;
    let released = editor.compat_audit_snapshot_inner()?;
    assert!(released.version == held.version);
    assert!(released.retirement_epoch > held.retirement_epoch);
    assert!(released.retained_captures + 1 == held.retained_captures);
    assert!(!editor
        .compatibility
        .as_ref()
        .expect("host")
        .captures
        .contains_key(&original_id));
    assert!(!editor
        .compatibility
        .as_ref()
        .expect("host")
        .capture_index
        .contains_node(original.node));
    assert!(editor
        .compat_call_inner(&bytes(&compat::CompatRequest {
            operation: compat::CompatOperation::GetNodeField,
            historical: true,
            state_version: 0,
            has_receiver: true,
            receiver: original,
            args: vec![calls::text("__type")]
        })?)
        .is_err());
    editor.compat_release_version_inner(0)?;
    let fence = editor.compat_audit_snapshot_inner()?;
    assert!(
        fence.version == released.version && fence.retirement_epoch > released.retirement_epoch
    );
    assert!(fence.retained_captures == released.retained_captures);
    editor.compat_capture_leases_inner(&bytes(&compat::CompatCaptureLeases {
        editor_id: 1,
        retain: vec![],
        release: vec![],
    })?)?;
    assert!(editor.compat_audit_snapshot_inner()?.retirement_epoch > fence.retirement_epoch);
    Ok(())
}

#[test]
fn invalid_lease_and_overflow_reject_before_begin_or_retirement() -> Result<(), BoundaryError> {
    let mut editor = fixture()?;
    editor.machine.sync(SyncInput::Start, 0.0, None)?;
    editor.machine.sync(
        SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        },
        1.0,
        None,
    )?;
    let version = editor.compat_current_version_inner()?;
    let record = editor.compat_snapshot_inner(version)?.batch.records[0].record;
    let request = compat::CompatBatchRequest {
        scope: compat::CompatBatchScope::CompatBatchBegin {
            expected_version: version,
            begin: compat::CompatBeginRequest {
                tags: vec![],
                reserve_keys: 0,
                class_mask_patches: vec![],
            },
        },
        leases: compat::CompatCaptureLeases {
            editor_id: 1,
            retain: vec![u64::MAX],
            release: vec![],
        },
        operations: vec![],
        finalize: false,
        now: 2.0,
        wall: 2.0,
    };
    let before = editor.compat_audit_snapshot_inner()?;
    assert!(editor.compat_batch_inner(&bytes(&request)?).is_err());
    let host = editor.compatibility.as_mut().expect("host");
    assert!(host.pending.is_none());
    assert!(host.retirement_epoch == before.retirement_epoch);
    host.retirement_epoch = u64::MAX;
    let mut overflow = request;
    overflow.leases.retain = vec![record.capture_id];
    assert!(editor.compat_batch_inner(&bytes(&overflow)?).is_err());
    assert!(editor
        .compatibility
        .as_ref()
        .expect("host")
        .pending
        .is_none());
    assert!(editor
        .compat_capture_leases_inner(&bytes(&overflow.leases)?)
        .is_err());
    assert!(editor.compat_release_version_inner(0).is_err());
    let host = editor.compatibility.as_ref().expect("host");
    assert_eq!(host.retirement_epoch, u64::MAX);
    assert!(host.states.contains_key(&0));
    Ok(())
}

#[test]
fn batch_input_pin_survives_its_explicit_release() -> Result<(), BoundaryError> {
    let mut editor = fixture()?;
    editor.machine.sync(SyncInput::Start, 0.0, None)?;
    editor.machine.sync(
        SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        },
        1.0,
        None,
    )?;
    let version = editor.compat_current_version_inner()?;
    let root = editor.compat_snapshot_inner(version)?.batch.records[0].record;
    editor.compat_capture_leases_inner(&bytes(&compat::CompatCaptureLeases {
        editor_id: 1,
        retain: vec![root.capture_id],
        release: vec![],
    })?)?;
    for value in [
        compat::ForeignCallbackValue::ForeignRecordArgument { value: root },
        compat::ForeignCallbackValue::ForeignNodeArgument { value: root.node },
        compat::ForeignCallbackValue::ForeignNodeArrayArgument {
            values: vec![root.node],
        },
    ] {
        let before = editor.compat_audit_snapshot_inner()?;
        let invalid = compat::CompatBatchRequest {
            scope: compat::CompatBatchScope::CompatBatchBegin {
                expected_version: version,
                begin: compat::CompatBeginRequest {
                    tags: vec![],
                    reserve_keys: 0,
                    class_mask_patches: vec![],
                },
            },
            leases: compat::CompatCaptureLeases {
                editor_id: 1,
                retain: vec![],
                release: vec![root.capture_id],
            },
            operations: vec![compat::CompatBatchOperation {
                operation: compat::CompatOperation::GetNodeByKey,
                receiver: compat::CompatNodeOperand::CompatNoNode {},
                args: vec![compat::CompatBatchArgument::CompatValueArgument { value }],
                initial_instance: compat::CompatInstanceSeed::CompatNoInstanceSeed {},
            }],
            finalize: false,
            now: 2.0,
            wall: 2.0,
        };
        assert!(editor.compat_batch_inner(&bytes(&invalid)?).is_err());
        assert!(editor
            .compatibility
            .as_ref()
            .expect("host")
            .pending
            .is_none());
        assert!(editor.compat_audit_snapshot_inner()?.retirement_epoch == before.retirement_epoch);
    }
    let reply = editor.compat_batch_inner(&bytes(&compat::CompatBatchRequest {
        scope: compat::CompatBatchScope::CompatBatchBegin {
            expected_version: version,
            begin: compat::CompatBeginRequest {
                tags: vec![],
                reserve_keys: 0,
                class_mask_patches: vec![],
            },
        },
        leases: compat::CompatCaptureLeases {
            editor_id: 1,
            retain: vec![],
            release: vec![root.capture_id],
        },
        operations: vec![compat::CompatBatchOperation {
            operation: compat::CompatOperation::GetTextContent,
            receiver: compat::CompatNodeOperand::CompatCapturedNode { record: root },
            args: vec![],
            initial_instance: compat::CompatInstanceSeed::CompatNoInstanceSeed {},
        }],
        finalize: false,
        now: 2.0,
        wall: 2.0,
    })?)?;
    assert!(matches!(
        reply.outcome,
        compat::CompatBatchOutcome::CompatBatchSuccess {}
    ));
    assert!(
        matches!(&reply.results[0].value, compat::ForeignCallbackValue::ForeignStringArgument { value } if value.is_empty())
    );
    let id = root.capture_id;
    assert!(!editor
        .compatibility
        .as_ref()
        .expect("host")
        .captures
        .contains_key(&id));
    Ok(())
}

#[test]
fn compact_emission_survives_discard_until_decoder_ack() -> Result<(), BoundaryError> {
    let mut editor = fixture()?;
    editor.machine.sync(SyncInput::Start, 0.0, None)?;
    editor.machine.sync(
        SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        },
        1.0,
        None,
    )?;
    let version = editor.compat_current_version_inner()?;
    let reply = editor.compat_batch_inner(&bytes(&compat::CompatBatchRequest {
        scope: compat::CompatBatchScope::CompatBatchBegin {
            expected_version: version,
            begin: compat::CompatBeginRequest {
                tags: vec![],
                reserve_keys: 0,
                class_mask_patches: vec![],
            },
        },
        leases: compat::CompatCaptureLeases {
            editor_id: 1,
            retain: vec![],
            release: vec![],
        },
        operations: vec![compat::CompatBatchOperation {
            operation: compat::CompatOperation::GetRoot,
            receiver: compat::CompatNodeOperand::CompatNoNode {},
            args: vec![],
            initial_instance: compat::CompatInstanceSeed::CompatNoInstanceSeed {},
        }],
        finalize: false,
        now: 2.0,
        wall: 2.0,
    })?)?;
    assert!(matches!(
        reply.outcome,
        compat::CompatBatchOutcome::CompatBatchSuccess {}
    ));
    let emitted = reply.results[0].delta.records[0].record;
    let id = emitted.capture_id;
    editor.compat_discard().expect("discard");
    assert!(editor
        .compatibility
        .as_ref()
        .expect("host")
        .captures
        .contains_key(&id));
    editor.compat_capture_leases_inner(&bytes(&compat::CompatCaptureLeases {
        editor_id: 1,
        retain: vec![id],
        release: vec![id],
    })?)?;
    assert!(!editor
        .compatibility
        .as_ref()
        .expect("host")
        .captures
        .contains_key(&id));
    assert!(editor.compat_current_version_inner()? == version);
    Ok(())
}
