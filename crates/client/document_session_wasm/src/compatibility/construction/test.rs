use super::*;
use compat::{CompatNativePrototype as P, CompatOperation as Op, ForeignNodeKind as K};
use doc_sync_core::*;

#[test]
fn hosted_seed_batch_consumes_exact_tickets_and_preserves_original_instances(
) -> Result<(), BoundaryError> {
    let config = wire::SessionConfigMsg {
        doc: "constructor-batch".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![61, 62, 63],
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
    let mut classes = Vec::new();
    let mut metadata = Vec::new();
    for (class_id, name, kind, prototype) in [
        (1, "root", K::Element, P::RootNode),
        (2, "text", K::Text, P::TextNode),
        (3, "paragraph", K::Element, P::ParagraphNode),
        (4, "linebreak", K::LineBreak, P::LineBreakNode),
        (5, "tab", K::Text, P::TabNode),
    ] {
        classes.push(compat::ForeignClassRegistration {
            owner_id: 1,
            class_id,
            type_name: name.into(),
            class_name: name.into(),
            kind,
            ancestry: vec![],
            native_type: name.into(),
            hooks: 0,
        });
        metadata.push(compat::CompatHostedClass {
            class_id,
            constructor_token: 100 + u64::from(class_id),
            native_prototype: prototype,
        });
    }
    let mut editor = EditorSession::create_compat_config(
        generated::ABI_MAJOR,
        &bytes(&config)?,
        0.0,
        0.0,
        compat::CompatConfig {
            editor_id: 1,
            classes: classes.clone(),
        },
        Some(Arc::new(instance_runtime::InstanceRuntime::new(
            &compat::CompatHostedConfig {
                registration: compat::CompatConfig {
                    editor_id: 1,
                    classes,
                },
                classes: metadata,
            },
            11,
        )?)),
    )?;
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
    let ready = editor.compat_batch_inner(&bytes(&compat::CompatBatchRequest {
        scope: compat::CompatBatchScope::CompatBatchBegin {
            expected_version: version,
            begin: compat::CompatBeginRequest {
                tags: vec![],
                reserve_keys: 4,
                class_mask_patches: vec![],
            },
        },
        leases: compat::CompatCaptureLeases {
            editor_id: 1,
            retain: vec![],
            release: vec![],
        },
        operations: vec![],
        finalize: false,
        now: 2.0,
        wall: 2.0,
    })?)?;
    let issued = ready.reservations[0].clone();
    let paragraph = compat::CompatNodeOperand::CompatReservedNode {
        reservation_id: issued.reservation_id,
        key: issued.keys[0],
    };
    let text = compat::CompatNodeOperand::CompatReservedNode {
        reservation_id: issued.reservation_id,
        key: issued.keys[1],
    };
    let paragraph_seed = compat::CompatInstanceSeed::CompatCreatedInstance {
        instance_owner_id: 1,
        class_id: 3,
        instance_id: 201,
        base: records::base_patch(&BaseData::Element(ElementData::default())),
        native_projection: compat::ForeignNativeProjection {
            native_type: "paragraph".into(),
            complete: true,
            fields: vec![],
        },
        own_fields: compat::ForeignOpaqueValue::ForeignMissing {},
    };
    let text_seed = compat::CompatInstanceSeed::CompatCreatedInstance {
        instance_owner_id: 1,
        class_id: 2,
        instance_id: 202,
        base: records::base_patch(&BaseData::Text(TextData::new("seeded"))),
        native_projection: compat::ForeignNativeProjection {
            native_type: "text".into(),
            complete: true,
            fields: vec![],
        },
        own_fields: compat::ForeignOpaqueValue::ForeignMissing {},
    };
    let request = compat::CompatBatchRequest {
        scope: compat::CompatBatchScope::CompatBatchContinue {
            update_id: ready.update_id,
            expected_epoch: ready.mutation_epoch,
        },
        leases: compat::CompatCaptureLeases {
            editor_id: 1,
            retain: vec![],
            release: vec![],
        },
        operations: vec![
            compat::CompatBatchOperation {
                operation: Op::CreateRegisteredNode,
                receiver: paragraph.clone(),
                args: vec![],
                initial_instance: paragraph_seed.clone(),
            },
            compat::CompatBatchOperation {
                operation: Op::CreateRegisteredNode,
                receiver: text.clone(),
                args: vec![],
                initial_instance: text_seed.clone(),
            },
            compat::CompatBatchOperation {
                operation: Op::Append,
                receiver: paragraph.clone(),
                args: vec![compat::CompatBatchArgument::CompatNodeArrayArgument {
                    values: vec![text.clone()],
                }],
                initial_instance: compat::CompatInstanceSeed::CompatNoInstanceSeed {},
            },
            compat::CompatBatchOperation {
                operation: Op::Append,
                receiver: compat::CompatNodeOperand::CompatCapturedNode { record: root },
                args: vec![compat::CompatBatchArgument::CompatNodeArrayArgument {
                    values: vec![paragraph.clone()],
                }],
                initial_instance: compat::CompatInstanceSeed::CompatNoInstanceSeed {},
            },
            compat::CompatBatchOperation {
                operation: Op::SetNativeField,
                receiver: text.clone(),
                args: vec![
                    compat::CompatBatchArgument::CompatValueArgument {
                        value: calls::text("__format"),
                    },
                    compat::CompatBatchArgument::CompatValueArgument {
                        value: compat::ForeignCallbackValue::ForeignNumberArgument { value: 1.0 },
                    },
                ],
                initial_instance: compat::CompatInstanceSeed::CompatNoInstanceSeed {},
            },
        ],
        finalize: false,
        now: 3.0,
        wall: 3.0,
    };
    let mut malformed = request.clone();
    malformed.operations.truncate(1);
    if let compat::CompatInstanceSeed::CompatCreatedInstance {
        native_projection, ..
    } = &mut malformed.operations[0].initial_instance
    {
        native_projection.complete = false;
    }
    assert!(editor.compat_batch_inner(&bytes(&malformed)?).is_err());
    assert_eq!(
        editor.compatibility.as_ref().expect("host").mutation_epoch,
        ready.mutation_epoch
    );
    assert!(editor
        .compatibility
        .as_ref()
        .expect("host")
        .reservations
        .get(&issued.reservation_id)
        .expect("reservation")
        .1
        .contains_key(&reserved(&paragraph)?.1));
    malformed = request.clone();
    malformed.operations.truncate(1);
    if let compat::CompatInstanceSeed::CompatCreatedInstance {
        class_id,
        native_projection,
        ..
    } = &mut malformed.operations[0].initial_instance
    {
        *class_id = 1;
        native_projection.native_type = "root".into();
    }
    assert!(editor.compat_batch_inner(&bytes(&malformed)?).is_err());
    let applied = editor.compat_batch_inner(&bytes(&request)?)?;
    assert!(matches!(
        applied.outcome,
        compat::CompatBatchOutcome::CompatBatchSuccess {}
    ));
    assert_eq!(applied.results.len(), 5);
    let node = applied
        .delta
        .records
        .iter()
        .find(|record| record.record.node.key == issued.keys[1])
        .expect("text");
    assert!(node.has_instance);
    assert!(node.record.node.instance_id == 202);
    assert!(node.record.node.class_id == 2);
    assert_eq!(node.base.text.as_ref().expect("text").format, Some(1));
    assert_eq!(
        String::from_utf16(
            node.base
                .text
                .as_ref()
                .expect("text")
                .text
                .as_ref()
                .expect("text")
        )
        .expect("UTF16"),
        "seeded"
    );
    // Other hosted editors share the global allocator and may reserve concurrently.
    // This session must install only its two issued keys, never replacement keys.
    let mut installed: Vec<_> = applied
        .delta
        .records
        .iter()
        .filter(|record| record.record.node.key.index != 0)
        .map(|record| record.record.node.key)
        .collect();
    installed.sort_by_key(|key| (key.index, key.generation));
    let mut expected = vec![issued.keys[0], issued.keys[1]];
    expected.sort_by_key(|key| (key.index, key.generation));
    assert_eq!(installed, expected);
    let mut duplicate = request.clone();
    duplicate.scope = compat::CompatBatchScope::CompatBatchContinue {
        update_id: applied.update_id,
        expected_epoch: applied.mutation_epoch,
    };
    duplicate.operations.truncate(1);
    assert!(editor.compat_batch_inner(&bytes(&duplicate)?).is_err());
    assert_eq!(
        editor.compatibility.as_ref().expect("host").mutation_epoch,
        applied.mutation_epoch
    );
    // Instance IDs are global across classes, not a counter per constructor.
    duplicate.operations[0].receiver = compat::CompatNodeOperand::CompatReservedNode {
        reservation_id: issued.reservation_id,
        key: issued.keys[2],
    };
    duplicate.operations[0].initial_instance = text_seed;
    if let compat::CompatInstanceSeed::CompatCreatedInstance { instance_id, .. } =
        &mut duplicate.operations[0].initial_instance
    {
        *instance_id = 201;
    }
    let failed = editor.compat_batch_inner(&bytes(&duplicate)?)?;
    assert!(matches!(
        failed.outcome,
        compat::CompatBatchOutcome::CompatBatchNativeFailure {
            location: compat::CompatFailureLocation::CompatOperationFailure { index: 0 },
            ..
        }
    ));
    assert!(failed.results.is_empty());
    assert!(!failed
        .delta
        .records
        .iter()
        .any(|record| record.record.node.key == issued.keys[2]));
    // Rejected creation burns its key capability; neither constructor nor allocator replays.
    duplicate.scope = compat::CompatBatchScope::CompatBatchContinue {
        update_id: failed.update_id,
        expected_epoch: failed.mutation_epoch,
    };
    if let compat::CompatInstanceSeed::CompatCreatedInstance { instance_id, .. } =
        &mut duplicate.operations[0].initial_instance
    {
        *instance_id = 203;
    }
    assert!(editor.compat_batch_inner(&bytes(&duplicate)?).is_err());
    let committed = editor.compat_commit_inner(4.0, 4.0)?;
    assert_eq!(committed.version, applied.version);
    assert!(editor
        .compatibility
        .as_ref()
        .expect("host")
        .constructed
        .is_empty());
    let snapshot = editor.compat_snapshot_inner(committed.version)?;
    assert_eq!(snapshot.batch.records.len(), 3);
    assert!(
        snapshot
            .batch
            .records
            .iter()
            .find(|record| record.record.node.key == issued.keys[1])
            .expect("published text")
            .record
            .node
            .instance_id
            == 202
    );
    Ok(())
}
