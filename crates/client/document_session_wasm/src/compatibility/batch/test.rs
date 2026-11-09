use super::*;
use doc_sync_core::*;

#[test]
fn actual_session_batches_keep_pending_identity_and_acknowledge_failed_prefixes(
) -> Result<(), BoundaryError> {
    let config = wire::SessionConfigMsg {
        doc: "batch-fixture".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![47, 48, 49],
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
    let (host, machine) = editor.compat_parts()?;
    let machine::Session::Editor(session) = &mut machine.session else {
        panic!("editor");
    };
    let pending = host.pending.take().expect("pending");
    let (pending, text) = session.with_compat_update(pending, |tx| -> Result<_, Error> {
        let paragraph = tx.create(Paragraph {})?;
        let text = tx.create_text("a")?;
        tx.append(paragraph, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(text.key())
    })?;
    host.pending = Some(pending);
    let text = text?;
    let committed = editor.compat_commit_inner(2.0, 2.0)?;
    let frozen = committed
        .batch
        .records
        .iter()
        .find(|record| record.record.node.key == records::key(text))
        .expect("text")
        .record;
    let first = compat::CompatBatchRequest {
        scope: compat::CompatBatchScope::CompatBatchBegin {
            expected_version: committed.version,
            begin: compat::CompatBeginRequest {
                tags: vec!["batch-tag".into()],
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
            operation: Op::GetWritable,
            receiver: compat::CompatNodeOperand::CompatCapturedNode { record: frozen },
            args: vec![],
            initial_instance: compat::CompatInstanceSeed::CompatNoInstanceSeed {},
        }],
        finalize: false,
        now: 3.0,
        wall: 3.0,
    };
    let ready = editor.compat_batch_inner(&bytes(&first)?)?;
    assert!(!ready.published && !ready.noop && ready.changed);
    assert!(matches!(ready.outcome, Outcome::CompatBatchSuccess {}));
    let writable = ready.results[0]
        .delta
        .records
        .iter()
        .find(|record| record.record.node.key == records::key(text))
        .expect("writable text")
        .record;
    assert_eq!(writable.access, compat::ForeignAccess::Writable);
    let pending_identity = editor.compatibility.as_ref().expect("host").pending_version;
    assert!(editor.compat_batch_inner(&bytes(&first)?).is_err());
    assert_eq!(
        editor.compatibility.as_ref().expect("host").pending_version,
        pending_identity
    );
    assert_eq!(
        editor.compatibility.as_ref().expect("host").mutation_epoch,
        ready.mutation_epoch
    );
    let mut next = compat::CompatBatchRequest {
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
                operation: Op::SetTextContent,
                receiver: compat::CompatNodeOperand::CompatCapturedNode { record: writable },
                args: vec![compat::CompatBatchArgument::CompatValueArgument {
                    value: calls::text("prefix"),
                }],
                initial_instance: compat::CompatInstanceSeed::CompatNoInstanceSeed {},
            },
            compat::CompatBatchOperation {
                operation: Op::SetNativeField,
                receiver: compat::CompatNodeOperand::CompatCapturedNode { record: writable },
                args: vec![
                    compat::CompatBatchArgument::CompatValueArgument {
                        value: calls::text("__unsupported"),
                    },
                    compat::CompatBatchArgument::CompatValueArgument {
                        value: calls::text("fail"),
                    },
                ],
                initial_instance: compat::CompatInstanceSeed::CompatNoInstanceSeed {},
            },
            compat::CompatBatchOperation {
                operation: Op::SetTextContent,
                receiver: compat::CompatNodeOperand::CompatCapturedNode { record: writable },
                args: vec![compat::CompatBatchArgument::CompatValueArgument {
                    value: calls::text("must-not-run"),
                }],
                initial_instance: compat::CompatInstanceSeed::CompatNoInstanceSeed {},
            },
        ],
        finalize: false,
        now: 4.0,
        wall: 4.0,
    };
    let failed = editor.compat_batch_inner(&bytes(&next)?)?;
    assert_eq!(failed.results.len(), 1);
    assert!(matches!(
        failed.outcome,
        Outcome::CompatBatchNativeFailure {
            location: compat::CompatFailureLocation::CompatOperationFailure { index: 1 },
            ..
        }
    ));
    assert!(!failed.published && !failed.noop);
    assert_eq!(
        editor.compatibility.as_ref().expect("host").pending_version,
        pending_identity
    );
    let actual = failed
        .delta
        .records
        .iter()
        .find(|record| record.record.node.key == records::key(text))
        .expect("partial delta");
    assert_eq!(
        String::from_utf16(
            actual
                .base
                .text
                .as_ref()
                .expect("text base")
                .text
                .as_ref()
                .expect("text")
        )
        .expect("UTF16"),
        "prefix"
    );
    assert_eq!(
        editor
            .compat_snapshot_inner(committed.version)?
            .batch
            .records
            .iter()
            .find(|record| record.record.node.key == records::key(text))
            .expect("frozen text")
            .base
            .text
            .as_ref()
            .expect("text")
            .text
            .as_ref()
            .expect("text"),
        &vec![97]
    );
    // A caught failure does not poison the update. Its old continuation epoch is stale.
    assert!(editor.compat_batch_inner(&bytes(&next)?).is_err());
    next.scope = compat::CompatBatchScope::CompatBatchContinue {
        update_id: failed.update_id,
        expected_epoch: failed.mutation_epoch,
    };
    next.operations.truncate(1);
    next.operations[0].args[0] = compat::CompatBatchArgument::CompatValueArgument {
        value: calls::text("recovered"),
    };
    let recovered = editor.compat_batch_inner(&bytes(&next)?)?;
    assert!(matches!(recovered.outcome, Outcome::CompatBatchSuccess {}));
    assert_eq!(recovered.update_id, ready.update_id);
    assert_eq!(recovered.version, ready.version);
    assert_eq!(recovered.tags, vec!["batch-tag"]);
    // A failing detached delete still acknowledges its cache invalidation.
    let host = editor.compatibility.as_mut().expect("host");
    let selection_ref = host.selection_values.allocate(
        Selection::Range(RangeSelection::collapsed(Point::text(text, Utf16Offset(1)))),
        recovered.version,
        recovered.update_id,
    )?;
    let mut body = host.selection_values.get(selection_ref)?.encoded();
    if let compat::CompatSelectionData::CompatRangeSelection {
        has_cached_nodes,
        cached_nodes,
        ..
    } = &mut body
    {
        *has_cached_nodes = true;
        *cached_nodes = vec![writable.node];
    } else {
        panic!("range");
    }
    host.selection_values.patch(
        selection_ref,
        body,
        selection_values::Scope {
            historical: false,
            state_version: recovered.version,
            update: recovered.update_id,
            activate: false,
        },
    )?;
    let detached = compat::CompatBatchRequest {
        scope: compat::CompatBatchScope::CompatBatchContinue {
            update_id: recovered.update_id,
            expected_epoch: recovered.mutation_epoch,
        },
        leases: compat::CompatCaptureLeases {
            editor_id: 1,
            retain: vec![],
            release: vec![],
        },
        operations: vec![compat::CompatBatchOperation {
            operation: Op::SelectionDeleteCharacter,
            receiver: compat::CompatNodeOperand::CompatNoNode {},
            initial_instance: compat::CompatInstanceSeed::CompatNoInstanceSeed {},
            args: vec![
                compat::CompatBatchArgument::CompatValueArgument {
                    value: compat::ForeignCallbackValue::ForeignSelectionArgument {
                        value: selection_ref,
                    },
                },
                compat::CompatBatchArgument::CompatValueArgument {
                    value: compat::ForeignCallbackValue::ForeignBooleanArgument { value: true },
                },
            ],
        }],
        finalize: false,
        now: 4.5,
        wall: 4.5,
    };
    let detached_failure = editor.compat_batch_inner(&bytes(&detached)?)?;
    assert!(matches!(
        detached_failure.outcome,
        Outcome::CompatBatchNativeFailure {
            location: compat::CompatFailureLocation::CompatOperationFailure { index: 0 },
            ..
        }
    ));
    assert!(detached_failure.results.is_empty());
    assert_eq!(detached_failure.selections.len(), 1);
    assert!(
        matches!(&detached_failure.selections[0], compat::CompatSelectionData::CompatRangeSelection {reference,has_cached_nodes:false,cached_nodes,..} if *reference==selection_ref && cached_nodes.is_empty())
    );
    // Malformed authority in a surplus argument rejects before the setter runs.
    next.scope = compat::CompatBatchScope::CompatBatchContinue {
        update_id: recovered.update_id,
        expected_epoch: detached_failure.mutation_epoch,
    };
    next.operations[0].args[0] = compat::CompatBatchArgument::CompatValueArgument {
        value: calls::text("must-not-apply"),
    };
    next.operations[0]
        .args
        .push(compat::CompatBatchArgument::CompatValueArgument {
            value: compat::ForeignCallbackValue::ForeignSelectionArgument {
                value: compat::ForeignSelectionRef {
                    editor_id: 1,
                    version: recovered.version,
                    selection_id: u32::MAX,
                },
            },
        });
    assert!(editor.compat_batch_inner(&bytes(&next)?).is_err());
    assert_eq!(
        editor.compatibility.as_ref().expect("host").mutation_epoch,
        detached_failure.mutation_epoch
    );
    next.operations[0].args.pop();
    next.operations[0]
        .args
        .push(compat::CompatBatchArgument::CompatSelectionIntentArgument {
            intent: compat::CompatSelectionIntent::CompatNoSelectionIntent {},
        });
    assert!(editor.compat_batch_inner(&bytes(&next)?).is_err());
    assert_eq!(
        editor.compatibility.as_ref().expect("host").mutation_epoch,
        detached_failure.mutation_epoch
    );
    let final_commit = editor.compat_commit_inner(5.0, 5.0)?;
    let actual = final_commit
        .batch
        .records
        .iter()
        .find(|record| record.record.node.key == records::key(text))
        .expect("committed text");
    assert_eq!(
        String::from_utf16(
            actual
                .base
                .text
                .as_ref()
                .expect("text base")
                .text
                .as_ref()
                .expect("text")
        )
        .expect("UTF16"),
        "recovered"
    );
    assert_eq!(final_commit.version, recovered.version);
    editor.compatibility.as_mut().expect("host").mutation_epoch = u64::MAX - 1;
    let mut exhausted = first;
    exhausted.scope = compat::CompatBatchScope::CompatBatchBegin {
        expected_version: final_commit.version,
        begin: compat::CompatBeginRequest {
            tags: vec![],
            reserve_keys: 0,
            class_mask_patches: vec![],
        },
    };
    exhausted.operations.clear();
    assert!(editor.compat_batch_inner(&bytes(&exhausted)?).is_err());
    assert!(editor
        .compatibility
        .as_ref()
        .expect("host")
        .pending
        .is_none());
    assert_eq!(
        editor.compatibility.as_ref().expect("host").mutation_epoch,
        u64::MAX - 1
    );
    Ok(())
}
