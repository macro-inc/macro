use super::*;

#[test]
fn read_origin_preserves_source_identity_without_authorizing_the_peer_or_fresh_update()
-> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut other = editor.create_conformance_peer(EditorMode::Headless)?;
    let tx = editor.transaction();
    let owner = tx.foreign_editor_identity();
    let update = tx.foreign_update_identity();
    let snapshot = tx.view().snapshot_for_foreign_read()?.clone();
    assert!(snapshot.matches_origin(&owner, &update));
    assert!(
        snapshot
            .view()
            .snapshot_for_foreign_read()?
            .matches_origin(&owner, &update)
    );
    let other_tx = other.transaction();
    assert!(!snapshot.matches_origin(&other_tx.foreign_editor_identity(), &update));
    assert!(!snapshot.matches_origin(&owner, &other_tx.foreign_update_identity()));
    drop(other_tx);
    snapshot.with_read_transaction(tx.committed_state(), |peer| -> Result<(), Error> {
        assert!(!owner.matches(peer));
        assert!(!update.matches(peer));
        let recaptured = peer.view().snapshot_for_foreign_read()?;
        assert!(recaptured.matches_origin(&owner, &update));
        assert!(!recaptured.matches_origin(
            &peer.foreign_editor_identity(),
            &peer.foreign_update_identity()
        ));
        recaptured.with_read_transaction(peer.committed_state(), |nested| -> Result<(), Error> {
            assert!(
                nested
                    .view()
                    .snapshot_for_foreign_read()?
                    .matches_origin(&owner, &update)
            );
            Ok(())
        })?
    })??;
    // Exercise provenance suspension independently of the peer's mutable owner.
    let mut peer = other.transaction();
    peer.foreign_read_only = true;
    peer.foreign_read_origin = snapshot.origin.clone();
    let peer_owner = peer.foreign_editor_identity();
    let peer_update = peer.foreign_update_identity();
    let pending = peer.suspend();
    let peer = other.resume(pending)?;
    assert!(peer_owner.matches(&peer));
    assert!(peer_update.matches(&peer));
    assert!(!owner.matches(&peer));
    assert!(
        peer.view()
            .snapshot_for_foreign_read()?
            .matches_origin(&owner, &update)
    );
    drop(peer);
    let pending = tx.suspend();
    let tx = editor.resume(pending)?;
    assert!(
        tx.view()
            .snapshot_for_foreign_read()?
            .matches_origin(&owner, &update)
    );
    drop(tx);
    let fresh = editor.transaction();
    assert!(owner.matches(&fresh));
    assert!(!snapshot.matches_origin(&owner, &fresh.foreign_update_identity()));
    // Retained provenance does not assert that this old update is still active.
    assert!(snapshot.matches_origin(&owner, &update));
    assert!(
        !fresh
            .committed_state()
            .view()
            .snapshot_for_foreign_read()?
            .matches_origin(&owner, &fresh.foreign_update_identity())
    );
    let plain = fresh.committed_state().view().snapshot_for_foreign_read()?;
    plain.with_read_transaction(fresh.committed_state(), |peer| -> Result<(), Error> {
        let captured = peer.view().snapshot_for_foreign_read()?;
        assert!(!captured.matches_origin(
            &peer.foreign_editor_identity(),
            &peer.foreign_update_identity()
        ));
        assert!(!captured.matches_origin(&owner, &update));
        captured.with_read_transaction(peer.committed_state(), |nested| -> Result<(), Error> {
            assert!(!nested.view().snapshot_for_foreign_read()?.matches_origin(
                &nested.foreign_editor_identity(),
                &nested.foreign_update_identity()
            ));
            Ok(())
        })?
    })??;
    Ok(())
}

#[test]
fn read_only_peers_reject_pipeline_and_publication_before_callbacks_or_commit_ids()
-> Result<(), Error> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    struct Hooks(Arc<AtomicUsize>);
    impl ForeignHooks for Hooks {
        fn selection_transform(
            &self,
            _: &mut Transaction<'_>,
            _: NodeKey,
        ) -> Override<Result<(), Error>> {
            self.0.fetch_add(1, Ordering::SeqCst);
            Override::Value(Ok(()))
        }
    }
    let calls = Arc::new(AtomicUsize::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .foreign_node(ForeignNodeType {
            type_name: "read-text".into(),
            class_name: "ReadText".into(),
            kind: NodeKind::Text,
            extends: Some("text"),
            required_state: vec![],
            hooks: Arc::new(Hooks(calls.clone())),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let paragraph = tx.create(Paragraph::default())?.key();
    let text = tx.create_foreign("read-text", SerializedNode::new())?;
    tx.text(text)?.set_text_content("pending")?;
    tx.append(paragraph, &[text])?;
    tx.append(NodeKey::ROOT, &[paragraph])?;
    tx.text(text)?
        .select(Some(Utf16Offset(2)), Some(Utf16Offset(2)))?;
    let snapshot = tx.view().snapshot_for_foreign_read()?;
    snapshot.with_read_transaction(tx.committed_state(), |peer| -> Result<(), Error> {
        let publication = peer.editor.suspend_version;
        assert!(matches!(peer.flush(), Err(Error::ForeignReadOnly)));
        assert!(matches!(
            peer.flush_with(FlushMode::NormalizeOnly),
            Err(Error::ForeignReadOnly)
        ));
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert!(matches!(peer.commit_phase(), Err(Error::ForeignReadOnly)));
        assert_eq!(peer.editor.suspend_version, publication);
        assert!(peer.committed_state().is_empty_state());
        peer.sealed = true;
        assert!(matches!(peer.flush(), Err(Error::ForeignReadOnly)));
        assert!(matches!(peer.commit_phase(), Err(Error::ForeignReadOnly)));
        assert_eq!(peer.editor.suspend_version, publication);
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert_eq!(peer.text_content(text), "pending");
        assert_eq!(peer.editor.keys.next_commit()?, CommitId(1));
        Ok(())
    })??;
    assert!(tx.committed_state().is_empty_state());
    assert_eq!(tx.text_content(text), "pending");
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    Ok(())
}

#[test]
fn read_only_point_values_change_without_composition_dirty_or_cache_side_effects()
-> Result<(), Error> {
    // LexicalSelection.ts Point.set and RangeSelection.isBackward keep value
    // writes in read mode while skipping composition, dirty and memo writes.
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let ((first, second), _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?.key();
        let q = tx.create(Paragraph::default())?.key();
        let first = tx.create_text("first")?.key();
        let second = tx.create_text("second")?.key();
        tx.append(p, &[first])?;
        tx.append(q, &[second])?;
        tx.append(NodeKey::ROOT, &[p, q])?;
        tx.text(first)?
            .select(Some(Utf16Offset(1)), Some(Utf16Offset(3)))?;
        Ok((first, second))
    })?;
    let mut tx = editor.transaction();
    tx.set_composition_key(Some(first))?;
    assert!(!tx.range_is_backward_at(SelectionSlot::Active)?);
    let Selection::Range(active) = tx.selection_mut_at(SelectionSlot::Active)? else {
        panic!("range")
    };
    active.dirty = false;
    let detached = tx.detach_selection(Selection::Range(RangeSelection::new(
        Point::text(first, Utf16Offset(1)),
        Point::text(first, Utf16Offset(3)),
    )));
    let snapshot = tx.view().snapshot_for_foreign_read()?;
    snapshot.with_read_transaction(tx.committed_state(), |peer| -> Result<(), Error> {
        assert!(!peer.selection_dirty);
        let dirty_since_flush = peer.dirty_since_flush;
        peer.set_point_at(
            SelectionSlot::Active,
            PointRole::Anchor,
            Point::text(second, Utf16Offset(2)),
        )?;
        let active = peer.range_selection()?;
        assert_eq!(active.anchor, Point::text(second, Utf16Offset(2)));
        assert_eq!(active.focus, Point::text(first, Utf16Offset(3)));
        assert_eq!(active.cached_is_backward(), Some(false));
        assert!(!active.dirty);
        assert!(!peer.range_is_backward_at(SelectionSlot::Active)?);
        assert_eq!(peer.composition_key(), Some(first));
        peer.set_point_at(
            detached,
            PointRole::Anchor,
            Point::text(second, Utf16Offset(2)),
        )?;
        assert!(peer.range_is_backward_at(detached)?);
        assert_eq!(peer.range_at(detached)?.cached_is_backward(), None);
        assert!(!peer.range_at(detached)?.dirty);
        peer.set_text_node_range_at(detached, second, Utf16Offset(4), second, Utf16Offset(1))?;
        assert!(peer.range_is_backward_at(detached)?);
        assert_eq!(peer.range_at(detached)?.cached_is_backward(), None);
        assert!(!peer.range_at(detached)?.dirty);
        assert!(!peer.selection_dirty);
        assert_eq!(peer.dirty_since_flush, dirty_since_flush);
        assert_eq!(peer.composition_key(), Some(first));
        assert!(matches!(
            peer.set_point_at(
                detached,
                PointRole::Anchor,
                Point::element(second, ChildIndex(0))
            ),
            Err(Error::PointTypeMismatch)
        ));
        assert_eq!(
            peer.anchor_at(detached)?,
            Point::text(second, Utf16Offset(4))
        );
        assert!(matches!(
            peer.set_selection(None),
            Err(Error::ForeignReadOnly)
        ));
        Ok(())
    })??;
    assert_eq!(tx.anchor()?, Point::text(first, Utf16Offset(1)));
    assert_eq!(tx.anchor_at(detached)?, Point::text(first, Utf16Offset(1)));
    assert_eq!(tx.composition_key(), Some(first));
    assert_eq!(
        snapshot
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("range")
            .anchor,
        Point::text(first, Utf16Offset(1))
    );
    Ok(())
}

#[test]
fn owned_read_keeps_pending_text_selection_composition_and_previous_selection() -> Result<(), Error>
{
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let (text, _) = editor.update(|tx| {
        let p = tx.create(Paragraph::default())?.key();
        let text = tx.create_text("before")?.key();
        tx.append(p, &[text])?;
        tx.append(NodeKey::ROOT, &[p])?;
        tx.text(text)?
            .select(Some(Utf16Offset(3)), Some(Utf16Offset(3)))?;
        Ok(text)
    })?;
    let mut tx = editor.transaction();
    tx.text(text)?.set_text_content("pending")?;
    tx.text(text)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(1)))?;
    tx.set_composition_key(Some(text))?;
    let snapshot = tx.view().snapshot_for_foreign_read()?;
    assert_eq!(snapshot.state().root_text_content().as_ref(), "pending");
    tx.text(text)?.set_text_content("after")?;
    tx.set_selection(None)?;
    tx.set_composition_key(None)?;
    assert_eq!(snapshot.text_content(text), "pending");
    assert_eq!(
        snapshot
            .state()
            .selection()
            .and_then(Selection::as_range)
            .expect("range")
            .anchor
            .offset(),
        1
    );
    assert_eq!(
        snapshot
            .previous_selection()
            .and_then(Selection::as_range)
            .expect("previous range")
            .anchor
            .offset(),
        3
    );
    assert!(snapshot.is_composing(text));
    assert_eq!(tx.text_content(text), "after");
    assert!(tx.selection().is_none());
    assert_eq!(tx.composition_key(), None);
    tx.commit()?;
    assert_eq!(snapshot.text_content(text), "pending");
    assert_eq!(editor.state().view().text_content(text), "after");
    assert_eq!(editor.state().root_text_content().as_ref(), "after");
    Ok(())
}

#[test]
fn owned_read_materializes_the_current_native_projection_and_keeps_it_independent()
-> Result<(), Error> {
    #[derive(Clone, Default, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
    struct Counter {
        count: u32,
    }
    impl NodeType for Counter {
        const TYPE: &'static str = "counter";
        type Kind = ElementKind;
        impl_default_node!();
    }
    impl ElementNode for Counter {
        element_node_base!();
        fn is_inline(&self, _: ElementView<'_>) -> bool {
            self.count >= 7
        }
    }
    struct Hooks(Arc<std::sync::atomic::AtomicU32>);
    impl ForeignHooks for Hooks {
        fn after_clone(
            &self,
            _: NodeKey,
            _: NodeKey,
            _: &ForeignData,
        ) -> Override<Option<ForeignData>> {
            self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Override::Inherit
        }
    }
    let clones = Arc::new(std::sync::atomic::AtomicU32::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Counter>()
        .foreign_node(ForeignNodeType {
            type_name: "foreign-counter".into(),
            class_name: "ForeignCounter".into(),
            kind: NodeKind::Element,
            extends: Some("counter"),
            required_state: vec![],
            hooks: Arc::new(Hooks(clones.clone())),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx.create_foreign("foreign-counter", SerializedNode::new())?;
    let snapshot = crate::foreign::projection::native(&mut tx, key, |_, tx| {
        tx.get_mut::<Counter>(key)?.count = 7;
        let snapshot = tx.view().snapshot_for_foreign_read()?;
        assert!(
            snapshot.matches_origin(&tx.foreign_editor_identity(), &tx.foreign_update_identity())
        );
        let identity = snapshot.record_identity(key)?;
        assert!(identity.matches(tx.node_or_err(key)?));
        assert!(!identity.matches(snapshot.node_or_err(key)?));
        assert!(identity == snapshot.clone().record_identity(key)?);
        let nested = snapshot.view().snapshot_for_foreign_read()?;
        assert!(identity == nested.record_identity(key)?);
        snapshot.with_read_transaction(tx.committed_state(), |peer| -> Result<(), Error> {
            let nested = peer.view().snapshot_for_foreign_read()?;
            assert!(identity == nested.record_identity(key)?);
            assert_eq!(
                nested.foreign_data(key).expect("foreign").fields["count"],
                7
            );
            nested.with_read_transaction(peer.committed_state(), |inner| -> Result<(), Error> {
                assert!(
                    identity
                        == inner
                            .view()
                            .snapshot_for_foreign_read()?
                            .record_identity(key)?
                );
                Ok(())
            })?
        })??;
        let root_identity = snapshot.record_identity(NodeKey::ROOT)?;
        assert!(root_identity.matches(tx.node_or_err(NodeKey::ROOT)?));
        assert!(root_identity.matches(snapshot.node_or_err(NodeKey::ROOT)?));
        let mut identities = std::collections::HashSet::new();
        identities.insert(identity.clone());
        identities.insert(snapshot.record_identity(key)?);
        identities.insert(root_identity);
        assert_eq!(identities.len(), 2);
        assert_eq!(clones.load(std::sync::atomic::Ordering::SeqCst), 0);
        assert_eq!(
            snapshot.foreign_data(key).expect("foreign").fields["count"],
            7
        );
        assert!(snapshot.is_inline(key));
        assert!(snapshot.get::<Counter>(key).is_none());
        tx.get_mut::<Counter>(key)?.count = 9;
        assert_eq!(
            snapshot.foreign_data(key).expect("foreign").fields["count"],
            7
        );
        Ok(snapshot)
    })?;
    assert_eq!(tx.foreign_data(key).expect("foreign").fields["count"], 9);
    tx.set_foreign_field(key, "count", serde_json::json!(11))?;
    assert!(!snapshot.record_identity(key)?.matches(tx.node_or_err(key)?));
    let changed = tx.view().snapshot_for_foreign_read()?;
    assert!(snapshot.record_identity(key)? != changed.record_identity(key)?);
    assert_eq!(
        snapshot.foreign_data(key).expect("foreign").fields["count"],
        7
    );
    assert!(snapshot.is_inline(key));
    drop(tx);
    assert_eq!(
        snapshot.foreign_data(key).expect("foreign").fields["count"],
        7
    );
    Ok(())
}

#[test]
fn independent_read_preserves_detached_slots_holes_and_selection_object_fields() -> Result<(), Error>
{
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let ((paragraph, text), _) = editor.update(|tx| {
        let paragraph = tx.create(Paragraph::default())?.key();
        let text = tx.create_text("abcdef")?.key();
        tx.append(paragraph, &[text])?;
        tx.append(NodeKey::ROOT, &[paragraph])?;
        tx.text(text)?
            .select(Some(Utf16Offset(1)), Some(Utf16Offset(3)))?;
        Ok((paragraph, text))
    })?;
    let Some(Selection::Range(previous)) = editor.state.selection.as_mut() else {
        panic!("previous range")
    };
    previous.cached_direction = Some((previous.anchor, previous.focus, false));
    let mut tx = editor.transaction();
    tx.text(text)?
        .select(Some(Utf16Offset(4)), Some(Utf16Offset(2)))?;
    assert!(tx.range_is_backward_at(SelectionSlot::Active)?);
    let mut range = RangeSelection::new(
        Point::text(text, Utf16Offset(5)),
        Point::text(text, Utf16Offset(1)),
    );
    range.cached_direction = Some((range.anchor, range.focus, true));
    range.style = "color: red".into();
    range.format = TextFormat::BOLD;
    range.dirty = true;
    tx.detached.push(None);
    let range_slot = tx.detach_selection(Selection::Range(range));
    let mut nodes = NodeSelection::new();
    nodes.add(text);
    nodes.add(paragraph);
    let node_slot = tx.detach_selection(Selection::Node(nodes));
    let table_slot = tx.detach_selection(Selection::Table(TableSelection::new(
        paragraph, text, paragraph,
    )));
    let snapshot = tx.view().snapshot_for_foreign_read()?.clone();
    tx.detached.clear();
    tx.set_selection(None)?;
    snapshot.with_read_transaction(tx.committed_state(), |peer| -> Result<(), Error> {
        assert_eq!(peer.detached.len(), 4);
        assert!(peer.detached[0].is_none());
        let active = peer.range_selection()?;
        assert_eq!(active.anchor.offset(), 4);
        assert_eq!(active.cached_is_backward(), Some(true));
        let previous = peer
            .previous_selection()
            .and_then(Selection::as_range)
            .expect("previous");
        assert_eq!(previous.anchor.offset(), 1);
        assert_eq!(previous.cached_is_backward(), Some(false));
        let range = peer.range_at(range_slot)?;
        assert_eq!(range.anchor.offset(), 5);
        assert_eq!(range.focus.offset(), 1);
        assert_eq!(range.cached_is_backward(), Some(true));
        assert_eq!(range.style.as_ref(), "color: red");
        assert_eq!(range.format, TextFormat::BOLD);
        assert!(range.dirty);
        assert_eq!(
            peer.selection_at(node_slot)?
                .and_then(Selection::as_node)
                .expect("nodes")
                .nodes
                .iter()
                .copied()
                .collect::<Vec<_>>(),
            [text, paragraph]
        );
        let table = peer
            .selection_at(table_slot)?
            .and_then(Selection::as_table)
            .expect("table");
        assert_eq!(table.table, paragraph);
        assert_eq!(table.anchor.key(), text);
        assert_eq!(table.focus.key(), paragraph);
        assert_eq!(
            peer.detach_selection(Selection::Node(NodeSelection::new())),
            SelectionSlot::Detached(DetachedSelectionId(4))
        );
        peer.detached.clear();
        Ok(())
    })??;
    snapshot.with_read_transaction(tx.committed_state(), |peer| {
        assert_eq!(peer.detached.len(), 4);
        assert_eq!(
            peer.range_at(range_slot)
                .expect("range")
                .cached_is_backward(),
            Some(true)
        );
    })?;
    assert!(tx.detached.is_empty());
    assert!(tx.selection().is_none());
    assert!(matches!(
        snapshot.record_identity(NodeKey::from_parts(KeyParts {
            generation: 0,
            index: 999
        })),
        Err(Error::NodeNotFound(_))
    ));
    Ok(())
}

#[test]
fn independent_read_peer_preserves_inputs_and_rejects_guarded_writes_before_hooks()
-> Result<(), Error> {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NATIVE_CLONES: AtomicUsize = AtomicUsize::new(0);
    static NATIVE_IMPORTS: AtomicUsize = AtomicUsize::new(0);
    static NATIVE_DEFAULTS: AtomicUsize = AtomicUsize::new(0);
    #[derive(Clone, Default, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
    struct Probe {}
    impl NodeType for Probe {
        const TYPE: &'static str = "read-probe";
        type Kind = ElementKind;
        fn default_node() -> Option<Self> {
            NATIVE_DEFAULTS.fetch_add(1, Ordering::SeqCst);
            Some(Self {})
        }
        fn after_clone(&self) -> Option<Self> {
            NATIVE_CLONES.fetch_add(1, Ordering::SeqCst);
            Some(self.clone())
        }
        fn import(tx: &mut Transaction<'_>, _: &SerializedNode) -> Result<NodeKey, Error> {
            NATIVE_IMPORTS.fetch_add(1, Ordering::SeqCst);
            Ok(tx.create(Self {})?.key())
        }
    }
    impl ElementNode for Probe {
        element_node_base!();
    }
    struct Hooks {
        splices: Arc<AtomicUsize>,
        clones: Arc<AtomicUsize>,
    }
    impl ForeignHooks for Hooks {
        fn splice(
            &self,
            _: &mut Transaction<'_>,
            _: NodeKey,
            _: ChildIndex,
            _: u32,
            _: &[NodeKey],
        ) -> Override<Result<(), Error>> {
            self.splices.fetch_add(1, Ordering::SeqCst);
            Override::Inherit
        }
        fn after_clone(
            &self,
            _: NodeKey,
            _: NodeKey,
            _: &ForeignData,
        ) -> Override<Option<ForeignData>> {
            self.clones.fetch_add(1, Ordering::SeqCst);
            Override::Inherit
        }
    }
    let splices = Arc::new(AtomicUsize::new(0));
    let clones = Arc::new(AtomicUsize::new(0));
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Probe>()
        .foreign_node(ForeignNodeType {
            type_name: "read-native-probe".into(),
            class_name: "ReadNativeProbe".into(),
            kind: NodeKind::Element,
            extends: Some("read-probe"),
            required_state: vec![],
            hooks: Arc::new(Hooks {
                splices: splices.clone(),
                clones: clones.clone(),
            }),
        })
        .foreign_node(ForeignNodeType {
            type_name: "read-paragraph".into(),
            class_name: "ReadParagraph".into(),
            kind: NodeKind::Element,
            extends: Some("paragraph"),
            required_state: vec![],
            hooks: Arc::new(Hooks {
                splices: splices.clone(),
                clones: clones.clone(),
            }),
        })
        .build()
        .expect("editor");
    let ((paragraph, text), _) = editor.update(|tx| {
        let paragraph = tx.create_foreign("read-paragraph", SerializedNode::new())?;
        let text = tx.create_text("before")?.key();
        tx.append(paragraph, &[text])?;
        tx.append(NodeKey::ROOT, &[paragraph])?;
        tx.text(text)?
            .select(Some(Utf16Offset(3)), Some(Utf16Offset(3)))?;
        Ok((paragraph, text))
    })?;
    let mut tx = editor.transaction();
    tx.text(text)?.set_text_content("pending")?;
    tx.text(text)?
        .select(Some(Utf16Offset(1)), Some(Utf16Offset(1)))?;
    tx.set_composition_key(Some(text))?;
    let probe = tx.create(Probe {})?.key();
    let snapshot = tx.view().snapshot_for_foreign_read()?;
    let committed = tx.committed_state().clone();
    let splice_count = splices.load(Ordering::SeqCst);
    let clone_count = clones.load(Ordering::SeqCst);
    let native_clone_count = NATIVE_CLONES.load(Ordering::SeqCst);
    let native_import_count = NATIVE_IMPORTS.load(Ordering::SeqCst);
    let native_default_count = NATIVE_DEFAULTS.load(Ordering::SeqCst);
    snapshot.with_read_transaction(&committed, |peer| -> Result<(), Error> {
        assert_eq!(peer.committed_state().view().text_content(text), "before");
        assert_eq!(peer.text_content(text), "pending");
        assert_eq!(
            peer.previous_selection()
                .and_then(Selection::as_range)
                .expect("previous")
                .anchor
                .offset(),
            3
        );
        assert_eq!(peer.range_selection()?.anchor.offset(), 1);
        assert_eq!(peer.composition_key(), Some(text));
        assert!(matches!(
            peer.copy_node(probe, false),
            Err(Error::ForeignReadOnly)
        ));
        assert!(matches!(
            peer.create_resolved::<Probe>(),
            Err(Error::ForeignReadOnly)
        ));
        let imported = serde_json::json!({"type":"read-probe","version":1})
            .as_object()
            .expect("object")
            .clone();
        assert!(matches!(
            peer.import_node(&imported),
            Err(Error::ForeignReadOnly)
        ));
        assert!(matches!(
            peer.create_foreign("read-native-probe", SerializedNode::new()),
            Err(Error::ForeignReadOnly)
        ));
        assert!(matches!(
            peer.create_text("forbidden"),
            Err(Error::ForeignReadOnly)
        ));
        assert!(matches!(
            peer.text(text)?.set_text_content("forbidden"),
            Err(Error::ForeignReadOnly)
        ));
        assert!(matches!(
            peer.append(paragraph, &[]),
            Err(Error::ForeignReadOnly)
        ));
        assert!(matches!(peer.clear(paragraph), Err(Error::ForeignReadOnly)));
        assert!(matches!(
            peer.remove(text, false),
            Err(Error::ForeignReadOnly)
        ));
        assert!(matches!(
            peer.mark_dirty(paragraph),
            Err(Error::ForeignReadOnly)
        ));
        assert!(matches!(
            peer.set_selection(None),
            Err(Error::ForeignReadOnly)
        ));
        assert!(matches!(
            peer.set_composition_key(None),
            Err(Error::ForeignReadOnly)
        ));
        assert!(matches!(
            peer.queue_update(|_| Ok(()), UpdateOptions::default()),
            Err(Error::ForeignReadOnly)
        ));
        assert!(matches!(
            peer.restore_editor_state(&committed),
            Err(Error::ForeignReadOnly)
        ));
        assert_eq!(
            Error::ForeignReadOnly.to_string(),
            "Cannot use method in read-only mode."
        );
        assert_eq!(peer.text_content(text), "pending");
        Ok(())
    })??;
    assert_eq!(NATIVE_CLONES.load(Ordering::SeqCst), native_clone_count);
    assert_eq!(NATIVE_IMPORTS.load(Ordering::SeqCst), native_import_count);
    assert_eq!(NATIVE_DEFAULTS.load(Ordering::SeqCst), native_default_count);
    assert_eq!(splices.load(Ordering::SeqCst), splice_count);
    assert_eq!(clones.load(Ordering::SeqCst), clone_count);
    assert_eq!(tx.text_content(text), "pending");
    assert_eq!(tx.range_selection()?.anchor.offset(), 1);
    assert_eq!(tx.composition_key(), Some(text));
    assert_eq!(tx.create_text("after")?.key().to_string(), "4");
    let other = Editor::builder(EditorMode::Headless)
        .build()
        .expect("other editor");
    assert!(matches!(
        snapshot.with_read_transaction(other.state(), |_| panic!(
            "foreign state must reject before callback"
        )),
        Err(Error::ForeignEditorState)
    ));
    tx.commit()?;
    assert_eq!(editor.state().root_text_content().as_ref(), "pending");
    Ok(())
}

#[test]
fn record_identity_tokens_preserve_writability_and_change_only_with_record_copies()
-> Result<(), Error> {
    let mut editor = Editor::builder(EditorMode::Headless)
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx.create_text("first")?.key();
    let identity = tx.view().foreign_record_identity(key)?;
    assert!(tx.is_writable(key));
    tx.text(key)?.set_text_content("same record")?;
    assert!(identity == tx.view().foreign_record_identity(key)?);
    assert!(identity.clone().matches(tx.node_or_err(key)?));
    assert!(tx.is_writable(key));
    let snapshot = tx.view().snapshot_for_foreign_read()?;
    tx.text(key)?.set_text_content("copied record")?;
    assert!(identity != tx.view().foreign_record_identity(key)?);
    assert!(!identity.matches(tx.node_or_err(key)?));
    assert!(identity.matches(snapshot.node_or_err(key)?));
    assert!(identity == snapshot.record_identity(key)?);
    assert_eq!(snapshot.text_content(key), "same record");
    Ok(())
}

#[test]
fn retaining_a_record_identity_does_not_retain_the_node_payload() -> Result<(), Error> {
    #[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
    struct ResourceNode {
        #[serde(skip)]
        resource: Arc<()>,
    }
    impl NodeType for ResourceNode {
        const TYPE: &'static str = "identity-resource";
        type Kind = DecoratorKind;
        impl_default_node!();
    }
    impl DecoratorNode for ResourceNode {
        decorator_node_base!();
    }
    let resource = Arc::new(());
    let observer = Arc::downgrade(&resource);
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<ResourceNode>()
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let key = tx.create(ResourceNode { resource })?.key();
    let identity = tx.view().foreign_record_identity(key)?;
    assert!(observer.upgrade().is_some());
    drop(tx);
    assert!(observer.upgrade().is_none());
    assert!(identity == identity.clone());
    Ok(())
}

#[test]
fn pure_hooks_capture_projected_payloads_without_exposing_native_typed_reads() -> Result<(), Error>
{
    #[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
    struct Counter {
        count: u32,
        observe: Option<u32>,
    }
    impl NodeType for Counter {
        const TYPE: &'static str = "pure-counter";
        type Kind = ElementKind;
        impl_default_node!();
    }
    impl ElementNode for Counter {
        element_node_base!();
        fn is_inline(&self, node: ElementView<'_>) -> bool {
            if let Some(index) = self.observe {
                assert!(!node.state.is_inline(NodeKey::from_parts(KeyParts {
                    generation: 0,
                    index
                })));
            }
            false
        }
    }
    struct Hooks(Arc<std::sync::Mutex<Vec<ForeignReadSnapshot>>>);
    impl ForeignHooks for Hooks {
        fn is_inline(&self, node: NodeView<'_>, data: &ForeignData) -> Override<bool> {
            assert!(node.state.get::<Counter>(node.key).is_none());
            self.0
                .lock()
                .expect("captures")
                .push(node.state.snapshot_for_foreign_read().expect("capture"));
            if data
                .fields
                .get("observe")
                .is_some_and(serde_json::Value::is_u64)
            {
                Override::Inherit
            } else {
                Override::Value(false)
            }
        }
    }
    let captures = Arc::new(std::sync::Mutex::new(Vec::new()));
    let mut editor = Editor::builder(EditorMode::Headless)
        .node::<Counter>()
        .foreign_node(ForeignNodeType {
            type_name: "pure-foreign-counter".into(),
            class_name: "PureForeignCounter".into(),
            kind: NodeKind::Element,
            extends: Some("pure-counter"),
            required_state: vec![],
            hooks: Arc::new(Hooks(captures.clone())),
        })
        .build()
        .expect("editor");
    let mut tx = editor.transaction();
    let first = tx.create_foreign("pure-foreign-counter", SerializedNode::new())?;
    let sibling = tx.create_foreign("pure-foreign-counter", SerializedNode::new())?;
    let last = tx.create_foreign("pure-foreign-counter", SerializedNode::new())?;
    tx.set_foreign_field(first, "observe", serde_json::json!(sibling.index()))?;
    tx.set_foreign_field(sibling, "observe", serde_json::json!(last.index()))?;
    tx.set_foreign_field(first, "count", serde_json::json!(0))?;
    tx.set_foreign_field(sibling, "count", serde_json::json!(0))?;
    let source = tx.view().foreign_record_identity(first)?;
    crate::foreign::projection::native(&mut tx, first, |_, tx| {
        tx.get_mut::<Counter>(first)?.count = 7;
        assert!(!tx.is_inline(first));
        assert!(!tx.is_inline(sibling));
        // The ordinary source still has the pre-write-back fields.
        assert_eq!(tx.foreign_data(first).expect("source").fields["count"], 0);
        Ok(())
    })?;
    let captured = captures.lock().expect("captures").clone();
    assert_eq!(captured.len(), 5);
    for snapshot in &captured {
        assert_eq!(
            snapshot.foreign_data(first).expect("projected").fields["count"],
            7
        );
        assert_eq!(
            snapshot.foreign_data(sibling).expect("sibling").fields["count"],
            0
        );
        assert!(source == snapshot.record_identity(first)?);
        assert!(snapshot.get::<Counter>(first).is_none());
        snapshot.with_read_transaction(tx.committed_state(), |peer| {
            assert!(!peer.is_inline(last));
        })?;
    }
    let nested = captures.lock().expect("captures");
    assert_eq!(nested.len(), 10);
    assert_eq!(
        nested[9].foreign_data(first).expect("nested").fields["count"],
        7
    );
    assert_eq!(tx.foreign_data(first).expect("written").fields["count"], 7);
    Ok(())
}
