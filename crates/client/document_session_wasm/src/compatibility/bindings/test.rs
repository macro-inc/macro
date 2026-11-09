use super::*;

#[test]
fn hosted_core_hydration_is_exact_and_shared_keys_do_not_collide() -> Result<(), BoundaryError> {
    let config = wire::SessionConfigMsg {
        doc: "compat-hosted-core".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![51, 52, 53],
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
    use compat::{CompatNativePrototype as P, ForeignNodeKind as K};
    let mut registered = vec![];
    let mut metadata = vec![];
    for (class_id, name, kind, prototype) in [
        (1, "root", K::Element, P::RootNode),
        (2, "text", K::Text, P::TextNode),
        (3, "paragraph", K::Element, P::ParagraphNode),
        (4, "linebreak", K::LineBreak, P::LineBreakNode),
        (5, "tab", K::Text, P::TabNode),
        (6, "heading", K::Element, P::HeadingNode),
    ] {
        registered.push(compat::ForeignClassRegistration {
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
    let hosted = compat::CompatHostedConfig {
        registration: compat::CompatConfig {
            editor_id: 1,
            classes: registered,
        },
        classes: metadata,
    };
    let mut editor = EditorSession::create_compat_hosted_inner(
        generated::ABI_MAJOR,
        &bytes(&config)?,
        0.0,
        0.0,
        &bytes(&hosted)?,
        11,
    )?;
    let snapshot = editor.compat_snapshot_inner(0)?;
    let original = snapshot.batch.records[0].record;
    assert!(!snapshot.batch.records[0].has_instance);
    let binding = compat::CompatInstanceBind {
        record: original,
        instance_owner_id: 1,
        class_id: 1,
        instance_id: 101,
    };
    let bound = editor.compat_bind_instance_inner(&bytes(&binding)?)?;
    assert!(bound.has_instance);
    assert!(bound.record.node.class_id == 1 && bound.record.node.instance_id == 101);
    assert!(!bound.has_root_cached_text);
    let repeated = editor.compat_bind_instance_inner(&bytes(&binding)?)?;
    assert!(bound.record == repeated.record);
    for bad in [
        compat::CompatInstanceBind {
            instance_owner_id: 2,
            ..binding
        },
        compat::CompatInstanceBind {
            class_id: 2,
            ..binding
        },
        compat::CompatInstanceBind {
            instance_id: 102,
            ..binding
        },
    ] {
        assert!(editor.compat_bind_instance_inner(&bytes(&bad)?).is_err());
    }
    let mut wrong = binding;
    wrong.record.capture_id += 10_000;
    assert!(editor.compat_bind_instance_inner(&bytes(&wrong)?).is_err());
    let machine::Session::Editor(session) = &editor.machine.session else {
        panic!("editor")
    };
    let state = session.surface().state();
    assert_eq!(state.node_count(), 1);
    assert_eq!(
        state
            .view()
            .foreign_instance(NodeKey::ROOT)
            .unwrap()
            .instance_id(),
        101
    );
    assert!(state
        .view()
        .node_or_err(NodeKey::ROOT)?
        .foreign_raw_root_cached_text()
        .is_none());

    editor
        .machine
        .sync(doc_sync_core::SyncInput::Start, 0.0, None)?;
    editor.machine.sync(
        doc_sync_core::SyncInput::Seed {
            kind: doc_sync_core::SeedKind::Optimistic,
            snapshot: vec![],
        },
        1.0,
        None,
    )?;
    let rebuilt = editor.compat_current_version_inner()?;
    assert!(rebuilt > 0);
    let old = editor.compat_snapshot_inner(0)?;
    assert!(old.batch.records[0].record.node.instance_id == 101);
    let rebound = editor.compat_bind_instance_inner(&bytes(&binding)?)?;
    assert!(rebound.record.node.instance_id == 101);
    let current = editor.compat_snapshot_inner(rebuilt)?;
    let another = compat::CompatInstanceBind {
        record: current.batch.records[0].record,
        instance_owner_id: 1,
        class_id: 1,
        instance_id: 101,
    };
    assert!(editor
        .compat_bind_instance_inner(&bytes(&another)?)
        .is_err());
    let fresh = editor.compat_bind_instance_inner(&bytes(&compat::CompatInstanceBind {
        instance_id: 102,
        ..another
    })?)?;
    assert!(fresh.record.node.instance_id == 102);

    let mut invalid = hosted.clone();
    invalid.classes[0].constructor_token = 0;
    assert!(EditorSession::create_compat_hosted_inner(
        generated::ABI_MAJOR,
        &bytes(&config)?,
        0.0,
        0.0,
        &bytes(&invalid)?,
        11
    )
    .is_err());
    invalid = hosted.clone();
    invalid.registration.classes[0].hooks = ForeignHook::Indent.bit();
    assert!(EditorSession::create_compat_hosted_inner(
        generated::ABI_MAJOR,
        &bytes(&config)?,
        0.0,
        0.0,
        &bytes(&invalid)?,
        11
    )
    .is_err());

    let first = editor.compat_begin_compact_inner(&bytes(&compat::CompatBeginRequest {
        tags: vec![],
        reserve_keys: 1,
        class_mask_patches: vec![],
    })?)?;
    let mut other_config = hosted.clone();
    other_config.registration.editor_id = 2;
    for class in &mut other_config.registration.classes {
        class.owner_id = 2;
    }
    let mut other = EditorSession::create_compat_hosted_inner(
        generated::ABI_MAJOR,
        &bytes(&config)?,
        0.0,
        0.0,
        &bytes(&other_config)?,
        12,
    )?;
    let second = other.compat_begin_compact_inner(&bytes(&compat::CompatBeginRequest {
        tags: vec![],
        reserve_keys: 1,
        class_mask_patches: vec![],
    })?)?;
    assert_ne!(first.reservation.keys, second.reservation.keys);
    assert_eq!(first.reservation.editor_id, 1);
    assert_eq!(second.reservation.editor_id, 2);
    editor.compat_discard().expect("discard reservation");
    other.compat_discard().expect("discard reservation");

    let mut runtime = instance_runtime::InstanceRuntime::new(&hosted, 11)?;
    runtime.transport = clone_transport;
    let mut cloning = EditorSession::create_compat_config(
        generated::ABI_MAJOR,
        &bytes(&config)?,
        0.0,
        0.0,
        hosted.registration.clone(),
        Some(Arc::new(runtime)),
    )?;
    let initial = cloning.compat_snapshot_inner(0)?;
    let root = initial.batch.records[0].record;
    let hydrated = cloning.compat_bind_instance_inner(&bytes(&compat::CompatInstanceBind {
        record: root,
        instance_owner_id: 1,
        class_id: 1,
        instance_id: 101,
    })?)?;
    cloning.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
    let writable = cloning.compat_call_inner(&bytes(&compat::CompatRequest {
        operation: compat::CompatOperation::GetWritable,
        historical: false,
        state_version: 0,
        has_receiver: true,
        receiver: hydrated.record,
        args: vec![],
    })?)?;
    assert!(writable.records[0].record.node.instance_id == 1101);
    assert!(!writable.records[0].has_root_cached_text);
    assert!(cloning
        .compat_bind_instance_inner(&bytes(&compat::CompatInstanceBind {
            record: writable.records[0].record,
            instance_owner_id: 1,
            class_id: 1,
            instance_id: 1101,
        })?)
        .is_err());
    let unbound = cloning.compat_call_inner(&bytes(&compat::CompatRequest {
        operation: compat::CompatOperation::CreateText,
        historical: false,
        state_version: 0,
        has_receiver: false,
        receiver: super::super::test::NO_RECORD,
        args: vec![compat::ForeignCallbackValue::ForeignStringArgument {
            value: "detached".encode_utf16().collect(),
        }],
    })?)?;
    let unbound = unbound
        .records
        .iter()
        .find(|record| record.type_name == "text")
        .expect("pending unbound text");
    assert!(!unbound.has_instance);
    assert!(cloning
        .compat_bind_instance_inner(&bytes(&compat::CompatInstanceBind {
            record: unbound.record,
            instance_owner_id: 1,
            class_id: 2,
            instance_id: 200,
        })?)
        .is_err());
    let pending_version = cloning
        .compatibility
        .as_ref()
        .unwrap()
        .pending_version
        .expect("pending version");
    let historical_pending = cloning.compat_call_inner(&bytes(&compat::CompatRequest {
        operation: compat::CompatOperation::GetLatest,
        historical: true,
        state_version: pending_version,
        has_receiver: true,
        receiver: unbound.record,
        args: vec![],
    })?)?;
    let historical_pending = historical_pending
        .records
        .first()
        .expect("historical pending text");
    assert!(historical_pending.record.update_id == 0);
    assert!(historical_pending.record.access == compat::ForeignAccess::Frozen);
    assert!(cloning
        .compat_bind_instance_inner(&bytes(&compat::CompatInstanceBind {
            record: historical_pending.record,
            instance_owner_id: 1,
            class_id: 2,
            instance_id: 200,
        })?)
        .is_err());
    let old = cloning.compat_snapshot_inner(0)?;
    assert!(old.batch.records[0].record.node.instance_id == 101);
    assert!(!old.batch.records[0].has_root_cached_text);
    cloning
        .compat_discard()
        .expect("discard cloned pending graph");
    cloning.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
    assert!(cloning
        .compat_call_inner(&bytes(&compat::CompatRequest {
            operation: compat::CompatOperation::GetWritable,
            historical: false,
            state_version: 0,
            has_receiver: true,
            receiver: hydrated.record,
            args: vec![],
        })?)
        .is_err());
    cloning
        .compat_discard()
        .expect("discard reused clone identity");

    let mut runtime = instance_runtime::InstanceRuntime::new(&hosted, 11)?;
    runtime.transport = thrown_transport;
    let mut failing = EditorSession::create_compat_config(
        generated::ABI_MAJOR,
        &bytes(&config)?,
        0.0,
        0.0,
        hosted.registration.clone(),
        Some(Arc::new(runtime)),
    )?;
    let initial = failing.compat_snapshot_inner(0)?;
    let bound = failing.compat_bind_instance_inner(&bytes(&compat::CompatInstanceBind {
        record: initial.batch.records[0].record,
        instance_owner_id: 1,
        class_id: 1,
        instance_id: 101,
    })?)?;
    failing.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
    let error = failing
        .compat_call_inner(&bytes(&compat::CompatRequest {
            operation: compat::CompatOperation::GetWritable,
            historical: false,
            state_version: 0,
            has_receiver: true,
            receiver: bound.record,
            args: vec![],
        })?)
        .expect_err("original clone exception");
    let BoundaryError::Model(error) = error else {
        panic!("typed model cause")
    };
    let cause = crate::compatibility_host::error::HostThrown::from_model_error(&error)
        .expect("original opaque exception");
    assert_eq!(cause.host_slot(), 11);
    assert_eq!(
        *cause.value(),
        compat::ForeignOpaqueValue::ForeignSlot { slot_id: 17 }
    );
    failing.compat_discard().expect("discard failed clone");
    let after = failing.compat_snapshot_inner(0)?;
    assert!(after.batch.records[0].record.node.instance_id == 101);
    Ok(())
}

// An explicit in-memory byte transport exercises the real model clone/staging
// path. It does not execute JS constructors or establish browser acceptance.
fn clone_transport(
    scope: &dyn crate::compatibility_host::CallbackScope,
    request: &compat::CompatHostRequest,
) -> Result<compat::CompatHostReply, Error> {
    crate::compatibility_host::invoke_with(scope, request, |slot, encoded| {
        let request = compat::CompatHostRequest::deserialize(encoded)
            .map_err(|error| Error::invariant(error.to_string()))?;
        assert_eq!(slot, 11);
        let compat::CompatHostCall::CompatHostClone {
            stage,
            source_record,
        } = request.call
        else {
            panic!("clone stage");
        };
        assert!(stage.source.instance_id == 101);
        assert!(source_record.record.node.instance_id == 101);
        assert!(stage.ctor_key == stage.destination.key);
        assert!(request.context.access == compat::CompatHostAccess::Clone);
        let forbidden =
            bytes(&compat::CompatCallbackRequest::CompatCallbackReserveKeys { count: 1 })
                .map_err(|error| Error::invariant(error.to_string()))?;
        assert!(crate::compatibility_host::callback_call(
            slot,
            request.context.scope_id,
            &forbidden
        )
        .is_err());
        bytes(&compat::CompatHostReply {
            host_slot: slot,
            scope_id: request.context.scope_id,
            result: compat::CompatHostResult::CompatHostCloneAck {
                ack: compat::ForeignCloneAck {
                    stage_id: stage.stage_id,
                    instance_owner_id: request.context.editor_id,
                    class_id: 1,
                    instance_id: 1101,
                    ctor_key: stage.ctor_key,
                    destination_key: stage.destination.key,
                    base_patch: stage.base,
                    native_projection: stage.native_projection,
                    own_fields: compat::ForeignOpaqueValue::ForeignMissing {},
                    observed_links: stage.required_links,
                },
            },
        })
        .map_err(|error| Error::invariant(error.to_string()))
    })
}

fn thrown_transport(
    scope: &dyn crate::compatibility_host::CallbackScope,
    request: &compat::CompatHostRequest,
) -> Result<compat::CompatHostReply, Error> {
    crate::compatibility_host::invoke_with(scope, request, |slot, _| {
        bytes(&compat::CompatHostReply {
            host_slot: slot,
            scope_id: request.context.scope_id,
            result: compat::CompatHostResult::CompatHostThrown {
                error: compat::ForeignOpaqueValue::ForeignSlot { slot_id: 17 },
            },
        })
        .map_err(|error| Error::invariant(error.to_string()))
    })
}
