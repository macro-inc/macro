use super::*;
use doc_sync_core::*;
use lexical_model::*;

#[test]
fn external_receipts_survive_observation_and_drain_exactly_once() -> Result<(), BoundaryError> {
    let mut editor = cold_editor()?;
    editor.machine.sync(SyncInput::Start, 0.0, None)?;
    editor.machine.sync(
        SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        },
        1.0,
        None,
    )?;
    let seeded = editor.compat_take_publications_inner()?;
    let seeded = compat::CompatPublications::deserialize(&seeded)?;
    assert_eq!(seeded.commits.len(), 1);
    assert!(
        compat::CompatPublications::deserialize(&editor.compat_take_publications_inner()?)?
            .commits
            .is_empty()
    );
    let bootstrap = editor.compat_current_version_inner()?;
    editor.compat_snapshot_inner(bootstrap)?;
    editor.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
    let (host, machine) = editor.compat_parts()?;
    let machine::Session::Editor(session) = &mut machine.session else {
        panic!("editor")
    };
    let pending = host.pending.take().expect("pending");
    let (pending, nodes) = session.with_compat_update(pending, |tx| -> Result<_, Error> {
        for key in tx.children_keys(NodeKey::ROOT)? {
            tx.remove(key, false)?;
        }
        let mut nodes = vec![];
        for _ in 0..10 {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text("unchanged text")?;
            tx.append(p, &[text.key()])?;
            nodes.push((p.key(), text.key()));
        }
        tx.append(
            NodeKey::ROOT,
            &nodes.iter().map(|(key, _)| *key).collect::<Vec<_>>(),
        )?;
        Ok(nodes)
    })?;
    host.pending = Some(pending);
    let nodes = nodes?;
    let created = editor.compat_commit_inner(2.0, 2.0)?;
    assert!(!created.batch.full_reconcile);
    let initial = editor.compat_snapshot_inner(created.version)?;
    assert!(initial.batch.full_reconcile);
    assert_eq!(initial.batch.records.len(), 21);

    editor.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
    let (host, machine) = editor.compat_parts()?;
    let machine::Session::Editor(session) = &mut machine.session else {
        panic!("editor")
    };
    let pending = host.pending.take().expect("pending");
    let (pending, result) = session.with_compat_update(pending, |tx| {
        tx.text(nodes[0].1)?
            .set_text_content("small edit")
            .map(|_| ())
    })?;
    host.pending = Some(pending);
    result?;
    let small = editor.compat_commit_inner(3.0, 3.0)?;
    assert!(!small.batch.full_reconcile);
    assert_eq!(small.batch.records.len(), 3);
    assert!(small.batch.removed_keys.is_empty());
    let small_bytes = bytes(&small)?.len();
    assert!(small_bytes <= 4096);

    editor.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
    let (host, machine) = editor.compat_parts()?;
    let machine::Session::Editor(session) = &mut machine.session else {
        panic!("editor")
    };
    let pending = host.pending.take().expect("pending");
    let (pending, result) = session.with_compat_update(pending, |tx| -> Result<(), Error> {
        let mut paragraphs = vec![];
        for _ in 10..10_000 {
            let p = tx.create(Paragraph::default())?;
            let text = tx.create_text("unchanged text")?;
            tx.append(p, &[text.key()])?;
            paragraphs.push(p.key());
        }
        tx.append(NodeKey::ROOT, &paragraphs)?;
        Ok(())
    })?;
    host.pending = Some(pending);
    result?;
    let grown = editor.compat_commit_inner(4.0, 4.0)?;
    assert!(!grown.batch.full_reconcile);
    // The old last paragraph also changes its next-sibling link.
    assert_eq!(grown.batch.records.len(), 19_982);
    assert!(grown
        .batch
        .records
        .iter()
        .any(|record| record.record.node.key == records::key(nodes[9].0)));
    assert!(grown
        .batch
        .records
        .iter()
        .all(|record| !record.has_root_cached_text && record.root_cached_text.is_empty()));

    let native_edit = |editor: &mut EditorSession, text: &str, now| {
        editor.machine.call(
            document_session::SessionInput::Editor(Input::TextFromView {
                key: nodes[0].1,
                text: text.into(),
                anchor: Some(Utf16Offset(10)),
                focus: Some(Utf16Offset(10)),
                composition_end: false,
                composition_data: None,
                selection: ViewSelection::Range {
                    anchor: Point::text(nodes[0].1, Utf16Offset(10)),
                    focus: Point::text(nodes[0].1, Utf16Offset(10)),
                    resolution_dirty: false,
                },
            }),
            now,
            Some(now),
        )
    };
    native_edit(&mut editor, "large edit", 5.0)?;
    assert!(editor.compat_current_version_inner().is_err());
    assert!(editor
        .compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)
        .is_err());
    assert!(editor.compat_audit_snapshot_inner().is_err());
    let allocated = editor
        .compatibility
        .as_ref()
        .expect("host")
        .keys
        .last_allocated();
    assert!(editor
        .compat_begin_compact_inner(&bytes(&compat::CompatBeginRequest {
            tags: vec![],
            reserve_keys: 3,
            class_mask_patches: vec![],
        })?)
        .is_err());
    assert_eq!(
        editor
            .compatibility
            .as_ref()
            .expect("host")
            .keys
            .last_allocated(),
        allocated
    );
    let encoded = editor.compat_take_publications_inner()?;
    let publications = compat::CompatPublications::deserialize(&encoded)?;
    assert_eq!(publications.commits.len(), 1);
    let large = &publications.commits[0];
    assert_eq!(editor.compat_current_version_inner()?, large.version);
    assert_eq!(large.flags, 0);
    assert!(large.changed);
    assert!(large.dirty_leaves.contains(&records::key(nodes[0].1)));
    assert!(large.tags.is_empty());
    assert!(!large.batch.full_reconcile);
    assert_eq!(large.batch.records.len(), 3);
    assert!(large.batch.removed_keys.is_empty());
    assert!(encoded.len() <= 4096);
    let empty = editor.compat_take_publications_inner()?;
    assert!(compat::CompatPublications::deserialize(&empty)?
        .commits
        .is_empty());
    native_edit(&mut editor, "next edit!", 5.5)?;
    native_edit(&mut editor, "last edit!", 5.6)?;
    assert!(editor.compat_current_version_inner().is_err());
    let (host, machine) = editor.compat_parts()?;
    let machine::Session::Editor(session) = &machine.session else {
        panic!("editor")
    };
    host.enqueue_publications(session.surface().state())?;
    let queued = host
        .publications
        .front()
        .expect("queued actual receipt")
        .version;
    assert!(editor.compat_release_version_inner(queued).is_err());
    assert!(editor.compat_audit_snapshot_inner().is_err());
    let multiple = editor.compat_take_publications_inner()?;
    let multiple = compat::CompatPublications::deserialize(&multiple)?;
    assert_eq!(multiple.commits.len(), 2);
    assert!(multiple.commits[0].version < multiple.commits[1].version);
    assert_eq!(
        editor.compat_current_version_inner()?,
        multiple.commits[1].version
    );

    for index in 0..MAX_PUBLICATIONS + 2 {
        let text = if index % 2 == 0 {
            "queue one!"
        } else {
            "queue two!"
        };
        native_edit(&mut editor, text, 5.7 + index as f64 / 1000.0)?;
    }
    assert!(editor.compat_current_version_inner().is_err());
    let first = editor.compat_take_publications_inner()?;
    assert_eq!(
        compat::CompatPublications::deserialize(&first)?
            .commits
            .len(),
        MAX_PUBLICATIONS
    );
    assert!(editor.compat_current_version_inner().is_err());
    assert!(editor
        .compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)
        .is_err());
    let remainder = editor.compat_take_publications_inner()?;
    assert_eq!(
        compat::CompatPublications::deserialize(&remainder)?
            .commits
            .len(),
        2
    );
    let empty = editor.compat_take_publications_inner()?;
    assert!(compat::CompatPublications::deserialize(&empty)?
        .commits
        .is_empty());

    editor.compat_begin_inner(&bytes(&compat::CompatBegin { tags: vec![] })?)?;
    let pending = editor.compatibility.as_ref().expect("host").pending_version;
    native_edit(&mut editor, "blocked!!!", 5.99)?;
    assert!(editor.compat_commit_inner(6.0, 6.0).is_err());
    assert!(editor
        .compatibility
        .as_ref()
        .expect("host")
        .pending
        .is_some());
    assert_eq!(
        editor.compatibility.as_ref().expect("host").pending_version,
        pending
    );
    assert!(editor.compat_take_publications_inner().is_err());
    editor.compat_discard().expect("actual pending discard");
    let external =
        compat::CompatPublications::deserialize(&editor.compat_take_publications_inner()?)?;
    assert_eq!(external.commits.len(), 1);

    editor.compat_begin_inner(&bytes(&compat::CompatBegin {
        tags: vec!["history-push".into()],
    })?)?;
    let (host, machine) = editor.compat_parts()?;
    let machine::Session::Editor(session) = &mut machine.session else {
        panic!("editor")
    };
    let pending = host.pending.take().expect("pending");
    let (pending, deleted) = session.with_compat_update(pending, |tx| -> Result<_, Error> {
        let p = tx.create(Paragraph::default())?;
        let text = tx.create_text("undo target")?;
        tx.append(p, &[text.key()])?;
        tx.append(NodeKey::ROOT, &[p.key()])?;
        Ok((p.key(), text.key()))
    })?;
    host.pending = Some(pending);
    let deleted = deleted?;
    // Advance the injected clock beyond the actual 400ms typing merge floor.
    editor.compat_commit_inner(1000.0, 1000.0)?;
    assert!(
        compat::CompatPublications::deserialize(&editor.compat_take_publications_inner()?)?
            .commits
            .is_empty()
    );
    editor.machine.call(
        document_session::SessionInput::Editor(Input::Undo),
        1001.0,
        Some(1001.0),
    )?;
    let causal_output = editor.machine.output.clone();
    let machine::Session::Editor(session) = &editor.machine.session else {
        panic!("editor")
    };
    let errors: Vec<_> = session
        .last_output()
        .view
        .iter()
        .filter_map(|effect| {
            if let document_session::ViewEffect::Error(error) = effect {
                Some(error.to_string())
            } else {
                None
            }
        })
        .collect();
    assert!(errors.is_empty(), "{errors:?}");
    // History may publish a separate cursor repair after its tree projection.
    // Compare against the actual observer chain, never a guessed history count.
    let observed = editor
        .compatibility
        .as_ref()
        .expect("host")
        .receipts
        .lock()
        .expect("receipts")
        .iter()
        .map(|(_, commit)| commit.clone())
        .collect::<Vec<_>>();
    assert!(!observed.is_empty());
    let removed =
        compat::CompatPublications::deserialize(&editor.compat_take_publications_inner()?)?;
    assert_eq!(editor.machine.output, causal_output);
    assert_eq!(removed.commits.len(), observed.len());
    for (wire, source) in removed.commits.iter().zip(&observed) {
        assert_eq!(wire.flags, 0);
        assert_eq!(
            wire.tags,
            source
                .tags
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
        );
        assert_eq!(
            wire.dirty_leaves,
            source
                .changes
                .dirty_leaves
                .iter()
                .copied()
                .map(records::key)
                .collect::<Vec<_>>()
        );
        assert_eq!(
            wire.dirty_elements.len(),
            source.changes.dirty_elements.len()
        );
        for (wire, (key, intent)) in wire
            .dirty_elements
            .iter()
            .zip(&source.changes.dirty_elements)
        {
            assert_eq!(wire.key, records::key(*key));
            assert_eq!(wire.intentional, *intent == DirtyIntent::Intentional);
        }
        match (source.next.selection(), &wire.selection) {
            (None, compat::CompatSelectionData::CompatNoSelection {}) => {}
            (
                Some(Selection::Range(actual)),
                compat::CompatSelectionData::CompatRangeSelection {
                    anchor,
                    focus,
                    format,
                    style,
                    ..
                },
            ) => {
                assert_eq!(anchor.key, records::key(actual.anchor.key()));
                assert_eq!(focus.key, records::key(actual.focus.key()));
                assert_eq!(
                    anchor.kind,
                    match actual.anchor {
                        Point::Text { .. } => compat::CompatPointKind::Text,
                        Point::Element { .. } => compat::CompatPointKind::Element,
                    }
                );
                assert_eq!(
                    focus.kind,
                    match actual.focus {
                        Point::Text { .. } => compat::CompatPointKind::Text,
                        Point::Element { .. } => compat::CompatPointKind::Element,
                    }
                );
                assert_eq!({ anchor.offset }, actual.anchor.offset());
                assert_eq!({ focus.offset }, actual.focus.offset());
                assert_eq!(*format, actual.format.bits());
                assert_eq!(*style, actual.style.encode_utf16().collect::<Vec<_>>());
            }
            _ => panic!("history selection receipt differs from actual publication"),
        }
    }
    for pair in removed.commits.windows(2) {
        assert!(pair[0].version < pair[1].version);
    }
    for (wire, source) in removed.commits.iter().zip(&observed).skip(1) {
        assert!(source.changes.is_empty());
        assert!(!source.composition_changed);
        assert_ne!(source.prev.selection(), source.next.selection());
        assert!(wire.batch.records.is_empty());
        assert!(wire.batch.removed_keys.is_empty());
    }
    let last_version = removed.commits.last().expect("actual receipt").version;
    assert_eq!(editor.compat_current_version_inner()?, last_version);
    let removed = &removed.commits[0];
    assert!(removed.tags.contains(&UpdateTag::Collaboration.to_string()));

    assert!(!removed.batch.full_reconcile);
    assert!(removed
        .batch
        .removed_keys
        .contains(&records::key(deleted.0)));
    assert!(removed
        .batch
        .removed_keys
        .contains(&records::key(deleted.1)));
    assert_eq!(removed.batch.removed_keys.len(), 2);
    assert!(removed
        .batch
        .records
        .iter()
        .all(|record| !removed.batch.removed_keys.contains(&record.record.node.key)));
    let final_snapshot = editor.compat_snapshot_inner(last_version)?;
    assert_eq!(final_snapshot.batch.records.len(), 20_001);
    Ok(())
}

fn cold_editor() -> Result<EditorSession, BoundaryError> {
    let config = wire::SessionConfigMsg {
        doc: "compat-sparse-publication".into(),
        session: "00000000-0000-0000-0000-000000000001".into(),
        user: "fixture-user".into(),
        peers: vec![31, 32, 33],
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
    EditorSession::create_compat_inner(
        generated::ABI_MAJOR,
        &bytes(&config)?,
        0.0,
        0.0,
        &bytes(&compat::CompatConfig {
            editor_id: 1,
            classes: vec![],
        })?,
    )
}

#[test]
fn bootstrap_closes_only_after_the_exact_current_snapshot_fence() -> Result<(), BoundaryError> {
    let mut editor = cold_editor()?;
    editor.compat_snapshot_inner(0)?;
    assert!(editor.compatibility.as_ref().expect("host").cold_bootstrap);
    assert_eq!(editor.compat_current_version_inner()?, 0);
    editor.machine.sync(SyncInput::Start, 0.0, None)?;
    editor.machine.sync(
        SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        },
        1.0,
        None,
    )?;
    assert!(editor.compat_snapshot_inner(0).is_err());
    assert!(editor.compatibility.as_ref().expect("host").cold_bootstrap);
    let seeded =
        compat::CompatPublications::deserialize(&editor.compat_take_publications_inner()?)?;
    assert_eq!(seeded.commits.len(), 1);
    assert!(
        compat::CompatPublications::deserialize(&editor.compat_take_publications_inner()?)?
            .commits
            .is_empty()
    );
    let version = editor.compat_current_version_inner()?;
    editor.compat_snapshot_inner(0)?;
    assert!(editor.compatibility.as_ref().expect("host").cold_bootstrap);
    editor.compat_snapshot_inner(version)?;
    assert!(!editor.compatibility.as_ref().expect("host").cold_bootstrap);
    Ok(())
}

#[test]
fn activated_cold_owner_rebuild_rejects_and_preserves_actual_receipts() -> Result<(), BoundaryError>
{
    let mut editor = cold_editor()?;
    let version = editor.compat_current_version_inner()?;
    editor.compat_snapshot_inner(version)?;
    editor.machine.sync(SyncInput::Start, 0.0, None)?;
    editor.machine.sync(
        SyncInput::Seed {
            kind: SeedKind::Optimistic,
            snapshot: vec![],
        },
        1.0,
        None,
    )?;
    let receipts = editor
        .compatibility
        .as_ref()
        .expect("host")
        .receipts
        .lock()
        .expect("lock")
        .len();
    assert_eq!(receipts, 1);
    assert!(editor.compat_current_version_inner().is_err());
    assert!(editor.compat_take_publications_inner().is_err());
    let host = editor.compatibility.as_ref().expect("host");
    assert_eq!(host.version, version);
    assert_eq!(host.receipts.lock().expect("lock").len(), receipts);
    assert!(host.publications.is_empty());
    Ok(())
}

#[test]
fn mixed_actual_owner_receipts_are_rejected_without_movement() -> Result<(), BoundaryError> {
    let mut editor = cold_editor()?;
    let mut foreign = cold_editor()?;
    for session in [&mut editor, &mut foreign] {
        session.machine.sync(SyncInput::Start, 0.0, None)?;
        session.machine.sync(
            SyncInput::Seed {
                kind: SeedKind::Optimistic,
                snapshot: vec![],
            },
            1.0,
            None,
        )?;
    }
    // Integrity rejection uses another real core's receipt, never fabricated Commit data.
    let foreign_receipt = foreign
        .compatibility
        .as_ref()
        .expect("foreign host")
        .receipts
        .lock()
        .expect("lock")
        .first()
        .expect("actual Seed receipt")
        .clone();
    editor
        .compatibility
        .as_ref()
        .expect("host")
        .receipts
        .lock()
        .expect("lock")
        .push(foreign_receipt);
    let version = editor.compatibility.as_ref().expect("host").next_version;
    assert!(editor.compat_take_publications_inner().is_err());
    assert!(editor.compat_current_version_inner().is_err());
    let host = editor.compatibility.as_ref().expect("host");
    assert_eq!(host.receipts.lock().expect("lock").len(), 2);
    assert_eq!(host.next_version, version);
    assert!(host.publications.is_empty());
    assert!(host.cold_bootstrap);
    Ok(())
}
