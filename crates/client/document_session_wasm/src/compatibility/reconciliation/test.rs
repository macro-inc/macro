use super::*;
use compat::{CompatNativePrototype as P, CompatOperation as Op, ForeignNodeKind as K};
use doc_sync_core::*;

type Transport =
    fn(&dyn CallbackScope, &compat::CompatHostRequest) -> Result<compat::CompatHostReply, Error>;
fn fixture(transport: Transport) -> Result<EditorSession, BoundaryError> {
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
    let mut runtime = instance_runtime::InstanceRuntime::new(
        &compat::CompatHostedConfig {
            registration: compat::CompatConfig {
                editor_id: 1,
                classes: classes.clone(),
            },
            classes: metadata,
        },
        11,
    )?;
    runtime.transport = transport;
    let mut editor = EditorSession::create_compat_config(
        generated::ABI_MAJOR,
        &bytes(&config)?,
        0.0,
        0.0,
        compat::CompatConfig {
            editor_id: 1,
            classes,
        },
        Some(Arc::new(runtime)),
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
    editor.compat_current_version_inner()?;
    editor.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
    Ok(editor)
}

fn callback_request(
    context: compat::CompatHostContext,
    receiver: compat::ForeignRecordRef,
    operation: Op,
    args: Vec<compat::CompatBatchArgument>,
) -> compat::CompatCallbackRequest {
    compat::CompatCallbackRequest::CompatCallbackBatch {
        request: compat::CompatBatchRequest {
            scope: compat::CompatBatchScope::CompatBatchContinue {
                update_id: context.update_id,
                expected_epoch: context.mutation_epoch,
            },
            leases: compat::CompatCaptureLeases {
                editor_id: context.editor_id,
                retain: vec![],
                release: vec![],
            },
            operations: vec![compat::CompatBatchOperation {
                operation,
                receiver: compat::CompatNodeOperand::CompatCapturedNode { record: receiver },
                args,
                initial_instance: compat::CompatInstanceSeed::CompatNoInstanceSeed {},
            }],
            finalize: false,
            now: 2.0,
            wall: 2.0,
        },
    }
}
fn success(
    scope: &dyn CallbackScope,
    request: &compat::CompatHostRequest,
) -> Result<compat::CompatHostReply, Error> {
    crate::compatibility_host::invoke_with(scope, request, |_, input| {
        let actual = compat::CompatHostRequest::deserialize(input)
            .map_err(|e| Error::invariant(e.to_string()))?;
        let compat::CompatHostCall::CompatHostReconcile { stage } = actual.call else {
            return Err(Error::Invariant("stage"));
        };
        let record = actual
            .delta
            .records
            .iter()
            .find(|record| record.type_name == "paragraph")
            .ok_or(Error::Invariant("paragraph"))?
            .record;
        let compat::CompatCallbackReply::CompatCallbackBatchReply { reply } = scope.call(
            callback_request(actual.context, record, Op::GetWritable, vec![]),
        )?
        else {
            return Err(Error::Invariant("batch"));
        };
        assert!(reply.mutation_epoch > actual.context.mutation_epoch);
        assert!(scope
            .call(callback_request(
                actual.context,
                record,
                Op::GetWritable,
                vec![]
            ))
            .is_err());
        let mut recursive = callback_request(actual.context, record, Op::GetWritable, vec![]);
        if let compat::CompatCallbackRequest::CompatCallbackBatch { request } = &mut recursive {
            request.finalize = true;
        }
        assert!(scope.call(recursive).is_err());
        let mut nested_begin = callback_request(actual.context, record, Op::GetWritable, vec![]);
        if let compat::CompatCallbackRequest::CompatCallbackBatch { request } = &mut nested_begin {
            request.scope = compat::CompatBatchScope::CompatBatchBegin {
                expected_version: stage.previous_version,
                begin: compat::CompatBeginRequest {
                    tags: vec![],
                    reserve_keys: 0,
                    class_mask_patches: vec![],
                },
            };
        }
        assert!(scope.call(nested_begin).is_err());
        let writable = reply
            .delta
            .records
            .iter()
            .find(|r| r.record.node.key == record.node.key)
            .ok_or(Error::Invariant("writable paragraph"))?
            .record;
        let ack = compat::CompatHostReply {
            host_slot: actual.context.host_slot,
            scope_id: actual.context.scope_id,
            result: compat::CompatHostResult::CompatHostReconcileAck {
                ack: compat::CompatReconcileAck {
                    stage_id: stage.stage_id,
                    leases: compat::CompatCaptureLeases {
                        editor_id: actual.context.editor_id,
                        retain: vec![],
                        release: vec![],
                    },
                    operations: vec![compat::CompatBatchOperation {
                        operation: Op::SetNativeField,
                        receiver: compat::CompatNodeOperand::CompatCapturedNode {
                            record: writable,
                        },
                        args: vec![
                            compat::CompatBatchArgument::CompatValueArgument {
                                value: calls::text("__textFormat"),
                            },
                            compat::CompatBatchArgument::CompatValueArgument {
                                value: compat::ForeignCallbackValue::ForeignNumberArgument {
                                    value: 1.0,
                                },
                            },
                        ],
                        initial_instance: compat::CompatInstanceSeed::CompatNoInstanceSeed {},
                    }],
                    value_patches: vec![],
                },
            },
        };
        bytes(&ack).map_err(model_error)
    })
}
fn thrown(
    scope: &dyn CallbackScope,
    request: &compat::CompatHostRequest,
) -> Result<compat::CompatHostReply, Error> {
    crate::compatibility_host::invoke_with(scope, request, |_, input| {
        let actual = compat::CompatHostRequest::deserialize(input)
            .map_err(|e| Error::invariant(e.to_string()))?;
        let record = actual
            .delta
            .records
            .iter()
            .find(|record| record.type_name == "text")
            .ok_or(Error::Invariant("text"))?
            .record;
        scope.call(callback_request(
            actual.context,
            record,
            Op::SetTextContent,
            vec![compat::CompatBatchArgument::CompatValueArgument {
                value: calls::text("prefix before throw"),
            }],
        ))?;
        bytes(&compat::CompatHostReply {
            host_slot: actual.context.host_slot,
            scope_id: actual.context.scope_id,
            result: compat::CompatHostResult::CompatHostThrown {
                error: compat::ForeignOpaqueValue::ForeignUndefined {},
            },
        })
        .map_err(model_error)
    })
}
#[test]
fn actual_reconcile_callback_applies_derived_ack_before_ordinary_admission(
) -> Result<(), BoundaryError> {
    let mut editor = fixture(success)?;
    let (host, machine) = editor.compat_parts()?;
    let machine::Session::Editor(session) = &mut machine.session else {
        panic!("editor");
    };
    let pending = host.pending.take().expect("pending");
    let (pending, result) =
        session.with_compat_update(pending, |tx| -> Result<(), BoundaryError> {
            let p = tx.create(Paragraph {})?;
            let text = tx.create_text("stage text")?;
            tx.append(p, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            scopes::with_pending_frame(host, || {
                let receipt = batch_execution::execute(
                    tx,
                    &[],
                    batch_execution::Normalization::Updater,
                    vec![],
                )?;
                let receipt = run(tx, &receipt)?;
                assert!(receipt.selections.is_empty());
                if let Some(error) = receipt.error {
                    return Err(error);
                }
                assert!(!tx.needs_flush());
                assert!(tx.create_text("sealed").is_err());
                assert!(tx.view().element(p).expect("paragraph").text_format.bits() == 1);
                Ok(())
            })
        })?;
    host.pending = Some(pending);
    result?;
    let committed = editor.compat_commit_inner(3.0, 3.0)?;
    assert!(committed.changed);
    Ok(())
}
#[test]
fn callback_throw_keeps_prefix_and_does_not_seal_the_pending_update() -> Result<(), BoundaryError> {
    let mut editor = fixture(thrown)?;
    let (host, machine) = editor.compat_parts()?;
    let machine::Session::Editor(session) = &mut machine.session else {
        panic!("editor");
    };
    let pending = host.pending.take().expect("pending");
    let (pending, result) =
        session.with_compat_update(pending, |tx| -> Result<(), BoundaryError> {
            let p = tx.create(Paragraph {})?;
            let text = tx.create_text("stage text")?;
            tx.append(p, &[text.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
            scopes::with_pending_frame(host, || {
                let receipt = batch_execution::execute(
                    tx,
                    &[],
                    batch_execution::Normalization::Updater,
                    vec![],
                )?;
                let error = run(tx, &receipt)?.error.expect("host threw");
                let BoundaryError::Model(error) = error else {
                    panic!("typed model error");
                };
                let cause = crate::compatibility_host::error::HostThrown::from_model_error(&error)
                    .expect("original cause");
                assert_eq!(cause.host_slot(), 11);
                assert!(matches!(
                    cause.value(),
                    compat::ForeignOpaqueValue::ForeignUndefined {}
                ));
                assert_eq!(tx.text_content(text), "prefix before throw");
                tx.text(text)?.set_text_content("caught and continued")?;
                Ok(())
            })
        })?;
    host.pending = Some(pending);
    result
}

fn seed_pending_text(editor: &mut EditorSession) -> Result<(), BoundaryError> {
    let (host, machine) = editor.compat_parts()?;
    let machine::Session::Editor(session) = &mut machine.session else {
        panic!("editor");
    };
    let pending = host.pending.take().expect("pending");
    let (pending, result) = session.with_compat_update(pending, |tx| -> Result<(), Error> {
        let p = tx.create(Paragraph {})?;
        let text = tx.create_text("finalize text")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok(())
    })?;
    host.pending = Some(pending);
    result?;
    Ok(())
}
fn finalize(editor: &mut EditorSession) -> Result<compat::CompatBatchReply, BoundaryError> {
    let host = editor.compatibility.as_ref().expect("host");
    editor.compat_batch_inner(&bytes(&compat::CompatBatchRequest {
        scope: compat::CompatBatchScope::CompatBatchContinue {
            update_id: host.update,
            expected_epoch: host.mutation_epoch,
        },
        leases: compat::CompatCaptureLeases {
            editor_id: host.editor,
            retain: vec![],
            release: vec![],
        },
        operations: vec![],
        finalize: true,
        now: 3.0,
        wall: 3.0,
    })?)
}
#[test]
fn compact_finalization_publishes_and_retires_noops_on_the_real_session(
) -> Result<(), BoundaryError> {
    let mut editor = fixture(success)?;
    let before = editor.compatibility.as_ref().expect("host").version;
    let noop = finalize(&mut editor)?;
    assert!(noop.noop && !noop.published);
    assert!(editor
        .compatibility
        .as_ref()
        .expect("host")
        .pending
        .is_none());
    assert_eq!(editor.compatibility.as_ref().expect("host").version, before);
    assert!(editor.compat_snapshot_inner(noop.version).is_ok());
    let begun = editor.compat_batch_inner(&bytes(&compat::CompatBatchRequest {
        scope: compat::CompatBatchScope::CompatBatchBegin {
            expected_version: noop.version,
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
        operations: vec![],
        finalize: false,
        now: 3.0,
        wall: 3.0,
    })?)?;
    assert!(begun.version != noop.version);
    seed_pending_text(&mut editor)?;
    let committed = finalize(&mut editor)?;
    assert!(committed.published && !committed.noop && committed.changed);
    assert!(matches!(
        committed.outcome,
        compat::CompatBatchOutcome::CompatBatchSuccess {}
    ));
    assert!(editor
        .compatibility
        .as_ref()
        .expect("host")
        .pending
        .is_none());
    assert!(committed.version != before);
    let machine::Session::Editor(session) = &editor.machine.session else {
        panic!("editor");
    };
    assert_eq!(
        session.surface().state().root_text_content().as_ref(),
        "finalize text"
    );
    Ok(())
}
#[test]
fn compact_policy_refusal_recovers_the_exact_update_for_retry() -> Result<(), BoundaryError> {
    let mut editor = fixture(success)?;
    seed_pending_text(&mut editor)?;
    let version = editor.compatibility.as_ref().expect("host").pending_version;
    editor.machine.sync(
        SyncInput::Authorization(AuthorizationState {
            current: true,
            can_write: false,
            can_comment: true,
        }),
        2.0,
        None,
    )?;
    let refused = finalize(&mut editor)?;
    assert!(!refused.published && !refused.noop);
    assert!(matches!(
        refused.outcome,
        compat::CompatBatchOutcome::CompatBatchNativeFailure { .. }
    ));
    let host = editor.compatibility.as_ref().expect("host");
    assert_eq!(host.pending_version, version);
    assert!(host.pending.is_some());
    let machine::Session::Editor(session) = &editor.machine.session else {
        panic!("editor");
    };
    assert!(session.surface().state().is_empty_state());
    editor.machine.sync(
        SyncInput::Authorization(AuthorizationState {
            current: true,
            can_write: true,
            can_comment: true,
        }),
        4.0,
        None,
    )?;
    let accepted = finalize(&mut editor)?;
    assert!(accepted.published && !accepted.noop);
    assert!(matches!(
        accepted.outcome,
        compat::CompatBatchOutcome::CompatBatchSuccess {}
    ));
    assert!(Some(accepted.version) == version);
    Ok(())
}

fn selection_prefix_failure(
    scope: &dyn CallbackScope,
    request: &compat::CompatHostRequest,
) -> Result<compat::CompatHostReply, Error> {
    crate::compatibility_host::invoke_with(scope, request, |_, input| {
        let actual = compat::CompatHostRequest::deserialize(input)
            .map_err(|e| Error::invariant(e.to_string()))?;
        let compat::CompatHostCall::CompatHostReconcile { stage } = actual.call else {
            return Err(Error::Invariant("stage"));
        };
        let record = actual
            .delta
            .records
            .iter()
            .find(|record| record.type_name == "text")
            .ok_or(Error::Invariant("text"))?
            .record;
        let mut create = callback_request(actual.context, record, Op::CreateNodeSelection, vec![]);
        if let compat::CompatCallbackRequest::CompatCallbackBatch { request } = &mut create {
            request.operations[0].receiver = compat::CompatNodeOperand::CompatNoNode {};
        }
        let compat::CompatCallbackReply::CompatCallbackBatchReply { reply } = scope.call(create)?
        else {
            return Err(Error::Invariant("batch"));
        };
        let compat::ForeignCallbackValue::ForeignSelectionArgument { value: reference } =
            reply.results[0].value
        else {
            return Err(Error::Invariant("real selection"));
        };
        bytes(&compat::CompatHostReply {
            host_slot: actual.context.host_slot,
            scope_id: actual.context.scope_id,
            result: compat::CompatHostResult::CompatHostReconcileAck {
                ack: compat::CompatReconcileAck {
                    stage_id: stage.stage_id,
                    leases: compat::CompatCaptureLeases {
                        editor_id: actual.context.editor_id,
                        retain: vec![],
                        release: vec![],
                    },
                    operations: vec![
                        compat::CompatBatchOperation {
                            operation: Op::NodeSelectionAdd,
                            receiver: compat::CompatNodeOperand::CompatNoNode {},
                            args: vec![
                                compat::CompatBatchArgument::CompatValueArgument {
                                    value: compat::ForeignCallbackValue::ForeignSelectionArgument {
                                        value: reference,
                                    },
                                },
                                compat::CompatBatchArgument::CompatNodeArgument {
                                    value: compat::CompatNodeOperand::CompatCapturedNode { record },
                                },
                            ],
                            initial_instance: compat::CompatInstanceSeed::CompatNoInstanceSeed {},
                        },
                        compat::CompatBatchOperation {
                            operation: Op::SetNativeField,
                            receiver: compat::CompatNodeOperand::CompatCapturedNode { record },
                            args: vec![compat::CompatBatchArgument::CompatValueArgument {
                                value: calls::text("__unsupported"),
                            }],
                            initial_instance: compat::CompatInstanceSeed::CompatNoInstanceSeed {},
                        },
                    ],
                    value_patches: vec![],
                },
            },
        })
        .map_err(model_error)
    })
}
#[test]
fn failed_reconcile_ack_delivers_latest_detached_selection_prefix() -> Result<(), BoundaryError> {
    let mut editor = fixture(selection_prefix_failure)?;
    seed_pending_text(&mut editor)?;
    let failed = finalize(&mut editor)?;
    assert!(!failed.published && !failed.noop);
    assert!(matches!(
        failed.outcome,
        compat::CompatBatchOutcome::CompatBatchNativeFailure { .. }
    ));
    let selection = failed
        .selections
        .iter()
        .find_map(|selection| {
            if let compat::CompatSelectionData::CompatNodeSelection { keys, dirty, .. } = selection
            {
                Some((keys, dirty))
            } else {
                None
            }
        })
        .expect("changed detached selection");
    assert_eq!(selection.0.len(), 1);
    assert!(*selection.1);
    assert!(editor
        .compatibility
        .as_ref()
        .expect("host")
        .pending
        .is_some());
    Ok(())
}

#[test]
fn final_operations_normalize_after_an_earlier_clean_flush() -> Result<(), BoundaryError> {
    let mut editor = fixture(success)?;
    seed_pending_text(&mut editor)?;
    let host = editor.compatibility.as_ref().expect("host");
    let ready = editor.compat_batch_inner(&bytes(&compat::CompatBatchRequest {
        scope: compat::CompatBatchScope::CompatBatchContinue {
            update_id: host.update,
            expected_epoch: host.mutation_epoch,
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
    let text = ready
        .delta
        .records
        .iter()
        .find(|record| record.type_name == "text")
        .expect("text")
        .record;
    let result = editor.compat_batch_inner(&bytes(&compat::CompatBatchRequest {
        scope: compat::CompatBatchScope::CompatBatchContinue {
            update_id: ready.update_id,
            expected_epoch: ready.mutation_epoch,
        },
        leases: compat::CompatCaptureLeases {
            editor_id: 1,
            retain: vec![],
            release: vec![],
        },
        operations: vec![compat::CompatBatchOperation {
            operation: Op::SetTextContent,
            receiver: compat::CompatNodeOperand::CompatCapturedNode { record: text },
            args: vec![compat::CompatBatchArgument::CompatValueArgument {
                value: calls::text(""),
            }],
            initial_instance: compat::CompatInstanceSeed::CompatNoInstanceSeed {},
        }],
        finalize: true,
        now: 3.0,
        wall: 3.0,
    })?)?;
    assert!(
        result.published
            && matches!(
                result.outcome,
                compat::CompatBatchOutcome::CompatBatchSuccess {}
            )
    );
    assert!(result.delta.removed_keys.contains(&text.node.key));
    let retired = result
        .delta
        .records
        .iter()
        .find(|record| record.record.node.key == text.node.key)
        .expect("final raw removed metadata");
    assert!(!retired.links.parent.present);
    assert!(retired
        .base
        .text
        .as_ref()
        .expect("text")
        .text
        .as_ref()
        .expect("value")
        .is_empty());
    let raw = editor.compat_call_inner(&bytes(&compat::CompatRequest {
        operation: Op::GetNodeField,
        historical: true,
        state_version: result.version,
        has_receiver: true,
        receiver: retired.record,
        args: vec![calls::text("__parent")],
    })?)?;
    assert!(matches!(
        raw.value,
        compat::ForeignCallbackValue::ForeignOpaqueArgument {
            value: compat::ForeignOpaqueValue::ForeignNull {}
        }
    ));
    assert!(editor
        .compat_call_inner(&bytes(&compat::CompatRequest {
            operation: Op::GetLatest,
            historical: true,
            state_version: result.version,
            has_receiver: true,
            receiver: retired.record,
            args: vec![],
        })?)
        .is_err());
    let machine::Session::Editor(session) = &editor.machine.session else {
        panic!("editor");
    };
    assert_eq!(session.surface().state().root_text_content().as_ref(), "");
    Ok(())
}
